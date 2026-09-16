import { describe, it, expect, beforeAll } from 'vitest'
import { keyWordsOf, candidatePool, pickBlanks, blankCount } from '@shared/keywords'
import { loadWordTiers } from '@shared/wordlists/frequency'

beforeAll(() => {
  // SCOWL size 档：数字越大越低频。zyzzyva 刻意不注入，用来验证"表外词视为最低频"
  loadWordTiers([['the', 10], ['is', 10], ['book', 10], ['car', 20], ['house', 35]])
})

describe('keyWordsOf — 关键词是句子的静态属性', () => {
  it('实词计入关键词', () => {
    expect(keyWordsOf(['the', 'government', 'is'])).toContain('government')
  })

  it('普通停用词不计入', () => {
    expect(keyWordsOf(['the', 'government'])).not.toContain('the')
  })

  // 这九个词全是停用词，但必须计入关键词，否则中档自动补全、重档不扣分、
  // 轻档永不挖空——系统对最典型的连读弱读错误完全失明
  it.each(['their', 'there', 'its', 'than', 'then', 'to', 'too', 'of', 'off'])(
    '高危同音词 %s 虽是停用词也必须计入关键词',
    (word) => {
      expect(keyWordsOf([word, 'book'])).toContain(word)
    }
  )

  it('重复词只保留一个', () => {
    expect(keyWordsOf(['book', 'book', 'car'])).toEqual(['book', 'car'])
  })
})

describe('candidatePool — 候选池 = 关键词 ∪ 该句历史错词', () => {
  it('并入历史错词，即便它是普通停用词', () => {
    const pool = candidatePool(['the', 'book'], new Set(['the']))
    expect(pool).toContain('the')
    expect(pool).toContain('book')
  })

  it('无历史错词时等于关键词', () => {
    expect(candidatePool(['the', 'book'], new Set())).toEqual(['book'])
  })
})

describe('blankCount — N 的取值', () => {
  // 实际范围是 1-5 而非 3-5：round(3 × 0.4) = 1
  it.each([
    [1, 1], [2, 1], [3, 1], [4, 2], [5, 2], [6, 2], [10, 4], [20, 5], [50, 5],
  ])('池大小 %i → N = %i', (poolSize, expected) => {
    expect(blankCount(poolSize)).toBe(expected)
  })

  it('池为空时 N 为 0', () => {
    expect(blankCount(0)).toBe(0)
  })
})

describe('pickBlanks — 挖空优先级', () => {
  it('已到期的历史错词排最前', () => {
    const picked = pickBlanks({
      pool: ['book', 'car', 'house'],
      dueWords: new Set(['house']),
      errorWords: new Set(['house']),
      n: 1,
    })
    expect(picked).toEqual(['house'])
  })

  it('高危同音词排在普通实词之前', () => {
    const picked = pickBlanks({
      pool: ['book', 'their'],
      dueWords: new Set(),
      errorWords: new Set(),
      n: 1,
    })
    expect(picked).toEqual(['their'])
  })

  it('低频实词优先于高频实词', () => {
    const picked = pickBlanks({
      pool: ['the', 'zyzzyva'],   // zyzzyva 不在词表 → tier 视为最低频
      dueWords: new Set(),
      errorWords: new Set(),
      n: 1,
    })
    expect(picked).toEqual(['zyzzyva'])
  })

  it('同为实词时 tier 越大（越低频）越优先', () => {
    const picked = pickBlanks({
      pool: ['book', 'house'],    // book=10, house=35
      dueWords: new Set(),
      errorWords: new Set(),
      n: 1,
    })
    expect(picked).toEqual(['house'])
  })

  it('池不足 n 时有几个给几个', () => {
    const picked = pickBlanks({
      pool: ['book'], dueWords: new Set(), errorWords: new Set(), n: 5,
    })
    expect(picked).toEqual(['book'])
  })
})
