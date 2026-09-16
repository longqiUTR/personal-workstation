import { STOPWORDS } from './wordlists/stopwords.js'
import { HOMOPHONE_WORDS } from './wordlists/homophones.js'
import { tierOf } from './wordlists/frequency.js'

// SCOWL size 10 档约含 4015 词，是设计里"词频 rank ≤ 3000"落到 tierOf 上的
// 对应口径——tierOf 没有"rank"这个概念，只有 size 档位，10 是最接近的边界。
const COMMON_TIER = 10

// "实词 = 不在停用词表中的词"是能落地的近似，不是词性判断：停用词表给不出
// 词性标注，引入 NLP 库的收益抵不过复杂度。这个近似本身是有漏洞的（见下），
// 漏洞由 HOMOPHONE_WORDS 打补丁堵上，两者必须一起看。
export function isContentWord(word: string): boolean {
  return !STOPWORDS.has(word)
}

export function keyWordsOf(words: string[]): string[] {
  const seen = new Set<string>()
  return words.filter((w) => {
    if (seen.has(w)) return false
    // 高危同音组的词即使是停用词也强制计入：他们/那里、其/它这类词一旦被停用词表
    // 挡在关键词之外，就会在中档被自动补全、重档不扣分、轻档永远挖不到——
    // 系统对最典型的连读弱读错误结构性失明，这是这个文件里最重要的一行判断。
    if (!isContentWord(w) && !HOMOPHONE_WORDS.has(w)) return false
    seen.add(w)
    return true
  })
}

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

export function blankCount(poolSize: number): number {
  if (poolSize === 0) return 0
  // 真实取值是 1-5，不是文档口语说的"3-5 个"：round(3 * 0.4) = 1，
  // 池子小的短句一样要挖空，不能因为公式里出现过 3-5 就当成下限。
  return Math.min(5, Math.max(1, Math.round(poolSize * 0.4)))
}

export function pickBlanks(opts: {
  pool: string[]
  dueWords: ReadonlySet<string>
  errorWords: ReadonlySet<string>
  n: number
}): string[] {
  const { pool, dueWords, errorWords, n } = opts

  // 优先级梯度，数字越小越优先：
  // 0 已到期的历史错词——SRS 复习借听写这个场景完成，见 srs.md
  // 1 高危同音组的词——刻意排在普通实词之前，这是要抓的核心错误类型
  // 2 未到期的历史错词
  // 3 低频实词（tier > COMMON_TIER）
  // 4 其余
  const tier = (w: string): number => {
    if (dueWords.has(w)) return 0
    if (HOMOPHONE_WORDS.has(w)) return 1
    if (errorWords.has(w)) return 2
    if (tierOf(w) > COMMON_TIER) return 3
    return 4
  }

  return [...pool]
    .sort((a, b) => {
      const d = tier(a) - tier(b)
      // 同一优先级梯度内按 tier 降序（越生僻越靠前），让梯度 3/4 内部也能
      // 体现"越低频越优先"，而不是回退到原数组顺序。
      return d !== 0 ? d : tierOf(b) - tierOf(a)
    })
    .slice(0, n)
}
