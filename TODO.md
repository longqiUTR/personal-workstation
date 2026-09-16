# M1 进度与待办

> 最后更新：2026-09-16
> 分支：`feat/m1-dictation-core`（未合并到 main）
> 状态：**10/17 任务完成，128 个测试全绿**

M1 的目标是「能每天用的听写训练闭环」：素材导入得进来、四档听写跑得通、错词自动入库并按 FSRS 排期复习。做完就能开始练，不等界面完美。

---

## 明天接手前先读这几条

不读的话大概率会重新踩一遍。

### 1. 环境上已经踩平的坑，别再试

| 坑 | 结论 |
|---|---|
| `npm install` 挂十几分钟 | 官方源走代理 **11 秒/包**。`.npmrc` 已指向 npmmirror，装包要**摘掉代理**：`env -u HTTP_PROXY -u HTTPS_PROXY npm i ...`。183 个包 47 秒装完 |
| `better-sqlite3` 装不上 | 本机无 Node 20 预编译二进制，node-gyp 回落又缺 C++ 工具链。**已改用 `node-sqlite3-wasm`**，别再尝试装回去 |
| `npm run tsc` 崩 | TypeScript 必须锁 **5.9.3**。7.x 移除了 `baseUrl` 且不再暴露 `typescript/lib/tsc`，`vue-tsc` 会找不到编译器 |
| GitHub 推送时好时坏 | `SSL_ERROR_SYSCALL` 是 Clash 节点波动，不是 git 配置问题。等一会儿重试，或换节点。提交在本地不会丢 |

### 2. 三处"守卫验证"是什么，为什么不能删

判定层有三个 bug 长得像可以顺手优化掉的代码。每个都配了测试，**改动后如果这些测试变红，是你踩回坑里了，不是测试坏了**：

| 位置 | 看起来像 | 实际是 |
|---|---|---|
| `diff.ts` 的 `align()` 用 `>` 而非 `>=` | 边界写法随意 | 改成 `>=` 会让所有「听成别的词」退化成「漏写」，错词照样入库但类型全错，**界面上完全看不出异常** |
| `keywords.ts` 里同音组覆盖停用词 | 多余的特例 | `their`/`there`/`its`/`than` 全是停用词，删掉这行系统就对最典型的连读弱读错误完全失明 |
| `grading.ts` 的 `replayCount >= 4` 分支 | 死代码（听写路径不可达） | **复习界面没有自动揭示，那边完全可达**。删了它，复习里听 9 遍才想起来的词会拿到 `hard` |

验证方法：把 bug 注入回去跑测试，确认变红，再还原。前面每个关键任务都这么验过。

### 3. 几个实测事实（不是推测）

- **`Again` 评分后 FSRS 给的 `due` 是 1 分钟后，不是明天。** 而 `due` 按 `YYYY-MM-DD` 存，截断后就是今天 —— 所以**同日去重是必需品**，没有它一个词会在同一次 20 分钟里反复出现，队列永远清不空
- **ts-fsrs 的 `Card` 是 10 个字段**，比设计稿多一个 `learning_steps`。它内部还会用 `last_review` 重算 `elapsed_days`，**忽略你在输入 Card 上设的值**
- **词表 79,465 词**（SCOWL size≤60 的 english+american+british 并集）。实测：该认的真词 15/15 全收，该不认的手滑串 5/5 全不在表内。**别换成 37 万词的 `words_alpha`**，词表越大手滑越容易被误判成听错
- `updateCard` 是 UPDATE-only。新词的第一次事件必然是 `again`，走 `upsertError` 的 INSERT 分支

### 4. 一条架构边界

**`src/shared/` 不碰文件系统、不 import server/web。** 词表数据由 `src/server/wordlists.ts` 读盘后注入。这条守住，判定逻辑才能保持 100% 可测——它是全项目风险最集中的地方。

**repository 只做持久化，不替 FSRS 做调度决定。** 曾经 `upsertError` 把 `due` 改写成"今天"，那是越界：传进来的 card 已经是 FSRS 的安排。

---

## 已完成（10/17）

### 判定层 `src/shared/` —— 纯函数，零 IO，87 个测试

| 文件 | 职责 | 测试 |
|---|---|---|
| `normalize.ts` | 归一化流水线（5 步顺序固定） | 14 |
| `diff.ts` | 词级 LCS 对齐 + 真词拼写容错 + 计分 | 14 ✅守卫 |
| `keywords.ts` | 关键词 / 候选池 / 挖空优先级 | 29 ✅守卫 |
| `grading.ts` | outcome 判定 + rating 映射 + 档位梯子 | 18 ✅守卫 |
| `transcript.ts` | LRC / SRT 解析 | 12 |
| `wordlists/` | 停用词 119 · 同音组 25 组 · 缩写 18 条 · 词表注入 | — |

集成验证跑过一次完整链路（字幕→归一化→关键词→挖空→diff→判定→评分），11/11 通过。

### 数据层 `src/server/db/` —— 41 个测试

- `schema.sql`：5 张表（`materials` / `sentences` / `attempts` / `words` / `reviews`）+ 3 个索引。`mocks` 和 `daily` 属于 M2，刻意缺席
- `repositories/`：5 个仓储，**所有 SQL 只在这里**

### 服务层 —— 已完成 2 个

- `services/import.ts` + `routes/materials.ts`：素材导入，关键词预计算，音频流支持 Range 请求（实测 `206` + `Content-Range`）
- `services/scheduler.ts`：FSRS 调度，唯一的 `f.next` 调用点，同日去重，毕业判定

---

## 待办（7/17）

### Task 11 · 听写提交服务 ← 下一个，也是最后一个高风险任务

`src/server/services/dictation.ts` + `routes/dictation.ts`

把判定层和调度层串起来：

```
取句子 + 用户历史错词
  → candidatePool() → 按档位定考察词
  → normalize() ×2 → diffWords() → judgeOutcome()
  → 写 attempts（含 tested_words_json，所有档位都落）
  → errorWords 入 words 表
  → 命中的 due 词走 scheduler.applyRating()
  → 更新 materials.current_sentence_idx
```

四种 outcome 的分支必须齐全：

| outcome | tested_total | accuracy | 入错词库 | 触发联动 | 推进断点 |
|---|---|---|---|---|---|
| `ok` / `weak` | N | 计算值 | 是 | 是 | 是 |
| `revealed` | N | 0 | 仅考察词 | 是，按 `again` | 是 |
| `skipped` | 0 | `NULL` | 否 | 否 | 是 |
| 保命档 | 0 | `NULL` | 否 | 否 | 是 |

⚠️ `accuracy` 和 `comprehended` 的 `null` 不能变成 `0`/`false`。保命档记 0 分意味着"全错"，会把趋势曲线拖下去。

⚠️ 轻档提交时要把「本句可见但未挖空的 due 词」标记为当日已曝光（`scheduler.markSeenButNotTested`），否则当天复习评分会虚高。

### Task 12 · 复习服务

`routes/review.ts`。`POST /api/review/submit` 的 body 提交**用户键入的原串**，不是前端算好的 `correct` 布尔值——判定必须在服务端用同一套 `diffWords`，否则"拼写失误视为打对"会在前端丢失。

### Task 12.5 · 前端骨架

`index.html`、`vite.config.ts`（`/api` 代理到 5174）、`src/web/env.d.ts`（缺了它 `npm run tsc` 会红）、`main.ts`、`App.vue`、`api.ts`、`router.ts`、三个视图文件（后两个先建占位，否则路由加载不了）。

### Task 13-16 · 界面

音频播放器（**200ms padding 在这里加**，数据库存的是原始时间戳）、四档听写界面、diff 结果着色、复习卡片。

按 `CLAUDE.md` §5，纯 UI 改动不跑测试，做完列改动文件，人工看界面。

⚠️ 中档的"自动补全"只补**非考察词**。用停用词表决定补全范围会让 `their`/`its`/`than` 全被自动填上，核心能力当场失效。

### Task 17 · 端到端验收

从 BBC Learning English 下一期《6 Minute English》真实跑一遍。验收清单见实施计划文档。

---

## 不在 M1 范围

档位自动调节（要读 `daily` 日聚合表，属 M2）、总览页、模考记录、静音检测自动切句、RSS 自动抓取。

`grading.ts` 的 `nextMode()` 已经写好但**没有调用方**，这是刻意的——降档下限那条规则趁热记下来成本为零。

---

## 文档索引

| 看什么 | 去哪 |
|---|---|
| 这个项目为什么长这样（**改任何东西前必读**） | `docs/kb/user-profile.md` |
| 20 条坑（**修 bug 前必读**） | `docs/kb/pitfalls.md` |
| 判定规则全文 | `docs/kb/dictation-engine.md` |
| 调度规则 | `docs/kb/srs.md` |
| 表结构与字段理由 | `docs/kb/data-model.md` |
| 逐任务实施步骤 | `docs/superpowers/plans/2026-09-15-m1-dictation-core.md` |
| 设计快照（冻结，不改） | `docs/superpowers/specs/2026-09-15-cet-listening-workbench-design.md` |
