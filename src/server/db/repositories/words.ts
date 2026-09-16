import type { Card, State } from 'ts-fsrs'
import type { Db } from '../connection'

/**
 * 对应 schema.sql 的 words 表。card 铺平了 ts-fsrs Card 的字段
 * （due/stability/difficulty/elapsed_days/scheduled_days/reps/lapses/state/last_review）。
 *
 * ⚠️ 已知缺口：本仓库安装的 ts-fsrs 5.4.2 的 Card 类型实际还有一个
 * `learning_steps: number` 字段（用于短期学习阶段的分步计时），但 schema.sql
 * （task 8a 定的表结构，本任务不允许改）没有对应列。任务说明列出的 9 个字段
 * 里也没有它，与当前装的版本对不上——大概率是任务撰写时参照的是更早、还没有
 * `learning_steps` 的 ts-fsrs 版本。这里的处理方式：读出来的 Card 固定把
 * learning_steps 填 0（与 createEmptyCard() 的初始值一致），写入时忽略调用方
 * 传入的 learning_steps（没地方存）。影响范围：只影响"学习/重学阶段内部的分步
 * 计时"这一个细粒度状态，不影响 stability/difficulty/reps/lapses/state 等
 * 决定长期调度的核心字段。如果后续要保真这个字段，需要给 words 表加列，
 * 但那是要单独评估、需要动 schema.sql 的事，不在本任务范围内。
 */
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
      learning_steps: 0,
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
     * 记录"这个词被听错了一次"。新词插入（error_count = 1，first_seen 记为
     * 本次句子）；已存在的词递增 error_count、把 last_error_sentence_id 更新为
     * 本次句子、并清掉 graduated。
     *
     * due 直接采用调用方传入的 today（转成 YYYY-MM-DD），而不是从 card.due
     * 换算——这是刻意的：srs.md 的毕业条件写明"毕业后若再次听错，state 重置
     * 并重新入队"，重新入队要在 findDue 的 due <= today 判据下真正生效，不能
     * 依赖调用方算出的 card.due 恰好落在今天或更早。card 的其余字段
     * （stability/difficulty/elapsed_days/scheduled_days/reps/lapses/state/
     * last_review）原样持久化，由调用方负责算出"重置后"的形状。
     */
    upsertError(word: string, sentenceId: number, card: Card, today: string): void {
      const exists = db.get(`SELECT word FROM words WHERE word = ?`, [word])
      const lastReview = card.last_review ? card.last_review.toISOString() : null

      if (exists) {
        db.run(
          `UPDATE words SET
             last_error_sentence_id = ?,
             error_count = error_count + 1,
             graduated = 0,
             due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
             reps = ?, lapses = ?, state = ?, last_review = ?
           WHERE word = ?`,
          [
            sentenceId,
            today,
            card.stability,
            card.difficulty,
            card.elapsed_days,
            card.scheduled_days,
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
              due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review)
           VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            word,
            sentenceId,
            sentenceId,
            today,
            card.stability,
            card.difficulty,
            card.elapsed_days,
            card.scheduled_days,
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
           reps = ?, lapses = ?, state = ?, last_review = ?
         WHERE word = ?`,
        [
          dateToYmd(card.due),
          card.stability,
          card.difficulty,
          card.elapsed_days,
          card.scheduled_days,
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
