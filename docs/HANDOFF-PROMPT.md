# story-director 插件交接提示词（当前最新版）

> 把下面整段内容（从「## 接手说明」到「## 收尾要求」）原样交给接手者。它是自包含的，接手者无需任何额外上下文即可继续开发。

---

## 接手说明

你是 story-director（叙事导演）插件的下一任开发者。这是一个 **SillyTavern 扩展插件**，用于在 AI 角色扮演（RP）中生成完整故事大纲、按时间线约束剧情、并每轮动态修订。请先读完本提示词再动手。

### 项目背景

SillyTavern（"酒馆"）是一个开源 AI 角色扮演前端。story-director 通过「完整大纲 + 时间线约束 + 每轮修订 + 长时记忆/向量检索」为 RP 注入叙事锚点：

- **完整大纲**：分幕（acts）+ 情节节点（beats，含类型/参与角色/状态）+ 角色弧光（arcs，含进度）+ 伏笔（foreshadowing，含回收节点）+ 当前焦点（focus）；
- **时间线约束**：用户指定故事内时间段与必读设定，所有节点必须落在区间内；
- **每轮异步修订**：后台校准方向、推进节点（**只在里程碑式完成时**）、更新伏笔与弧光状态；
- **大纲体检**：用户主动触发同步性诊断，含时间线漂移与节点节奏检查；
- **记忆插件集成**：只读接入 yuzuki-Memory 的记忆摘要与向量检索。

**插件哲学（重要，所有新功能先问是否符合立场）**：
- **大纲是规划文档，不是剧情日志**：常规对话轮次只校准 focus，节点推进只在里程碑；记录剧情是记忆插件（yuzuki）的事，不抢活；
- **事实边界不可重规划**：已发生（done）与进行中（active）的节点是既定事实。重新生成 = 只规划进行中节点之后；时间线 start 早于进行中节点时自动顺延；
- **重玩是用户自己的检查点**：快照回滚已有 30 条，插件不提供「回到过去重新体验」的特殊通道；
- **能力曲线交由 LLM 自行判断**：不做代码层的能力约束（时间拉长主角必然成长）。

### 当前环境

- **开发目录**：`/mnt/f/deepseek/plugins/story-director`（Windows 侧为 `F:\deepseek\plugins\story-director`）
- **git 仓库根**：`/mnt/f/deepseek/plugins`，分支 `main`
- **部署目标**：`/mnt/f/jiuguanai/SillyTavern-Launcher/SillyTavern/public/scripts/extensions/third-party/story-director/`（Windows 为 `F:\jiuguanai\...`）
- **部署方式**：`deploy.ps1`（**文件必须保持纯 ASCII**，见下方坑）
- **测试命令**（必须加隔离参数，否则沙箱会 EPERM）：

```bash
node --test --experimental-test-isolation=none "story-director/test/*.test.js"
```

当前测试数：**170/170 通过**。

### 最新 git 状态

当前分支 `main`，最近提交（按新到旧）：

```
83c8d8a feat: fact boundary - regenerate plans only the future after the ongoing beat
539cd1b fix: ongoing beat stays the single active focus after history merge
46f97b1 fix: keep in-progress beats in history merge; make revision milestone-only
a5c18c1 feat: preserve happened beats as a collapsible history act on regenerate
5637853 feat: derived act numbers and title renumbering tool
f14390d refactor: single-source act membership and controlled edit functions
1b9d191 feat: fetch model list and test connection for the independent API
8d63f12 feat: AI-assisted beat creation in the node editor; API type as dropdown
7d01fb4 feat: add beat pacing setting relative to the story span
4fc71fc fix: model picker shows all fetched models instead of filtered datalist
4f32b4c fix: deploy.ps1 silently deployed nothing under Windows PowerShell 5.1
ed6e3d8 feat: remember director window position across sessions
32547d0 feat: jump to a chosen beat to start playing from that story point
8283f2c feat: health-check history in outline meta; busy-aware action reporting
0eaa5c6 perf: compact revision context and switch locked revision to patch output
9ff4ec7 fix: honor lock mode in health check; clear retrieval hits on chat switch
48e1b30 feat: show which vector memory sources were hit after generate/revise/check
11cea9d style: make toolbar buttons equal width and height
```

工作区可能有未跟踪文件：`.superpowers/`、`docs/HANDOFF-PROMPT.md`（历史交接文档，非运行文件）。

### 当前文件结构与职责

```
story-director/
├── manifest.json          # id: story_director，版本 0.11.1（homepage 待填）
├── index.js               # 入口：魔法棒菜单 + 独立大窗口（含位置恢复）+ 事件 + 斜杠命令
├── settings.html          # 独立大窗口模板，四个页签：大纲总览 / 故事设定 / 生成与记忆 / API 与工具
├── style.css              # 白色底 UI，含 v2 polish 样式
├── deploy.ps1             # 部署脚本（必须 ASCII-only！）
├── src/
│   ├── outline-store.js   # 数据模型 + normalize（引用自愈）+ 受控编辑纯函数
│   ├── prompts.js         # 提示词模板 + schema + 群像/时间线/节奏/前情/事实边界块
│   ├── llm-client.js      # extractJson/stripCodeFence/makeStructuredGenerator
│   ├── openai-compat.js   # 独立 API 直连 + /v1/models 列表 + 连接测试
│   ├── injector.js        # focus → 导演指令 + 截断
│   ├── tracker.js         # applyRevision/applyPatch/mergeLockedOutline（锁定保护）
│   ├── checker.js         # 体检报告归一化 + 应用结果（支持锁定保护）
│   ├── director.js        # 编排：生成/修订/体检/suggestBeat/快照/记忆/向量
│   ├── adapter.js         # 酒馆桥接：角色卡预算、历史快照、yuzuki 接口、模型列表/测试
│   └── ui.js              # 独立窗口渲染、节点编辑器、页签、快照/导入导出
└── test/                  # 170 个测试
```

### 已实现功能（不要重复造轮子）

1. **独立大界面**：魔法棒菜单打开白色大窗口，可拖拽，**记住位置**（extension_settings.windowPos，打开时视口钳制），Esc 关闭。
2. **四个页签**：大纲总览 / 故事设定（时间线+必读设定+节点节奏+总览/弧光/伏笔）/ 生成与记忆（参数+预算+记忆插件）/ API 与工具（独立 API+快照+导入导出）。
3. **完整大纲生成**：题材通用，强制四线（主角/对抗/配角/世界势力）；acts 3-4 幕，beats 6-8 个带 cast；arcs 带 status；foreshadowing 带 beatId。
4. **时间线约束**：`timeline {start,end,note,mustRead}`，必读设定最高优先级。
5. **节点节奏**：`beatPacing`（balanced/dense/sparse），间隔相对总跨度（跨度÷节点数），不写绝对时间；生成/修订/体检三处 prompt 联动。
6. **前情保留 + 事实边界**：`preserveHistory`（默认 true）——重新生成时旧 done/active 节点收进「前情·已完成」幕（默认折叠）；active 节点保持 active 并成为唯一焦点（新大纲第一个 active 降为 pending）；prompt 事实边界块约束模型只能规划进行中节点之后、start 早于进行中节点自动顺延。关掉保留 = 全新大纲（弃史重来）。重玩 = 用户快照回滚。
7. **保守修订**：prompt 明确「大纲不是剧情日志」——常规轮次只校准 focus（不推进节点/不新增节点），里程碑（目标达成/冲突收场/场景明确结束）才推进。锁定模式用增量补丁（buildRevisePatchPrompt + applyPatch），输出 token 省 ~90%；输入侧压缩 done 节点（compactOutlineForRevision），合并时恢复细节。
8. **记忆插件集成**：`YuzukiMemory.VariableInjector.buildMemoryText()` 摘要；`YuzukiMemory.VectorStore.search()` 多路向量检索；检索命中清单实时展示（大纲总览页「本次检索命中」卡片）；设置：useMemoryPlugin / memoryContextLimit / generateMemoryMode / useVectorMemory / vectorMemoryLimit。
9. **上下文预算**：cardContextLimit（12000）、dialogueContextLimit（8000）防百万 token。
10. **受控编辑 + 引用自愈**：beat.actId 是唯一事实来源，acts[].beats 由 normalize 派生（消灭双向不一致）；normalize 统一自愈悬空引用（伏笔 beatId、focus.currentBeat 缺失/悬空、activeForeshadow 过滤）。编辑收编为纯函数：createBeat / updateBeat / removeBeat / moveBeatOrder / jumpToBeat / renumberActTitles / mergeHistoryIntoOutline——全部不可变（返回新对象）、可测试；UI 只调用它们。
11. **跳转节点**：总览 hover 🏁 或编辑器「从此开始」——目标 active、之前 done、后续 active 重置、焦点指向目标、nextStep 清空、自动快照。
12. **体检**：verdict/issues/changed/reason + 时间线漂移 + 节点节奏检查点；**体检历史留痕**（meta.checkHistory，10 条，总览统计行图标序列绿/黄/红）；锁定模式下体检只吸收状态类变更（mergeLockedOutline）。
13. **派生幕编号**：渲染徽章按数组顺序派生（删插不跳号）；「重编幕号」工具（renumberActTitles，≤10 中文数字，>10 阿拉伯，未编号标题不动）。
14. **AI 生成节点**：节点编辑器顶部「AI 生成」——一句话提示 + 当前大纲 → 建议节点填入表单确认后保存（suggestBeat）。
15. **独立 API**：custom 模式 OpenAI 兼容直连；**获取模型**（/v1/models，兼容 OpenAI 与 Ollama 格式，chip 面板点选，不用 datalist——会被输入值过滤）；**测试连接**（/models 优先，404 降级最小 chat completion）；API 类型下拉。
16. **快照/导入导出**：生成/修订/体检/手动编辑/导入前自动留快照（30 条），可回滚；JSON 导出/导入。
17. **并发友好**：director.isRunning() + UI 忙碌提示（不误报失败）。

### 关键实现细节与坑

- **generateRaw 不召回聊天记忆**：只发送传入内容；token 大头只可能来自角色卡，已用字符预算修复（928k token 教训）。
- **不要重新给 generateRaw 传 jsonSchema**：酒馆内置解析不剥 markdown 代码块，llm-client.js 自己用 extractJson 解析。
- **ctx.chatMetadata 引用会过期**：adapter 每次读写都 freshCtx() 重新取 window.SillyTavern.getContext()。
- **yuzuki-Memory 只读集成**：只调 window.YuzukiMemory.* 公开 API；向量检索需要柚月自己的「注入向量记忆」开关开启。
- **CRLF/LF**：/mnt/f 下 git 可能显示整文件 M，`git diff --ignore-space-at-eol` 为空说明只是换行差异；提交时不要提交无意义换行 churn。
- **deploy.ps1 必须纯 ASCII（重大坑）**：Windows PowerShell 5.1 对无 BOM 文件按 ANSI/GBK 读取，UTF-8 中文注释会错乱解析、吞掉后续代码行（导致 $Src 为空、Copy-Item 静默失败、Remove-Item 却执行了——部署一次删空一次插件目录）。脚本内已有注释说明，**不要再加非 ASCII 字符**。部署后务必 `ls` 目标目录验证文件真的在。
- **bindSelect 的 after 回调无参数**：不要把事件对象当参数用；select 存的是字符串（'true'/'false'），布尔设置要在 after 里转换。
- **UI 白色底**：控件样式集中在 style.css 的 v2 UI polish 段，不套酒馆暗色主题变量做背景。
- **锁定大纲**：tracker.applyRevision/applyPatch/checker.applyCheckResult 均支持 lockOutline——只推进状态/focus/伏笔，不改写手动编辑内容。
- **数据模型约定**：acts[].beats 是派生的（不要手工维护）；引用完整性交给 normalize；编辑一律走 outline-store 的受控纯函数，不要直接在 UI mutate。

### 尚未完成 / 可继续的方向

- `manifest.json` 的 `homepage` 仍为空，等用户提供 GitHub 仓库地址；版本 0.11.1 未发过 release（18+ commit 未治理）。
- **UI 层零测试**：170 个测试全在逻辑层，DOM 交互靠手动验证；ui.js 已 900+ 行，考虑拆分（渲染层可抽 ui-render.js）。
- 伏笔高亮交互（总览页 beat 行伏笔标记、回收点跳转高亮）——规划中。
- 可选：把「必读设定」从 timeline 中拆出为独立字段，语义更清晰（当前在 timeline.mustRead）。
- 可选：操作级撤销（增量变更日志，比整份快照更细）。
- 可选：修订频率默认值（当前 every；可考虑 everyN=3 省 token）。
- 用户可能继续提 UI 细节、token 优化、记忆插件工作流等需求。

### 收尾要求

1. 每改一处逻辑都跑 `node --test --experimental-test-isolation=none "story-director/test/*.test.js"`，确保 170+ 全绿；新增逻辑补测试。
2. 改浏览器侧文件后做语法检查：
   ```bash
   node --check index.js
   node -e "import('file:///mnt/f/deepseek/plugins/story-director/src/ui.js')"
   node -e "import('file:///mnt/f/deepseek/plugins/story-director/src/adapter.js')"
   ```
3. 每个任务单独 git commit，message 英文，`feat:` / `fix:` / `style:` / `refactor:` 前缀。
4. 改完部署：运行 `deploy.ps1`，**部署后 ls 目标目录确认文件存在**（历史教训：曾静默部署失败），提醒用户 Ctrl+Shift+R 硬刷新。
5. 如果改了 yuzuki-Memory 相关逻辑，先确认只是调用公开 API，不要修改柚月插件文件。
