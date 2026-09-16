import { describe, it, expect } from 'vitest'
import { judgeOutcome, ratingFrom, nextMode } from '@shared/grading'

describe('judgeOutcome — 推进判定', () => {
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

  // 听写路径 ≥4 遍不可达（4 遍触发自动揭示），但复习界面没有自动揭示，
  // 这个分支在那边完全可达。少了它复习会静默落到 hard
  it('重听 ≥4 遍即便打对也记 again', () => {
    expect(ratingFrom({ correct: true, replayCount: 4 })).toBe('again')
    expect(ratingFrom({ correct: true, replayCount: 9 })).toBe('again')
  })

  // correct 必须为 true 且 replayCount 小，否则别的分支已经返回 again，
  // 把 revealed 判断整个删掉测试照样过，等于没钉住
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

describe('nextMode — 档位自动调节（M2 才接入）', () => {
  // 若允许从轻档自动降到保命档，用户就再也升不回来了：
  // 保命档产不出正确率，永远凑不满升档条件
  it('轻档不会被自动降到保命档', () => {
    expect(nextMode('light', 'demote')).toBe('light')
  })

  it('中档降到轻档', () => {
    expect(nextMode('medium', 'demote')).toBe('light')
  })

  it('重档降到中档', () => {
    expect(nextMode('heavy', 'demote')).toBe('medium')
  })

  it('轻档升到中档', () => {
    expect(nextMode('light', 'promote')).toBe('medium')
  })

  it('重档不会再升', () => {
    expect(nextMode('heavy', 'promote')).toBe('heavy')
  })

  it('保命档不参与自动调节', () => {
    expect(nextMode('lifeline', 'demote')).toBe('lifeline')
    expect(nextMode('lifeline', 'promote')).toBe('lifeline')
  })
})
