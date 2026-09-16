# personal-workstation

个人工作台。本地运行，管理并行推进的多条个人事务线。

## 当前状态

**第一期（M1）：四级精听工作台 —— 10/17 任务完成，128 个测试全绿**

判定层（`src/shared/`，纯函数零 IO）与数据层（`src/server/db/`）已完成，素材导入和 FSRS 调度已跑通。
剩余：听写提交、复习服务、前端界面、端到端验收。

**进度与待办详见 [TODO.md](TODO.md)** —— 接手前请先读它开头的「明天接手前先读这几条」。

以听写驱动的英语精听训练台，训练行为本身产出全部数据（零手工录入），听错的词自动进入
FSRS 间隔重复队列，复习卡片带原音频语境。四级是第一个里程碑，六级复用同一套系统。

## 文档

| 看什么 | 去哪 |
|---|---|
| **知识库**（活文档，随实现演进） | [`docs/kb/`](docs/kb/) —— 改动前必读 [user-profile.md](docs/kb/user-profile.md)，修 bug 前必读 [pitfalls.md](docs/kb/pitfalls.md) |
| 设计快照（成文即冻结） | [`docs/superpowers/specs/2026-09-15-cet-listening-workbench-design.md`](docs/superpowers/specs/2026-09-15-cet-listening-workbench-design.md) |
| 项目规则 | [`CLAUDE.md`](CLAUDE.md) |

## 规划中的其余线

读研、上班、辅导孩子功课、养生。数据结构已预留 `lane` 扩展位，总览页的热力图与掉线预警可直接复用。

## 素材说明

本仓库**不包含任何听力素材**。日常训练素材来自 BBC Learning English、VOA Learning English
等官方免费源（自带 transcript）；真题音频需自行从正版渠道获取，放在本地 `materials/`
目录下，该目录已在 `.gitignore` 中排除。
