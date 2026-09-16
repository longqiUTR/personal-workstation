import { describe, expect, it } from 'vitest'
import type { Card } from 'ts-fsrs'
import { State } from 'ts-fsrs'
import { openDatabase, type Db } from '../../src/server/db/connection'
import { createMaterialsRepo } from '../../src/server/db/repositories/materials'
import { createSentencesRepo } from '../../src/server/db/repositories/sentences'
import { createWordsRepo } from '../../src/server/db/repositories/words'
import { createReviewsRepo } from '../../src/server/db/repositories/reviews'
import { createScheduler } from '../../src/server/services/scheduler'

// 造一条 material + 一句 sentence，words 的外键挂在句子上（同 repositories.test.ts 的套路）。
function seedSentence(db: Db): number {
  const materials = createMaterialsRepo(db)
  const sentences = createSentencesRepo(db)
  const materialId = materials.create({
    title: 'Test Material',
    source: 'cet4',
    audioPath: '/audio/test.mp3',
    addedAt: '2026-09-16T00:00:00.000Z',
  })
  sentences.bulkCreate(materialId, [
    { idx: 0, startMs: 0, endMs: 3000, text: 'Hello world', keyWords: ['hello', 'world'] },
  ])
  const sentence = sentences.getByIdx(materialId, 0)
  if (!sentence) throw new Error('seed failed')
  return sentence.id
}

// 直接手搭一张 Card，绕开真实 FSRS 多轮模拟——毕业条件的 stability>60 天
// 需要几十次成功复习才能自然达到（见任务交底的测量事实：1.9→4.5→7.0→9.4），
// 用手搭的方式把测试锚定在"给定这张卡，评这个分，是否毕业"这个行为上。
function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    due: new Date('2026-09-10T00:00:00.000Z'),
    stability: 20,
    difficulty: 5,
    elapsed_days: 20,
    scheduled_days: 20,
    reps: 4,
    lapses: 0,
    state: State.Review,
    last_review: new Date('2026-08-27T00:00:00.000Z'),
    learning_steps: 0,
    ...overrides,
  }
}

describe('scheduler.applyRating', () => {
  it('全新词打 again：created，error_count=1，reviews 行 source=dictation', () => {
    const db = openDatabase(':memory:')
    const sentenceId = seedSentence(db)
    const wordsRepo = createWordsRepo(db)
    const reviewsRepo = createReviewsRepo(db)
    const scheduler = createScheduler(db)

    scheduler.applyRating({
      word: 'abandon',
      rating: 'again',
      source: 'dictation',
      replayCount: 0,
      sentenceId,
      now: new Date('2026-09-16T10:00:00.000Z'),
    })

    const row = wordsRepo.get('abandon')
    expect(row).not.toBeNull()
    expect(row!.errorCount).toBe(1)
    expect(row!.graduated).toBe(false)

    const reviews = reviewsRepo.recentByWord('abandon', 10)
    expect(reviews).toHaveLength(1)
    expect(reviews[0]).toMatchObject({ word: 'abandon', rating: 'again', source: 'dictation' })

    db.close()
  })

  it('source: review 和 dictation 写入的行可区分', () => {
    const db = openDatabase(':memory:')
    const sentenceId = seedSentence(db)
    const wordsRepo = createWordsRepo(db)
    const reviewsRepo = createReviewsRepo(db)
    const scheduler = createScheduler(db)

    // 词只可能通过"听写听错"（rating=again）第一次落库——updateCard 只
    // UPDATE 不 INSERT，全新词直接打 good/hard 会撞 reviews 的外键。
    // 这里先用 upsertError 模拟"之前已经错过一次"，贴合真实调用路径。
    wordsRepo.upsertError('meticulous', sentenceId, makeCard())

    scheduler.applyRating({
      word: 'meticulous',
      rating: 'good',
      source: 'dictation',
      replayCount: 1,
      sentenceId,
      now: new Date('2026-09-16T09:00:00.000Z'),
    })
    scheduler.applyRating({
      word: 'meticulous',
      rating: 'hard',
      source: 'review',
      replayCount: 2,
      sentenceId,
      now: new Date('2026-09-16T09:05:00.000Z'),
    })

    const recent = reviewsRepo.recentByWord('meticulous', 10)
    expect(recent.map((r) => r.source)).toEqual(['review', 'dictation'])
    expect(recent.map((r) => r.rating)).toEqual(['hard', 'good'])

    db.close()
  })

  it('lapses 在 Review 卡被打 again 时从 0 变成 1（真实 FSRS 数值，测过才知道）', () => {
    const db = openDatabase(':memory:')
    const sentenceId = seedSentence(db)
    const wordsRepo = createWordsRepo(db)
    const scheduler = createScheduler(db)

    // 先建行，再覆写成一张 lapses=0 的 Review 卡
    wordsRepo.upsertError('diligent', sentenceId, makeCard())
    wordsRepo.updateCard('diligent', makeCard({ lapses: 0, state: State.Review }))

    scheduler.applyRating({
      word: 'diligent',
      rating: 'again',
      source: 'review',
      replayCount: 0,
      sentenceId,
      now: new Date('2026-09-16T10:00:00.000Z'),
    })

    expect(wordsRepo.get('diligent')?.card.lapses).toBe(1)

    db.close()
  })

  it('毕业词打 again：graduated 被清除（重新入队路径）', () => {
    const db = openDatabase(':memory:')
    const sentenceId = seedSentence(db)
    const wordsRepo = createWordsRepo(db)
    const scheduler = createScheduler(db)

    wordsRepo.upsertError('resilient', sentenceId, makeCard())
    wordsRepo.markGraduated('resilient')
    expect(wordsRepo.get('resilient')?.graduated).toBe(true)

    scheduler.applyRating({
      word: 'resilient',
      rating: 'again',
      source: 'dictation',
      replayCount: 0,
      sentenceId,
      now: new Date('2026-09-16T10:00:00.000Z'),
    })

    expect(wordsRepo.get('resilient')?.graduated).toBe(false)

    db.close()
  })
})

describe('毕业条件：三个都满足才毕业，缺一不可', () => {
  it('state=Review + 连续三次 good/easy + stability>60 → 毕业', () => {
    const db = openDatabase(':memory:')
    const sentenceId = seedSentence(db)
    const wordsRepo = createWordsRepo(db)
    const reviewsRepo = createReviewsRepo(db)
    const scheduler = createScheduler(db)

    wordsRepo.upsertError('perseverance', sentenceId, makeCard())
    // 手搭一张 Review、高 stability 的卡：measured 过，last_review 到 now
    // 相隔 30 天时，Good 评分后 stability 会涨到 127.6 左右，稳稳超过 60
    // 天的阈值。ts-fsrs 内部按 last_review 到 now 重新算 elapsed_days（见
    // AbstractScheduler.init），这里手填的 elapsed_days/scheduled_days 只是
    // 为了让持久化字段自洽，真正影响计算结果的是 last_review。
    wordsRepo.updateCard(
      'perseverance',
      makeCard({
        state: State.Review,
        stability: 70,
        elapsed_days: 30,
        scheduled_days: 30,
        reps: 5,
        last_review: new Date('2026-08-17T00:00:00.000Z'),
      }),
    )
    // 预铺两条更早的 good 评分，凑够"最近三次"
    reviewsRepo.create({
      word: 'perseverance',
      rating: 'good',
      source: 'review',
      replayCount: 0,
      reviewedAt: '2026-09-10T00:00:00.000Z',
    })
    reviewsRepo.create({
      word: 'perseverance',
      rating: 'good',
      source: 'review',
      replayCount: 0,
      reviewedAt: '2026-09-13T00:00:00.000Z',
    })

    scheduler.applyRating({
      word: 'perseverance',
      rating: 'good',
      source: 'review',
      replayCount: 1,
      sentenceId,
      now: new Date('2026-09-16T10:00:00.000Z'),
    })

    expect(wordsRepo.get('perseverance')?.graduated).toBe(true)

    db.close()
  })

  it('缺 state=Review：卡仍处于 Learning，即使另两条件都满足也不毕业', () => {
    const db = openDatabase(':memory:')
    const sentenceId = seedSentence(db)
    const wordsRepo = createWordsRepo(db)
    const reviewsRepo = createReviewsRepo(db)
    const scheduler = createScheduler(db)

    wordsRepo.upsertError('word-a', sentenceId, makeCard())
    // measured 过：Learning + learning_steps=0 的卡打 Good 之后仍停在
    // Learning（不会跳到 Review），stability 原样保留在 70（>60）。
    // Learning/Relearning 的状态转移只看 (state, learning_steps 计数, grade)，
    // 不看 elapsed_days，所以这里不需要让 last_review 精确对应某个天数——
    // 但仍需显式给 undefined：last_review 缺失时 ts-fsrs 内部把 elapsed_days
    // 强制按 0 算（见 AbstractScheduler.init 对 last_review 的判空），
    // 不写会退回 makeCard() 默认的 2026-08-27，虽然这条路径下无影响，
    // 显式写出来避免这个测试的"不依赖 elapsed_days"变成没验证过的假设。
    wordsRepo.updateCard(
      'word-a',
      makeCard({
        state: State.Learning,
        stability: 70,
        learning_steps: 0,
        elapsed_days: 0,
        scheduled_days: 0,
        last_review: undefined,
      }),
    )
    reviewsRepo.create({ word: 'word-a', rating: 'good', source: 'review', replayCount: 0, reviewedAt: '2026-09-10T00:00:00.000Z' })
    reviewsRepo.create({ word: 'word-a', rating: 'good', source: 'review', replayCount: 0, reviewedAt: '2026-09-13T00:00:00.000Z' })

    scheduler.applyRating({
      word: 'word-a',
      rating: 'good',
      source: 'review',
      replayCount: 1,
      sentenceId,
      now: new Date('2026-09-16T10:00:00.000Z'),
    })

    expect(wordsRepo.get('word-a')?.card.state).toBe(State.Learning)
    expect(wordsRepo.get('word-a')?.graduated).toBe(false)

    db.close()
  })

  it('缺"最近三次都是 good/easy"：混入一次 hard，即使 state/stability 都满足也不毕业', () => {
    const db = openDatabase(':memory:')
    const sentenceId = seedSentence(db)
    const wordsRepo = createWordsRepo(db)
    const reviewsRepo = createReviewsRepo(db)
    const scheduler = createScheduler(db)

    wordsRepo.upsertError('word-b', sentenceId, makeCard())
    // 同 perseverance 用例：last_review 显式设为 30 天前，让 stability
    // 涨到 measured 过的 127.6 左右——这个用例要证明的是"三次评分里混了一次
    // hard 就不毕业"，所以 state/stability 两个条件都得稳稳满足。
    wordsRepo.updateCard(
      'word-b',
      makeCard({
        state: State.Review,
        stability: 70,
        elapsed_days: 30,
        scheduled_days: 30,
        reps: 5,
        last_review: new Date('2026-08-17T00:00:00.000Z'),
      }),
    )
    reviewsRepo.create({ word: 'word-b', rating: 'hard', source: 'review', replayCount: 2, reviewedAt: '2026-09-10T00:00:00.000Z' })
    reviewsRepo.create({ word: 'word-b', rating: 'good', source: 'review', replayCount: 0, reviewedAt: '2026-09-13T00:00:00.000Z' })

    scheduler.applyRating({
      word: 'word-b',
      rating: 'good',
      source: 'review',
      replayCount: 1,
      sentenceId,
      now: new Date('2026-09-16T10:00:00.000Z'),
    })

    expect(wordsRepo.get('word-b')?.graduated).toBe(false)

    db.close()
  })

  it('缺 stability>60：卡是 Review 且三次都是 good，但 stability 只涨到约 53.6 → 不毕业', () => {
    const db = openDatabase(':memory:')
    const sentenceId = seedSentence(db)
    const wordsRepo = createWordsRepo(db)
    const reviewsRepo = createReviewsRepo(db)
    const scheduler = createScheduler(db)

    wordsRepo.upsertError('word-c', sentenceId, makeCard())
    // measured 过：stability=10、last_review 30 天前的 Review 卡打 Good 后
    // 涨到约 53.6，够不到 60。elapsed_days 同样由 last_review 到 now 反推，
    // 显式覆盖 last_review 而不依赖 makeCard() 默认值。
    wordsRepo.updateCard(
      'word-c',
      makeCard({
        state: State.Review,
        stability: 10,
        elapsed_days: 30,
        scheduled_days: 30,
        reps: 5,
        last_review: new Date('2026-08-17T00:00:00.000Z'),
      }),
    )
    reviewsRepo.create({ word: 'word-c', rating: 'good', source: 'review', replayCount: 0, reviewedAt: '2026-09-10T00:00:00.000Z' })
    reviewsRepo.create({ word: 'word-c', rating: 'good', source: 'review', replayCount: 0, reviewedAt: '2026-09-13T00:00:00.000Z' })

    scheduler.applyRating({
      word: 'word-c',
      rating: 'good',
      source: 'review',
      replayCount: 1,
      sentenceId,
      now: new Date('2026-09-16T10:00:00.000Z'),
    })

    const row = wordsRepo.get('word-c')
    expect(row?.card.stability).toBeLessThan(60)
    expect(row?.graduated).toBe(false)

    db.close()
  })
})

describe('scheduler.dueQueue：同日去重', () => {
  it('当天评过分的词，即使 due 因为 Again 的一分钟偏移仍落在今天，也不会再出现', () => {
    const db = openDatabase(':memory:')
    const sentenceId = seedSentence(db)
    const scheduler = createScheduler(db)

    // Again 把 due 拨到「一分钟后」而不是明天——今天 10:00 打 again，
    // due = 10:01，dateToYmd 截断后仍然是今天，findDue 单独看会判定"到期"。
    scheduler.applyRating({
      word: 'ephemeral',
      rating: 'again',
      source: 'dictation',
      replayCount: 0,
      sentenceId,
      now: new Date('2026-09-16T10:00:00.000Z'),
    })

    expect(scheduler.dueQueue('2026-09-16', 10).map((w) => w.word)).not.toContain('ephemeral')

    db.close()
  })

  it('次日再查同一个词会回来（due 已到，且当天没有评分记录）', () => {
    const db = openDatabase(':memory:')
    const sentenceId = seedSentence(db)
    const scheduler = createScheduler(db)

    scheduler.applyRating({
      word: 'ephemeral',
      rating: 'again',
      source: 'dictation',
      replayCount: 0,
      sentenceId,
      now: new Date('2026-09-16T10:00:00.000Z'),
    })

    expect(scheduler.dueQueue('2026-09-17', 10).map((w) => w.word)).toContain('ephemeral')

    db.close()
  })
})

describe('scheduler.markSeenButNotTested：轻档明文曝光的延迟排期', () => {
  it('标记曝光后当天从 dueQueue 消失，次日又回来', () => {
    const db = openDatabase(':memory:')
    const sentenceId = seedSentence(db)
    const wordsRepo = createWordsRepo(db)
    const scheduler = createScheduler(db)

    // 造一个已经到期的错词
    wordsRepo.upsertError('candid', sentenceId, makeCard({ due: new Date('2026-09-15T00:00:00.000Z') }))
    expect(scheduler.dueQueue('2026-09-16', 10).map((w) => w.word)).toContain('candid')

    scheduler.markSeenButNotTested(['candid'], '2026-09-16')

    expect(scheduler.dueQueue('2026-09-16', 10).map((w) => w.word)).not.toContain('candid')
    expect(scheduler.dueQueue('2026-09-17', 10).map((w) => w.word)).toContain('candid')

    db.close()
  })
})
