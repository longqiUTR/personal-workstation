// 区分"听成了另一个真实存在的词"（判错，进错词库）和"手误/拼写不规范"
// （判对，不进错词库）——没有词典就分不清这两种情况。
// 用注入而不是在这里直接读文件，是因为 shared 层不能碰文件系统；
// 真正从 wordlist-english 读数据、调用 loadDictionary 是后面任务
// （server 层）的事。
let dictionary: Set<string> = new Set()

export function loadDictionary(words: Iterable<string>): void {
  dictionary = new Set([...words].map((w) => w.toLowerCase()))
}

export function isRealWord(word: string): boolean {
  return dictionary.has(word.toLowerCase())
}

export function dictionarySize(): number {
  return dictionary.size
}
