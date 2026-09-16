import type { Card, State } from 'ts-fsrs'
import type { Db } from '../connection'

export interface WordRow {
  word: string
  firstSeenSentenceId: number | null
  lastErrorSentenceId: number | null
  errorCount: number
  graduated: boolean
  exposedOn: string | null
  card: Card
}

interface WordDbRow {
  word: string
  first_seen_sentence_id: number | null
  last_error_sentence_id: number | null
  error_count: number
  graduated: number
  exposed_on: string | null
  due: string
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  state: number
  last_review: string | null
}

// due / exposed_on 是 YYYY-MM-DD，与 findDue 的字符串比较对齐；
// Card.due 是精确到时刻的 Date，按 UTC 天截断转换——写方向。
function dateToYmd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// 反方向：YYYY-MM-DD 按 ECMA-262 的 date-only 解析规则视为 UTC 零点，
// 和上面写入时的截断口径对称，来回转换不会产生日期偏移。
function ymdToDate(s: string): Date {
  return new Date(s)
}

// last_review 需要保留到时刻的精度（不是"今天/未到期"这种天粒度比较），
// 所以走完整 ISO 字符串，不经过 YYYY-MM-DD 那一层截断。
function isoToDate(s: string): Date {
  return new Date(s)
}

function mapRow(row: WordDbRow): WordRow {
  return {
    word: row.word,
    firstSeenSentenceId: row.first_seen_sentence_id === null ? null : Number(row.first_seen_sentence_id),
    lastErrorSentenceId: row.last_error_sentence_id === null ? null : Number(row.last_error_sentence_id),
    errorCount: Number(row.error_count),
    graduated: Boolean(row.graduated),
    exposedOn: row.exposed_on,
    card: {
      due: ymdToDate(row.due),
      stability: Number(row.stability),
      difficulty: Number(row.difficulty),
      elapsed_days: Number(row.elapsed_days),
      scheduled_days: Number(row.scheduled_days),
      reps: Number(row.reps),
      lapses: Number(row.lapses),
      state: Number(row.state) as State,
      last_review: row.last_review === null ? undefined : isoToDate(row.last_review),
      // 见文件顶部注释：schema 没有这一列，固定回填 0。
      learning_steps: row.learning_steps,
    },
  }
}

export function createWordsRepo(db: Db) {
  return {
    // due 用字符串比较：graduated = 0（未毕业）、due <= today（到期）、
    // 且 exposed_on 不是 today（今天没有被轻档明文曝光过，否则评分会虚高，
    // 见 pitfalls.md #15）。按 due 升序，最先到期的先复习。
    findDue(today: string, limit: number): WordRow[] {
      return db
        .all(
          `SELECT * FROM words
           WHERE graduated = 0 AND due <= ? AND (exposed_on IS NULL OR exposed_on <> ?)
           ORDER BY due
           LIMIT ?`,
          [today, today, limit],
        )
        .map((row) => mapRow(row as unknown as WordDbRow))
    },

    findByWords(words: string[]): WordRow[] {
      // 空数组不能拼成 "IN ()"（非法 SQL），直接短路返回空结果。
      if (words.length === 0) return []
      const placeholders = words.map(() => '?').join(', ')
      return db
        .all(`SELECT * FROM words WHERE word IN (${placeholders})`, words)
        .map((row) => mapRow(row as unknown as WordDbRow))
    },

    get(word: string): WordRow | null {
      const row = db.get(`SELECT * FROM words WHERE word = ?`, [word])
      return row ? mapRow(row as unknown as WordDbRow) : null
    },

    /**
     * 只负责持久化，不替 FSRS 做调度决定：due 如实写 card.due。
     *
     * 曾经这里强制把 due 写成"今天"，理由是"毕业词再次听错要重新入队"。
     * 那是越界——调用方拿到的 card 已经是 FSRS 对这次 Again 的安排，
     * 覆盖它等于让持久化层推翻调度器。真需要当天再练，应由 Task 10 的
     * 调度服务在算 card 时决定，而不是在这里改写结果。
     */
    upsertError(word: string, sentenceId: number, card: Card): void {
      const exists = db.get(`SELECT word FROM words WHERE word = ?`, [word])
      const lastReview = card.last_review ? card.last_review.toISOString() : null

      if (exists) {
        db.run(
          `UPDATE words SET
             last_error_sentence_id = ?,
             error_count = error_count + 1,
             graduated = 0,
             due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
             learning_steps = ?, reps = ?, lapses = ?, state = ?, last_review = ?
           WHERE word = ?`,
          [
            sentenceId,
            dateToYmd(card.due),
            card.stability,
            card.difficulty,
            card.elapsed_days,
            card.scheduled_days,
            card.learning_steps,
            card.reps,
            card.lapses,
            card.state,
            lastReview,
            word,
          ],
        )
      } else {
        db.run(
          `INSERT INTO words
             (word, first_seen_sentence_id, last_error_sentence_id, error_count, graduated,
              due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
              reps, lapses, state, last_review)
           VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            word,
            sentenceId,
            sentenceId,
            dateToYmd(card.due),
            card.stability,
            card.difficulty,
            card.elapsed_days,
            card.scheduled_days,
            card.learning_steps,
            card.reps,
            card.lapses,
            card.state,
            lastReview,
          ],
        )
      }
    },

    // 常规 FSRS 调度更新（独立复习 / 听写联动评分后调用），due 这里如实取自
    // card.due——和 upsertError 不同，这里没有"必须回到今天"的强制要求。
    updateCard(word: string, card: Card): void {
      db.run(
        `UPDATE words SET
           due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
           learning_steps = ?, reps = ?, lapses = ?, state = ?, last_review = ?
         WHERE word = ?`,
        [
          dateToYmd(card.due),
          card.stability,
          card.difficulty,
          card.elapsed_days,
          card.scheduled_days,
          card.learning_steps,
          card.reps,
          card.lapses,
          card.state,
          card.last_review ? card.last_review.toISOString() : null,
          word,
        ],
      )
    },

    markExposed(word: string, date: string): void {
      db.run(`UPDATE words SET exposed_on = ? WHERE word = ?`, [date, word])
    },

    markGraduated(word: string): void {
      db.run(`UPDATE words SET graduated = 1 WHERE word = ?`, [word])
    },
  }
}

export type WordsRepo = ReturnType<typeof createWordsRepo>
