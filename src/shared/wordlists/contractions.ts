// 只展开 n't 类缩写，因为它们在连续语流里确实难以分辨，转写文本里
// 拼法也不统一（don't/do not 混用）。's / 're / 've / 'll 故意不展开：
// it's 和 its、they're 和 their 这类区别在发音上是听得出来的，恰恰是
// 考试要考的点——展开了就把这个区别抹平了，等于放过了最该抓的错误。
export const CONTRACTIONS: ReadonlyArray<[RegExp, string]> = [
  [/\bdon't\b/gi, 'do not'],
  [/\bdoesn't\b/gi, 'does not'],
  [/\bdidn't\b/gi, 'did not'],
  [/\bcan't\b/gi, 'can not'],
  [/\bcannot\b/gi, 'can not'],
  [/\bwon't\b/gi, 'will not'],
  [/\bisn't\b/gi, 'is not'],
  [/\baren't\b/gi, 'are not'],
  [/\bwasn't\b/gi, 'was not'],
  [/\bweren't\b/gi, 'were not'],
  [/\bhaven't\b/gi, 'have not'],
  [/\bhasn't\b/gi, 'has not'],
  [/\bhadn't\b/gi, 'had not'],
  [/\bshouldn't\b/gi, 'should not'],
  [/\bwouldn't\b/gi, 'would not'],
  [/\bcouldn't\b/gi, 'could not'],
  [/\bgonna\b/gi, 'going to'],
  [/\bwanna\b/gi, 'want to'],
]
