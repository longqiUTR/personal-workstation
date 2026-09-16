import type { Db } from '../connection'

/** 对应 schema.sql 的 materials 表，字段转成 camelCase。 */
export interface MaterialRow {
  id: number
  title: string
  source: string
  lane: string
  audioPath: string
  transcriptPath: string | null
  durationMs: number | null
  sentenceCount: number
  currentSentenceIdx: number
  addedAt: string
  finishedAt: string | null
}

export interface CreateMaterialInput {
  title: string
  source: string
  lane?: string
  audioPath: string
  transcriptPath?: string | null
  durationMs?: number | null
  sentenceCount?: number
  addedAt: string
}

/** 数据库原始行的形状（snake_case），只在本文件内部使用。 */
interface MaterialDbRow {
  id: number
  title: string
  source: string
  lane: string
  audio_path: string
  transcript_path: string | null
  duration_ms: number | null
  sentence_count: number
  current_sentence_idx: number
  added_at: string
  finished_at: string | null
}

function mapRow(row: MaterialDbRow): MaterialRow {
  return {
    id: Number(row.id),
    title: row.title,
    source: row.source,
    lane: row.lane,
    audioPath: row.audio_path,
    transcriptPath: row.transcript_path,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    sentenceCount: Number(row.sentence_count),
    currentSentenceIdx: Number(row.current_sentence_idx),
    addedAt: row.added_at,
    finishedAt: row.finished_at,
  }
}

export function createMaterialsRepo(db: Db) {
  return {
    create(input: CreateMaterialInput): number {
      const result = db.run(
        `INSERT INTO materials (title, source, lane, audio_path, transcript_path, duration_ms, sentence_count, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.title,
          input.source,
          input.lane ?? 'english',
          input.audioPath,
          input.transcriptPath ?? null,
          input.durationMs ?? null,
          input.sentenceCount ?? 0,
          input.addedAt,
        ],
      )
      return Number(result.lastInsertRowid)
    },

    get(id: number): MaterialRow | null {
      const row = db.get(`SELECT * FROM materials WHERE id = ?`, [id])
      return row ? mapRow(row as unknown as MaterialDbRow) : null
    },

    // 按 id 倒序即最新插入的排最前，比按 added_at 排序更可靠——
    // added_at 是调用方传入的字符串，不保证严格单调。
    list(): MaterialRow[] {
      return db
        .all(`SELECT * FROM materials ORDER BY id DESC`)
        .map((row) => mapRow(row as unknown as MaterialDbRow))
    },

    setProgress(id: number, idx: number): void {
      db.run(`UPDATE materials SET current_sentence_idx = ? WHERE id = ?`, [idx, id])
    },

    markFinished(id: number, at: string): void {
      db.run(`UPDATE materials SET finished_at = ? WHERE id = ?`, [at, id])
    },
  }
}

export type MaterialsRepo = ReturnType<typeof createMaterialsRepo>
