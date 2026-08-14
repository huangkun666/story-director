# 叙事导演（story-director）插件设计文档

- 日期：2026-08-14
- 状态：设计已与用户逐节确认，待评审
- 目标平台：SillyTavern（本地 `F:\jiuguanai\SillyTavern-Launcher\SillyTavern`）

## 1. 背景与目标

### 1.1 问题

在 SillyTavern 中进行 AI 角色扮演（RP）时，常见两个痛点：

1. **抽奖感**：模型每一步的走向随机性大，同样的开局可能滑向完全不同的方向，玩家无法掌控剧情走向。
2. **剧情缺乏深度**：生成内容平铺直叙，缺少主题、角色弧光、情节起伏、伏笔呼应等叙事骨架，读起来"没灵魂"。

### 1.2 目标

开发一个 SillyTavern 扩展插件 **story-director（叙事导演）**，通过"提前生成大纲 + 根据用户输入动态修订大纲"，为每次生成注入一个贯穿性的叙事锚点，从而：

- 降低剧情随机性（强约束默认开启，可调）；
- 提升剧情深度（主题、弧光、情节结构、伏笔、世界观五维骨架）；
- 大纲随玩家输入连续演化，而非一次性冻结；
- 提供用户可感知、可干预的控制入口（手动编辑、体检、参数调节）。

### 1.3 非目标（YAGNI）

- 不做多角色分线管理（群聊角色各自独立弧光等复杂编排）；
- 不做剧情分支树的可视化画布；
- 不内置任何模型后端，不绑定任何具体模型；
- 不负责"破限/越狱"类提示词。

## 2. 整体架构

插件采用三层结构：

```
┌─────────────────────────────────────────────┐
│  UI 层：大纲面板（查看/手动编辑/一键生成/体检）    │
├─────────────────────────────────────────────┤
│  导演引擎（Director）                         │
│   ├─ 大纲生成器（首次生成整场大钢）              │
│   ├─ 情节追踪器（每轮自动修订：推进/偏离/插新节点） │
│   ├─ 大纲体检器（用户主动触发的同步性诊断）        │
│   └─ 注入器（把"当前焦点指令"写进提示词）        │
├─────────────────────────────────────────────┤
│  存储层：chat_metadata 中的结构化大纲 JSON       │
└─────────────────────────────────────────────┘
```

### 2.1 模块职责

| 模块 | 职责 | 依赖 |
|------|------|------|
| `outline-store` | 读写/校验 `chat_metadata` 里的大纲 JSON，提供默认空大纲 | SillyTavern `chat_metadata` / `updateChatMetadata` / `saveMetadata` |
| `director` | 编排生成/修订/体检流程，维护引擎状态（是否正在修订） | store、LLM client、prompts |
| `tracker`（情节追踪器） | 每轮自动修订：推进节点、吸收偏离、更新伏笔 | director、LLM client |
| `checker`（大纲体检器） | 同步性诊断，输出结构化报告并应用修改 | director、LLM client |
| `injector` | 把 `focus` 渲染成"导演指令"文本并调用 `setExtensionPrompt` | store |
| `llm-client` | 封装 `generateRaw`/`generateQuietPrompt`，请求结构化 JSON，容错解析 | SillyTavern `generateRaw` |
| `prompts` | 集中管理生成/修订/体检/注入四套提示词模板 | 无 |
| `ui` | 面板渲染、事件绑定、手动编辑、参数控件 | SillyTavern `renderExtensionTemplateAsync` 等 |

### 2.2 设计原则

- **复用酒馆能力**：注入走 `setExtensionPrompt`，持久化走 `chat_metadata`，后台调模型走 `generateRaw`（模型无关，自动使用酒馆当前连接的 API）。
- **模型无关**：LLM 调用一律走酒馆当前 `main_api`，不写死任何厂商。
- **异步修订**：每轮自动修订在后台执行，不阻塞角色回复。
- **失败安全**：任何模型调用失败或 JSON 解析失败，均降级为"沿用旧大纲 + 继续注入"，绝不破坏 RP 主流程。
- **隔离清晰**：每个模块单一职责，可独立测试。

## 3. 大纲数据模型

大纲作为聊天元数据（`chat_metadata`）中的一个键（暂定 `story_director`）存储，结构为 JSON：

```jsonc
{
  "version": 1,
  "theme": "背叛与救赎",                // 主题
  "tone": "压抑、冷峻、结尾留一丝温暖",    // 情绪基调
  "world": "……世界观与冲突根源……",        // 长线背景
  "arcs": [                             // 角色弧光
    { "char": "主角", "desire": "…", "flaw": "…", "growth": "从X到Y" }
  ],
  "foreshadowing": [                    // 伏笔清单
    { "id": "f1", "hint": "…", "status": "pending|active|paid", "payoff": "…" }
  ],
  "beats": [                            // 长线情节节点（起承转合）
    { "id": "b1", "title": "开端：…", "summary": "…", "status": "done|active|pending" }
  ],
  "focus": {                            // 短钢：当前焦点（每轮注入的就是它）
    "currentBeat": "b2",
    "nextStep": "下一步：…",
    "activeForeshadow": ["f1"],
    "avoidOffTopic": "不要偏离…"
  },
  "meta": { "updatedAt": "…", "revisionCount": 0 }
}
```

### 3.1 字段语义

- `beats[].status`：`pending`（待开始）/ `active`（进行中）/ `done`（已完成）。
- `foreshadowing[].status`：`pending`（已埋未激活）/ `active`（当前应引导）/ `paid`（已回收）。
- `focus` 是**注入到提示词**的唯一数据源，每次生成前由 injector 渲染。

### 3.2 校验

`outline-store` 在读取时做最小结构校验：字段缺失用默认值补齐，非法 `status` 值回退为 `pending`，`focus.currentBeat` 不存在时回退到第一个 `active` 或 `pending` beat。保证渲染器永不因坏数据崩溃。

## 4. 数据流

### 4.1 正常对话流程（每轮）

```
用户发送消息
   │
   ├─① 同步注入（快，不调模型）：
   │     injector 把 focus 渲染成"导演指令"，
   │     经 setExtensionPrompt 塞进提示词 → 角色按大纲回复
   │
   └─② 异步修订（后台，不阻塞）：
         tracker 调模型做"情节追踪"，
         输入：最近对话 + 当前大纲，
         输出：更新后大纲（JSON），
         写回 chat_metadata，供下一轮注入使用
```

**关键决策：异步修订。** 修订不阻塞角色回复，避免每轮多等一次模型调用的延迟。代价是"当前轮用上一轮修订后的大纲"，因大纲连续演化，滞后一轮几乎无感。

### 4.2 首次生成流程

用户点击"生成大纲"按钮：

1. 读取**当前角色卡**信息：角色名、描述、性格、开场白、示例对话、世界书条目；
2. 收集用户输入：想要的主题/方向（可选）、以及当前参数（详细度、控制强度等）；
3. 调模型，用 JSON Schema 生成完整大钢（theme/tone/world/arcs/beats/foreshadowing + 初始 focus）；
4. 校验并写入 `chat_metadata`，渲染到面板。

### 4.3 修订/体检统一 LLM 协议

所有需要模型输出的操作（生成、每轮修订、体检）都要求**结构化 JSON 输出**，通过 `generateRaw` 的 `jsonSchema` 能力传递 schema。解析时做容错：先 `JSON.parse`，失败再尝试剥离 markdown 代码块，仍失败则判定本次调用失败并降级。

## 5. 情节追踪器（每轮自动修订）

每轮用户发言后异步执行，模型完成三件事（输入：最近 N 轮对话 + 当前大纲；输出：更新后大纲）：

1. **推进节点**：判断 `focus.currentBeat` 是否已完成；若完成，将该 beat 标记为 `done`，`focus` 移到下一个 `pending` beat 并标记为 `active`。
2. **偏离吸收**：判断剧情是否偏离当前方向。若偏离，**不粗暴打断**，而是把偏离吸收进大纲——改写 `focus.nextStep` 或插入新 beat（尊重玩家自由选择，不把玩家拽回轨道）。偏离容忍度由参数控制。
3. **更新伏笔**：标记已回收的伏笔为 `paid`，记录新埋下的伏笔。

**约束**：追踪器只更新大纲 JSON，不直接干预本轮生成文本。

## 6. 大纲体检器（用户主动触发的同步性诊断）

解决"用户感觉大纲与当前剧情脱节"的补救机制，独立于每轮自动修订。

- **触发**：面板"体检"按钮 + 斜杠命令 `/director check`。
- **输入**：最近 N 轮对话历史（N 可配，默认 5）+ 现有大纲。
- **模型输出**：结构化诊断报告：

```jsonc
{
  "verdict": "sync | minor-drift | major-drift",   // 同步 / 轻度脱节 / 严重脱节
  "issues": [ { "where": "…", "what": "…", "severity": "low|mid|high" } ],
  "changed": true,                                  // 是否修改了大纲
  "changes": "……修改内容摘要……",                     // 改了哪些
  "reason": "……判断依据……"                          // 无论改没改都要给出
}
```

- **行为**：
  - `verdict` 为 `minor-drift` / `major-drift` 且模型判断需要改 → 应用修改、写回、出报告；
  - `verdict` 为 `sync` 或判断无需改 → 不改大纲，但**同样出报告**说明"当前大纲仍适用"及理由。
- **反馈**：无论是否修改，都以诊断报告形式呈现（面板内展示 verdict/issue 摘要 + 可展开 reason/changes 详情）。

**分工**：每轮自动修订是"静默快速"的推进与吸收；体检是"用户起疑时的一次性深度检查"，必须给用户明确反馈。二者互补。

## 7. UI 面板

面板位于酒馆扩展抽屉内，可折叠。自上而下：

1. **大纲总览区**：显示 theme/tone/world 摘要；beats 列表（状态徽章 ✅已完成 / 🔄进行中 / ⬜待开始）；arcs、foreshadowing 可展开。支持**手动编辑**（点击节点改文本，改完写回）。
2. **当前焦点区（focus）**：高亮显示 currentBeat + nextStep + 活跃伏笔，附"刷新"按钮（手动触发一次修订）。
3. **工具栏**："生成大纲"、"修订大纲"、"体检"、"清空大纲"、启用/停用开关（停用自动清掉注入）。
4. **诊断报告区**：展示最近一次体检/修订的报告。

### 7.1 手动编辑

点击节点进入编辑态，改完保存写回 `chat_metadata`。编辑对象为 beats / arcs / foreshadowing / focus 的文本字段，不直接暴露原始 JSON（面向普通用户，降低误操作风险）。

## 8. 可调参数

参数存于 `extension_settings.story_director`，使用酒馆自带设置 UI。

| 参数 | 作用 | 默认值 |
|------|------|--------|
| `enabled` | 启用/停用插件 | true |
| `controlStrength` | 弱引导 ↔ 强约束（改变注入指令措辞强弱） | strong |
| `injectTokenLimit` | focus 注入 token 上限 | 300 |
| `reviseFrequency` | 每轮 / 每 N 轮 / 仅手动 | every（每轮） |
| `reviseEveryN` | `reviseFrequency=everyN` 时的 N | 1 |
| `driftTolerance` | 偏离容忍度（吸收 vs 拉回） | loose（吸收） |
| `outlineDetail` | 首次生成大钢详细度 | medium |
| `recentTurns` | 修订/体检取最近对话轮数 | 5 |
| `promptOverrides` | 自定义生成/修订/体检/注入提示词 | 内置默认 |

## 9. 错误处理与鲁棒性

- **JSON 解析失败**：丢弃本次修订/体检输出，保留旧大纲，下轮重试，不污染数据。
- **模型调用失败/超时**：静默降级为"仅用现有大纲注入"，不打断 RP。
- **注入长度控制**：focus 渲染文本按 `injectTokenLimit` 截断，防止挤占上下文。
- **并发控制**：同一时刻只允许一个修订/体检任务运行（新触发丢弃或排队，避免竞态覆盖）。
- **空大纲**：未生成大纲时，注入器不注入任何内容，插件静默待命。

## 10. 部署位置与文件结构

开发目录：`F:\deepseek\plugins`（本工作区，作为 git 仓库根）。

插件源码目录（开发完成后拷贝/软链到酒馆）：

```
F:\deepseek\plugins\story-director\
├── manifest.json          # manifest_version 1, id, display_name, js, css
├── index.js               # 入口：加载模块、注册事件、挂载 UI
├── style.css
└── src\
    ├── outline-store.js
    ├── director.js
    ├── tracker.js
    ├── checker.js
    ├── injector.js
    ├── llm-client.js
    ├── prompts.js
    └── ui.js
```

部署目标：`F:\jiuguanai\SillyTavern-Launcher\SillyTavern\public\scripts\extensions\third-party\story-director\`。

## 11. 事件绑定

插件监听以下 SillyTavern 事件：

- `MESSAGE_SENT`：触发每轮异步修订（受 `reviseFrequency` 控制）；
- `CHAT_CHANGED`：切换聊天时重载该聊天的大纲，刷新面板；
- `EXTENSION_SETTINGS_LOADED`：初始化设置默认值。

注入不依赖事件，而是由 `injector` 在每次生成前通过 `setExtensionPrompt` 预先写入（酒馆在组装提示词时会读取 `extension_prompts`）。

## 12. 测试策略

- **纯逻辑单测**（Node）：`outline-store` 的校验/默认值补齐、`injector` 的指令渲染与截断、`tracker`/`checker` 对 LLM 返回 JSON 的解析与状态合并（用假 LLM 输出注入）。
- **LLM 输出解析测试**：覆盖"纯 JSON""带 markdown 代码块""非法 JSON"三种返回。
- **手动集成验证**：在本地酒馆真实跑通"生成→注入→自动修订→体检→手动编辑"全链路。
- **鲁棒性验证**：断网/模型报错时确认 RP 不被中断。

## 13. 开放问题

- 无（设计已与用户逐节确认，暂无遗留项）。
