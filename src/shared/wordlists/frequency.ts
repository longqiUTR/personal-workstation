// tier 是这个词在 SCOWL 词表里第一次出现的规模档位（10/20/35/40/50/55/60）。
// 数字越大代表越生僻，挖空优先级越高。表里查不到的词一律按"最生僻"处理，
// 不能默认成高频词，否则会漏挖那些确实生僻却没进表的词。
// 实测参考：the/government/their 是 10 档，overwhelmed 是 20 档，
// bewildered/daunting 是 35 档。
let tiers: Map<string, number> = new Map()

export function loadWordTiers(entries: Iterable<[string, number]>): void {
  tiers = new Map([...entries].map(([w, t]) => [w.toLowerCase(), t]))
}

export function tierOf(word: string): number {
  return tiers.get(word.toLowerCase()) ?? Number.MAX_SAFE_INTEGER
}
