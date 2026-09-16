CREATE TABLE IF NOT EXISTS materials (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  title                TEXT    NOT NULL,
  source               TEXT    NOT NULL,          -- bbc | voa | cet4 | cet6
  lane                 TEXT    NOT NULL DEFAULT 'english',
  audio_path           TEXT    NOT NULL,
  transcript_path      TEXT,
  duration_ms          INTEGER,
  sentence_count       INTEGER NOT NULL DEFAULT 0,
  current_sentence_idx INTEGER NOT NULL DEFAULT 0, -- 断点显式存储，不依赖对 attempts 的任何反推
  added_at             TEXT    NOT NULL,
  finished_at          TEXT
);

CREATE TABLE IF NOT EXISTS sentences (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id    INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  idx            INTEGER NOT NULL,
  start_ms       INTEGER NOT NULL,
  end_ms         INTEGER NOT NULL,
  text           TEXT    NOT NULL,
  key_words_json TEXT    NOT NULL,   -- 仅静态部分：实词 ∪ 高危同音组词，导入时预计算；历史错词随时间增长，不在此列
  UNIQUE (material_id, idx)
);

CREATE TABLE IF NOT EXISTS attempts (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  sentence_id          INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  mode                 TEXT    NOT NULL,   -- lifeline | light | medium | heavy
  input                TEXT,
  tested_words_total   INTEGER NOT NULL DEFAULT 0,
  tested_words_correct INTEGER NOT NULL DEFAULT 0,
  accuracy             REAL,               -- 可为 NULL：保命档、或 tested_words_total = 0 的极短句落在这里。
                                            -- 存成 0 会把这些句子计为全错，拖低趋势曲线，
                                            -- M2 里还会误触发自动降档——反而惩罚了用户使用保命档保住连续打卡。
                                            -- 消费方不得当 0 或 100 处理。
  tested_words_json    TEXT    NOT NULL,   -- 本次实际考察的词集合，所有档位都要落，不只轻档：
                                            -- 中/重档考察词 = 候选池全集，含随时间增长的历史错词，事后不可复现
  outcome              TEXT    NOT NULL,   -- ok | weak | revealed | skipped
  comprehended         INTEGER,            -- 仅保命档 0/1，其余档 NULL
  replay_count         INTEGER NOT NULL DEFAULT 0,
  duration_ms          INTEGER,
  created_at           TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS words (
  word                   TEXT PRIMARY KEY,
  first_seen_sentence_id INTEGER REFERENCES sentences(id),
  last_error_sentence_id INTEGER REFERENCES sentences(id), -- 复习卡片播放最近一次听错的那句，不是第一次
  error_count            INTEGER NOT NULL DEFAULT 1,
  graduated              INTEGER NOT NULL DEFAULT 0,
  exposed_on             TEXT,             -- 轻档明文露出（未挖空）的日期，格式 YYYY-MM-DD，与 due 对齐做字符串比较。
                                            -- 当天再复习会评分虚高，靠这个字段推迟一天；混入 ISO 时间戳会让比较静默查空
  due                    TEXT    NOT NULL,
  stability              REAL    NOT NULL,
  difficulty             REAL    NOT NULL,
  elapsed_days           INTEGER NOT NULL,
  scheduled_days         INTEGER NOT NULL,  -- 与 lapses 一样，铺平自 ts-fsrs Card，无法从 reviews 反推，必须持久化
  reps                   INTEGER NOT NULL,
  lapses                 INTEGER NOT NULL,
  state                  INTEGER NOT NULL,
  last_review            TEXT
);

CREATE TABLE IF NOT EXISTS reviews (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  word         TEXT NOT NULL REFERENCES words(word) ON DELETE CASCADE,
  rating       TEXT NOT NULL,
  source       TEXT NOT NULL,      -- review | dictation —— 区分评分来自独立复习还是听写联动，排查双重调度用
  replay_count INTEGER NOT NULL DEFAULT 0,
  reviewed_at  TEXT NOT NULL
);

-- mocks、daily 两张表刻意缺席：属于 M2，第一期只做四级听力这一条线

CREATE INDEX IF NOT EXISTS idx_words_due ON words(due) WHERE graduated = 0;
CREATE INDEX IF NOT EXISTS idx_attempts_sentence ON attempts(sentence_id);
CREATE INDEX IF NOT EXISTS idx_reviews_word ON reviews(word);
