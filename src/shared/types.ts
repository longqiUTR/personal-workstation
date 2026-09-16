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
