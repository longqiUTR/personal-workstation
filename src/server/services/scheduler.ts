// FSRS 调度服务：听写联动和独立复习提交的唯一入口。
// 两条路径分叉写各自的调度逻辑是 pitfalls.md #6/#12/#13 的根因——
// 因此本文件只暴露 applyRating 一个会推进 FSRS 状态的方法，
// 调用方（听写提交 / 独立复习提交）都必须走它，不允许各写一套。
import { fsrs, generatorParameters, createEmptyCard, Rating as FsrsRating, State } from 'ts-fsrs'
import type { Card, Grade } from 'ts-fsrs'
import type { Db } from '../db/connection.js'
import { createWordsRepo, type WordRow } from '../db/repositories/words.js'
import { createReviewsRepo } from '../db/repositories/reviews.js'
import type { Rating } from '../../shared/types.js'

export interface ApplyRatingInput {
  word: string
  rating: Rating // 字符串，来自 shared/grading 的 ratingFrom()，听写与复习共用同一个映射函数
  source: 'review' | 'dictation'
  replayCount: number
  sentenceId: number // 本次听错/复习所在的句子
  now: Date
}

// 字符串 rating 到 ts-fsrs 枚举的映射——只在这一处转换，不能在第二条路径
// 里再写一份，否则又是 #6 那种分叉。
const RATING_TO_GRADE: Record<Rating, Grade> = {
  again: FsrsRating.Again,
  hard: FsrsRating.Hard,
  good: FsrsRating.Good,
  easy: FsrsRating.Easy,
}

// 毕业条件见 srs.md：state=Review、最近连续 3 次 good/easy、stability>60 天。
const GRADUATION_LOOKBACK = 3
const GRADUATION_STABILITY_DAYS = 60

export function createScheduler(db: Db) {
  const wordsRepo = createWordsRepo(db)
  const reviewsRepo = createReviewsRepo(db)
  // generatorParameters() 用 ts-fsrs 默认参数——本项目没有自定义调参需求，
  // 引入可配置项目前先不做，避免无使用场景的过度设计。
  const f = fsrs(generatorParameters())

  // 毕业判定读的是"刚落库之后"的状态：card 是本次 applyRating 算出的新卡，
  // 而这次评分本身也已经写进了 reviews，所以 recentByWord(word, 3) 的
  // "最近 3 次"天然包含本次评分——这正是"连续 3 次"里的最后一次。
  function maybeGraduate(word: string, card: Card): void {
    if (card.state !== State.Review) return
    if (!(card.stability > GRADUATION_STABILITY_DAYS)) return

    const recent = reviewsRepo.recentByWord(word, GRADUATION_LOOKBACK)
    if (recent.length < GRADUATION_LOOKBACK) return
    const allGoodOrEasy = recent.every((r) => r.rating === 'good' || r.rating === 'easy')
    if (!allGoodOrEasy) return

    wordsRepo.markGraduated(word)
  }

  return {
    applyRating(input: ApplyRatingInput): void {
      const grade = RATING_TO_GRADE[input.rating]
      const existing = wordsRepo.get(input.word)
      const card = existing ? existing.card : createEmptyCard(input.now)
      const { card: nextCard } = f.next(card, input.now, grade)

      // 先落 words 行、再写 reviews 行：reviews.word 有外键约束
      // （references words(word)，见 schema.sql），全新词只有先经
      // upsertError 建好行，reviews 的 INSERT 才不会撞 FK。这个顺序和
      // 任务描述里"先写 reviews 再持久化 card"的步骤编号相反，
      // 是数据库约束逼出来的，不是随意调整。
      if (input.rating === 'again') {
        // again 走 upsertError：它同时负责 error_count 自增、
        // last_error_sentence_id 更新、清 graduated——毕业词再次听错
        // 重新入队就是靠这条路径（见 words.ts 顶部注释）。
        wordsRepo.upsertError(input.word, input.sentenceId, nextCard)
      } else {
        wordsRepo.updateCard(input.word, nextCard)
      }

      reviewsRepo.create({
        word: input.word,
        rating: input.rating,
        source: input.source,
        replayCount: input.replayCount,
        reviewedAt: input.now.toISOString(),
      })

      maybeGraduate(input.word, nextCard)
    },

    // 同日去重的落点：wordsRepo.findDue 已经排除毕业词和今天曝光过的词，
    // 这里再叠加"今天已经产生过评分的词"。Again 只把 due 拨到一分钟后
    // （不是明天），而 words.due 按天截断存储，不去重的话同一个词会在
    // 20 分钟的听写会话里被反复问到（due 当天恒 <= today）。
    dueQueue(today: string, limit: number): WordRow[] {
      const reviewedToday = new Set(reviewsRepo.wordsReviewedOn(today))
      return wordsRepo.findDue(today, limit).filter((w) => !reviewedToday.has(w.word))
    },

    // 轻档挖空时"句中可见但没被抽中挖空"的 due 词：用户已经在屏幕上看过
    // 明文，当天再考会评分虚高（pitfalls.md #15）。标记曝光后 findDue 会
    // 跳过它们，顺延到明天再排。
    markSeenButNotTested(words: string[], today: string): void {
      for (const word of words) wordsRepo.markExposed(word, today)
    },
  }
}

export type Scheduler = ReturnType<typeof createScheduler>
