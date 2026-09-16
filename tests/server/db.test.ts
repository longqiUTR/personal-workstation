import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, type Db } from '../../src/server/db/connection'

function seedMaterial(db: Db) {
  const material = db.run(
    `INSERT INTO materials (title, source, audio_path, sentence_count, added_at)
     VALUES (?, ?, ?, ?, ?)`,
    ['Test Material', 'cet4', '/audio/test.mp3', 1, '2026-09-16T00:00:00.000Z'],
  )
  const materialId = Number(material.lastInsertRowid)

  const sentence = db.run(
    `INSERT INTO sentences (material_id, idx, start_ms, end_ms, text, key_words_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [materialId, 0, 0, 3000, 'Hello world', JSON.stringify(['hello', 'world'])],
  )
  const sentenceId = Number(sentence.lastInsertRowid)

  return { materialId, sentenceId }
}

describe('database schema and connection', () => {
  it('creates all five tables', () => {
    const db = openDatabase(':memory:')
    const rows = db.all(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    )
    const names = rows.map((r) => r.name)
    expect(names).toEqual(
      expect.arrayContaining(['materials', 'sentences', 'attempts', 'words', 'reviews']),
    )
    db.close()
  })

  it('inserts a material -> sentence -> attempt chain and reads it back', () => {
    const db = openDatabase(':memory:')
    const { sentenceId } = seedMaterial(db)

    const attempt = db.run(
      `INSERT INTO attempts
         (sentence_id, mode, input, tested_words_total, tested_words_correct,
          accuracy, tested_words_json, outcome, comprehended, replay_count, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sentenceId,
        'medium',
        'hello world',
        2,
        2,
        1.0,
        JSON.stringify(['hello', 'world']),
        'ok',
        null,
        0,
        1500,
        '2026-09-16T00:01:00.000Z',
      ],
    )
    const attemptId = Number(attempt.lastInsertRowid)

    const row = db.get('SELECT * FROM attempts WHERE id = ?', [attemptId])
    expect(row).toBeTruthy()
    expect(row?.sentence_id).toBe(sentenceId)
    expect(row?.mode).toBe('medium')
    expect(row?.tested_words_correct).toBe(2)
    expect(row?.outcome).toBe('ok')

    db.close()
  })

  it('accepts and returns NULL for attempts.accuracy (lifeline / empty-tested case)', () => {
    const db = openDatabase(':memory:')
    const { sentenceId } = seedMaterial(db)

    const attempt = db.run(
      `INSERT INTO attempts
         (sentence_id, mode, input, tested_words_total, tested_words_correct,
          accuracy, tested_words_json, outcome, comprehended, replay_count, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sentenceId,
        'lifeline',
        null,
        0,
        0,
        null, // accuracy 必须真正落 NULL，不是 0
        JSON.stringify([]),
        'revealed',
        1,
        0,
        null,
        '2026-09-16T00:02:00.000Z',
      ],
    )
    const attemptId = Number(attempt.lastInsertRowid)

    const row = db.get('SELECT * FROM attempts WHERE id = ?', [attemptId])
    expect(row).toBeTruthy()
    // 显式断言 null，而不是 falsy —— 0 也是 falsy，但语义完全不同
    expect(row?.accuracy).toBeNull()
    expect(row?.accuracy).not.toBe(0)

    db.close()
  })

  it('accepts NULL comprehended for non-lifeline tiers and 0/1 for lifeline', () => {
    const db = openDatabase(':memory:')
    const { sentenceId } = seedMaterial(db)

    const heavy = db.run(
      `INSERT INTO attempts
         (sentence_id, mode, tested_words_total, tested_words_correct,
          tested_words_json, outcome, comprehended, created_at)
       VALUES (?, 'heavy', 1, 1, ?, 'ok', ?, ?)`,
      [sentenceId, JSON.stringify(['hello']), null, '2026-09-16T00:03:00.000Z'],
    )
    const lifelineOk = db.run(
      `INSERT INTO attempts
         (sentence_id, mode, tested_words_total, tested_words_correct,
          tested_words_json, outcome, comprehended, created_at)
       VALUES (?, 'lifeline', 0, 0, ?, 'revealed', ?, ?)`,
      [sentenceId, JSON.stringify([]), 1, '2026-09-16T00:04:00.000Z'],
    )
    const lifelineFail = db.run(
      `INSERT INTO attempts
         (sentence_id, mode, tested_words_total, tested_words_correct,
          tested_words_json, outcome, comprehended, created_at)
       VALUES (?, 'lifeline', 0, 0, ?, 'revealed', ?, ?)`,
      [sentenceId, JSON.stringify([]), 0, '2026-09-16T00:05:00.000Z'],
    )

    const heavyRow = db.get('SELECT * FROM attempts WHERE id = ?', [
      Number(heavy.lastInsertRowid),
    ])
    const lifelineOkRow = db.get('SELECT * FROM attempts WHERE id = ?', [
      Number(lifelineOk.lastInsertRowid),
    ])
    const lifelineFailRow = db.get('SELECT * FROM attempts WHERE id = ?', [
      Number(lifelineFail.lastInsertRowid),
    ])

    expect(heavyRow?.comprehended).toBeNull()
    expect(lifelineOkRow?.comprehended).toBe(1)
    expect(lifelineFailRow?.comprehended).toBe(0)

    db.close()
  })

  it('round-trips all ts-fsrs Card fields on a words row', () => {
    const db = openDatabase(':memory:')
    const { sentenceId } = seedMaterial(db)

    db.run(
      `INSERT INTO words
         (word, first_seen_sentence_id, last_error_sentence_id, error_count, graduated,
          exposed_on, due, stability, difficulty, elapsed_days, scheduled_days,
          reps, lapses, state, last_review)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'ubiquitous',
        sentenceId,
        sentenceId,
        3,
        0,
        '2026-09-15',
        '2026-09-20',
        4.2,
        6.7,
        5,
        7,
        2,
        1,
        1,
        '2026-09-13T00:00:00.000Z',
      ],
    )

    const row = db.get('SELECT * FROM words WHERE word = ?', ['ubiquitous'])
    expect(row).toMatchObject({
      word: 'ubiquitous',
      first_seen_sentence_id: sentenceId,
      last_error_sentence_id: sentenceId,
      error_count: 3,
      graduated: 0,
      exposed_on: '2026-09-15',
      due: '2026-09-20',
      stability: 4.2,
      difficulty: 6.7,
      elapsed_days: 5,
      scheduled_days: 7,
      reps: 2,
      lapses: 1,
      state: 1,
      last_review: '2026-09-13T00:00:00.000Z',
    })

    db.close()
  })

  it('uses the partial index to find due, non-graduated words by date string', () => {
    const db = openDatabase(':memory:')

    const words = [
      { word: 'alpha', due: '2026-09-10', graduated: 0 }, // due, 未毕业 -> 命中
      { word: 'beta', due: '2026-09-16', graduated: 0 }, // due, 未毕业 -> 命中
      { word: 'gamma', due: '2026-09-10', graduated: 1 }, // 已毕业 -> 不该出现
      { word: 'delta', due: '2026-09-30', graduated: 0 }, // 还没到期 -> 不该出现
    ]
    for (const w of words) {
      db.run(
        `INSERT INTO words
           (word, error_count, graduated, due, stability, difficulty,
            elapsed_days, scheduled_days, reps, lapses, state)
         VALUES (?, 1, ?, ?, 1.0, 1.0, 0, 1, 0, 0, 0)`,
        [w.word, w.graduated, w.due],
      )
    }

    const due = db.all(
      `SELECT word FROM words WHERE graduated = 0 AND due <= ? ORDER BY word`,
      ['2026-09-16'],
    )
    expect(due.map((r) => r.word)).toEqual(['alpha', 'beta'])

    // 确认这条查询真的走了针对 graduated = 0 的部分索引，而不是全表扫描
    const plan = db.all(
      `EXPLAIN QUERY PLAN
       SELECT word FROM words WHERE graduated = 0 AND due <= ?`,
      ['2026-09-16'],
    )
    const planText = plan.map((r) => String(r.detail)).join(' | ')
    expect(planText).toContain('idx_words_due')

    db.close()
  })

  it('cascades deletes from materials down through sentences to attempts', () => {
    const db = openDatabase(':memory:')
    const { materialId, sentenceId } = seedMaterial(db)

    db.run(
      `INSERT INTO attempts (sentence_id, mode, tested_words_total, tested_words_correct,
                              tested_words_json, outcome, created_at)
       VALUES (?, 'light', 1, 1, ?, 'ok', ?)`,
      [sentenceId, JSON.stringify(['hello']), '2026-09-16T00:06:00.000Z'],
    )

    expect(db.get('SELECT * FROM sentences WHERE id = ?', [sentenceId])).toBeTruthy()
    expect(
      db.get('SELECT * FROM attempts WHERE sentence_id = ?', [sentenceId]),
    ).toBeTruthy()

    db.run('DELETE FROM materials WHERE id = ?', [materialId])

    expect(db.get('SELECT * FROM sentences WHERE id = ?', [sentenceId])).toBeFalsy()
    expect(
      db.get('SELECT * FROM attempts WHERE sentence_id = ?', [sentenceId]),
    ).toBeFalsy()

    db.close()
  })

  it('persists data across close/reopen using a real file path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'db-persistence-test-'))
    const dbPath = join(dir, 'persist.db')

    try {
      const db1 = openDatabase(dbPath)
      db1.run(
        `INSERT INTO materials (title, source, audio_path, sentence_count, added_at)
         VALUES (?, ?, ?, ?, ?)`,
        ['Persisted Material', 'voa', '/audio/persist.mp3', 0, '2026-09-16T00:00:00.000Z'],
      )
      db1.close()

      const db2 = openDatabase(dbPath)
      const row = db2.get('SELECT * FROM materials WHERE title = ?', ['Persisted Material'])
      expect(row).toBeTruthy()
      expect(row?.source).toBe('voa')
      db2.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
