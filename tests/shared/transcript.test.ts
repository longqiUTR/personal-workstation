import { describe, it, expect } from 'vitest'
import { parseLrc, parseSrt } from '@shared/transcript'

describe('parseLrc', () => {
  it('解析时间戳与文本', () => {
    const lrc = `[00:01.50]Hello world
[00:05.20]Second line`
    expect(parseLrc(lrc)).toEqual([
      { idx: 0, startMs: 1500, endMs: 5200, text: 'Hello world' },
      { idx: 1, startMs: 5200, endMs: null, text: 'Second line' },
    ])
  })

  it('忽略元数据行与空行', () => {
    const lrc = `[ar:BBC]

[00:01.00]Only this`
    expect(parseLrc(lrc)).toHaveLength(1)
  })

  it('支持三位毫秒', () => {
    expect(parseLrc('[00:01.123]x')[0]!.startMs).toBe(1123)
  })

  it('乱序的行按时间排序', () => {
    const lrc = `[00:05.00]second
[00:01.00]first`
    expect(parseLrc(lrc).map((s) => s.text)).toEqual(['first', 'second'])
  })

  it('末行 endMs 为 null，由导入时用音频总时长补齐', () => {
    expect(parseLrc('[00:01.00]only')[0]!.endMs).toBeNull()
  })

  it('空内容返回空数组', () => {
    expect(parseLrc('')).toEqual([])
  })
})

describe('parseSrt', () => {
  it('解析序号、时间轴与文本', () => {
    const srt = `1
00:00:01,500 --> 00:00:04,000
Hello world

2
00:00:05,200 --> 00:00:08,000
Second line`
    expect(parseSrt(srt)).toEqual([
      { idx: 0, startMs: 1500, endMs: 4000, text: 'Hello world' },
      { idx: 1, startMs: 5200, endMs: 8000, text: 'Second line' },
    ])
  })

  it('多行文本合并为一句', () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
first part
second part`
    expect(parseSrt(srt)[0]!.text).toBe('first part second part')
  })

  it('支持点号毫秒分隔符', () => {
    const srt = `1
00:00:01.500 --> 00:00:04.000
x`
    expect(parseSrt(srt)[0]!.startMs).toBe(1500)
  })

  it('小时进位正确', () => {
    const srt = `1
01:02:03,004 --> 01:02:05,000
x`
    expect(parseSrt(srt)[0]!.startMs).toBe(3723004)
  })

  // 空文本块被过滤后，idx 必须重新连号——否则 sentences.idx 不连续，断点续做会跳句
  it('空文本块被过滤且 idx 连号', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000


2
00:00:03,000 --> 00:00:04,000
real text`
    const r = parseSrt(srt)
    expect(r).toHaveLength(1)
    expect(r[0]!.idx).toBe(0)
    expect(r[0]!.text).toBe('real text')
  })

  it('空内容返回空数组', () => {
    expect(parseSrt('')).toEqual([])
  })
})
