# personal-workstation

个人工作台。本地运行，管理并行推进的多条个人事务线。

## 当前状态

**第一期：四级精听工作台**（设计已确认，待实施）

以听写驱动的英语精听训练台，训练行为本身产出全部数据（零手工录入），听错的词自动进入
FSRS 间隔重复队列，复习卡片带原音频语境。四级是第一个里程碑，六级复用同一套系统。

设计文档：[`docs/superpowers/specs/2026-09-15-cet-listening-workbench-design.md`](docs/superpowers/specs/2026-09-15-cet-listening-workbench-design.md)

## 规划中的其余线

读研、上班、辅导孩子功课、养生。数据结构已预留 `lane` 扩展位，总览页的热力图与掉线预警可直接复用。

## 素材说明

本仓库**不包含任何听力素材**。日常训练素材来自 BBC Learning English、VOA Learning English
等官方免费源（自带 transcript）；真题音频需自行从正版渠道获取，放在本地 `materials/`
目录下，该目录已在 `.gitignore` 中排除。
