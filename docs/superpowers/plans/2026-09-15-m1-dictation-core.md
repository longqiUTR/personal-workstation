# M1 听写核心闭环 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出一个能每天用的听写训练闭环——素材导入得进来、四档听写跑得通、错词自动入库并按 FSRS 排期复习。

**Architecture:** 三层。`src/shared/` 是**纯函数层**，装全部判定逻辑（归一化、diff、关键词、计分、rating），无 IO、无框架依赖，可 100% 单测——M1 的风险几乎全集中在这里。`src/server/` 是 Fastify + SQLite，repository 层隔离数据访问。`src/web/` 是 Vue 3 界面。判定规则互相牵制（见 `docs/kb/pitfalls.md` 的 16 条），所以纯函数层严格 TDD，每个测试用例直接对应一条已知陷阱。

**Tech Stack:** Node 20 / TypeScript 5.9.3 / Fastify / node-sqlite3-wasm / ts-fsrs 5.4.2 / Vue 3 + Vite / Vitest

**必读前置：** `docs/kb/user-profile.md`（这个项目为什么长这样）、`docs/kb/dictation-engine.md`（判定规则全文）、`docs/kb/pitfalls.md`（16 条陷阱）

## 范围说明：档位自动调节推迟到 M2

spec §5.5 的档位自动调节（连续 3 天 >90% 提示升档、<60% 自动降档）**不在 M1**。

原因：它要读"该档位有记录的日子的正确率"，数据源是 `daily` 汇总表——而 `daily` 是总览页的东西，属于 M2。为了 M1 硬凑一套日聚合，等于把 M2 的一半提前做了，与"早一天开始训练"相冲突。

**M1 的档位是手动切换的**（快捷键 `1`/`2`/`3`/`4`），当前档位存浏览器 `localStorage`，不入库。

`grading.ts` 的 `nextMode()` 和它的测试**照写**——降档下限那条规则（`pitfalls.md` #10）趁现在记下来成本为零，M2 接入时直接用。但 M1 没有调用方，这是刻意的。

`daily` 表同样不在 M1 的 schema 里。M2 建表时从 `attempts` 回填历史即可（`attempts` 有 `created_at` 和 `mode`，信息是全的）。

---

## 文件结构

```
src/
  shared/                      纯函数层，无 IO，全部可单测
    types.ts                   领域类型（Mode/Outcome/Rating/DiffResult…）
    wordlists/
      stopwords.ts             停用词表（约 180 词，字面量）
      homophones.ts            高危同音组（20-30 组，字面量）
      contractions.ts          缩写展开白名单
      frequency.ts             词频 rank 表加载器
      dictionary.ts            合法英文词表加载器（拼写容错用）
    normalize.ts               归一化流水线（5 步，顺序固定）
    diff.ts                    词级 LCS 对齐 + 拼写容错 + 计分
    keywords.ts                关键词 / 候选池 / 挖空选择
    grading.ts                 outcome 判定 + rating 映射
    transcript.ts              LRC / SRT 解析
  server/
    index.ts                   Fastify 启动
    db/
      schema.sql               建表语句
      connection.ts            连接 + 迁移
      repositories/            数据访问抽象层（禁止在别处写 SQL）
        materials.ts  sentences.ts  attempts.ts  words.ts  reviews.ts
    services/
      import.ts                素材导入（音频 + 字幕 → materials/sentences）
      dictation.ts             听写提交（串 diff → 错词入库 → SRS 联动）
      scheduler.ts             FSRS 调度 + 当日去重 + 曝光推迟
    routes/
      materials.ts  dictation.ts  review.ts
  web/
    main.ts  App.vue  api.ts
    views/     ImportView.vue  DictationView.vue  ReviewView.vue
    components/AudioPlayer.vue  DictationPane.vue  DiffResult.vue  ReviewCard.vue
tests/shared/                  纯函数层测试，用例对应 pitfalls.md
  normalize.test.ts  diff.test.ts  keywords.test.ts
  grading.test.ts    transcript.test.ts
assets/wordlists/              静态词表数据文件（随仓库版本控制）
  frequency-top20k.txt  dictionary-en.txt
```

**边界原则：** `shared/` 不 import `server/` 或 `web/` 的任何东西，也不碰 fs/网络。这条守住，判定逻辑就永远可测。

---

## Task 1: 项目脚手架

**Files:**
- Create: `package.json`、`tsconfig.json`、`vitest.config.ts`、`src/shared/types.ts`

- [ ] **Step 1: 初始化 package.json**

```bash
cd C:/Users/86185/Desktop/balabala/personal-workstation
npm init -y
```

- [ ] **Step 2: 装依赖**

`ts-fsrs` **必须钉死版本**（`Card` 结构在版本间变过，而 `words` 表是按 `Card` 铺平的）。先查当前版本再钉：

**先建 `.npmrc`**，否则装依赖会慢到不可用（实测官方 registry 走代理约 11s/包，装十几个包连带上百个传递依赖会拖到几十分钟）：

```
registry=https://registry.npmmirror.com
```

然后装（**摘掉代理**，`env -u HTTP_PROXY -u HTTPS_PROXY npm install ...`，镜像在国内走代理反而慢）：

```bash
npm i fastify @fastify/static node-sqlite3-wasm ts-fsrs@5.4.2 vue vue-router
npm i -D typescript@5.9.3 tsx vitest @types/node @vitejs/plugin-vue vite vue-tsc
```

**两个版本必须锁死，不带 `^`：**

| 包 | 锁定版本 | 不锁会怎样 |
|---|---|---|
| `ts-fsrs` | `5.4.2` | `Card` 结构在版本间变过，而 `words` 表是按 `Card` 铺平的，浮动版本会让表结构与库悄悄错位 |
| `typescript` | `5.9.3` | TS 7 移除了 `baseUrl`，且 `vue-tsc` 找不到 `typescript/lib/tsc`（exports 不再暴露该路径），`npm run tsc` 直接崩 |

`@fastify/static` 是 Task 9 音频流所必需：`reply.sendFile` 来自它，且要靠它支持 Range 请求，否则前端无法 seek 到句子起点。

不装 `@fastify/cors`——前端走 vite proxy（Task 12.5），同源请求不需要 CORS。

**存储引擎是 `node-sqlite3-wasm`，不是 `better-sqlite3`。** 后者在本机装不上：没有 Node 20 的预编译二进制，回落到 node-gyp 编译时缺 Visual Studio C++ 工具链。`node-sqlite3-wasm` 是 WASM 版 SQLite，零编译，已实测建表、部分索引（带 `WHERE`）、参数化查询、`all`/`get`/`run`、文件持久化全部可用，`schema.sql` 一个字都不用改。

⚠️ 它是 **CommonJS** 包，在 `"type": "module"` 的项目里必须用 default import：

```ts
import pkg from 'node-sqlite3-wasm'
const { Database } = pkg
```

写成 `import { Database } from 'node-sqlite3-wasm'` 会报 `Named export 'Database' not found`。

- [ ] **Step 3: 写 package.json 的 scripts**

```json
{
  "type": "module",
  "scripts": {
    "dev:server": "tsx watch src/server/index.ts",
    "dev:web": "vite",
    "test": "vitest run",
    "test:watch": "vitest",
    "tsc": "tsc --noEmit && vue-tsc --noEmit"
  }
}
```

- [ ] **Step 4: tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "paths": { "@shared/*": ["./src/shared/*"] }
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

**不要加 `baseUrl`。** TS 5.x 起 `paths` 直接相对 tsconfig.json 所在目录解析，不需要它；而 TS 7 已彻底移除该选项，写了会报 `TS5102`。

`noUncheckedIndexedAccess` 打开是刻意的：diff 算法里大量数组下标访问，这个选项能在编译期逼出越界隐患。

- [ ] **Step 5: vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
  resolve: { alias: { '@shared': resolve(__dirname, './src/shared') } },
})
```

- [ ] **Step 6: 领域类型 `src/shared/types.ts`**

```ts
/** 四档强度。保命档不考察词，accuracy 恒为 null。 */
export type Mode = 'lifeline' | 'light' | 'medium' | 'heavy'

export type Outcome = 'ok' | 'weak' | 'revealed' | 'skipped'

/** 与 ts-fsrs 的 Rating 对齐。Easy 在听写路径不可达。 */
export type Rating = 'again' | 'hard' | 'good' | 'easy'

/** 单个词的判定结果。spelling_slip 计入分子但不进错词库。 */
export type WordVerdict = 'correct' | 'spelling_slip' | 'wrong' | 'missing'

export interface WordDiff {
  expected: string
  actual: string | null
  verdict: WordVerdict
  /** 是否是本次考察词——只有考察词参与计分 */
  tested: boolean
}

export interface DiffResult {
  words: WordDiff[]
  testedTotal: number
  testedCorrect: number
  /** testedTotal 为 0 时必须是 null，不得写 0 或 100 */
  accuracy: number | null
  /** 需要进错词库的词（wrong + missing，且是考察词） */
  errorWords: string[]
}
```

- [ ] **Step 7: 验证工具链**

```bash
npm run tsc
```
Expected: 无输出（通过）

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/shared/types.ts
git commit -m "chore: scaffold project toolchain"
```

---

## Task 2: 词表资源

**Files:**
- Create: `src/shared/wordlists/stopwords.ts`、`homophones.ts`、`contractions.ts`、`frequency.ts`、`dictionary.ts`
- Create: `assets/wordlists/frequency-top20k.txt`、`assets/wordlists/dictionary-en.txt`

- [ ] **Step 1: 停用词表**

`src/shared/wordlists/stopwords.ts` —— 标准英文 stopwords，约 180 词，导出 `Set<string>`：

```ts
export const STOPWORDS = new Set([
  'a','an','the','and','or','but','if','then','than','so','because',
  'as','of','at','by','for','with','about','against','between','into',
  'through','during','before','after','above','below','to','from','up',
  'down','in','out','on','off','over','under','again','further','once',
  'here','there','when','where','why','how','all','any','both','each',
  'few','more','most','other','some','such','no','nor','not','only',
  'own','same','too','very','can','will','just','should','now',
  'i','me','my','myself','we','our','ours','ourselves','you','your',
  'yours','he','him','his','she','her','hers','it','its','they','them',
  'their','theirs','what','which','who','whom','this','that','these',
  'those','am','is','are','was','were','be','been','being','have','has',
  'had','having','do','does','did','doing','would','could','ought',
])
```

⚠️ 注意 `there`/`their`/`its`/`than`/`then`/`to`/`too`/`off` 都在这个表里——这正是 Task 5 必须用高危同音组打补丁的原因（`docs/kb/pitfalls.md` #8）。

- [ ] **Step 2: 高危同音组**

`src/shared/wordlists/homophones.ts`：

```ts
/**
 * 高危同音组。组内词一律计入关键词，无论是不是停用词。
 * 不加这个表，系统对最典型的连读弱读错误完全失明——详见 kb/pitfalls.md #8。
 */
export const HOMOPHONE_GROUPS: readonly (readonly string[])[] = [
  ["their", "there", "they're"],
  ["its", "it's"],
  ["than", "then"],
  ["to", "too", "two"],
  ["your", "you're"],
  ["were", "where", "we're"],
  ["of", "off"],
  ["whose", "who's"],
  ["weather", "whether"],
  ["quite", "quiet"],
  ["affect", "effect"],
  ["accept", "except"],
  ["lose", "loose"],
  ["desert", "dessert"],
  ["principal", "principle"],
  ["week", "weak"],
  ["piece", "peace"],
  ["through", "threw"],
  ["write", "right"],
  ["hear", "here"],
  ["buy", "by", "bye"],
  ["knew", "new"],
  ["one", "won"],
  ["sea", "see"],
  ["wear", "where"],
]

export const HOMOPHONE_WORDS: Set<string> = new Set(
  HOMOPHONE_GROUPS.flat()
)
```

- [ ] **Step 3: 缩写白名单**

`src/shared/wordlists/contractions.ts`：

```ts
/**
 * 只展开发音上难以区分、且 transcript 写法不稳定的 n't 类缩写。
 * 's / 're / 've / 'll 一律不展开——it's ≠ its 是期望行为，
 * 它们正是四六级听力考点。详见 kb/dictation-engine.md。
 */
export const CONTRACTIONS: ReadonlyArray<[RegExp, string]> = [
  [/\bdon't\b/gi, 'do not'],
  [/\bdoesn't\b/gi, 'does not'],
  [/\bdidn't\b/gi, 'did not'],
  [/\bcan't\b/gi, 'can not'],
  [/\bcannot\b/gi, 'can not'],
  [/\bwon't\b/gi, 'will not'],
  [/\bisn't\b/gi, 'is not'],
  [/\baren't\b/gi, 'are not'],
  [/\bwasn't\b/gi, 'was not'],
  [/\bweren't\b/gi, 'were not'],
  [/\bhaven't\b/gi, 'have not'],
  [/\bhasn't\b/gi, 'has not'],
  [/\bhadn't\b/gi, 'had not'],
  [/\bshouldn't\b/gi, 'should not'],
  [/\bwouldn't\b/gi, 'would not'],
  [/\bcouldn't\b/gi, 'could not'],
  [/\bgonna\b/gi, 'going to'],
  [/\bwanna\b/gi, 'want to'],
]
```

- [ ] **Step 4: 下载词表数据**

合法英文词表（拼写容错的前提，没它整条规则实现不了）和词频表：

```bash
mkdir -p assets/wordlists
# 合法英文词表：一行一词，小写
curl -L -o assets/wordlists/dictionary-en.txt \
  https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt
```

⚠️ `words_alpha.txt` 约 **37 万条**，含大量生僻词和古体词，而 spec §10.1 要的是约 10 万词的 SCOWL。词表越大，"打出的是真词 → 判错"这条分支命中越多，手滑会更多地被误判成听错。

先用它跑通，**若发现错词库变脏（出现明显是手滑却被判错的词），换 SCOWL size-60**。

词频表：取一份 COCA/Google Books 前 2 万词 rank 列表存为 `assets/wordlists/frequency-top20k.txt`，一行一词、按频次降序（行号即 rank）。若一时找不到合适来源，**先用 `words_alpha.txt` 跑不通**——它没有频次信息。临时方案是把 `STOPWORDS` 之外的词全当低频（rank 视为 99999），Task 5 的挖空优先级会退化但不阻塞，后续补表即可。

- [ ] **Step 5: 加载器**

`src/shared/wordlists/dictionary.ts`：

```ts
/**
 * 合法英文词表。用于区分"听成了另一个真词"和"拼写手滑"。
 * 注入式设计：shared 层不碰 fs，由调用方加载后传入。
 */
let dictionary: Set<string> = new Set()

export function loadDictionary(words: Iterable<string>): void {
  dictionary = new Set([...words].map((w) => w.toLowerCase()))
}

export function isRealWord(word: string): boolean {
  return dictionary.has(word.toLowerCase())
}

export function dictionarySize(): number {
  return dictionary.size
}
```

`src/shared/wordlists/frequency.ts` 同构，导出 `loadFrequency(words)` 和 `rankOf(word): number`（不在表中返回 `Number.MAX_SAFE_INTEGER`）。

- [ ] **Step 6: Commit**

```bash
git add src/shared/wordlists assets/wordlists .gitignore
git commit -m "feat: add stopword, homophone and contraction word lists"
```

注意 `assets/wordlists/*.txt` 体积可能有几 MB。若不想入库，加进 `.gitignore` 并在 README 写明下载命令——但**高危同音组和停用词必须入库**（它们是代码不是数据）。

---

## Task 3: 归一化流水线（TDD）

**Files:**
- Create: `src/shared/normalize.ts`
- Test: `tests/shared/normalize.test.ts`

- [ ] **Step 1: 写失败的测试**

`tests/shared/normalize.test.ts` —— 用例直接对应 `kb/pitfalls.md` #3 和 #11：

```ts
import { describe, it, expect } from 'vitest'
import { normalize } from '@shared/normalize'

describe('normalize', () => {
  it('转小写并按空白分词', () => {
    expect(normalize('The Quick Brown')).toEqual(['the', 'quick', 'brown'])
  })

  it('展开白名单里的 n\'t 缩写', () => {
    expect(normalize("I don't know")).toEqual(['i', 'do', 'not', 'know'])
  })

  // pitfalls #11：带尾随标点的缩写，若在分词后查表会完全匹配不上
  it('缩写带尾随标点时仍能展开', () => {
    expect(normalize("I don't, really")).toEqual(['i', 'do', 'not', 'really'])
    expect(normalize("No, I don't.")).toEqual(['no', 'i', 'do', 'not'])
  })

  // pitfalls #3：'s 不展开，it's 与 its 必须保持为不同 token
  it("不展开 's，it's 与 its 保持可区分", () => {
    expect(normalize("it's")).toEqual(["it's"])
    expect(normalize('its')).toEqual(['its'])
    expect(normalize("it's")).not.toEqual(normalize('its'))
  })

  it("不展开 're，they're 与 their 保持可区分", () => {
    expect(normalize("they're")).not.toEqual(normalize('their'))
  })

  it('去除词首尾标点但保留词内撇号', () => {
    expect(normalize('"Hello," he said.')).toEqual(['hello', 'he', 'said'])
    expect(normalize("don't-worry")).toEqual(['do', 'not', 'worry'])
  })

  it('连字符词等价于空格分写', () => {
    expect(normalize('well-known')).toEqual(normalize('well known'))
  })

  it('折叠连续空白', () => {
    expect(normalize('a   b\t\nc')).toEqual(['a', 'b', 'c'])
  })

  // BBC / VOA 的 transcript 用弯撇号 U+2019，用户键盘打的是直撇号
  it('弯撇号与直撇号等价', () => {
    expect(normalize('I don’t know')).toEqual(['i', 'do', 'not', 'know'])
    expect(normalize('it’s')).toEqual(normalize("it's"))
  })

  it('弯撇号版本的 it’s 仍与 its 可区分', () => {
    expect(normalize('it’s')).not.toEqual(normalize('its'))
  })

  // 6 Minute English 每期都用弯引号包生词，这是主力素材源的固定格式
  it('弯引号包着的生词不能把引号带进 token', () => {
    expect(normalize('we learn ‘bewildered’ today')).toEqual(
      ['we', 'learn', 'bewildered', 'today']
    )
    expect(normalize("we learn 'bewildered' today")).toEqual(
      ['we', 'learn', 'bewildered', 'today']
    )
  })

  it('空输入返回空数组', () => {
    expect(normalize('')).toEqual([])
    expect(normalize('   ')).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/shared/normalize.test.ts`
Expected: FAIL — `Cannot find module '@shared/normalize'`

- [ ] **Step 3: 实现**

`src/shared/normalize.ts`：

```ts
import { CONTRACTIONS } from './wordlists/contractions.js'

/**
 * 归一化流水线。五步顺序固定，不可调换：
 *   1 小写 → 2 展开缩写 → 3 去词首尾标点 → 4 折叠空白 → 5 分词
 *
 * 第 2 步必须在整句字符串上做正则替换，不能等分词后逐 token 查表：
 * 分词前 "don't," 是一个 token，与白名单键 "don't" 不相等，查表会失效。
 * 而第 3 步去标点又必须在展开之后——调换会让 it's 塌缩成 its，
 * 放过最该抓的同音异形错误。详见 kb/dictation-engine.md。
 */
export function normalize(input: string): string[] {
  let s = input.toLowerCase()

  // 弯撇号统一成直撇号。BBC / VOA 的 transcript 用的是 U+2019，
  // 而用户键盘打出的是 U+0027——不统一的话缩写白名单完全不触发，
  // don't 保持 1 token、用户输入展开成 2 token，整句对齐错位级联误判。
  // 必须在缩写展开之前做。
  s = s.replace(/[‘’ʼ′]/g, "'")

  for (const [pattern, replacement] of CONTRACTIONS) {
    s = s.replace(pattern, replacement)
  }

  // 连字符视为词边界：well-known ≡ well known
  s = s.replace(/-+/g, ' ')

  return s
    // 边缘剥离不保留撇号。词内撇号不在边缘，it's / they're 不受影响；
    // 但 BBC 用弯引号包生词（"today's words are ‘bewildered’…"），
    // 上一步把弯引号也转成了直撇号，若这里保留 ' 就会得到 token "'bewildered'"，
    // 与用户键入的 bewildered 判错，还会把带引号的串当主键写进 words 表。
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((token) => token.length > 0)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/shared/normalize.test.ts`
Expected: PASS，12 个用例全绿

- [ ] **Step 5: Commit**

```bash
git add src/shared/normalize.ts tests/shared/normalize.test.ts
git commit -m "feat: add normalization pipeline with fixed step order"
```

---

## Task 4: 词级 diff + 拼写容错 + 计分（TDD）

**这是整个 M1 最容易做错的一块。** 测试用例必须覆盖 `kb/pitfalls.md` #2 的每个反例。

**Files:**
- Create: `src/shared/diff.ts`
- Test: `tests/shared/diff.test.ts`

- [ ] **Step 1: 写失败的测试**

`tests/shared/diff.test.ts`：

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { diffWords } from '@shared/diff'
import { loadDictionary } from '@shared/wordlists/dictionary'

beforeAll(() => {
  // 真词表的最小子集，够覆盖用例
  loadDictionary([
    'their', 'there', 'then', 'than', 'week', 'weak', 'receive',
    'government', 'the', 'is', 'a', 'test', 'affect', 'effect',
  ])
})

/** 便捷构造：全部词都是考察词 */
const allTested = (words: string[]) => new Set(words)

describe('diffWords — 拼写容错（pitfalls #2）', () => {
  it('打出的是另一个真词 → 判错，进错词库', () => {
    const r = diffWords(['their'], ['there'], allTested(['their']))
    expect(r.words[0]!.verdict).toBe('wrong')
    expect(r.errorWords).toEqual(['their'])
    expect(r.testedCorrect).toBe(0)
  })

  it('than / then 同样判错', () => {
    const r = diffWords(['then'], ['than'], allTested(['then']))
    expect(r.words[0]!.verdict).toBe('wrong')
    expect(r.errorWords).toEqual(['then'])
  })

  it('week / weak 同样判错', () => {
    const r = diffWords(['week'], ['weak'], allTested(['week']))
    expect(r.words[0]!.verdict).toBe('wrong')
  })

  it('打出的不是英文词 → 拼写手滑，计入分子但不进错词库', () => {
    const r = diffWords(['receive'], ['recieve'], allTested(['receive']))
    expect(r.words[0]!.verdict).toBe('spelling_slip')
    expect(r.testedCorrect).toBe(1)
    expect(r.errorWords).toEqual([])
  })

  it('编辑距离 >1 且非真词 → 判错而非手滑', () => {
    const r = diffWords(['government'], ['govmt'], allTested(['government']))
    expect(r.words[0]!.verdict).toBe('wrong')
  })

  // 相邻换位是最常见的手滑类型，纯 Levenshtein 会记 2 步从而误判成"听错"
  it('相邻换位算作距离 1（Damerau），判手滑', () => {
    const r = diffWords(['believe'], ['beleive'], allTested(['believe']))
    expect(r.words[0]!.verdict).toBe('spelling_slip')
  })
})

describe('diffWords — 对齐（align 的两个已知陷阱）', () => {
  // 曾经的 bug：tie-break 用 >= 会让所有"替换"退化成"漏写"，
  // 错词照样进库但类型全错，肉眼看不出来
  it('单词替换判为 wrong 而不是 missing', () => {
    const r = diffWords(['their'], ['there'], allTested(['their']))
    expect(r.words[0]!.verdict).toBe('wrong')
    expect(r.words[0]!.actual).toBe('there')   // 不能是 null
  })

  // 曾经的 bug：pending 用 pop() 会让连续两个错词前后颠倒
  it('连续两个词都写错时配对顺序不颠倒', () => {
    const r = diffWords(
      ['alpha', 'beta', 'zulu'],
      ['xray', 'yankee', 'zulu'],
      allTested(['alpha', 'beta', 'zulu'])
    )
    expect(r.words.map((w) => w.actual)).toEqual(['xray', 'yankee', 'zulu'])
  })
})

describe('diffWords — 计分', () => {
  it('完全正确', () => {
    const r = diffWords(['the', 'test'], ['the', 'test'], allTested(['the', 'test']))
    expect(r.testedCorrect).toBe(2)
    expect(r.testedTotal).toBe(2)
    expect(r.accuracy).toBe(1)
  })

  it('漏写计入分母且进错词库', () => {
    const r = diffWords(['the', 'test'], ['the'], allTested(['the', 'test']))
    expect(r.words[1]!.verdict).toBe('missing')
    expect(r.testedTotal).toBe(2)
    expect(r.testedCorrect).toBe(1)
    expect(r.errorWords).toEqual(['test'])
  })

  it('多写不计入分母也不进错词库', () => {
    const r = diffWords(['the'], ['the', 'extra'], allTested(['the']))
    expect(r.testedTotal).toBe(1)
    expect(r.testedCorrect).toBe(1)
    expect(r.errorWords).toEqual([])
  })

  it('只有考察词参与计分，非考察词错漏不影响 accuracy', () => {
    const r = diffWords(['the', 'test'], ['the', 'wrong'], allTested(['the']))
    expect(r.testedTotal).toBe(1)
    expect(r.testedCorrect).toBe(1)
    expect(r.accuracy).toBe(1)
    expect(r.errorWords).toEqual([])
  })

  // pitfalls #1 + spec §5.3.1 全局规则
  it('考察词为空时 accuracy 必须是 null，不能是 0 或 1', () => {
    const r = diffWords(['the', 'test'], [], new Set())
    expect(r.testedTotal).toBe(0)
    expect(r.accuracy).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/shared/diff.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现**

`src/shared/diff.ts`：

```ts
import type { DiffResult, WordDiff, WordVerdict } from './types.js'
import { isRealWord } from './wordlists/dictionary.js'

/**
 * Damerau-Levenshtein 距离（含相邻换位）。
 *
 * 必须算换位，不能用纯 Levenshtein：receive/recieve、believe/beleive、
 * friend/freind 都是相邻换位，纯 Levenshtein 记 2 步，会把最常见的
 * 手滑类型全判成"听成了别的词"。
 *
 * 距离 >2 一律返回 3，调用方只关心是否 ≤1。
 */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3
  const m = a.length
  const n = b.length
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1)
      }
    }
  }
  return d[m]![n]!
}

/**
 * 判定一个考察词。
 *
 * 关键规则（kb/pitfalls.md #2）：编辑距离 ≤1 时，看用户打出的串
 * 本身是不是一个合法英文单词——是真词说明听成了别的词（判错，
 * 进错词库）；不是任何英文词才是拼写手滑（计入分子，不进错词库）。
 *
 * 不能简单地"距离 ≤1 就算手滑"：their/there、than/then、week/weak
 * 的距离都是 1，那样会把系统最该抓的错误全部放过。
 */
function judge(expected: string, actual: string | null): WordVerdict {
  if (actual === null) return 'missing'
  if (expected === actual) return 'correct'
  if (editDistance(expected, actual) <= 1 && !isRealWord(actual)) {
    return 'spelling_slip'
  }
  return 'wrong'
}

/** 词级 LCS 对齐，返回 expected 每一位对应的 actual（无对应为 null） */
function align(expected: string[], actual: string[]): (string | null)[] {
  const m = expected.length
  const n = actual.length
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0)
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] =
        expected[i - 1] === actual[j - 1]
          ? dp[i - 1]![j - 1]! + 1
          : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!)
    }
  }

  const result: (string | null)[] = Array.from({ length: m }, () => null)
  let i = m
  let j = n
  const pending: string[] = []
  while (i > 0 && j > 0) {
    if (expected[i - 1] === actual[j - 1]) {
      result[i - 1] = actual[j - 1]!
      i--
      j--
    } else if (dp[i - 1]![j]! > dp[i]![j - 1]!) {
      // expected[i-1] 没匹配上：用一个未消费的 actual 顶上，
      // 好让"听成别的词"能被识别，而不是一律记成漏写
      result[i - 1] = pending.shift() ?? null
      i--
    } else {
      pending.push(actual[j - 1]!)
      j--
    }
  }
  while (i > 0) {
    result[i - 1] = pending.shift() ?? null
    i--
  }
  return result
}

export function diffWords(
  expected: string[],
  actual: string[],
  testedWords: ReadonlySet<string>
): DiffResult {
  const aligned = align(expected, actual)

  const words: WordDiff[] = expected.map((word, idx) => ({
    expected: word,
    actual: aligned[idx] ?? null,
    verdict: judge(word, aligned[idx] ?? null),
    tested: testedWords.has(word),
  }))

  const tested = words.filter((w) => w.tested)
  const testedTotal = tested.length
  const testedCorrect = tested.filter(
    (w) => w.verdict === 'correct' || w.verdict === 'spelling_slip'
  ).length

  return {
    words,
    testedTotal,
    testedCorrect,
    // 考察词为空时必须是 null——保命档和极短句都会走到这里，
    // 写 0 会把它们算成"全错"并触发自动降档
    accuracy: testedTotal === 0 ? null : testedCorrect / testedTotal,
    // 去重：同一个词在一句里出现两次且都错，只该让 error_count +1。
    // 但 testedTotal 不去重——两次出现就是两次要听出来，都该计分。
    errorWords: [
      ...new Set(
        tested
          .filter((w) => w.verdict === 'wrong' || w.verdict === 'missing')
          .map((w) => w.expected)
      ),
    ],
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/shared/diff.test.ts`
Expected: PASS，13 个用例全绿

- [ ] **Step 5: Commit**

```bash
git add src/shared/diff.ts tests/shared/diff.test.ts
git commit -m "feat: add word-level diff with real-word spelling tolerance"
```

---

## Task 5: 关键词 / 候选池 / 挖空选择（TDD）

**Files:**
- Create: `src/shared/keywords.ts`
- Test: `tests/shared/keywords.test.ts`

- [ ] **Step 1: 写失败的测试**

用例对应 `kb/pitfalls.md` #8（高危同音词全是停用词）：

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { keyWordsOf, candidatePool, pickBlanks, blankCount } from '@shared/keywords'
import { loadFrequency } from '@shared/wordlists/frequency'

beforeAll(() => {
  loadFrequency(['the', 'is', 'book', 'car', 'house'])  // rank 1..5
})

describe('keyWordsOf — 关键词是句子的静态属性', () => {
  it('实词计入关键词', () => {
    expect(keyWordsOf(['the', 'government', 'is'])).toContain('government')
  })

  it('普通停用词不计入', () => {
    expect(keyWordsOf(['the', 'government'])).not.toContain('the')
  })

  // pitfalls #8：这些词全是停用词，但必须计入关键词，
  // 否则中档自动补全、重档不扣分、轻档不挖空，核心能力失效
  it.each(['their', 'there', 'its', 'than', 'then', 'to', 'too', 'of', 'off'])(
    '高危同音词 %s 虽是停用词也必须计入关键词',
    (word) => {
      expect(keyWordsOf([word, 'book'])).toContain(word)
    }
  )
})

describe('candidatePool — 候选池 = 关键词 ∪ 该句历史错词', () => {
  it('并入历史错词，即便它是普通停用词', () => {
    const pool = candidatePool(['the', 'book'], new Set(['the']))
    expect(pool).toContain('the')
    expect(pool).toContain('book')
  })

  it('无历史错词时等于关键词', () => {
    expect(candidatePool(['the', 'book'], new Set())).toEqual(['book'])
  })
})

describe('blankCount — N 的取值', () => {
  // kb/dictation-engine.md：实际范围是 1-5 而非 3-5（spec §5.4 的举例算错了）
  it.each([
    [1, 1], [2, 1], [3, 1], [4, 2], [5, 2], [6, 2], [10, 4], [20, 5], [50, 5],
  ])('池大小 %i → N = %i', (poolSize, expected) => {
    expect(blankCount(poolSize)).toBe(expected)
  })

  it('池为空时 N 为 0', () => {
    expect(blankCount(0)).toBe(0)
  })
})

describe('pickBlanks — 挖空优先级', () => {
  it('已到期的历史错词排最前', () => {
    const picked = pickBlanks({
      pool: ['book', 'car', 'house'],
      dueWords: new Set(['house']),
      errorWords: new Set(['house']),
      n: 1,
    })
    expect(picked).toEqual(['house'])
  })

  // spec §5.4 优先级 2：同音组排在普通实词之前
  it('高危同音词排在普通实词之前', () => {
    const picked = pickBlanks({
      pool: ['book', 'their'],
      dueWords: new Set(),
      errorWords: new Set(),
      n: 1,
    })
    expect(picked).toEqual(['their'])
  })

  it('低频实词优先于高频实词', () => {
    const picked = pickBlanks({
      pool: ['the', 'zyzzyva'],   // zyzzyva 不在频次表 → rank 极大
      dueWords: new Set(),
      errorWords: new Set(),
      n: 1,
    })
    expect(picked).toEqual(['zyzzyva'])
  })

  it('池不足 n 时有几个给几个', () => {
    const picked = pickBlanks({
      pool: ['book'], dueWords: new Set(), errorWords: new Set(), n: 5,
    })
    expect(picked).toEqual(['book'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/shared/keywords.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`src/shared/keywords.ts`：

```ts
import { STOPWORDS } from './wordlists/stopwords.js'
import { HOMOPHONE_WORDS } from './wordlists/homophones.js'
import { rankOf } from './wordlists/frequency.js'

const LOW_FREQUENCY_RANK = 3000

/**
 * 实词 = 不在停用词表中的词。这是个近似（停用词表推不出词性），
 * 但够用——不要为词性精确引入 NLP 库。
 *
 * ⚠️ 这个定义只用于挖空优先级和关键词预计算，
 * 绝不用于决定中档的自动补全范围（那个依据的是考察词 / 非考察词）。
 */
export function isContentWord(word: string): boolean {
  return !STOPWORDS.has(word)
}

/**
 * 句子的关键词 = 实词 ∪ 高危同音组词。句子的静态属性，导入时预计算。
 *
 * 同音组这条补丁不能省：their/there/its/than/then 全是停用词，
 * 少了它这些词对所有档位都不可见，系统对最典型的听错完全失明。
 */
export function keyWordsOf(words: string[]): string[] {
  const seen = new Set<string>()
  return words.filter((w) => {
    if (seen.has(w)) return false
    if (!isContentWord(w) && !HOMOPHONE_WORDS.has(w)) return false
    seen.add(w)
    return true
  })
}

/** 候选池 = 关键词 ∪ 该句中出现的用户历史错词（运行时求并） */
export function candidatePool(words: string[], errorWords: ReadonlySet<string>): string[] {
  const key = new Set(keyWordsOf(words))
  const seen = new Set<string>()
  return words.filter((w) => {
    if (seen.has(w)) return false
    if (!key.has(w) && !errorWords.has(w)) return false
    seen.add(w)
    return true
  })
}

/** N = min(5, max(1, round(池 × 0.4)))，池为空时 0 */
export function blankCount(poolSize: number): number {
  if (poolSize === 0) return 0
  return Math.min(5, Math.max(1, Math.round(poolSize * 0.4)))
}

export function pickBlanks(opts: {
  pool: string[]
  dueWords: ReadonlySet<string>
  errorWords: ReadonlySet<string>
  n: number
}): string[] {
  const { pool, dueWords, errorWords, n } = opts

  const tier = (w: string): number => {
    if (dueWords.has(w)) return 0                 // 已到期错词
    if (HOMOPHONE_WORDS.has(w)) return 1          // 高危同音词
    if (errorWords.has(w)) return 2               // 未到期错词
    if (rankOf(w) > LOW_FREQUENCY_RANK) return 3  // 低频实词
    return 4                                      // 其余实词
  }

  return [...pool]
    .sort((a, b) => {
      const d = tier(a) - tier(b)
      return d !== 0 ? d : rankOf(b) - rankOf(a)  // 同档内越低频越优先
    })
    .slice(0, n)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/shared/keywords.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/keywords.ts tests/shared/keywords.test.ts
git commit -m "feat: add key word selection with homophone override"
```

---

## Task 6: outcome 判定 + rating 映射（TDD）

**Files:**
- Create: `src/shared/grading.ts`
- Test: `tests/shared/grading.test.ts`

- [ ] **Step 1: 写失败的测试**

覆盖 `kb/pitfalls.md` #10、#13、#14 和 spec §5.1 的 N≥3 前置条件：

```ts
import { describe, it, expect } from 'vitest'
import { judgeOutcome, ratingFrom, nextMode } from '@shared/grading'

describe('judgeOutcome — 推进判定', () => {
  // spec §5.1：错 ≤1 即算过，但仅当 N ≥ 3
  it('N≥3 时错 1 个算过', () => {
    expect(judgeOutcome({ testedTotal: 4, testedCorrect: 3 })).toBe('ok')
  })

  it('N≥3 时错 2 个算 weak', () => {
    expect(judgeOutcome({ testedTotal: 4, testedCorrect: 2 })).toBe('weak')
  })

  // N≤2 若沿用"错≤1"，必然恒判 ok，weak 在短句上永不触发
  it('N=2 时必须全对才算过', () => {
    expect(judgeOutcome({ testedTotal: 2, testedCorrect: 1 })).toBe('weak')
    expect(judgeOutcome({ testedTotal: 2, testedCorrect: 2 })).toBe('ok')
  })

  it('N=1 时必须全对才算过', () => {
    expect(judgeOutcome({ testedTotal: 1, testedCorrect: 0 })).toBe('weak')
    expect(judgeOutcome({ testedTotal: 1, testedCorrect: 1 })).toBe('ok')
  })

  it('考察词为空（保命档 / 极短句）算过', () => {
    expect(judgeOutcome({ testedTotal: 0, testedCorrect: 0 })).toBe('ok')
  })
})

describe('ratingFrom — 听写与复习共用的评分映射', () => {
  it('第一遍就打对 → good', () => {
    expect(ratingFrom({ correct: true, replayCount: 1 })).toBe('good')
  })

  it('重听 2-3 遍后打对 → hard', () => {
    expect(ratingFrom({ correct: true, replayCount: 2 })).toBe('hard')
    expect(ratingFrom({ correct: true, replayCount: 3 })).toBe('hard')
  })

  it('打错 → again', () => {
    expect(ratingFrom({ correct: false, replayCount: 1 })).toBe('again')
  })

  // 听写路径下 ≥4 遍不可达（4 遍触发自动揭示），但复习界面没有自动揭示，
  // 这个分支在那边完全可达。少了它复习会静默落到 hard，与 kb/srs.md 相反。
  it('重听 ≥4 遍即便打对也记 again', () => {
    expect(ratingFrom({ correct: true, replayCount: 4 })).toBe('again')
    expect(ratingFrom({ correct: true, replayCount: 9 })).toBe('again')
  })

  // pitfalls #13：听 4 遍还听不出来是最明确的 again 信号，不能丢。
  // 注意 correct 必须为 true 且 replayCount 小——否则别的分支已经返回 again，
  // 把实现里的 revealed 判断整个删掉测试照样过，等于没钉住。
  it('revealed 句即便第一遍就判对也记 again', () => {
    expect(ratingFrom({ correct: true, replayCount: 1, revealed: true })).toBe('again')
  })

  it('复习路径选了"我记得，不听了"且打对 → easy', () => {
    expect(ratingFrom({ correct: true, replayCount: 0, skippedAudio: true })).toBe('easy')
  })

  it('easy 在听写路径不可达（听写从不传 skippedAudio）', () => {
    const ratings = [1, 2, 3, 4].flatMap((replayCount) =>
      [true, false].flatMap((correct) =>
        [true, false].map((revealed) => ratingFrom({ correct, replayCount, revealed }))
      )
    )
    expect(ratings).not.toContain('easy')
  })
})

// ⚠️ nextMode 在 M1 不被调用——档位自动调节整体推迟到 M2，见本计划「范围说明」。
// 但函数和测试现在就写，因为降档下限（pitfall #10）的逻辑趁热记下来成本为零，
// 等 M2 再想一遍容易重新踩进去。
describe('nextMode — 档位自动调节（M2 才接入）', () => {
  // pitfalls #10：自动降档下限是轻档，保命档只能手动进
  it('轻档不会被自动降到保命档', () => {
    expect(nextMode('light', 'demote')).toBe('light')
  })

  it('中档降到轻档', () => {
    expect(nextMode('medium', 'demote')).toBe('light')
  })

  it('重档降到中档', () => {
    expect(nextMode('heavy', 'demote')).toBe('medium')
  })

  it('重档不会再升', () => {
    expect(nextMode('heavy', 'promote')).toBe('heavy')
  })

  it('保命档不参与自动调节', () => {
    expect(nextMode('lifeline', 'demote')).toBe('lifeline')
    expect(nextMode('lifeline', 'promote')).toBe('lifeline')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/shared/grading.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`src/shared/grading.ts`：

```ts
import type { Mode, Outcome, Rating } from './types.js'

/**
 * 推进判定：错 ≤1 个考察词即算过，但仅当 N ≥ 3。
 *
 * N ≤ 2 时要求全对——否则"错≤1"会让短句恒判 ok，
 * weak 标记在短句上永远不触发，回看清单失去价值。
 * 也不用百分比阈值：轻档典型只挖 3 个空，80% 等价于必须全对，
 * 反而比重档更严苛。
 */
export function judgeOutcome(r: { testedTotal: number; testedCorrect: number }): Outcome {
  if (r.testedTotal === 0) return 'ok'
  const missed = r.testedTotal - r.testedCorrect
  const allowed = r.testedTotal >= 3 ? 1 : 0
  return missed <= allowed ? 'ok' : 'weak'
}

/**
 * 听写与复习**共用**的 rating 映射。
 *
 * kb/srs.md 把"两条路径走同一个 rating 计算函数"列为实现硬要求——
 * 分叉正是 pitfall #6 的根因。所以这里只有这一个函数，不要再加第二个。
 *
 * replayCount 是整句级的（一句里两个 due 词会拿同一个 rating），
 * 这是可接受的近似——单词级重听次数在听写场景无法测量。
 *
 * 各分支在两条路径上的可达性：
 *   - revealed：只有听写路径会传 true（复习界面没有自动揭示）
 *   - replayCount >= 4：只有复习路径可达（听写第 4 遍就触发揭示了）
 *   - skippedAudio：只有复习路径会传 true（听写没有"我记得"入口），
 *     因此 'easy' 在听写路径天然不可达
 */
export function ratingFrom(o: {
  correct: boolean
  replayCount: number
  revealed?: boolean
  /** 仅复习路径：用户选了"我记得，不听了" */
  skippedAudio?: boolean
}): Rating {
  if (o.revealed || !o.correct) return 'again'
  if (o.skippedAudio) return 'easy'
  if (o.replayCount >= 4) return 'again'
  return o.replayCount <= 1 ? 'good' : 'hard'
}

const LADDER: readonly Mode[] = ['light', 'medium', 'heavy']

/**
 * 档位自动调节。保命档不在梯子上——它只能手动进入。
 *
 * 若允许自动降到保命档，用户就再也升不回来了：
 * 保命档产不出正确率，永远凑不满"连续 3 天 >90%"的升档条件。
 * 它是疲劳时的手动逃生舱，不是自动下坠的终点。
 */
export function nextMode(current: Mode, direction: 'promote' | 'demote'): Mode {
  if (current === 'lifeline') return 'lifeline'
  const idx = LADDER.indexOf(current)
  const next = direction === 'promote' ? idx + 1 : idx - 1
  return LADDER[Math.min(LADDER.length - 1, Math.max(0, next))]!
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/shared/grading.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/grading.ts tests/shared/grading.test.ts
git commit -m "feat: add outcome judgement and rating mapping"
```

---

## Task 7: LRC / SRT 解析（TDD）

**Files:**
- Create: `src/shared/transcript.ts`
- Test: `tests/shared/transcript.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest'
import { parseLrc, parseSrt } from '@shared/transcript'

describe('parseLrc', () => {
  it('解析时间戳与文本', () => {
    const lrc = `[00:01.50]Hello world
[00:05.20]Second line`
    expect(parseLrc(lrc)).toEqual([
      { idx: 0, startMs: 1500, endMs: 5200, text: 'Hello world' },
      { idx: 1, startMs: 5200, endMs: null, text: 'Second line' },
    ])
  })

  it('忽略元数据行与空行', () => {
    const lrc = `[ar:BBC]

[00:01.00]Only this`
    expect(parseLrc(lrc)).toHaveLength(1)
  })

  it('支持 [mm:ss.xxx] 三位毫秒', () => {
    expect(parseLrc('[00:01.123]x')[0]!.startMs).toBe(1123)
  })
})

describe('parseSrt', () => {
  it('解析序号、时间轴与文本', () => {
    const srt = `1
00:00:01,500 --> 00:00:04,000
Hello world

2
00:00:05,200 --> 00:00:08,000
Second line`
    expect(parseSrt(srt)).toEqual([
      { idx: 0, startMs: 1500, endMs: 4000, text: 'Hello world' },
      { idx: 1, startMs: 5200, endMs: 8000, text: 'Second line' },
    ])
  })

  it('多行文本合并为一句', () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
first part
second part`
    expect(parseSrt(srt)[0]!.text).toBe('first part second part')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/shared/transcript.test.ts`

- [ ] **Step 3: 实现**

`src/shared/transcript.ts`：

```ts
export interface ParsedSentence {
  idx: number
  startMs: number
  /** LRC 末行没有结束时间，导入时用音频总时长补齐 */
  endMs: number | null
  text: string
}

export function parseLrc(content: string): ParsedSentence[] {
  const re = /^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/
  const rows: { startMs: number; text: string }[] = []

  for (const line of content.split(/\r?\n/)) {
    const m = re.exec(line.trim())
    if (!m) continue
    const text = m[4]!.trim()
    if (!text) continue
    const frac = (m[3] ?? '0').padEnd(3, '0')
    rows.push({
      startMs: Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number(frac),
      text,
    })
  }

  rows.sort((a, b) => a.startMs - b.startMs)
  return rows.map((row, idx) => ({
    idx,
    startMs: row.startMs,
    endMs: rows[idx + 1]?.startMs ?? null,
    text: row.text,
  }))
}

export function parseSrt(content: string): ParsedSentence[] {
  const toMs = (s: string): number => {
    const m = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/.exec(s)!
    return Number(m[1]) * 3600000 + Number(m[2]) * 60000 + Number(m[3]) * 1000 + Number(m[4])
  }

  return content
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, idx) => {
      const lines = block.split(/\r?\n/)
      const timeLineIdx = lines.findIndex((l) => l.includes('-->'))
      const [from, to] = lines[timeLineIdx]!.split('-->')
      return {
        idx,
        startMs: toMs(from!),
        endMs: toMs(to!),
        text: lines.slice(timeLineIdx + 1).join(' ').trim(),
      }
    })
    .filter((s) => s.text.length > 0)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/shared/transcript.test.ts`

- [ ] **Step 5: 跑全部纯函数测试**

Run: `npm test`
Expected: 5 个测试文件全绿

- [ ] **Step 6: Commit**

```bash
git add src/shared/transcript.ts tests/shared/transcript.test.ts
git commit -m "feat: add LRC and SRT transcript parsers"
```

---

## Task 8: 数据库 schema + repository 层

**Files:**
- Create: `src/server/db/schema.sql`、`connection.ts`、`repositories/*.ts`

- [ ] **Step 1: 建表语句**

`src/server/db/schema.sql` —— 字段与 `docs/kb/data-model.md` 严格一致：

```sql
CREATE TABLE IF NOT EXISTS materials (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  title                TEXT    NOT NULL,
  source               TEXT    NOT NULL,          -- bbc | voa | cet4 | cet6
  lane                 TEXT    NOT NULL DEFAULT 'english',
  audio_path           TEXT    NOT NULL,
  transcript_path      TEXT,
  duration_ms          INTEGER,
  sentence_count       INTEGER NOT NULL DEFAULT 0,
  current_sentence_idx INTEGER NOT NULL DEFAULT 0,
  added_at             TEXT    NOT NULL,
  finished_at          TEXT
);

CREATE TABLE IF NOT EXISTS sentences (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id    INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  idx            INTEGER NOT NULL,
  start_ms       INTEGER NOT NULL,
  end_ms         INTEGER NOT NULL,
  text           TEXT    NOT NULL,
  -- 仅静态部分：实词 ∪ 高危同音组词。历史错词不在此列，运行时求并
  key_words_json TEXT    NOT NULL,
  UNIQUE (material_id, idx)
);

CREATE TABLE IF NOT EXISTS attempts (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  sentence_id          INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  mode                 TEXT    NOT NULL,   -- lifeline | light | medium | heavy
  input                TEXT,
  tested_words_total   INTEGER NOT NULL DEFAULT 0,
  tested_words_correct INTEGER NOT NULL DEFAULT 0,
  accuracy             REAL,               -- 可为 NULL，消费方不得当 0 或 100
  tested_words_json    TEXT    NOT NULL,   -- 所有档位都落，中/重档事后不可复现
  outcome              TEXT    NOT NULL,   -- ok | weak | revealed | skipped
  comprehended         INTEGER,            -- 仅保命档 0/1，其余档 NULL
  replay_count         INTEGER NOT NULL DEFAULT 0,
  duration_ms          INTEGER,
  created_at           TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS words (
  word                   TEXT PRIMARY KEY,
  first_seen_sentence_id INTEGER REFERENCES sentences(id),
  last_error_sentence_id INTEGER REFERENCES sentences(id),
  error_count            INTEGER NOT NULL DEFAULT 1,
  graduated              INTEGER NOT NULL DEFAULT 0,
  exposed_on             TEXT,        -- 当日已曝光，推迟一天再排（轻档泄漏）
  -- 以下为 ts-fsrs Card 全字段，缺一不可：
  -- lapses 与 scheduled_days 无法从 reviews 反推
  due                    TEXT    NOT NULL,
  stability              REAL    NOT NULL,
  difficulty             REAL    NOT NULL,
  elapsed_days           INTEGER NOT NULL,
  scheduled_days         INTEGER NOT NULL,
  reps                   INTEGER NOT NULL,
  lapses                 INTEGER NOT NULL,
  state                  INTEGER NOT NULL,
  last_review            TEXT
);

CREATE TABLE IF NOT EXISTS reviews (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  word         TEXT NOT NULL REFERENCES words(word) ON DELETE CASCADE,
  rating       TEXT NOT NULL,
  source       TEXT NOT NULL,      -- review | dictation
  replay_count INTEGER NOT NULL DEFAULT 0,
  reviewed_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_words_due ON words(due) WHERE graduated = 0;
CREATE INDEX IF NOT EXISTS idx_attempts_sentence ON attempts(sentence_id);
CREATE INDEX IF NOT EXISTS idx_reviews_word ON reviews(word);
```

- [ ] **Step 2: 连接与迁移**

`src/server/db/connection.ts`：

```ts
// node-sqlite3-wasm 是 CommonJS，"type": "module" 下必须 default import。
// 写成 import { Database } from '...' 会报 Named export not found。
import pkg from 'node-sqlite3-wasm'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const { Database } = pkg

const DB_PATH = resolve(process.cwd(), 'data/workstation.db')

export function openDatabase(path = DB_PATH) {
  // ':memory:' 时 dirname 得到 '.'，mkdirSync 不会抛错，测试可直接传它
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(readFileSync(resolve(import.meta.dirname, 'schema.sql'), 'utf8'))
  return db
}
```

- [ ] **Step 3: repository 层**

**所有 SQL 只许出现在 `src/server/db/repositories/` 下。** 业务代码一律走接口。这层抽象已经证明了自己的价值：原定的 `better-sqlite3` 在本机编不过，换成 `node-sqlite3-wasm` 时只动了 `connection.ts` 一个文件。

每个 repository 导出一个工厂函数，接收 `db` 返回方法集。例如 `repositories/words.ts`：

```ts
import type { Card } from 'ts-fsrs'
import type { openDatabase } from '../connection.js'

type Database = ReturnType<typeof openDatabase>

export interface WordRow {
  word: string
  errorCount: number
  graduated: boolean
  exposedOn: string | null
  lastErrorSentenceId: number | null
  card: Card
}

export function createWordsRepo(db: Database) {
  return {
    findDue(today: string, limit: number): WordRow[] { /* … */ },
    findByWords(words: string[]): WordRow[] { /* … */ },
    upsertError(word: string, sentenceId: number, card: Card): void { /* … */ },
    updateCard(word: string, card: Card): void { /* … */ },
    markExposed(word: string, date: string): void { /* … */ },
    markGraduated(word: string): void { /* … */ },
  }
}
```

其余四个 repository 同构。**`words` 的读写必须整体映射 `Card` 全字段**，不要图省事只存几个。

- [ ] **Step 4: 冒烟验证**

写一个临时脚本建库并插一条数据，确认 schema 无语法错误：

```bash
npx tsx -e "import {openDatabase} from './src/server/db/connection.ts'; const db=openDatabase('data/smoke.db'); console.log(db.prepare('SELECT count(*) c FROM sqlite_master').get()); db.close()"
```
Expected: 打印出表数量（≥5）

删掉冒烟库：`rm data/smoke.db*`

- [ ] **Step 5: Commit**

```bash
git add src/server/db
git commit -m "feat: add database schema and repository layer"
```

---

## Task 9: 素材导入

**Files:**
- Create: `src/server/services/import.ts`、`src/server/routes/materials.ts`

- [ ] **Step 1: 导入服务**

流程：读音频文件 → 解析字幕（按扩展名选 `parseLrc`/`parseSrt`）→ 对每句 `normalize` 后算 `keyWordsOf` → 写 `materials` + `sentences`。

要点：
- LRC 末句 `endMs` 为 `null`，用音频总时长补齐；拿不到时长就用 `startMs + 5000` 兜底
- `parseSrt` 先 `map` 赋 `idx` 再 `filter` 掉空块，`idx` 上会留空洞。**写库时按数组下标重新编号**，否则 `sentences.idx` 不连续，断点续做会跳句
- **DB 存原始时间戳，不加 padding。** padding 由播放器在播放时加（Task 13），两边都加会变成 400ms 且句间重叠
- `key_words_json` 存的是 **normalize 之后**的词形，与判定时保持同一口径——存原始大小写会导致比对时对不上

- [ ] **Step 2: 路由**

- `POST /api/materials` — body: `{ title, source, audioPath, transcriptPath }`，返回导入的句数
- `GET /api/materials` — 列表，带完成进度
- `GET /api/materials/:id/sentences` — 句子列表
- `GET /api/materials/:id/audio` — 音频流（`sendFile`，支持 Range 请求，否则前端无法 seek）

- [ ] **Step 3: 手动验证**

准备一份测试素材（自己录一段 30 秒音频 + 手写 LRC 也行）：

```bash
npm run dev:server
curl -X POST http://localhost:5174/api/materials \
  -H 'Content-Type: application/json' \
  -d '{"title":"test","source":"bbc","audioPath":"materials/test.mp3","transcriptPath":"materials/test.lrc"}'
```
Expected: `{"materialId":1,"sentenceCount":N}`

- [ ] **Step 4: Commit**

```bash
git add src/server/services/import.ts src/server/routes/materials.ts
git commit -m "feat: add material import with transcript parsing"
```

---

## Task 10: FSRS 调度服务

**Files:**
- Create: `src/server/services/scheduler.ts`
- Test: `tests/server/scheduler.test.ts`

- [ ] **Step 1: 写测试**

⚠️ **用例体必须写完整、先跑红再实现。** 下面给的是骨架，空函数体的 `it()` 在 vitest 里会**空跑全绿**，证明不了任何事——这是这份计划里最容易糊弄过去的一处。

用 `openDatabase(':memory:')` 建库，保证 `npm test` 无副作用、用例之间不串状态。

```ts
describe('scheduler', () => {
  it('同一个词当日只调度一次', () => { /* 听写联动后，findDue 不应再返回它 */ })
  it('revealed 句的 due 词按 again 记一次复习', () => { /* … */ })
  it('轻档可见但未挖空的 due 词标记为当日已曝光', () => { /* … */ })
  it('已曝光的词当日不进复习队列', () => { /* … */ })
  it('连续 3 次 good 且 stability>60 且 state=Review → 毕业', () => { /* … */ })
  it('毕业词再次听错则重新入队且 error_count 累加', () => { /* … */ })
})
```

实现前先定死三件事，否则写到一半会卡：

| 事项 | 定法 |
|---|---|
| FSRS 实例与参数 | 模块级单例，用 `generatorParameters()` 默认值。前期复习量远不到 1000 次，个性化参数无意义 |
| 新错词的初始 Card | `createEmptyCard(now)` |
| `due` / `exposed_on` / `today` 的格式 | **全部用 `YYYY-MM-DD` 日期串**，不用 ISO 时间戳。`findDue(today)` 是字符串比较，两种格式混用会直接查空——而且是静默查空，没有任何报错 |

- [ ] **Step 2: 实现**

关键点（对应 `kb/srs.md`）：

- **听写与复习必须走同一个 `applyRating()` 入口**，不允许两套逻辑。这是最容易出现调度状态不一致的地方
- 触发条件是"**任一档位**实际考察到 due 词"，不只轻档——中/重档的考察词是候选池全集，同样含 due 词
- `revealed` 句命中的 due 词按 `again` 写入
- 轻档提交时，把"本句中可见但未被挖空的 due 词"写 `exposed_on = today`，推迟一天再排（否则复习评分虚高）
- 毕业条件三个同时满足：`state = Review` && 最近连续 3 次 `good`/`easy` && `stability > 60`

- [ ] **Step 3: 跑测试**

Run: `npx vitest run tests/server/scheduler.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/server/services/scheduler.ts tests/server/scheduler.test.ts
git commit -m "feat: add FSRS scheduler with dictation linkage"
```

---

## Task 11: 听写提交服务

**Files:**
- Create: `src/server/services/dictation.ts`、`src/server/routes/dictation.ts`

- [ ] **Step 1: 服务**

串联：

```
取句子 + 用户历史错词
  → candidatePool()
  → 按档位定考察词（保命档空集 / 轻档 pickBlanks / 中重档全集）
  → normalize(原文) 与 normalize(用户输入)
  → diffWords()
  → judgeOutcome()
  → 写 attempts（含 tested_words_json，所有档位都落）
  → errorWords 入 words 表（更新 last_error_sentence_id）
  → 命中的 due 词走 scheduler.applyRating()
  → 更新 materials.current_sentence_idx
```

四种 `outcome` 的分支必须齐全：

| outcome | tested_total | accuracy | 入错词库 | 触发联动 | 推进 current_sentence_idx |
|---|---|---|---|---|---|
| `ok` / `weak` | N | 计算值 | 是 | 是 | 是 |
| `revealed` | N | 0 | 是（仅考察词） | 是，按 `again` | 是 |
| `skipped` | 0 | `NULL` | 否 | 否 | 是 |
| 保命档 | 0 | `NULL` | 否 | 否 | 是 |

- [ ] **Step 2: 路由**

- `GET /api/dictation/next?materialId=N` — 返回当前句 + 该档位的考察词/挖空位置
- `POST /api/dictation/submit` — body: `{ sentenceId, mode, input, replayCount, revealed }`，返回 `DiffResult` + `outcome`
- `POST /api/dictation/skip` — 记 `skipped`
- `POST /api/dictation/comprehend` — 保命档的懂/没懂

- [ ] **Step 3: 服务级测试**

`skipped` 的语义（`pitfalls.md` #14）只有上面那张表，没有任何自动化测试钉住它。按 `CLAUDE.md` §5「判定逻辑必须有单元测试」，补一条：

```ts
it('skipped 的句子：accuracy 为 NULL、不入错词库、不触发联动，但进度前进', async () => {
  const before = await materials.get(materialId)
  await dictation.skip({ sentenceId })
  const attempt = await attempts.latest(sentenceId)
  expect(attempt.accuracy).toBeNull()
  expect(attempt.outcome).toBe('skipped')
  expect(await words.count()).toBe(0)
  expect((await materials.get(materialId)).currentSentenceIdx)
    .toBe(before.currentSentenceIdx + 1)
})
```

同样用 `openDatabase(':memory:')`。

- [ ] **Step 4: 端到端验证**

导入素材后，用 curl 提交一次听写，确认 `attempts` 落了行、错词进了 `words`、`current_sentence_idx` 前进了。

- [ ] **Step 5: Commit**

```bash
git add src/server/services/dictation.ts src/server/routes/dictation.ts
git commit -m "feat: add dictation submission pipeline"
```

---

## Task 12: 复习服务

**Files:**
- Create: `src/server/routes/review.ts`

- [ ] **Step 1: 路由**

- `GET /api/review/queue` — 当日 due 且未曝光、未被听写覆盖的词，带 `last_error_sentence_id` 对应的句子和音频区间
- `POST /api/review/submit` — body: `{ word, input, replayCount, skippedAudio }`

⚠️ **body 提交的是用户键入的原串 `input`，不是前端算好的 `correct` 布尔值。**

判定必须在服务端用 `shared/diff.ts` 的同一套规则做。否则"拼写失误视为打对"要么在 Vue 组件里重新实现一遍，要么直接丢失——前端做字符串相等比较的话，`recieve` 会判错 → `Again`，与 `kb/srs.md` 正好相反。`kb/srs.md` 把"听写与复习走**同一个 rating 计算函数**和同一个 FSRS 入口"列为实现硬要求，pitfall #6 的根因就是这里分叉。

评分直接调 Task 6 已经写好的 `ratingFrom()`，复习路径传 `skippedAudio`，**不要另写一个映射函数**。

复习卡片返回的是**最近一次听错该词的那句**（`last_error_sentence_id`），不是第一次。

- [ ] **Step 2: Commit**

```bash
git add src/server/routes/review.ts
git commit -m "feat: add review queue and submission"
```

---

## Task 12.5: 前端骨架（不做这步，Task 13-16 一行都跑不起来）

**Files:**
- Create: `index.html`、`vite.config.ts`、`src/web/env.d.ts`、`src/web/main.ts`、`App.vue`、`api.ts`、`router.ts`、`views/ImportView.vue`、`views/DictationView.vue`（占位）、`views/ReviewView.vue`（占位）

- [ ] **Step 1: `vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@shared': resolve(__dirname, './src/shared') } },
  server: {
    proxy: { '/api': 'http://localhost:5174' },
  },
})
```

走 vite proxy 而不是 CORS，前端就能用相对路径请求，省掉环境变量。

- [ ] **Step 2: `index.html`**（放仓库根，Vite 的入口约定）

```html
<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8" /><title>精听工作台</title></head>
  <body><div id="app"></div><script type="module" src="/src/web/main.ts"></script></body>
</html>
```

- [ ] **Step 3: `env.d.ts`**（缺了它 `npm run tsc` 会红）

```ts
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
```

`npm run tsc` 跑的是 `tsc --noEmit && vue-tsc --noEmit`，而 `include` 覆盖了 `src/**/*`。没有这个 shim，普通 `tsc` 解析 `main.ts` 里的 `import App from './App.vue'` 会报 `TS2307`。这个错要到 Task 17 Step 1 才暴露，届时排查成本高得多。

- [ ] **Step 4: `router.ts` + `main.ts` + `App.vue` + 三个视图文件**

三个路由：`/import`、`/dictation`、`/review`。`App.vue` 只放一个顶栏（三个链接 + 今日复习待办数）和 `<router-view />`。

`DictationView.vue` 和 `ReviewView.vue` **先创建成一行占位组件**（Task 14 / Task 16 再填内容）。不建的话，`router.ts` 里静态 import 会让 dev server 起不来、懒加载会 404——两种都过不了本任务的验收。

- [ ] **Step 5: `api.ts`**

统一的 fetch 封装，集中处理 JSON 和错误。所有视图只经它访问后端，不要在组件里散落 `fetch`。

- [ ] **Step 6: `ImportView.vue`**

一个表单：标题、来源（下拉 bbc/voa/cet4/cet6）、音频路径、字幕路径 → 调 `POST /api/materials`。

M1 的素材导入**走界面，不走 curl**（Task 9 Step 3 的 curl 只用于当时的联调验证）。

- [ ] **Step 7: 验证能起来**

```bash
npm run dev:web
```
Expected: 浏览器打开 `http://localhost:5173` 能看到顶栏，三个路由都能点开（后两个是占位）

- [ ] **Step 8: Commit**

```bash
git add index.html vite.config.ts src/web
git commit -m "feat: add frontend shell with routing and import view"
```

---

## Task 13-16: 前端

**按 `CLAUDE.md` §5，纯 UI 改动不跑测试** —— 每个任务做完列出改了哪些文件，由使用者自己看界面。

### Task 13: 音频播放器

`src/web/components/AudioPlayer.vue`

- 句级播放：给定 `startMs`/`endMs`，播完自动停
- 变速 0.75x / 1.0x / 1.25x（`playbackRate`）
- 暴露 `replay()` 并累计 `replayCount`
- **前后各 200ms padding 在这里加**（DB 存的是原始时间戳，见 Task 9）

### Task 14: 四档听写界面

`src/web/views/DictationView.vue` + `components/DictationPane.vue`

- 四档切换（快捷键 `1`/`2`/`3`/`4`），当前档位存 `localStorage`（M1 只手动切档，见「范围说明」）
- **候选池为空的句子降级呈现**：轻档下这种句子挖不出任何空，若照常渲染会出现一个零空格、无处输入的句子。按 spec §5.4 改用保命档形式（听 + 看原文）
- 保命档：听 → 「懂 / 没懂」两个按钮 → 显示原文
- 轻档：句子带下划线空格，只在空格里输入，`Tab` 在空格间跳转
- 中/重档：文本框
- 全局快捷键：**空格重播 / Enter 提交 / Tab 跳过**
- 听满 4 遍自动亮答案并记 `revealed`
- 打开即从 `current_sentence_idx` 续上

⚠️ 中档的"自动补全"只补**非考察词**。用停用词表决定补全范围会让 `their`/`its`/`than` 全被填上——核心能力当场失效（`kb/pitfalls.md` #8）。

### Task 15: diff 结果展示

`src/web/components/DiffResult.vue`

逐词着色：`correct` 绿、`spelling_slip` 黄（标注"拼写"）、`wrong` 红（标注你打的是什么）、`missing` 灰。非考察词弱化显示，让注意力落在考察词上。

### Task 16: 复习界面

`src/web/views/ReviewView.vue` + `components/ReviewCard.vue`

- 先播原句（**不显示文字**）→ 输入那个词 → 判定 → 显示原句
- 「我记得，不听了」按钮（这是 `easy` 的唯一来源）
- 复习完显示今日剩余数量

---

## Task 17: 端到端串联与验收

- [ ] **Step 1: 全量检查**

```bash
npm run tsc && npm test
```
Expected: 两个都过

- [ ] **Step 2: 真实素材走一遍**

从 BBC Learning English 下一期《6 Minute English》（mp3 + transcript），转成 LRC 后导入，完整做完 10 句。

- [ ] **Step 3: 人工验收清单**

- [ ] 轻档挖空里能看到 `their`/`its`/`than` 这类词被挖（不是只挖实词）
- [ ] 故意把 `their` 打成 `there` → 判**错**并进错词库
- [ ] 故意把 `receive` 打成 `recieve` → 判**拼写**，不进错词库
- [ ] 关掉页面重开 → 从上次那句继续，档位也还原
- [ ] 保命档做的句子 `accuracy` 落库为 `NULL`（查一下库：`SELECT mode, accuracy FROM attempts`），不是 0
- [ ] `Tab` 跳过的句子不进错词库，但 `current_sentence_idx` 正常前进
- [ ] 隔天打开 → 复习队列里出现前一天的错词，卡片播的是原句
- [ ] 复习时故意打 `recieve` → 判**对**（拼写失误视为打对），与听写路径一致

（"保命档不会被自动升档"这条属于档位自动调节，已推迟到 M2，M1 不验收）

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: complete M1 dictation loop"
```

---

## 完成标准

M1 完成 = **可以每天用它训练了**。具体是：素材导入得进来、四档都能跑、错词自动入库、隔天有复习队列、关掉再开能续上。

总览页、模考、静音检测切句、RSS 抓取全部是 M2，不在本计划内。

## 执行时的两条硬规矩

1. **判定逻辑的每个改动都要有对应测试**，且覆盖 `docs/kb/pitfalls.md` 的反例。这块靠肉眼验不出来
2. **改完维护知识库**（`CLAUDE.md` §2）。实现与文档不符时，先确认是文档过期还是代码写错——多数情况是后者
