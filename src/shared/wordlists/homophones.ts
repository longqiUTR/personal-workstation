// 同音/易混词组：组内任意一个词都视为关键词，不管它是否在 stopwords 里。
// 没有这张表，系统就抓不到连读/弱读导致的典型听力错误——而这正是这个产品
// 存在的意义。stopwords.ts 负责"通常不考"，这张表负责把其中最容易被听错、
// 最该考的那一小撮词强制拉回关键词范围，两张表要合起来读。
export const HOMOPHONE_GROUPS: readonly (readonly string[])[] = [
  ["their", "there", "they're"],
  ["its", "it's"],
  ["than", "then"],
  ["to", "too", "two"],
  ["your", "you're"],
  ["were", "where", "we're"],
  ["of", "off"],
  ["whose", "who's"],
  ["weather", "whether"],
  ["quite", "quiet"],
  ["affect", "effect"],
  ["accept", "except"],
  ["lose", "loose"],
  ["desert", "dessert"],
  ["principal", "principle"],
  ["week", "weak"],
  ["piece", "peace"],
  ["through", "threw"],
  ["write", "right"],
  ["hear", "here"],
  ["buy", "by", "bye"],
  ["knew", "new"],
  ["one", "won"],
  ["sea", "see"],
  ["wear", "where"],
]

export const HOMOPHONE_WORDS: Set<string> = new Set(HOMOPHONE_GROUPS.flat())
