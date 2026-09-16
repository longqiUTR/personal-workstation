// server 层与磁盘之间唯一的桥梁：src/shared/wordlists/* 故意保持零文件系统依赖
// （靠 loadDictionary/loadWordTiers 注入），这样才能在单测里直接灌小词表、不碰磁盘。
// 真正从 wordlist-english 读文件、拼真实词表的逻辑只能放在这一个文件里。
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { loadDictionary } from '../shared/wordlists/dictionary.js'
import { loadWordTiers } from '../shared/wordlists/frequency.js'

// wordlist-english 内置到 size 70，但 70 档比 60 档再多约 3.6 万生僻词。
// 故意不用：词典越大，用户真正手滑打出来的错词越容易"碰巧也是个真词"，
// 把该抓的听力错误（听成了另一个词）误判成拼写手滑放过——见 docs/kb/pitfalls.md #2。
const SIZES = [10, 20, 35, 40, 50, 55, 60] as const
const DIALECTS = ['english', 'american', 'british'] as const

function packageDir(): string {
  // wordlist-english 没有 "exports" 字段限制子路径，require.resolve 能拿到
  // 包目录里任意 json 文件的真实路径，不依赖 process.cwd()，改哪里跑都不受影响。
  const require = createRequire(import.meta.url)
  return dirname(require.resolve('wordlist-english/package.json'))
}

/**
 * 从 node_modules/wordlist-english 读 english/american/british 三个方言在
 * SCOWL [10,20,35,40,50,55,60] 六个规模档位上的词表，取并集小写化后注入 shared 层。
 * 实测并集大小 79465——如果测出来数字差得远，报出来，不要自己瞎调参数凑数。
 */
export function loadWordlistsFromDisk(): { dictionarySize: number } {
  const dir = packageDir()
  // 词 -> 该词第一次出现的 SCOWL 档位（数值越小越常见）。
  // SIZES 已经是从小到大排好序，按顺序遍历 + "已存在就不覆盖"，
  // 天然得到"记录最小档位"的效果，不需要额外比较逻辑。
  const tierByWord = new Map<string, number>()

  for (const size of SIZES) {
    for (const dialect of DIALECTS) {
      const file = join(dir, `${dialect}-words-${size}.json`)
      const words = JSON.parse(readFileSync(file, 'utf8')) as string[]
      for (const word of words) {
        const lower = word.toLowerCase()
        if (!tierByWord.has(lower)) tierByWord.set(lower, size)
      }
    }
  }

  loadDictionary(tierByWord.keys())
  loadWordTiers(tierByWord.entries())

  return { dictionarySize: tierByWord.size }
}
