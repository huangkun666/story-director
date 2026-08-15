# 叙事导演 (story-director)

SillyTavern 扩展：双层结构化大纲 + 每轮动态修订，为 AI 角色扮演生成注入叙事锚点，降低随机性、提升剧情深度。

## 功能

- **大纲生成**：读取当前角色卡（含 depth_prompt、世界书、聊天级 scenario/system_prompt/mes_example 覆盖）生成结构化大纲；
- **每轮异步修订**：后台推进情节节点、吸收偏离、更新伏笔状态；
- **大纲体检**：主动诊断大纲与剧情的同步性，无论是否修改都给出反馈；
- **导演指令注入**：把当前节点 / 下一步 / 活跃伏笔注入生成上下文；
- **精美面板**：卡片式总览、情节时间线、焦点高亮、彩色体检报告、loading 状态、空状态引导；
- **可调参数**：控制强度、注入长度、修订节奏、偏离策略、大纲详细度、回顾轮数；
- **独立 API**：生成 / 修订 / 体检可脱离酒馆主 API，走 OpenAI 兼容接口。

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
| `recentTurns` | `5` | 修订 / 体检回看的最近轮数 |
| `llm.mode` | `main` | `main` 复用主 API / `custom` 独立配置 |
| `llm.api` | 空 | 与酒馆 `generateRaw` 的 `api` 参数同名（openai / textgenerationwebui 等） |
| `llm.baseUrl` | 空 | OpenAI 兼容网关地址，例如 `https://api.example.com/v1` |
| `llm.apiKey` | 空 | 独立密钥，仅 custom 模式使用 |
| `llm.model` | 空 | 独立模型名，留空使用服务端默认 |

所有设置都在扩展面板「高级设置」里即时修改并保存。

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

大纲 JSON 存于 `chat_metadata.story_director`，设置存于 `extension_settings.story_director`。`src/` 下除 `adapter.js`、`ui.js` 外均为零依赖纯逻辑模块，可在 Node 中直接单测。
