import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../src/server/db/connection'
import { createMaterialsRepo } from '../../src/server/db/repositories/materials'
import { createSentencesRepo } from '../../src/server/db/repositories/sentences'
import { importMaterial } from '../../src/server/services/import'
import { loadWordlistsFromDisk } from '../../src/server/wordlists'
import { normalize } from '@shared/normalize'

// 素材文件是临时 fixture，测试自己写、自己删——不往仓库的 materials/ 下放任何东西（版权红线）。
const dirsToClean: string[] = []

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'import-fixture-'))
  dirsToClean.push(dir)
  return dir
}

function writeFixture(dir: string, name: string, content: string): string {
  const p = join(dir, name)
  writeFileSync(p, content, 'utf8')
  return p
}

beforeAll(() => {
  // 用真实词表跑完整导入链路，顺带验证 79465 这个数没有随依赖升级漂移。
  const { dictionarySize } = loadWordlistsFromDisk()
  expect(dictionarySize).toBe(79465)
})

afterEach(() => {
  while (dirsToClean.length > 0) {
    rmSync(dirsToClean.pop()!, { recursive: true, force: true })
  }
})

describe('importMaterial', () => {
  it('LRC 导入：句子数正确，idx 从 0 连续', () => {
    const dir = fixtureDir()
    const audioPath = writeFixture(dir, 'a.mp3', 'fake-audio')
    const transcriptPath = writeFixture(
      dir,
      't.lrc',
      '[00:01.00]First line\n[00:03.00]Second line\n[00:06.00]Third line',
    )

    const db = openDatabase(':memory:')
    const { materialId, sentenceCount } = importMaterial(db, {
      title: 'Test BBC',
      source: 'bbc',
      audioPath,
      transcriptPath,
      durationMs: 10000,
    })

    expect(sentenceCount).toBe(3)

    const sentences = createSentencesRepo(db).listByMaterial(materialId)
    expect(sentences.map((s) => s.idx)).toEqual([0, 1, 2])

    // sentence_count 必须在 create 时就落对——repo 没有暴露"事后改"的方法
    expect(createMaterialsRepo(db).get(materialId)?.sentenceCount).toBe(3)

    db.close()
  })

  it('LRC 末句 endMs：有 durationMs 取 durationMs，没有则退化为 startMs + 5000', () => {
    const dir = fixtureDir()
    const audioPath = writeFixture(dir, 'a.mp3', 'fake-audio')
    const transcriptPath = writeFixture(dir, 't.lrc', '[00:01.00]First\n[00:03.00]Last')

    const dbWithDuration = openDatabase(':memory:')
    const { materialId: idWith } = importMaterial(dbWithDuration, {
      title: 'With duration',
      source: 'bbc',
      audioPath,
      transcriptPath,
      durationMs: 12345,
    })
    const withDuration = createSentencesRepo(dbWithDuration).listByMaterial(idWith)
    expect(withDuration[1]!.endMs).toBe(12345)
    dbWithDuration.close()

    const dbNoDuration = openDatabase(':memory:')
    const { materialId: idWithout } = importMaterial(dbNoDuration, {
      title: 'No duration',
      source: 'bbc',
      audioPath,
      transcriptPath,
      // durationMs 故意不传
    })
    const withoutDuration = createSentencesRepo(dbNoDuration).listByMaterial(idWithout)
    expect(withoutDuration[1]!.startMs).toBe(3000) // [00:03.00]
    expect(withoutDuration[1]!.endMs).toBe(8000) // 3000 + 5000
    dbNoDuration.close()
  })

  it('SRT 导入：空文本块被丢弃，idx 仍从 0 连续', () => {
    const dir = fixtureDir()
    const audioPath = writeFixture(dir, 'a.mp3', 'fake-audio')
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:02,000',
      'First block',
      '',
      '2',
      '00:00:02,000 --> 00:00:03,000',
      '', // 空文本块，应被丢弃且不留 idx 空洞
      '',
      '3',
      '00:00:03,000 --> 00:00:04,000',
      'Third block',
    ].join('\n')
    const transcriptPath = writeFixture(dir, 't.srt', srt)

    const db = openDatabase(':memory:')
    const { materialId, sentenceCount } = importMaterial(db, {
      title: 'SRT test',
      source: 'voa',
      audioPath,
      transcriptPath,
    })

    expect(sentenceCount).toBe(2)
    const sentences = createSentencesRepo(db).listByMaterial(materialId)
    expect(sentences.map((s) => s.idx)).toEqual([0, 1])
    expect(sentences.map((s) => s.text)).toEqual(['First block', 'Third block'])

    db.close()
  })

  it('keyWords 存归一化后的形式：弯引号生词与缩写都要落成小写、无引号、拆开的 token', () => {
    const dir = fixtureDir()
    const audioPath = writeFixture(dir, 'a.mp3', 'fake-audio')
    const rawText = "‘Bewildered’, she don't know why."
    const transcriptPath = writeFixture(dir, 't.lrc', `[00:01.00]${rawText}\n[00:03.00]padding`)

    // 先确认真正喂给 keyWordsOf 的这条文本，normalize() 之后 don't 被拆成 do/not
    // 两个独立 token——不是黏成 "donot"，也没被缩写白名单漏掉。
    const tokens = normalize(rawText)
    expect(tokens).toContain('do')
    expect(tokens).toContain('not')

    const db = openDatabase(':memory:')
    const { materialId } = importMaterial(db, {
      title: 'Quote test',
      source: 'bbc',
      audioPath,
      transcriptPath,
      durationMs: 8000,
    })
    const sentences = createSentencesRepo(db).listByMaterial(materialId)
    expect(sentences[0]!.keyWords).toContain('bewildered')
    // 引号形式或原始大小写不该出现——出现就说明存的是原始文本而不是归一化结果
    expect(sentences[0]!.keyWords).not.toContain('‘bewildered’')
    expect(sentences[0]!.keyWords).not.toContain('Bewildered')

    db.close()
  })

  it('高危同音词 their 即使是停用词也要进 keyWords', () => {
    const dir = fixtureDir()
    const audioPath = writeFixture(dir, 'a.mp3', 'fake-audio')
    const transcriptPath = writeFixture(
      dir,
      't.lrc',
      '[00:01.00]I saw their house.\n[00:03.00]padding',
    )

    const db = openDatabase(':memory:')
    const { materialId } = importMaterial(db, {
      title: 'Homophone test',
      source: 'bbc',
      audioPath,
      transcriptPath,
      durationMs: 8000,
    })
    const sentences = createSentencesRepo(db).listByMaterial(materialId)
    // their 是停用词表里的词，若挖空/判定流程的停用词过滤跑在同音词覆盖之前生效，
    // 这条会静默失败——听力最典型的连读弱读错误就会在默认档位上抓不到。
    expect(sentences[0]!.keyWords).toContain('their')

    db.close()
  })

  it('时间戳原样落库，不叠加 200ms 播放留白', () => {
    const dir = fixtureDir()
    const audioPath = writeFixture(dir, 'a.mp3', 'fake-audio')
    const transcriptPath = writeFixture(dir, 't.lrc', '[00:01.500]First\n[00:04.000]Second')

    const db = openDatabase(':memory:')
    const { materialId } = importMaterial(db, {
      title: 'Raw timestamp test',
      source: 'bbc',
      audioPath,
      transcriptPath,
      durationMs: 9000,
    })
    const sentences = createSentencesRepo(db).listByMaterial(materialId)
    // 解析出来的原始值是 1500——如果这里变成 1700 就是被误加了播放留白
    expect(sentences[0]!.startMs).toBe(1500)

    db.close()
  })

  it('音频或文本文件缺失时抛出点名具体路径的错误', () => {
    const dir = fixtureDir()
    const transcriptPath = writeFixture(dir, 't.lrc', '[00:01.00]Hello')
    const missingAudio = join(dir, 'missing.mp3')

    const db = openDatabase(':memory:')
    expect(() =>
      importMaterial(db, {
        title: 'Missing audio',
        source: 'bbc',
        audioPath: missingAudio,
        transcriptPath,
      }),
    ).toThrow(missingAudio)

    const audioPath = writeFixture(dir, 'a.mp3', 'fake-audio')
    const missingTranscript = join(dir, 'missing.lrc')
    expect(() =>
      importMaterial(db, {
        title: 'Missing transcript',
        source: 'bbc',
        audioPath,
        transcriptPath: missingTranscript,
      }),
    ).toThrow(missingTranscript)

    db.close()
  })
})
