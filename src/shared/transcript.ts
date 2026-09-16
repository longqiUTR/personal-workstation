// startMs/endMs 是原始时间戳，不在这里加 200ms 播放留白——留白是播放器的职责，
// 数据库存的必须是原始值；两处都加会叠成 400ms，导致相邻句子的播放区间互相重叠。
export interface ParsedSentence {
  idx: number
  startMs: number
  endMs: number | null
  text: string
}

export function parseLrc(content: string): ParsedSentence[] {
  const re = /^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/
  const rows: { startMs: number; text: string }[] = []

  for (const line of content.split(/\r?\n/)) {
    const m = re.exec(line.trim())
    if (!m) continue
    const text = m[4]!.trim()
    if (!text) continue
    const frac = (m[3] ?? '0').padEnd(3, '0')
    rows.push({
      startMs: Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number(frac),
      text,
    })
  }

  // 野生 LRC 文件的行序不可靠（有些导出工具按字母序而非时间序写行），
  // 而下面 endMs 是从"下一行"的 startMs 推出来的——不排序会算出负数或重叠的区间。
  rows.sort((a, b) => a.startMs - b.startMs)
  return rows.map((row, idx) => ({
    idx,
    startMs: row.startMs,
    // LRC 格式只记录起始时间，最后一行没有"下一行"可借，只能留 null；
    // 导入阶段用音频总时长回填，调用方必须处理 null，不能假设它总是数字。
    endMs: rows[idx + 1]?.startMs ?? null,
    text: row.text,
  }))
}

export function parseSrt(content: string): ParsedSentence[] {
  const toMs = (s: string): number => {
    const m = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/.exec(s)!
    return Number(m[1]) * 3600000 + Number(m[2]) * 60000 + Number(m[3]) * 1000 + Number(m[4])
  }

  return content
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/)
      const timeLineIdx = lines.findIndex((l) => l.includes('-->'))
      if (timeLineIdx < 0) return null
      const [from, to] = lines[timeLineIdx]!.split('-->')
      return {
        startMs: toMs(from!),
        endMs: toMs(to!),
        text: lines.slice(timeLineIdx + 1).join(' ').trim(),
      }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null && s.text.length > 0)
    // idx 必须在过滤空文本块之后再分配：如果在上一步 map 时就赋 idx，
    // 被过滤掉的块会在编号里留洞，sentences.idx 不连续，断点续做会跳句。
    .map((s, idx) => ({ idx, ...s }))
}
