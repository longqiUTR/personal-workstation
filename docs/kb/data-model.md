# 数据模型

```
materials   素材      id, title, source, lane, audio_path, transcript_path,
                      duration_ms, sentence_count, current_sentence_idx,
                      added_at, finished_at

sentences   句子      id, material_id, idx, start_ms, end_ms, text,
                      key_words_json          -- 仅静态部分：实词 ∪ 高危同音组词
                                              -- 导入时预计算。历史错词不在此列

attempts    听写记录  id, sentence_id, mode, input,
                      tested_words_total, tested_words_correct, accuracy,
                      tested_words_json,      -- 本次实际考察的词集合，所有档位都落
                                              -- 中/重档候选池含历史错词，事后不可复现
                      outcome,                -- ok | weak | revealed | skipped
                      comprehended,           -- 仅保命档，其余档 NULL
                      replay_count, duration_ms, created_at

words       生词      word (PK), first_seen_sentence_id, last_error_sentence_id,
                      error_count, graduated,
                      exposed_on,             -- 当日已在轻档明文露出过，推迟一天再排
                      due, stability, difficulty, elapsed_days,
                      scheduled_days, reps, lapses, state, last_review

reviews     复习记录  id, word, rating, source,   -- source: review | dictation
                      replay_count, reviewed_at

mocks       模考      id, date, source,       -- cet4 | cet6
                      listening_raw, listening_raw_total, listening_score,
                      reading_raw,   reading_raw_total,   reading_score,
                      writing_score, translation_score,
                      total,                  -- 计算得出，不录入
                      note

daily       日汇总    date, lane, minutes, sentences_done,
                      mode_distribution_json, -- 各档位句数分布，非单值
                      accuracy_by_mode_json,  -- 各档位正确率，不混算
                      streak_kept
```

## 几处刻意的设计（改之前先看理由）

| 字段 | 为什么这么设计 |
|---|---|
| `attempts.accuracy` 可为 `NULL` | 保命档、或 `tested_words_total = 0` 的极短句。**所有消费方必须处理空值**，不能当 0 或 100 |
| **`key_words_json` 只固化静态部分** | 实词 ∪ 高危同音组词。历史错词随时间增长，导入时算不出来，必须运行时取并集得到候选池。若把它也写进这个字段，要么永远漏掉（挖空优先级 1/3 失去依据），要么每天重算全表 |
| **叫 `tested_words_*` 不叫 `key_words_*`** | 关键词是**句子**的静态属性，考察词是**本次作答**的属性，轻档下两者不相等。同名会让"只有关键词参与计分"产生歧义 |
| `tested_words_*` 存原始计数 + `tested_words_json` 存考察词集合 | 三者齐备才能按任意口径重算。**所有档位都要落 `tested_words_json`，不只轻档**——中/重档考察词 = 候选池全集，含随时间增长的历史错词，事后不可复现 |
| 三个 `source` 字段含义不同 | `materials.source`=bbc/voa/cet4/cet6、`mocks.source`=cet4/cet6、`reviews.source`=review/dictation。repository 层用不同类型区分，避免串用 |
| **保命档同样落 `attempts` 行** | `accuracy = NULL`、`comprehended` 有值。这点定死，不留"可配置"的余地 |
| `materials.current_sentence_idx` | 显式记断点，**任何档位推进都更新**。断点必须显式，不依赖对 `attempts` 的任何反推 |
| `words` 铺平 ts-fsrs Card 全部字段 | `lapses`、`scheduled_days` 无法从 `reviews` 反推，必须持久化 |
| `words.last_error_sentence_id` | 复习卡片播**最近**一次听错的那句，不是第一次 |
| `words.exposed_on` | 轻档只挖 N 个空，句中其余 due 词是明文显示的。当天再复习它们评分会虚高，所以标记曝光日期、推迟一天。日期格式 `YYYY-MM-DD`，与 `due` 保持一致——`findDue` 是字符串比较，混用 ISO 时间戳会静默查空 |
| `reviews.source` | 区分评分来自独立复习还是听写联动，排查调度异常用 |
| `daily` 存 JSON 分布而非单值 | 用户一天内完全可能切档。单值会丢信息且导致混算 |

## mocks 的分数口径

四六级官方用**常模参照的标准分转换**，非线性、每次考试常模不同，**本地无法精确复现**。所以：

- `*_raw`：答对题数（可选填）
- `*_raw_total`：该模块总题数（四级听力 25 题、阅读 30 题）。**存成字段而非硬编码常量**——六级题量不同，接六级时要用
- `*_score`：710 分制分值，由用户从真题书换算表读取填入；无换算表时系统按"答对率 × 模块满分"线性估算并回填
- 模块满分：听力 248.5、阅读 248.5、写作 106.5、翻译 106.5
- `total` 由四项 `*_score` **相加算出，不接受录入**
- 写作/翻译无客观答案，只填 `*_score`（按范文自评，8 分档 ≈ 及格线）

**UI 必须明示这是粗略估算、误差可能很大，仅供看纵向趋势。** 误差有两层：CET 用常模参照的标准分转换（非线性、每次常模不同）；各 Section 每题权重并不相等，线性估算本身就差得不少。把不可能精确的数字包装成精确的，比不给更糟。

## 为其余四条线预留的扩展位

第一期**不要碰**，但设计时留好：

- `materials.source`：`bbc` / `voa` / `cet4` / `cet6` —— 接六级只需新增取值，系统无需改动
- `materials.lane` 与 `daily.lane`：`english` / `grad` / `work` / `kid` / `health` —— 第一期恒为 `english`。未来接入读研/上班/孩子/养生时，总览页的热力图和掉线预警可直接复用

## 存储引擎：node-sqlite3-wasm

**不是 `better-sqlite3`。** 它在本机装不上：没有 Node 20 的预编译二进制，回落到 node-gyp 编译时缺 Visual Studio C++ 工具链（`Could not find any Visual Studio installation`）。

换成 WASM 版 SQLite，零编译。已实测可用：建表、带 `WHERE` 的部分索引、参数化查询、`all`/`get`/`run`、关闭重开后的文件持久化。**`schema.sql` 不需要任何改动。**

⚠️ 它是 **CommonJS** 包，本项目是 `"type": "module"`，必须 default import：

```ts
import pkg from 'node-sqlite3-wasm'
const { Database } = pkg
```

写成 `import { Database } from 'node-sqlite3-wasm'` 会报 `Named export 'Database' not found`。

另外它没有 `better-sqlite3` 的 `db.pragma()` 方法，PRAGMA 走 `db.exec('PRAGMA ...')`。

## 数据访问抽象

所有数据库操作走一层 repository 接口，**不在业务代码里直接写 SQL**。

这层抽象已经证明了自己的价值：原定的 `better-sqlite3` 编不过，换 `node-sqlite3-wasm` 时只动了 `connection.ts` 一个文件。没有它就要改遍全项目。
