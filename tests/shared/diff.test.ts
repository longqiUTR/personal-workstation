import { describe, it, expect, beforeAll } from 'vitest'
import { diffWords } from '@shared/diff'
import { loadDictionary } from '@shared/wordlists/dictionary'

beforeAll(() => {
  // 真词表的最小子集，够覆盖用例。注意 recieve/beleive/goverment 等
  // 手滑串刻意不在表内——拼写容错规则正是靠"是不是真词"来区分听错和手滑
  loadDictionary([
    'their', 'there', 'then', 'than', 'week', 'weak', 'receive',
    'government', 'the', 'is', 'a', 'test', 'affect', 'effect',
    'believe', 'zulu', 'alpha', 'beta',
  ])
})

const allTested = (words: string[]) => new Set(words)

describe('diffWords — 拼写容错', () => {
  it('打出的是另一个真词 → 判错，进错词库', () => {
    const r = diffWords(['their'], ['there'], allTested(['their']))
    expect(r.words[0]!.verdict).toBe('wrong')
    expect(r.errorWords).toEqual(['their'])
    expect(r.testedCorrect).toBe(0)
  })

  it('than / then 同样判错', () => {
    const r = diffWords(['then'], ['than'], allTested(['then']))
    expect(r.words[0]!.verdict).toBe('wrong')
    expect(r.errorWords).toEqual(['then'])
  })

  it('week / weak 同样判错', () => {
    const r = diffWords(['week'], ['weak'], allTested(['week']))
    expect(r.words[0]!.verdict).toBe('wrong')
  })

  it('打出的不是英文词 → 拼写手滑，计入分子但不进错词库', () => {
    const r = diffWords(['receive'], ['recieve'], allTested(['receive']))
    expect(r.words[0]!.verdict).toBe('spelling_slip')
    expect(r.testedCorrect).toBe(1)
    expect(r.errorWords).toEqual([])
  })

  it('编辑距离 >1 且非真词 → 判错而非手滑', () => {
    const r = diffWords(['government'], ['govmt'], allTested(['government']))
    expect(r.words[0]!.verdict).toBe('wrong')
  })

  // 相邻换位是最常见的手滑类型，纯 Levenshtein 会记 2 步从而误判成"听错"
  it('相邻换位算作距离 1（Damerau），判手滑', () => {
    const r = diffWords(['believe'], ['beleive'], allTested(['believe']))
    expect(r.words[0]!.verdict).toBe('spelling_slip')
  })
})

describe('diffWords — 对齐的两个已知陷阱', () => {
  it('单词替换判为 wrong 而不是 missing', () => {
    const r = diffWords(['their'], ['there'], allTested(['their']))
    expect(r.words[0]!.verdict).toBe('wrong')
    expect(r.words[0]!.actual).toBe('there')
  })

  it('连续两个词都写错时配对顺序不颠倒', () => {
    const r = diffWords(
      ['alpha', 'beta', 'zulu'],
      ['xray', 'yankee', 'zulu'],
      allTested(['alpha', 'beta', 'zulu'])
    )
    expect(r.words.map((w) => w.actual)).toEqual(['xray', 'yankee', 'zulu'])
  })
})

describe('diffWords — 计分', () => {
  it('完全正确', () => {
    const r = diffWords(['the', 'test'], ['the', 'test'], allTested(['the', 'test']))
    expect(r.testedCorrect).toBe(2)
    expect(r.testedTotal).toBe(2)
    expect(r.accuracy).toBe(1)
  })

  it('漏写计入分母且进错词库', () => {
    const r = diffWords(['the', 'test'], ['the'], allTested(['the', 'test']))
    expect(r.words[1]!.verdict).toBe('missing')
    expect(r.testedTotal).toBe(2)
    expect(r.testedCorrect).toBe(1)
    expect(r.errorWords).toEqual(['test'])
  })

  it('多写不计入分母也不进错词库', () => {
    const r = diffWords(['the'], ['the', 'extra'], allTested(['the']))
    expect(r.testedTotal).toBe(1)
    expect(r.testedCorrect).toBe(1)
    expect(r.errorWords).toEqual([])
  })

  it('只有考察词参与计分，非考察词错漏不影响 accuracy', () => {
    const r = diffWords(['the', 'test'], ['the', 'wrong'], allTested(['the']))
    expect(r.testedTotal).toBe(1)
    expect(r.testedCorrect).toBe(1)
    expect(r.accuracy).toBe(1)
    expect(r.errorWords).toEqual([])
  })

  // 保命档与极短句都会走到这里，写 0 会把它们算成"全错"
  it('考察词为空时 accuracy 必须是 null，不能是 0 或 1', () => {
    const r = diffWords(['the', 'test'], [], new Set())
    expect(r.testedTotal).toBe(0)
    expect(r.accuracy).toBeNull()
  })

  it('同一个词在句中出现两次且都错，errorWords 去重但 testedTotal 不去重', () => {
    const r = diffWords(['test', 'a', 'test'], ['x', 'a', 'y'], allTested(['test', 'a']))
    expect(r.testedTotal).toBe(3)
    expect(r.errorWords).toEqual(['test'])
  })
})
