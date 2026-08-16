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
- **记忆插件集成**：只读接入 yuzuki-Memory 的摘要、向量检索与**记忆指针**。

**插件哲学（重要，所有新功能先问是否符合立场）**：
- **大纲是规划文档，不是剧情日志**：常规对话轮次只校准 focus，节点推进只在里程碑；记录剧情是记忆插件（yuzuki）的事，不抢活；
- **事实边界不可重规划**：已发生（done）与进行中（active）的节点是既定事实。重新生成 = 只规划进行中节点之后；时间线 start 早于进行中节点时自动顺延；
- **重玩是用户自己的检查点**：快照回滚已有 30 条，插件不提供「回到过去重新体验」的特殊通道；
- **能力曲线交由 LLM 自行判断**：不做代码层的能力约束（时间拉长主角必然成长）；
- **新人物允许但须交代**：生成/修订/AI 节点三处 prompt 显式许可引入新角色，但不得与名录重名冲突、身份动机必须交代。

### 当前环境

- **开发目录**：`/mnt/f/deepseek/plugins/story-director`（Windows 侧为 `F:\deepseek\plugins\story-director`）
- **git 仓库根**：`/mnt/f/deepseek/plugins`，分支 `main`（约 69 个提交）
- **GitHub 仓库**：https://github.com/huangkun666/story-director（origin，public；token 在 Windows 系统变量 `Git-hub-token`，push 用一次性 credential helper，勿把 token 写进 .git/config）
- **部署目标**：`/mnt/f/jiuguanai/SillyTavern-Launcher/SillyTavern/public/scripts/extensions/third-party/story-director/`（Windows 为 `F:\jiuguanai\...`）
- **部署方式**：`deploy.ps1`（**文件必须保持纯 ASCII**，见下方坑）
- **测试命令**（必须加隔离参数，否则沙箱会 EPERM）：

```bash
node --test --experimental-test-isolation=none "story-director/test/*.test.js"
```

当前测试数：**210/210 通过**。

### 最新 git 状态

最近提交（按新到旧）：

```
09993d7 docs: fill homepage with GitHub repo URL
ff4a320 docs: refresh handoff prompt to current state (210 tests, memory pointer era)
88b9b99 feat: derive recent dialogue window from yuzuki memory pointer
7121227 feat: dialogue extraction rules UI - chips, manual add, AI analyze
61fc229 feat: two-stage retrieval - direction draft before targeted search
c9ebc1c feat: dialogue body extraction rules with AI-assisted setup
24be012 feat: tighter vector retrieval and context-aware recent dialogue
e7e2783 feat: explicitly permit new characters in generation, beats and revision
55c69df feat: new 'characters & foreshadowing' tab with full manual management
3122822 feat: controlled edit functions for arcs and foreshadowing
a6895b9 fix: dark theme actually reaches content, readable helper text, tidy cards
7e0d9e7 feat: light/dark theme switcher with full variable-driven palette
cb2561b refactor: split ui.js into event layer and render layer
165e5d3 feat: foreshadow payoff visibility - chips on beats and jump-to-node
421af5d docs: refresh handoff prompt to current state
83c8d8a feat: fact boundary - regenerate plans only the future after the ongoing beat
539cd1b fix: ongoing beat stays the single active focus after history merge
46f97b1 fix: keep in-progress beats in history merge; make revision milestone-only
a5c18c1 feat: preserve happened beats as a collapsible history act on regenerate
5637853 feat: derived act numbers and title renumbering tool
f14390d refactor: single-source act membership and controlled edit functions
4fc71fc fix: model picker shows all fetched models instead of filtered datalist
1b9d191 feat: fetch model list and test connection for the independent API
8d63f12 feat: AI-assisted beat creation in the node editor; API type as dropdown
7d01fb4 feat: add beat pacing setting relative to the story span
8283f2c feat: health-check history in outline meta; busy-aware action reporting
ed6e3d8 feat: remember director window position across sessions
32547d0 feat: jump to a chosen beat to start playing from that story point
4f32b4c fix: deploy.ps1 silently deployed nothing under Windows PowerShell 5.1
0eaa5c6 perf: compact revision context and switch locked revision to patch output
9ff4ec7 fix: honor lock mode in health check; clear retrieval hits on chat switch
48e1b30 feat: show which vector memory sources were hit after generate/revise/check
```

工作区可能有未跟踪文件：`.superpowers/`、`docs/HANDOFF-PROMPT.md`（历史交接文档，非运行文件）。

### 当前文件结构与职责

```
story-director/
├── manifest.json          # id: story_director，版本 0.11.1（homepage = GitHub 仓库）
├── index.js               # 入口：魔法棒菜单 + 独立大窗口（含位置恢复）+ 事件 + 斜杠命令
├── settings.html          # 独立大窗口模板，五个页签
├── style.css              # 双主题（白天/夜晚），全部颜色走 CSS 变量，禁止硬编码
├── deploy.ps1             # 部署脚本（必须 ASCII-only！）
├── src/
│   ├── outline-store.js   # 数据模型 + normalize（引用自愈）+ 全部受控编辑纯函数
│   ├── prompts.js         # 提示词模板 + schema + 群像/时间线/节奏/前情/事实边界/方向草案块
│   ├── llm-client.js      # extractJson/stripCodeFence/makeStructuredGenerator
│   ├── openai-compat.js   # 独立 API 直连 + /v1/models 列表 + 连接测试
│   ├── dialogue-extract.js# 对话正文提取纯函数（标签规则，无匹配回退原文）
│   ├── injector.js        # focus → 导演指令 + 截断
│   ├── tracker.js         # applyRevision/applyPatch/mergeLockedOutline（锁定保护）
│   ├── checker.js         # 体检报告归一化 + 应用结果（支持锁定保护）
│   ├── director.js        # 编排：生成（两阶段）/修订/体检/suggestBeat/analyzeDialogueTags
│   ├── adapter.js         # 酒馆桥接：角色卡预算、历史快照、yuzuki 接口、记忆指针、模型工具
│   ├── ui.js              # 事件层：页签/编辑器/设置/窗口/拖拽
│   └── ui-render.js       # 渲染层：所有纯渲染函数（HTML 字符串 / DOM 填充）
└── test/                  # 210 个测试
```

### 已实现功能（不要重复造轮子）

1. **独立大界面**：魔法棒菜单打开白色大窗口，可拖拽、记住位置（windowPos，视口钳制）、Esc 关闭。
2. **双主题**：工具栏 🌙/☀️ 切换白天/夜晚；style.css 全部颜色走 CSS 变量（`--sd-*`），暗色是同一变量的黑灰覆盖；类型徽章有专门暗色反转；语义浅底用 color-mix 自动适配。**新增颜色必须加变量，禁止硬编码**。
3. **五个页签**：大纲总览 / 故事设定（时间线+必读设定+节点节奏+保留前情+故事总览卡）/ 生成与记忆（生成参数+修订参数+记忆插件+对话正文提取）/ 角色与伏笔 / API 与工具。
4. **完整大纲生成（两阶段检索）**：`advancedRetrieval`（默认开）——① 方向草案（模型先输出 direction + 2-4 条精准检索词）→ ② 用草案 queries + 保底三路（时间线/角色前5/焦点）定向检索 → ③ 正式生成（direction 块 + 资料）。草案失败自动降级单轮。题材通用，强制四线；新人物许可块。
5. **时间线约束**：`timeline {start,end,note,mustRead}`，必读设定最高优先级；**节点节奏**（beatPacing 相对跨度三档）。
6. **事实边界 + 前情保留**：`preserveHistory`（默认 true）——重新生成时旧 done/active 节点收进「前情·已完成」幕（默认折叠）；active 保持 active 并成为唯一焦点（新大纲第一个 active 降为 pending）；prompt 硬约束 start 早于进行中节点自动顺延。关掉 = 弃史重来；重玩 = 用户快照回滚。
7. **近期对话上下文（记忆指针驱动）**：记忆插件每 N 轮（默认 20）更新一次并维护记忆指针。`adapter.getMemoryGap()` 只读调用 `YuzukiMemory.Storage.loadState()` 读 `settings.manualPointers.summary`，`getRecentDialogue` 的轮数 = **指针之后缺失楼层数（+1 轮余量，clamp 60 轮）**，无指针（记忆未启用/无状态/读取失败）回落 `recentTurns`。对话**始终携带**（生成/修订/体检）。
8. **对话正文提取**：`dialogueExtractRules` 设置（全局）；`dialogue-extract.js` 纯函数按标签（如【】、* *）提取正文，无匹配行保留原文、全部无匹配/无规则回退原文；UI「AI 分析」让模型扫描最近对话给出规则建议（含真实提取示例），**用户逐条确认**后才生效，也可手动添加；作用于生成/修订/体检。
9. **保守修订**：prompt 明确「大纲不是剧情日志」——常规轮次只校准 focus，里程碑才推进节点；锁定模式用增量补丁（buildRevisePatchPrompt + applyPatch，输出省 ~90%）；输入侧压缩 done 节点（compactOutlineForRevision），合并时恢复细节。
10. **向量检索**：多路 query（模型定向优先 + 时间线/角色前5/焦点保底），**每路 top 3** 防低相关占预算；命中清单实时展示（总览页「本次检索命中」卡）。
11. **上下文预算**：cardContextLimit（12000）、dialogueContextLimit（8000）、memoryContextLimit（8000）、vectorMemoryLimit（6000）。
12. **受控编辑 + 引用自愈**：beat.actId 唯一事实来源，acts[].beats 派生；normalize 自愈悬空引用（伏笔 beatId、focus.currentBeat 缺失/悬空、activeForeshadow）。纯函数：createBeat/updateBeat/removeBeat/moveBeatOrder/jumpToBeat/renumberActTitles/mergeHistoryIntoOutline/createArc/updateArc/removeArc/createForeshadow/updateForeshadow/removeForeshadow——全部不可变、可测试。
13. **角色与伏笔页签**：角色卡网格（欲望/缺陷/成长 + 状态 + **出场节点派生 chips 跳转高亮**）+ 编辑/新增/删除（arc 编辑器 modal）；伏笔管理（状态筛选 + 编辑/一键回收/删除 + 回收节点选择器 + 跳转高亮）。
14. **伏笔高亮**：总览页节点行显示指向它的活跃伏笔 chips（hover 看 hint）；伏笔卡「回收于 X」可点击跳转总览闪烁定位。
15. **派生幕编号**：渲染徽章按数组顺序派生；「重编幕号」工具（renumberActTitles）。
16. **AI 生成节点**：节点编辑器顶部「AI 生成」——一句话提示 + 当前大纲 → 建议节点填入表单确认后保存（suggestBeat）。
17. **独立 API**：custom 模式 OpenAI 兼容直连；获取模型（/v1/models，兼容 OpenAI/Ollama 格式，chip 面板点选）；测试连接（/models 优先，404 降级最小 chat completion）；API 类型下拉。
18. **体检**：verdict/issues/changed/reason + 时间线漂移 + 节点节奏检查点；**体检历史留痕**（meta.checkHistory 10 条，统计行图标序列）；锁定模式下只吸收状态类变更。
19. **快照/导入导出**：自动留快照 30 条可回滚；JSON 导出/导入。
20. **并发友好**：director.isRunning() + UI 忙碌提示。

### 关键实现细节与坑

- **generateRaw 不召回聊天记忆**：只发送传入内容；token 大头只可能来自角色卡，已用字符预算修复（928k token 教训）。
- **不要重新给 generateRaw 传 jsonSchema**：酒馆内置解析不剥 markdown 代码块，llm-client.js 自己用 extractJson 解析。
- **ctx.chatMetadata 引用会过期**：adapter 每次读写都 freshCtx() 重新取 window.SillyTavern.getContext()。
- **yuzuki-Memory 只读集成**：只调 window.YuzukiMemory.* 公开 API（VariableInjector / VectorStore / **Storage.loadState 读指针**）；向量检索需要柚月自己的「注入向量记忆」开关开启。**记忆指针语义**：`state.settings.manualPointers.summary` = 已存储楼层 index，缺失楼层 = chat.length - pointer（task-runner.js 中 summaryEvery 默认 20）。
- **测试注意——settings 引用锁定**：`ensureSettings(ctx)` 会把 ctx.extensionSettings.story_director 的**引用**存进 adapter；测试里若在 createSillyTavernAdapter **之后**重新赋值 `ctx.extensionSettings.story_director = {...}` 会换掉引用导致设置不生效，必须在创建 adapter 之前设置。
- **deploy.ps1 必须纯 ASCII（重大坑）**：Windows PowerShell 5.1 对无 BOM 文件按 ANSI/GBK 读取，UTF-8 中文注释会错乱解析、吞掉后续代码行（导致 $Src 为空、Copy-Item 静默失败、Remove-Item 却执行了——部署一次删空一次插件目录）。脚本内已有注释说明，**不要再加非 ASCII 字符**。部署后务必 `ls` 目标目录验证文件真的在。
- **编辑代码文件时小心 trailing newline**：替换函数签名行时容易把行尾换行吞掉导致两行粘连（`}) {    const x = ...`），改完用 `node --check` 验证。
- **bindSelect 的 after 回调无参数**：不要把事件对象当参数用；select 存的是字符串（'true'/'false'），布尔设置要在 after 里转换。
- **样式规范**：颜色只走 `--sd-*` 变量（白天/夜晚双值），语义浅底用 color-mix；类型徽章等特殊色在暗色块单独覆盖。
- **锁定大纲**：tracker.applyRevision/applyPatch/checker.applyCheckResult 均支持 lockOutline——只推进状态/focus/伏笔，不改写手动编辑内容。
- **数据模型约定**：acts[].beats 是派生的（不要手工维护）；引用完整性交给 normalize；编辑一律走 outline-store 的受控纯函数，不要直接在 UI mutate。
- **生成上下文构成**（按序）：角色卡（预算内，含名录/世界书）→ 用户要求 → 时间线/必读设定 → 节点节奏 → 事实边界（进行中节点）→ 近期对话（指针驱动窗口 + 可提取正文）→ 前情块（done/active 摘要）→ 方向草案 → 记忆摘要 → 向量资料 → 固定指令（四线/新人物许可/JSON 模板）。

### 尚未完成 / 可继续的方向

- ✅ **发布治理已完成**：仓库 https://github.com/huangkun666/story-director（public），homepage 已填，69 个提交 + `v0.11.1` tag 已推送，release 已发（https://github.com/huangkun666/story-director/releases/tag/v0.11.1 ，含 tgz 附件）。后续发新版：`npm pack` 或 tar 打包 → `gh release create` / REST API 传附件。
- UI 层测试仍少（ui-render 部分函数有测，事件绑定靠手动验证）。
- 记忆指针的 UI 展示（如「记忆缺口 N 层」状态显示）——可选。
- 可选：把「必读设定」从 timeline 中拆出为独立字段。
- 可选：操作级撤销（增量变更日志，比整份快照更细）。
- 可选：修订频率默认值（当前 every；可考虑 everyN=3 省 token）。
- 用户可能继续提 UI 细节、token 优化、记忆插件工作流等需求。

### 收尾要求

1. 每改一处逻辑都跑 `node --test --experimental-test-isolation=none "story-director/test/*.test.js"`，确保 210+ 全绿；新增逻辑补测试。
2. 改浏览器侧文件后做语法检查：
   ```bash
   node --check index.js
   node -e "import('file:///mnt/f/deepseek/plugins/story-director/src/ui.js')"
   node -e "import('file:///mnt/f/deepseek/plugins/story-director/src/adapter.js')"
   ```
3. 每个任务单独 git commit，message 英文，`feat:` / `fix:` / `style:` / `refactor:` / `docs:` 前缀。
4. 改完部署：运行 `deploy.ps1`，**部署后 ls 目标目录确认文件存在**（历史教训：曾静默部署失败），提醒用户 Ctrl+Shift+R 硬刷新。
5. 如果改了 yuzuki-Memory 相关逻辑，先确认只是调用公开 API，不要修改柚月插件文件。
