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
  }
}

export type ReviewsRepo = ReturnType<typeof createReviewsRepo>
