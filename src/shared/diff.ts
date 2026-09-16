import type { DiffResult, WordDiff, WordVerdict } from './types.js'
import { isRealWord } from './wordlists/dictionary.js'

// 必须是 Damerau-Levenshtein（含相邻换位分支），不能用纯 Levenshtein：
// receive/recieve、believe/beleive、friend/freind 都是相邻换位，纯 Levenshtein
// 记 2 步，会把最常见的手滑类型全判成"听成了别的词"。
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

// 判定规则是"距离 ≤1 且用户打出的串本身不是真词"，不是"距离 ≤1 就算手滑"。
// 后者会把 than/then、week/weak、affect/effect 这些恰好距离为 1 的同音异形词
// 全部吃成"拼写失误"——而抓住这类错误正是系统存在的理由。查真词表就是用来
// 分辨"听成了别的词"和"手指滑了"的唯一依据。
function judge(expected: string, actual: string | null): WordVerdict {
  if (actual === null) return 'missing'
  if (expected === actual) return 'correct'
  if (editDistance(expected, actual) <= 1 && !isRealWord(actual)) {
    return 'spelling_slip'
  }
  return 'wrong'
}

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
  // 回溯是从句尾往句首走，pending 里越先 push 进去的 actual 词，
  // 在原句里的位置反而越靠后一步——所以取出时必须用 shift()（FIFO）
  // 才能把顺序转回正着的从前往后；用 pop()（LIFO）会把连续多个
  // wrong word 的配对顺序整体颠倒。
  const pending: string[] = []
  while (i > 0 && j > 0) {
    if (expected[i - 1] === actual[j - 1]) {
      result[i - 1] = actual[j - 1]!
      i--
      j--
    } else if (dp[i - 1]![j]! > dp[i]![j - 1]!) {
      // 严格 >，不能写成 >=：写 >= 会让 expected 一侧在任何一个 actual 词被
      // 推进 pending 之前就被消费掉，替换词永远配对不上，全部退化成 missing——
      // 错词依旧进错词库，只是判定分类错了，屏幕上完全看不出异常。
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
    // testedTotal 为 0（保命档、跳过、候选池为空的极短句）必须是 null，
    // 写 0 会把这些情形算成"全错"，误导趋势曲线和自动降档判断。
    accuracy: testedTotal === 0 ? null : testedCorrect / testedTotal,
    // errorWords 去重（同一个词出现两次只入库一次），但 testedTotal 不去重——
    // 两次出现都要求用户听出来，都得算进分母，去重的只是"要不要进错词库"这件事。
    errorWords: [
      ...new Set(
        tested
          .filter((w) => w.verdict === 'wrong' || w.verdict === 'missing')
          .map((w) => w.expected)
      ),
    ],
  }
}
