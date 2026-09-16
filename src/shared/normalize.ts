import { CONTRACTIONS } from './wordlists/contractions.js'

/**
 * 归一化流水线。步骤顺序固定，不可调换：
 *   1 小写 → 2 弯撇号归一 → 3 展开缩写 → 4 连字符视为词边界 → 5 分词并剥离词首尾标点
 */
export function normalize(input: string): string[] {
  let s = input.toLowerCase()

  // 弯撇号归一必须在展开缩写之前：BBC/VOA 转写用 U+2019，键盘打的是 U+0027。
  // 不做这一步，白名单正则永远匹配不上弯撇号版本的 don't，缩写展开在真实素材上直接失效。
  s = s.replace(/[‘’ʼ′]/g, "'")

  // 必须是字符串级正则替换，不能等分词后逐 token 查表：分词前 "don't,"（带尾标点）
  // 是一个 token，和白名单键 "don't" 不相等，查表匹配不上，白名单等于失效。
  // 顺序也不能和下面的去标点互换——先去标点会把 it's 变成 its，抹掉考题要的区别。
  for (const [pattern, replacement] of CONTRACTIONS) {
    s = s.replace(pattern, replacement)
  }

  s = s.replace(/-+/g, ' ')

  return s
    .split(/\s+/)
    .map((token) =>
      // 只剥词首尾，不剥词内撇号——so it's 存活。但左右两侧的弯引号（上面已转成
      // 直引号）必须在这里剥掉：6 Minute English 每期都用引号包生词，
      // 留下就会变成 'bewildered'，和用户打的 bewildered 判不相等。
      token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    )
    .filter((token) => token.length > 0)
}
