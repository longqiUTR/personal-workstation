import type { Mode, Outcome, Rating } from './types.js'

// 用"错 ≤1 个"而不是百分比阈值：轻档典型只挖 3 个空，80% 等价于必须
// 全对，反而比重档更严苛——最容易的档位不该是判定最苛刻的档位。
// 容错额度限定在 N≥3 才生效：N≤2 时若仍按"错≤1"，必然恒判 ok，
// weak 在短句上永远不会触发，短句和长句就不再是同一套规则。
export function judgeOutcome(r: { testedTotal: number; testedCorrect: number }): Outcome {
  if (r.testedTotal === 0) return 'ok'
  const missed = r.testedTotal - r.testedCorrect
  const allowed = r.testedTotal >= 3 ? 1 : 0
  return missed <= allowed ? 'ok' : 'weak'
}

// 听写与复习必须共用这一个函数、同一个 FSRS 入口——分叉是过往双重调度
// bug 的根因。各分支的可达性按路径区分：revealed 只有听写会传（复习没有
// 揭示这个环节）；skippedAudio（→ easy）只有复习会传（"我记得，不听了"
// 是复习特有的入口，听写不存在）；replayCount ≥4 只有复习路径可达——
// 听写第 4 遍就自动揭示了，永远走不到这个分支。easy 因此在听写路径
// 结构性不可达，不是遗漏。
export function ratingFrom(o: {
  correct: boolean
  replayCount: number
  revealed?: boolean
  skippedAudio?: boolean
}): Rating {
  if (o.revealed || !o.correct) return 'again'
  if (o.skippedAudio) return 'easy'
  if (o.replayCount >= 4) return 'again'
  return o.replayCount <= 1 ? 'good' : 'hard'
}

// replayCount 是整句级，不是单词级：一句里两个 due 词、整句重听 3 遍，
// 两个词拿到同样的 rating。这是接受的近似——单词级重听次数在听写场景下
// 没有办法测量。

const LADDER: readonly Mode[] = ['light', 'medium', 'heavy']

// 降档下限是轻档，不能到保命档：保命档不考察词，产不出正确率，一旦掉
// 进去就永远凑不满升档条件，等于把用户焊死在保命档。保命档因此不上梯子，
// 只是一个手动进出的疲劳逃生舱，不是自动调节会把人放进去的常态档位。
//
// M1 没有调用方：自动调节要读 daily 聚合表，那是 M2 的范围；这里先把
// 降档下限这条规则和测试写死，等 M2 接入时不用重新论证一遍。
export function nextMode(current: Mode, direction: 'promote' | 'demote'): Mode {
  if (current === 'lifeline') return 'lifeline'
  const idx = LADDER.indexOf(current)
  const next = direction === 'promote' ? idx + 1 : idx - 1
  return LADDER[Math.min(LADDER.length - 1, Math.max(0, next))]!
}
