# 入库分支提交身份与历史评测

2026-11-27，首次发布 `codex/ingestion-optimization` 被 GitHub GH007 邮箱隐私策略拒绝。仅对本分支尚未发布的祖先提交替换匹配作者/提交者的邮箱为账号 noreply 地址，并顺序重建父引用；文件树、提交说明、时间和其他作者身份均保留。其他工作区与分支引用没有修改，GitHub 隐私设置没有修改。

[历史提交对应表](baselines/ingestion-commit-aliases.json) 将报告中的原始 SHA 映射到发布 SHA。历史冻结报告继续保留原始值；基线加载工具通过 `baseline-reference.cjs` 解析别名，因此新克隆也可以复现旧源码，不依赖本机旧 Git 对象。逐提交文件树在改写时已核对相同。原分支仅保存在本机 `refs/backup/ingestion-before-email-privacy`，该备份不推送。

后续提交用单次 `git -c user.email=… commit` 指定同一 noreply 邮箱，不修改共享仓库配置。此变更仅用于发布身份修复，不代表重新运行历史评测。
