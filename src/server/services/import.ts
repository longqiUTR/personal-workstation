// 素材导入：唯一把 src/shared 的纯函数层和 db 层接起来的地方。
// 不在这里写裸 SQL——所有落库都走 repositories。
import { existsSync, readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import type { Db } from '../db/connection.js'
import { createMaterialsRepo } from '../db/repositories/materials.js'
import { createSentencesRepo } from '../db/repositories/sentences.js'
import { parseLrc, parseSrt } from '../../shared/transcript.js'
import { normalize } from '../../shared/normalize.js'
import { keyWordsOf } from '../../shared/keywords.js'

export interface ImportInput {
  title: string
  source: string // bbc | voa | cet4 | cet6
  audioPath: string // 相对仓库根，或绝对路径
  transcriptPath: string
  durationMs?: number // 调用方（前端用 Audio 元素）读到的音频时长
}

export function importMaterial(
  db: Db,
  input: ImportInput,
): { materialId: number; sentenceCount: number } {
  // path.resolve 单参数时就是相对 process.cwd() 解析，绝对路径原样返回——
  // 天然同时满足"相对仓库根"和"绝对路径"两种输入形式，不用分情况处理。
  const audioAbs = resolve(input.audioPath)
  const transcriptAbs = resolve(input.transcriptPath)

  if (!existsSync(audioAbs)) {
    throw new Error(`音频文件不存在: ${audioAbs}`)
  }
  if (!existsSync(transcriptAbs)) {
    throw new Error(`文本文件不存在: ${transcriptAbs}`)
  }

  const ext = extname(transcriptAbs).toLowerCase()
  const content = readFileSync(transcriptAbs, 'utf8')

  const parsed =
    ext === '.lrc' ? parseLrc(content) : ext === '.srt' ? parseSrt(content) : null
  if (parsed === null) {
    throw new Error(`不支持的字幕格式: ${ext}（只认 .lrc / .srt）`)
  }

  const lastIdx = parsed.length - 1
  const sentences = parsed.map((s, i) => {
    // LRC 只有起始时间戳，末句没有下一行可借，parseLrc 给的是 null；
    // SRT 每块自带结束时间，正常不会是 null。这里统一用 ?? 兜底，
    // 避免 sentences.end_ms 的 NOT NULL 约束在异常输入上抛出难懂的 SQL 报错。
    // 末句优先用调用方传入的音频总时长，拿不到才退化成经验值 +5000ms。
    const endMs = s.endMs ?? (i === lastIdx ? input.durationMs ?? s.startMs + 5000 : s.startMs + 5000)
    return { idx: s.idx, startMs: s.startMs, endMs, text: s.text }
  })

  const materials = createMaterialsRepo(db)
  const sentencesRepo = createSentencesRepo(db)

  // sentenceCount 在这里就能算出来，直接随 material 一起落库——
  // materialsRepo 没有暴露"事后改 sentence_count"的方法（也不该有，
  // 数据访问层不该替业务层决定何时该改哪个字段）。
  const materialId = materials.create({
    title: input.title,
    source: input.source,
    audioPath: input.audioPath,
    transcriptPath: input.transcriptPath,
    durationMs: input.durationMs ?? null,
    sentenceCount: sentences.length,
    addedAt: new Date().toISOString(),
  })

  sentencesRepo.bulkCreate(
    materialId,
    sentences.map((s) => ({
      idx: s.idx,
      // 原始时间戳直接存，不在这里加播放留白（200ms）——留白是播放器的职责，
      // 两处都加会叠成 400ms，相邻句子的播放区间会互相重叠。
      startMs: s.startMs,
      endMs: s.endMs,
      text: s.text,
      // 判定时 diff 比较的是归一化后的 token，这里必须存 normalize() 的输出
      // （小写、缩写展开后的形式），存原始大小写/标点会导致关键词永远配不上。
      keyWords: keyWordsOf(normalize(s.text)),
    })),
  )

  return { materialId, sentenceCount: sentences.length }
}
