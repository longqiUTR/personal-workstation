import { describe, it, expect } from 'vitest'
import { normalize } from '@shared/normalize'

describe('normalize', () => {
  it('转小写并按空白分词', () => {
    expect(normalize('The Quick Brown')).toEqual(['the', 'quick', 'brown'])
  })

  it("展开白名单里的 n't 缩写", () => {
    expect(normalize("I don't know")).toEqual(['i', 'do', 'not', 'know'])
  })

  // 若把展开做成"分词后逐 token 查白名单"，"don't," 带尾标点匹配不上，白名单等于失效
  it('缩写带尾随标点时仍能展开', () => {
    expect(normalize("I don't, really")).toEqual(['i', 'do', 'not', 'really'])
    expect(normalize("No, I don't.")).toEqual(['no', 'i', 'do', 'not'])
  })

  // 's 不展开：it's 与 its 在听感上有真实差别，正是考点
  it("不展开 's，it's 与 its 保持可区分", () => {
    expect(normalize("it's")).toEqual(["it's"])
    expect(normalize('its')).toEqual(['its'])
    expect(normalize("it's")).not.toEqual(normalize('its'))
  })

  it("不展开 're，they're 与 their 保持可区分", () => {
    expect(normalize("they're")).not.toEqual(normalize('their'))
  })

  it('去除词首尾标点但保留词内撇号', () => {
    expect(normalize('"Hello," he said.')).toEqual(['hello', 'he', 'said'])
    expect(normalize("don't-worry")).toEqual(['do', 'not', 'worry'])
  })

  it('连字符词等价于空格分写', () => {
    expect(normalize('well-known')).toEqual(normalize('well known'))
  })

  it('折叠连续空白', () => {
    expect(normalize('a   b\t\nc')).toEqual(['a', 'b', 'c'])
  })

  it('空输入返回空数组', () => {
    expect(normalize('')).toEqual([])
    expect(normalize('   ')).toEqual([])
  })

  // BBC / VOA 的 transcript 用弯撇号 U+2019，用户键盘打的是直撇号
  it('弯撇号与直撇号等价', () => {
    expect(normalize('I don’t know')).toEqual(['i', 'do', 'not', 'know'])
    expect(normalize('it’s')).toEqual(normalize("it's"))
  })

  it('弯撇号版本的 it’s 仍与 its 可区分', () => {
    expect(normalize('it’s')).not.toEqual(normalize('its'))
  })

  // 6 Minute English 每期都用弯引号包生词，这是主力素材源的固定格式
  it('弯引号包着的生词不能把引号带进 token', () => {
    expect(normalize('we learn ‘bewildered’ today')).toEqual(
      ['we', 'learn', 'bewildered', 'today']
    )
    expect(normalize("we learn 'bewildered' today")).toEqual(
      ['we', 'learn', 'bewildered', 'today']
    )
  })

  it('BBC 真实句式', () => {
    expect(normalize("Today's words are ‘bewildered’, ‘overwhelmed’ and ‘daunting’."))
      .toEqual(["today's", 'words', 'are', 'bewildered', 'overwhelmed', 'and', 'daunting'])
  })

  it("所有格 students’ 与 students' 等价", () => {
    expect(normalize('students’')).toEqual(normalize("students'"))
  })
})
