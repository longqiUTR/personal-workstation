import type { Db } from '../connection'

/** 对应 schema.sql 的 sentences 表，字段转成 camelCase。 */
export interface SentenceRow {
  id: number
  materialId: number
  idx: number
  startMs: number
  endMs: number
  text: string
  keyWords: string[]
}

export interface NewSentenceInput {
  idx: number
  startMs: number
  endMs: number
  text: string
  keyWords: string[]
}

interface SentenceDbRow {
  id: number
  material_id: number
  idx: number
  start_ms: number
  end_ms: number
  text: string
  key_words_json: string
}

function mapRow(row: SentenceDbRow): SentenceRow {
  return {
    id: Number(row.id),
    materialId: Number(row.material_id),
    idx: Number(row.idx),
    startMs: Number(row.start_ms),
    endMs: Number(row.end_ms),
    text: row.text,
    keyWords: JSON.parse(row.key_words_json) as string[],
  }
}

export function createSentencesRepo(db: Db) {
  return {
    bulkCreate(materialId: number, rows: NewSentenceInput[]): void {
      if (rows.length === 0) return

      // 整批包一个事务：中途任何一行失败（比如 idx 撞了 UNIQUE(material_id, idx)）
      // 都要整批回滚——半导入的素材比导入失败更糟，句子编号断档会让后续听写流程错位。
      db.exec('BEGIN')
      try {
        for (const row of rows) {
          db.run(
            `INSERT INTO sentences (material_id, idx, start_ms, end_ms, text, key_words_json)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [materialId, row.idx, row.startMs, row.endMs, row.text, JSON.stringify(row.keyWords)],
          )
        }
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    },

    listByMaterial(materialId: number): SentenceRow[] {
      return db
        .all(`SELECT * FROM sentences WHERE material_id = ? ORDER BY idx`, [materialId])
        .map((row) => mapRow(row as unknown as SentenceDbRow))
    },

    get(id: number): SentenceRow | null {
      const row = db.get(`SELECT * FROM sentences WHERE id = ?`, [id])
      return row ? mapRow(row as unknown as SentenceDbRow) : null
    },

    getByIdx(materialId: number, idx: number): SentenceRow | null {
      const row = db.get(`SELECT * FROM sentences WHERE material_id = ? AND idx = ?`, [
        materialId,
        idx,
      ])
      return row ? mapRow(row as unknown as SentenceDbRow) : null
    },
  }
}

export type SentencesRepo = ReturnType<typeof createSentencesRepo>
