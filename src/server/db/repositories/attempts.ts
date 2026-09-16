import type { Db } from '../connection'

/** 对应 schema.sql 的 attempts 表，字段转成 camelCase。 */
export interface AttemptRow {
  id: number
  sentenceId: number
  mode: string
  input: string | null
  testedWordsTotal: number
  testedWordsCorrect: number
  accuracy: number | null
  testedWords: string[]
  outcome: string
  comprehended: boolean | null
  replayCount: number
  durationMs: number | null
  createdAt: string
}

export type CreateAttemptInput = Omit<AttemptRow, 'id'>

interface AttemptDbRow {
  id: number
  sentence_id: number
  mode: string
  input: string | null
  tested_words_total: number
  tested_words_correct: number
  accuracy: number | null
  tested_words_json: string
  outcome: string
  comprehended: number | null
  replay_count: number
  duration_ms: number | null
  created_at: string
}

// SQLite 没有布尔类型，comprehended 落库是 INTEGER，且是三态：NULL（非保命档，
// 未考察"是否听懂"）/ 0 / 1（保命档）。写成 Boolean(value) 会把 NULL 也转成
// false，等于替用户瞎猜"听懂了"——这是本文件唯一容易踩、也最不能踩的坑。
function comprehendedFromDb(value: number | null): boolean | null {
  return value === null ? null : value === 1
}

function comprehendedToDb(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0
}

function mapRow(row: AttemptDbRow): AttemptRow {
  return {
    id: Number(row.id),
    sentenceId: Number(row.sentence_id),
    mode: row.mode,
    input: row.input,
    testedWordsTotal: Number(row.tested_words_total),
    testedWordsCorrect: Number(row.tested_words_correct),
    // accuracy 保持 NULL 原样透传，不做 ?? 0 之类的兜底——NULL 是保命档/
    // 空考察集的正常状态，兜成 0 会把这些句子计成全错，见 schema.sql 里的注释。
    accuracy: row.accuracy === null ? null : Number(row.accuracy),
    testedWords: JSON.parse(row.tested_words_json) as string[],
    outcome: row.outcome,
    comprehended: comprehendedFromDb(row.comprehended),
    replayCount: Number(row.replay_count),
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    createdAt: row.created_at,
  }
}

export function createAttemptsRepo(db: Db) {
  return {
    create(input: CreateAttemptInput): number {
      const result = db.run(
        `INSERT INTO attempts
           (sentence_id, mode, input, tested_words_total, tested_words_correct,
            accuracy, tested_words_json, outcome, comprehended, replay_count, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.sentenceId,
          input.mode,
          input.input,
          input.testedWordsTotal,
          input.testedWordsCorrect,
          input.accuracy,
          JSON.stringify(input.testedWords),
          input.outcome,
          comprehendedToDb(input.comprehended),
          input.replayCount,
          input.durationMs,
          input.createdAt,
        ],
      )
      return Number(result.lastInsertRowid)
    },

    // 按 id 倒序取第一条：id 自增严格反映插入顺序，比 created_at（调用方传入的
    // 字符串，同毫秒可能重复）更可靠。
    latestBySentence(sentenceId: number): AttemptRow | null {
      const row = db.get(`SELECT * FROM attempts WHERE sentence_id = ? ORDER BY id DESC LIMIT 1`, [
        sentenceId,
      ])
      return row ? mapRow(row as unknown as AttemptDbRow) : null
    },

    countByMaterial(materialId: number): number {
      const row = db.get(
        `SELECT COUNT(*) AS cnt FROM attempts
         JOIN sentences ON attempts.sentence_id = sentences.id
         WHERE sentences.material_id = ?`,
        [materialId],
      )
      return row ? Number((row as unknown as { cnt: number }).cnt) : 0
    },
  }
}

export type AttemptsRepo = ReturnType<typeof createAttemptsRepo>
