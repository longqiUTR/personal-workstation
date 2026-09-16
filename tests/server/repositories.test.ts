import { describe, expect, it } from 'vitest'
import type { Card } from 'ts-fsrs'
import { State } from 'ts-fsrs'
import { openDatabase, type Db } from '../../src/server/db/connection'
import { createMaterialsRepo } from '../../src/server/db/repositories/materials'
import { createSentencesRepo } from '../../src/server/db/repositories/sentences'
import { createAttemptsRepo } from '../../src/server/db/repositories/attempts'
import { createWordsRepo } from '../../src/server/db/repositories/words'
import { createReviewsRepo } from '../../src/server/db/repositories/reviews'

// 造一条 material + 一句 sentence，attempts/words 的外键都挂在句子上。
function seedMaterialAndSentence(db: Db) {
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
  return { materialId, sentenceId: sentence.id }
}

// reviews.word 有外键约束（references words(word)），先塞一行满足 NOT NULL 列即可，
// 具体的 FSRS 字段值在 reviews 相关测试里不重要。
function seedWord(db: Db, word: string) {
  db.run(
    `INSERT INTO words (word, error_count, graduated, due, stability, difficulty,
       elapsed_days, scheduled_days, reps, lapses, state)
     VALUES (?, 1, 0, '2026-09-10', 1.0, 1.0, 0, 1, 0, 0, 0)`,
    [word],
  )
}

describe('materials repo', () => {
  it('创建/读取一次往返', () => {
    const db = openDatabase(':memory:')
    const repo = createMaterialsRepo(db)

    const id = repo.create({
      title: 'BBC 6 Minute English',
      source: 'bbc',
      audioPath: '/audio/a.mp3',
      addedAt: '2026-09-16T00:00:00.000Z',
    })
    const row = repo.get(id)

    expect(row).toMatchObject({
      id,
      title: 'BBC 6 Minute English',
      source: 'bbc',
      lane: 'english', // 未传时落 schema 默认值
      audioPath: '/audio/a.mp3',
      transcriptPath: null,
      sentenceCount: 0,
      currentSentenceIdx: 0,
      finishedAt: null,
    })
    expect(repo.get(id + 999)).toBeNull()

    db.close()
  })

  it('list 最新插入排最前，setProgress/markFinished 生效', () => {
    const db = openDatabase(':memory:')
    const repo = createMaterialsRepo(db)

    const id1 = repo.create({ title: 'First', source: 'voa', audioPath: '/a.mp3', addedAt: 't1' })
    const id2 = repo.create({ title: 'Second', source: 'voa', audioPath: '/b.mp3', addedAt: 't2' })

    expect(repo.list().map((m) => m.id)).toEqual([id2, id1])

    repo.setProgress(id1, 5)
    expect(repo.get(id1)?.currentSentenceIdx).toBe(5)

    repo.markFinished(id2, '2026-09-16T12:00:00.000Z')
    expect(repo.get(id2)?.finishedAt).toBe('2026-09-16T12:00:00.000Z')

    db.close()
  })
})

describe('sentences repo', () => {
  it('bulkCreate + listByMaterial/get/getByIdx 基本往返', () => {
    const db = openDatabase(':memory:')
    const { materialId, sentenceId } = seedMaterialAndSentence(db)
    const repo = createSentencesRepo(db)

    const list = repo.listByMaterial(materialId)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      id: sentenceId,
      idx: 0,
      text: 'Hello world',
      keyWords: ['hello', 'world'],
    })

    expect(repo.get(sentenceId)?.text).toBe('Hello world')
    expect(repo.getByIdx(materialId, 0)?.id).toBe(sentenceId)
    expect(repo.getByIdx(materialId, 99)).toBeNull()

    db.close()
  })

  it('bulkCreate 是事务性的：中途撞 UNIQUE 约束整批回滚，不留半成品', () => {
    const db = openDatabase(':memory:')
    const materials = createMaterialsRepo(db)
    const sentences = createSentencesRepo(db)
    const materialId = materials.create({
      title: 'M',
      source: 'cet4',
      audioPath: '/a.mp3',
      addedAt: 't',
    })

    expect(() =>
      sentences.bulkCreate(materialId, [
        { idx: 0, startMs: 0, endMs: 1000, text: 'One', keyWords: [] },
        { idx: 1, startMs: 1000, endMs: 2000, text: 'Two', keyWords: [] },
        { idx: 0, startMs: 2000, endMs: 3000, text: 'Dup idx', keyWords: [] }, // 撞 UNIQUE(material_id, idx)
      ]),
    ).toThrow()

    // 半导入比导入失败更糟：前两行也必须被回滚掉，一条都不能留
    expect(sentences.listByMaterial(materialId)).toHaveLength(0)

    db.close()
  })
})

describe('attempts repo', () => {
  it('create + latestBySentence/countByMaterial 基本往返', () => {
    const db = openDatabase(':memory:')
    const { materialId, sentenceId } = seedMaterialAndSentence(db)
    const repo = createAttemptsRepo(db)

    repo.create({
      sentenceId,
      mode: 'medium',
      input: 'hello world',
      testedWordsTotal: 2,
      testedWordsCorrect: 2,
      accuracy: 1,
      testedWords: ['hello', 'world'],
      outcome: 'ok',
      comprehended: null,
      replayCount: 0,
      durationMs: 1500,
      createdAt: '2026-09-16T00:01:00.000Z',
    })
    const id2 = repo.create({
      sentenceId,
      mode: 'medium',
      input: 'hello world',
      testedWordsTotal: 2,
      testedWordsCorrect: 1,
      accuracy: 0.5,
      testedWords: ['hello', 'world'],
      outcome: 'weak',
      comprehended: null,
      replayCount: 1,
      durationMs: 2000,
      createdAt: '2026-09-16T00:02:00.000Z',
    })

    const latest = repo.latestBySentence(sentenceId)
    expect(latest?.id).toBe(id2)
    expect(latest?.outcome).toBe('weak')
    expect(repo.countByMaterial(materialId)).toBe(2)

    db.close()
  })

  it('accuracy 为 NULL 时原样回读为 null，不是 0（保命档/无考察词场景）', () => {
    const db = openDatabase(':memory:')
    const { sentenceId } = seedMaterialAndSentence(db)
    const repo = createAttemptsRepo(db)

    repo.create({
      sentenceId,
      mode: 'lifeline',
      input: null,
      testedWordsTotal: 0,
      testedWordsCorrect: 0,
      accuracy: null,
      testedWords: [],
      outcome: 'revealed',
      comprehended: true,
      replayCount: 0,
      durationMs: null,
      createdAt: '2026-09-16T00:03:00.000Z',
    })

    const row = repo.latestBySentence(sentenceId)
    // 显式断言 null，不是 falsy——0 也是 falsy 但语义完全不同
    expect(row?.accuracy).toBeNull()
    expect(row?.accuracy).not.toBe(0)

    db.close()
  })

  it('comprehended 非保命档回读为 null，保命档回读为 true/false', () => {
    const db = openDatabase(':memory:')
    const { sentenceId } = seedMaterialAndSentence(db)
    const repo = createAttemptsRepo(db)
    const base = {
      sentenceId,
      testedWordsTotal: 0,
      testedWordsCorrect: 0,
      accuracy: null,
      testedWords: [] as string[],
      input: null,
      durationMs: null,
      replayCount: 0,
    }

    repo.create({ ...base, mode: 'heavy', outcome: 'ok', comprehended: null, createdAt: 't1' })
    expect(repo.latestBySentence(sentenceId)?.comprehended).toBeNull()

    repo.create({ ...base, mode: 'lifeline', outcome: 'revealed', comprehended: true, createdAt: 't2' })
    expect(repo.latestBySentence(sentenceId)?.comprehended).toBe(true)

    repo.create({ ...base, mode: 'lifeline', outcome: 'revealed', comprehended: false, createdAt: 't3' })
    // 最容易踩的坑：Boolean(null) === false，会把"未考察"误判成"没听懂"
    expect(repo.latestBySentence(sentenceId)?.comprehended).toBe(false)

    db.close()
  })
})

describe('words repo', () => {
  function makeCard(overrides: Partial<Card> = {}): Card {
    return {
      due: new Date('2026-09-20T00:00:00.000Z'),
      stability: 4.2,
      difficulty: 6.7,
      elapsed_days: 5,
      scheduled_days: 7,
      reps: 2,
      lapses: 3, // 故意取一个不易和别的字段混淆的值，映射漏了会被立刻测出来
      state: State.Review,
      last_review: new Date('2026-09-13T08:00:00.000Z'),
      learning_steps: 0,
      ...overrides,
    }
  }

  it('upsertError 完整往返 Card 的每个字段（新词分支）', () => {
    const db = openDatabase(':memory:')
    const { sentenceId } = seedMaterialAndSentence(db)
    const repo = createWordsRepo(db)

    repo.upsertError('ubiquitous', sentenceId, makeCard(), '2026-09-16')
    const row = repo.get('ubiquitous')

    expect(row).not.toBeNull()
    // due 取自 upsertError 的 today 参数而非 card.due——见 words.ts 里的注释
    expect(row!.card.due).toEqual(new Date('2026-09-16'))
    expect(row!.card.stability).toBe(4.2)
    expect(row!.card.difficulty).toBe(6.7)
    expect(row!.card.elapsed_days).toBe(5)
    expect(row!.card.scheduled_days).toBe(7)
    expect(row!.card.reps).toBe(2)
    expect(row!.card.lapses).toBe(3)
    expect(row!.card.state).toBe(State.Review)
    expect(row!.card.last_review).toEqual(new Date('2026-09-13T08:00:00.000Z'))

    expect(row!.errorCount).toBe(1)
    expect(row!.firstSeenSentenceId).toBe(sentenceId)
    expect(row!.lastErrorSentenceId).toBe(sentenceId)
    expect(row!.graduated).toBe(false)
    expect(row!.exposedOn).toBeNull()

    db.close()
  })

  it('updateCard 完整往返 Card 全部字段，due 取自 card.due', () => {
    const db = openDatabase(':memory:')
    const { sentenceId } = seedMaterialAndSentence(db)
    const repo = createWordsRepo(db)

    repo.upsertError('meticulous', sentenceId, makeCard({ lapses: 0 }), '2026-09-10')
    repo.updateCard(
      'meticulous',
      makeCard({ due: new Date('2026-09-25T00:00:00.000Z'), lapses: 4, scheduled_days: 15 }),
    )

    const row = repo.get('meticulous')
    expect(row!.card.due).toEqual(new Date('2026-09-25'))
    expect(row!.card.lapses).toBe(4)
    expect(row!.card.scheduled_days).toBe(15)

    db.close()
  })

  it('upsertError 对已存在的词递增 error_count 并清除 graduated', () => {
    const db = openDatabase(':memory:')
    const { sentenceId } = seedMaterialAndSentence(db)
    const repo = createWordsRepo(db)

    repo.upsertError('abandon', sentenceId, makeCard(), '2026-09-10')
    repo.markGraduated('abandon')
    expect(repo.get('abandon')?.graduated).toBe(true)

    repo.upsertError('abandon', sentenceId, makeCard(), '2026-09-16')
    const row = repo.get('abandon')
    expect(row?.errorCount).toBe(2)
    // 毕业词再次听错必须重新入队——srs.md「毕业后若再次听错，state 重置并重新入队」
    expect(row?.graduated).toBe(false)

    db.close()
  })

  it('findDue 排除已毕业的词', () => {
    const db = openDatabase(':memory:')
    const { sentenceId } = seedMaterialAndSentence(db)
    const repo = createWordsRepo(db)

    repo.upsertError('alpha', sentenceId, makeCard(), '2026-09-10')
    repo.upsertError('beta', sentenceId, makeCard(), '2026-09-10')
    repo.markGraduated('beta')

    expect(repo.findDue('2026-09-16', 10).map((w) => w.word)).toEqual(['alpha'])

    db.close()
  })

  it('findDue 排除今天已曝光的词，但包含更早日期曝光的词', () => {
    const db = openDatabase(':memory:')
    const { sentenceId } = seedMaterialAndSentence(db)
    const repo = createWordsRepo(db)

    repo.upsertError('gamma', sentenceId, makeCard(), '2026-09-10')
    repo.upsertError('delta', sentenceId, makeCard(), '2026-09-10')
    repo.markExposed('gamma', '2026-09-16') // 今天曝光过 -> 排除
    repo.markExposed('delta', '2026-09-14') // 更早曝光过 -> 仍然命中

    expect(repo.findDue('2026-09-16', 10).map((w) => w.word)).toEqual(['delta'])

    db.close()
  })

  it('findByWords 按词批量查询，空数组直接返回空', () => {
    const db = openDatabase(':memory:')
    const { sentenceId } = seedMaterialAndSentence(db)
    const repo = createWordsRepo(db)

    repo.upsertError('one', sentenceId, makeCard(), '2026-09-10')
    repo.upsertError('two', sentenceId, makeCard(), '2026-09-10')

    expect(
      repo
        .findByWords(['one', 'two', 'missing'])
        .map((w) => w.word)
        .sort(),
    ).toEqual(['one', 'two'])
    expect(repo.findByWords([])).toEqual([])

    db.close()
  })
})

describe('reviews repo', () => {
  it('create + countByWord 基本往返', () => {
    const db = openDatabase(':memory:')
    seedWord(db, 'abandon')
    const repo = createReviewsRepo(db)

    repo.create({
      word: 'abandon',
      rating: 'good',
      source: 'review',
      replayCount: 1,
      reviewedAt: '2026-09-14T00:00:00.000Z',
    })
    repo.create({
      word: 'abandon',
      rating: 'hard',
      source: 'dictation',
      replayCount: 2,
      reviewedAt: '2026-09-15T00:00:00.000Z',
    })

    expect(repo.countByWord('abandon')).toBe(2)
    expect(repo.countByWord('other')).toBe(0)

    db.close()
  })

  it('recentByWord 按最新在前排序（毕业判定要看最近三次评分）', () => {
    const db = openDatabase(':memory:')
    seedWord(db, 'abandon')
    const repo = createReviewsRepo(db)

    repo.create({
      word: 'abandon',
      rating: 'again',
      source: 'dictation',
      replayCount: 0,
      reviewedAt: '2026-09-10T00:00:00.000Z',
    })
    repo.create({
      word: 'abandon',
      rating: 'hard',
      source: 'review',
      replayCount: 2,
      reviewedAt: '2026-09-12T00:00:00.000Z',
    })
    repo.create({
      word: 'abandon',
      rating: 'good',
      source: 'review',
      replayCount: 1,
      reviewedAt: '2026-09-14T00:00:00.000Z',
    })

    const recent = repo.recentByWord('abandon', 2)
    expect(recent.map((r) => r.rating)).toEqual(['good', 'hard'])

    db.close()
  })
})
