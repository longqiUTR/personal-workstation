import type { Db } from '../connection'

/** 对应 schema.sql 的 reviews 表，字段转成 camelCase。 */
export interface ReviewRow {
  id: number
  word: string
  rating: string
  source: string
  replayCount: number
  reviewedAt: string
}

export type CreateReviewInput = Omit<ReviewRow, 'id'>

interface ReviewDbRow {
  id: number
  word: string
  rating: string
  source: string
  replay_count: number
  reviewed_at: string
}

function mapRow(row: ReviewDbRow): ReviewRow {
  return {
    id: Number(row.id),
    word: row.word,
    rating: row.rating,
    source: row.source,
    replayCount: Number(row.replay_count),
    reviewedAt: row.reviewed_at,
  }
}

export function createReviewsRepo(db: Db) {
  return {
    create(input: CreateReviewInput): number {
      const result = db.run(
        `INSERT INTO reviews (word, rating, source, replay_count, reviewed_at)
         VALUES (?, ?, ?, ?, ?)`,
        [input.word, input.rating, input.source, input.replayCount, input.reviewedAt],
      )
      return Number(result.lastInsertRowid)
    },

    // 按 id 倒序：毕业判定要看"最近连续三次评分"，id 自增顺序比 reviewed_at
    // 字符串更可靠地反映真实的评分先后。
    recentByWord(word: string, limit: number): ReviewRow[] {
      return db
        .all(`SELECT * FROM reviews WHERE word = ? ORDER BY id DESC LIMIT ?`, [word, limit])
        .map((row) => mapRow(row as unknown as ReviewDbRow))
    },

    countByWord(word: string): number {
      const row = db.get(`SELECT COUNT(*) AS cnt FROM reviews WHERE word = ?`, [word])
      return row ? Number((row as unknown as { cnt: number }).cnt) : 0
    },

    // 调度服务用来做同日去重：Again 只把 due 拨到一分钟后，按天截断的
    // words.due 当天就会显示"到期"，不靠这个查询排掉今天已经评过分的词，
    // 复习队列在一次会话内永远清不空。reviewed_at 是完整 ISO 字符串，
    // 取前 10 位和调用方传入的 YYYY-MM-DD 做字符串比较，口径与 words.due 一致。
    wordsReviewedOn(date: string): string[] {
      return db
        .all(`SELECT DISTINCT word FROM reviews WHERE substr(reviewed_at, 1, 10) = ?`, [date])
        .map((row) => (row as unknown as { word: string }).word)
    },
  }
}

export type ReviewsRepo = ReturnType<typeof createReviewsRepo>
