# 叙事导演 (story-director)

SillyTavern 扩展：双层结构化大纲 + 每轮动态修订，为 RP 生成注入叙事锚点。

## 功能
- 生成大纲（读取当前角色卡 + 用户要求）
- 每轮异步修订（推进节点 / 吸收偏离 / 更新伏笔）
- 大纲体检（同步性诊断，无论改不改都反馈）
- 手动编辑、清空、可调参数

## 部署
1. 运行 `deploy.ps1`（或手动拷贝 `story-director` 目录到酒馆 `public/scripts/extensions/third-party/`）。
2. 重启酒馆，在扩展面板启用"叙事导演"。

## 开发
- 纯逻辑单测：`node --test story-director/test/*.test.js`
