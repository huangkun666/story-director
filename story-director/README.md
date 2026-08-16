# 叙事导演 (story-director)

SillyTavern 扩展：双层结构化大纲 + 每轮动态修订，为 AI 角色扮演生成注入叙事锚点，降低随机性、提升剧情深度。

## 功能

- **大纲生成**：题材不限，读取角色卡与必读设定，按用户指定的故事内时间线生成完整群像大纲：主角线 / 对抗线 / 配角线 / 世界势力线 + 分幕结构 + 6-8 个带参与角色的情节节点 + 弧光进度 + 伏笔回收关联；
- **时间线约束**：大界面「故事设定」页填写开始/结束时间、补充约束；所有分幕和节点都限制在这个时间段内；
- **必读设定**：独立于时间线的世界观级硬约束（最高优先级），生成、修订、体检都强制执行；
- **可编辑大纲**：点击节点打开编辑器改标题/概要/类型/所属幕，可新增、删除、上下移动节点；双击幕标题编辑幕；「锁定大纲」开启后自动修订只推进状态，不改写手动编辑内容；
- **长时记忆接入**：检测到 yuzuki-Memory 时，生成/修订/体检会自动读取其剧情摘要与记忆表格（可关闭、可限长），长对话不会因为丢失前文而幻觉；
- **向量资料检索**：把时间线、用户要求和当前焦点作为查询，调用柚月 `VectorStore.search()` 检索已向量化的资料库，把相关 chunk 注入大纲请求（可关闭、可限长）；
- **每轮异步修订**：后台推进情节节点、吸收偏离、更新伏笔与弧光状态；
- **修订快照**：生成/修订/体检/手动编辑/清空/导入前自动留快照（最多 30 条），可从左侧工具卡一键回滚；支持导出/导入大纲 JSON；
- **大纲体检**：主动诊断大纲（时间线、分幕、节点、伏笔、焦点）与剧情的同步性，无论是否修改都给出反馈；
- **导演指令注入**：把当前节点 / 下一步 / 活跃伏笔 / 当前时间线注入生成上下文；
- **分栏工作台**：挂在聊天输入区左侧的魔法棒菜单里，打开白色大窗口；五个功能页签：**大纲总览 / 故事设定 / 生成与记忆 / 角色与伏笔 / API 与工具**，主界面只放大纲；窗口可拖拽、Esc 关闭；
- **可调参数**：控制强度、注入长度、修订节奏、偏离策略、大纲详细度、回顾轮数；
- **独立 API**：生成 / 修订 / 体检可脱离酒馆主 API，走 OpenAI 兼容接口。

## 时间线

大界面顶部有「时间线约束」编辑区，按每个聊天独立保存在 `chat_metadata.story_director.timeline`：

- `start` / `end`：故事内时间文本，例如「建安五年（200年）」「建安十三年（208年）」「第一天」「第七天」；
- `note`：可选补充，例如「必须包含赤壁之战」；
- 留空时，模型会自己推定一个时间范围并写回大纲；
- 修订时若剧情时间越过 `end`，会顺延时间线并补过渡节点，不会把原有大纲删掉。

## 必读设定

独立于时间线的世界观级硬约束，存在大纲顶层 `mustRead` 字段（旧版本存在 `timeline.mustRead` 的数据会在加载时自动迁移）。无论时间线如何变化都必须遵守；与任何其他设定冲突时以此为准。

## 设置说明

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `enabled` | `true` | 总开关 |
| `controlStrength` | `strong` | `weak` 弱引导 / `strong` 强约束 |
| `injectTokenLimit` | `300` | 注入指令的近似 token 上限 |
| `reviseFrequency` | `every` | `every` 每轮 / `everyN` 每 N 轮 / `manual` 仅手动 |
| `reviseEveryN` | `1` | 每 N 轮修订的 N |
| `driftTolerance` | `loose` | `loose` 宽松吸收偏离 / `strict` 严格拉回 |
| `outlineDetail` | `medium` | 大纲详细度 `low` / `medium` / `high` |
| `generateMemoryMode` | `auto` | 生成大纲时的记忆模式：`auto` 摘要+向量 / `summary` 只读摘要 / `vector` 只检索 / `none` 不用记忆 |
| `recentTurns` | `5` | 修订 / 体检回看的最近轮数 |
| `cardContextLimit` | `12000` | 生成大纲时角色卡内容的最大字符数，防止巨型世界书/深度提示撑爆 prompt |
| `dialogueContextLimit` | `8000` | 修订 / 体检回看对话的最大字符数 |
| `useMemoryPlugin` | `true` | 开启后接入 yuzuki-Memory 的剧情摘要与记忆表格 |
| `memoryContextLimit` | `8000` | 记忆插件注入大纲请求的最大字符数 |
| `useVectorMemory` | `true` | 开启后调用柚月向量库检索相关资料 |
| `vectorMemoryLimit` | `6000` | 向量检索结果注入大纲请求的最大字符数 |
| `lockOutline` | `false` | `true` 时自动修订只推进状态，不改写手动编辑的节点/幕/时间线 |
| `llm.mode` | `main` | `main` 复用主 API / `custom` 独立配置 |
| `llm.api` | 空 | 与酒馆 `generateRaw` 的 `api` 参数同名（openai / textgenerationwebui 等） |
| `llm.baseUrl` | 空 | OpenAI 兼容网关地址，例如 `https://api.example.com/v1` |
| `llm.apiKey` | 空 | 独立密钥，仅 custom 模式使用 |
| `llm.model` | 空 | 独立模型名，留空使用服务端默认 |

所有设置都在大界面底部的「高级设置」抽屉里即时修改并保存（也可以直接用 `/director open` 打开界面）。

## 独立 API（custom 模式）

酒馆 `generateRaw` 的 `api` 参数之外，反向代理地址与密钥走酒馆全局设置，无法安全地把一套独立 baseUrl/apiKey 透传进去。因此 `custom` 模式直接按 OpenAI 兼容格式调用：

```
POST {baseUrl}/v1/chat/completions
Authorization: Bearer {apiKey}
{ "model": "{model}", "messages": [...] }
```

- `baseUrl` 为空或请求失败 / 解析失败时，静默降级为「沿用旧大纲 + 继续注入」，绝不中断 RP；
- 不绑定任何具体厂商，任何 OpenAI 兼容服务均可使用。

## 斜杠命令

```
/director open      打开大界面
/director generate  生成大纲
/director revise    手动修订
/director check     同步性体检
/director status    查看插件状态
```

## 部署

```powershell
.\deploy.ps1
```

`deploy.ps1` 会从脚本所在目录拷贝 `manifest.json`、`index.js`、`settings.html`、`style.css`、`src/` 到酒馆的 `public/scripts/extensions/third-party/story-director/`，不会把 `test/`、`README.md` 和脚本自身拷过去。部署后**硬刷新（Ctrl+Shift+R）**验证。

## 开发

纯逻辑单测（必须加 `--experimental-test-isolation=none`，否则沙箱下 `node --test` 会因 spawn 子进程触发 EPERM）：

```bash
node --test --experimental-test-isolation=none "story-director/test/*.test.js"
```

浏览器侧文件语法检查（adapter.js / ui.js 可被 Node import；index.js 依赖 window，用 `node --check`）：

```bash
node -e "import('file:///F:/deepseek/plugins/story-director/src/adapter.js').then(m=>console.log('OK', Object.keys(m).join(', ')))"
node -e "import('file:///F:/deepseek/plugins/story-director/src/ui.js').then(m=>console.log('OK', Object.keys(m).join(', ')))"
node --check index.js
```

## 数据模型

大纲 JSON 存于 `chat_metadata.story_director`（顶层含 `mustRead`、`timeline`、`theme/tone/world`、`arcs`、`foreshadowing`、`acts` 分幕、`beats` 节点、`focus` 焦点），设置存于 `extension_settings.story_director`。`src/` 下除 `adapter.js`、`ui.js` 外均为零依赖纯逻辑模块，可在 Node 中直接单测。
