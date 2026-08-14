# story-director（叙事导演）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 开发一个 SillyTavern 扩展插件，通过"双层结构化大纲 + 每轮异步修订 + 用户主动体检"为 RP 生成注入叙事锚点，降低随机性并提升剧情深度。

**Architecture:** 三层结构——UI 面板层（渲染/手动编辑/按钮）、导演引擎层（生成器/追踪器/体检器/注入器）、存储层（`chat_metadata` 中的 JSON 大纲）。纯逻辑模块（store、injector、prompts、llm-client 的解析部分）零依赖可单测；依赖酒馆的部分（director 编排、ui、index 入口）通过 `SillyTavern.getContext()` 在运行时获取 API，不 import 酒馆内部文件。

**Tech Stack:** 原生 ES 模块 JavaScript（浏览器 + Node 单测）、SillyTavern 扩展 API（`manifest.json` + `setExtensionPrompt` + `generateRaw` + `chat_metadata` + `renderExtensionTemplateAsync`）、Node 内置 `node:test`。

## Global Constraints

- 插件命名空间 key：`story_director`（`extension_settings.story_director`）。
- 大纲元数据 key：`story_director`（存于 `chat_metadata`）。
- 注入 `setExtensionPrompt` 的 key：`story_director`。
- 所有 LLM 调用走 `SillyTavern.getContext().generateRaw()`，模型无关，禁止写死任何厂商。
- 扩展目录名：`story-director`；部署目标 `F:\jiuguanai\SillyTavern-Launcher\SillyTavern\public\scripts\extensions\third-party\story-director\`。
- 开发目录：`F:\deepseek\plugins\story-director\`（本仓库根 `F:\deepseek\plugins`）。
- 纯逻辑模块（`outline-store.js`、`injector.js`、`prompts.js`、`llm-client.js` 的解析函数）不得 import 任何酒馆内部文件，只依赖 Node 原生能力。
- Node 版本 v22.15.1；测试命令统一 `node --test <file>`。
- 插件必须失败安全：任何 LLM 调用/解析失败都降级为"沿用旧大纲 + 继续注入"，绝不中断 RP。

---

### Task 1: 项目脚手架与 manifest

**Files:**
- Create: `story-director/manifest.json`
- Create: `story-director/index.js`
- Create: `story-director/style.css`

**Interfaces:**
- Consumes: 无
- Produces:
  - `manifest.json`：`id: "story_director"`、`js: "index.js"`、`css: "style.css"`。
  - `index.js` 导出全局命名空间 `window.STORY_DIRECTOR`（含 `version`、`loaded` 标记）。
  - 后续 Task 的模块文件都放在 `story-director/src/` 下，由 `index.js` import。

- [ ] **Step 1: 创建 manifest.json**

```jsonc
{
  "manifest_version": 1,
  "id": "story_director",
  "display_name": "叙事导演 (Story Director)",
  "version": "0.1.0",
  "description": "双层结构化大纲 + 每轮动态修订，为 RP 生成注入叙事锚点，降低随机性并提升剧情深度。",
  "author": "you",
  "homepage": "",
  "auto_update": false,
  "requires": [],
  "js": "index.js",
  "css": "style.css"
}
```

- [ ] **Step 2: 创建 index.js 骨架**

```javascript
// story-director 入口：加载模块、注册事件、挂载 UI
(function () {
    'use strict';

    const NAMESPACE = 'STORY_DIRECTOR';
    const VERSION = '0.1.0';

    if (window[NAMESPACE]?.loaded) {
        console.warn(`[story-director] Already loaded, skipping duplicate init.`);
        return;
    }

    window[NAMESPACE] = { loaded: true, version: VERSION };

    console.log(`[story-director] v${VERSION} loaded.`);
})();
```

- [ ] **Step 3: 创建 style.css 骨架**

```css
/* story-director 样式占位，后续 Task 补充 */
#story_director_panel { padding: 8px; }
```

- [ ] **Step 4: 语法自检并提交**

```bash
cd F:\deepseek\plugins
git add story-director
git commit -m "feat: add story-director scaffold (manifest + entry)"
```

---

### Task 2: outline-store —— 大纲数据模型与校验

**Files:**
- Create: `story-director/src/outline-store.js`
- Test: `story-director/test/outline-store.test.js`

**Interfaces:**
- Consumes: 无（纯逻辑）
- Produces:
  - `createEmptyOutline()` → `object`（默认空大纲）
  - `normalizeOutline(raw)` → `object`（校验+补默认值，永不抛错）
  - `serializeOutline(outline)` → `string`（JSON 字符串）
  - `deserializeOutline(json)` → `object`（容错解析，失败返回空大纲）

- [ ] **Step 1: 写失败测试**

```javascript
// story-director/test/outline-store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyOutline, normalizeOutline, serializeOutline, deserializeOutline } from '../src/outline-store.js';

test('createEmptyOutline returns valid empty structure', () => {
    const o = createEmptyOutline();
    assert.equal(o.version, 1);
    assert.equal(typeof o.theme, 'string');
    assert.equal(typeof o.tone, 'string');
    assert.equal(typeof o.world, 'string');
    assert.ok(Array.isArray(o.arcs));
    assert.ok(Array.isArray(o.foreshadowing));
    assert.ok(Array.isArray(o.beats));
    assert.equal(typeof o.focus, 'object');
    assert.equal(typeof o.focus.currentBeat, 'string');
    assert.equal(typeof o.focus.nextStep, 'string');
    assert.ok(Array.isArray(o.focus.activeForeshadow));
    assert.equal(typeof o.focus.avoidOffTopic, 'string');
});

test('normalizeOutline fills missing fields with defaults', () => {
    const o = normalizeOutline({ version: 1, theme: 'X' });
    assert.equal(o.theme, 'X');
    assert.equal(typeof o.tone, 'string');
    assert.ok(Array.isArray(o.beats));
    assert.equal(typeof o.focus, 'object');
});

test('normalizeOutline coerces invalid status values', () => {
    const o = normalizeOutline({
        beats: [{ id: 'b1', title: 't', summary: 's', status: 'bogus' }],
        foreshadowing: [{ id: 'f1', hint: 'h', status: 'bogus', payoff: '' }],
    });
    assert.equal(o.beats[0].status, 'pending');
    assert.equal(o.foreshadowing[0].status, 'pending');
});

test('normalizeOutline repairs dangling focus.currentBeat', () => {
    const o = normalizeOutline({
        beats: [{ id: 'b1', title: 't', summary: 's', status: 'active' }],
        focus: { currentBeat: 'nope' },
    });
    assert.equal(o.focus.currentBeat, 'b1');
});

test('deserializeOutline returns empty on invalid JSON', () => {
    const o = deserializeOutline('not json {');
    assert.equal(o.version, 1);
});

test('serialize/deserialize roundtrip', () => {
    const o = createEmptyOutline();
    o.theme = '背叛与救赎';
    const back = deserializeOutline(serializeOutline(o));
    assert.equal(back.theme, '背叛与救赎');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test story-director/test/outline-store.test.js`
Expected: FAIL（`Cannot find module '../src/outline-store.js'`）

- [ ] **Step 3: 实现 outline-store.js**

```javascript
// story-director/src/outline-store.js
// 纯逻辑：大纲数据模型、默认值、校验。零依赖。

export const OUTLINE_VERSION = 1;

const VALID_BEAT_STATUS = new Set(['pending', 'active', 'done']);
const VALID_FORESHADOW_STATUS = new Set(['pending', 'active', 'paid']);

export function createEmptyOutline() {
    return {
        version: OUTLINE_VERSION,
        theme: '',
        tone: '',
        world: '',
        arcs: [],
        foreshadowing: [],
        beats: [],
        focus: {
            currentBeat: '',
            nextStep: '',
            activeForeshadow: [],
            avoidOffTopic: '',
        },
        meta: { updatedAt: '', revisionCount: 0 },
    };
}

function asString(v, d = '') {
    return typeof v === 'string' ? v : d;
}

function normalizeBeat(b) {
    if (!b || typeof b !== 'object') return null;
    const id = asString(b.id, '');
    if (!id) return null;
    return {
        id,
        title: asString(b.title, ''),
        summary: asString(b.summary, ''),
        status: VALID_BEAT_STATUS.has(b.status) ? b.status : 'pending',
    };
}

function normalizeForeshadow(f) {
    if (!f || typeof f !== 'object') return null;
    const id = asString(f.id, '');
    if (!id) return null;
    return {
        id,
        hint: asString(f.hint, ''),
        status: VALID_FORESHADOW_STATUS.has(f.status) ? f.status : 'pending',
        payoff: asString(f.payoff, ''),
    };
}

function normalizeArc(a) {
    if (!a || typeof a !== 'object') return null;
    const char = asString(a.char, '');
    if (!char) return null;
    return {
        char,
        desire: asString(a.desire, ''),
        flaw: asString(a.flaw, ''),
        growth: asString(a.growth, ''),
    };
}

export function normalizeOutline(raw) {
    const base = createEmptyOutline();
    if (!raw || typeof raw !== 'object') return base;

    base.version = OUTLINE_VERSION;
    base.theme = asString(raw.theme, '');
    base.tone = asString(raw.tone, '');
    base.world = asString(raw.world, '');
    base.arcs = Array.isArray(raw.arcs) ? raw.arcs.map(normalizeArc).filter(Boolean) : [];
    base.foreshadowing = Array.isArray(raw.foreshadowing) ? raw.foreshadowing.map(normalizeForeshadow).filter(Boolean) : [];
    base.beats = Array.isArray(raw.beats) ? raw.beats.map(normalizeBeat).filter(Boolean) : [];

    const focus = (raw.focus && typeof raw.focus === 'object') ? raw.focus : {};
    base.focus.currentBeat = asString(focus.currentBeat, '');
    base.focus.nextStep = asString(focus.nextStep, '');
    base.focus.activeForeshadow = Array.isArray(focus.activeForeshadow)
        ? focus.activeForeshadow.map(x => asString(x, '')).filter(Boolean)
        : [];
    base.focus.avoidOffTopic = asString(focus.avoidOffTopic, '');

    // 修复悬空的 currentBeat
    if (base.focus.currentBeat && !base.beats.some(b => b.id === base.focus.currentBeat)) {
        const firstActiveOrPending = base.beats.find(b => b.status === 'active' || b.status === 'pending');
        base.focus.currentBeat = firstActiveOrPending ? firstActiveOrPending.id : '';
    }

    const meta = (raw.meta && typeof raw.meta === 'object') ? raw.meta : {};
    base.meta.updatedAt = asString(meta.updatedAt, '');
    base.meta.revisionCount = Number.isFinite(meta.revisionCount) ? Math.max(0, Math.floor(meta.revisionCount)) : 0;

    return base;
}

export function serializeOutline(outline) {
    return JSON.stringify(normalizeOutline(outline), null, 2);
}

export function deserializeOutline(json) {
    if (typeof json !== 'string') return createEmptyOutline();
    try {
        return normalizeOutline(JSON.parse(json));
    } catch {
        return createEmptyOutline();
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test story-director/test/outline-store.test.js`
Expected: PASS（6/6）

- [ ] **Step 5: 提交**

```bash
cd F:\deepseek\plugins
git add story-director/src/outline-store.js story-director/test/outline-store.test.js
git commit -m "feat: add outline data model with validation"
```

---

### Task 3: prompts —— 提示词模板与 JSON Schema 定义

**Files:**
- Create: `story-director/src/prompts.js`
- Test: `story-director/test/prompts.test.js`

**Interfaces:**
- Consumes: 无（纯逻辑）
- Produces:
  - `OUTLINE_SCHEMA` → `object`（大纲的 JSON Schema，传给 `generateRaw` 的 `jsonSchema.value`）
  - `CHECK_SCHEMA` → `object`（体检报告的 JSON Schema）
  - `buildGeneratePrompt({ characterCard, userRequest, detail })` → `{ system, prompt }`
  - `buildRevisePrompt({ recentDialogue, outline })` → `{ system, prompt }`
  - `buildCheckPrompt({ recentDialogue, outline })` → `{ system, prompt }`
  - `buildDirectorInstruction(outline, strength)` → `string`（注入用导演指令，见 Task 4，此处仅放实现）

- [ ] **Step 1: 写失败测试**

```javascript
// story-director/test/prompts.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    OUTLINE_SCHEMA, CHECK_SCHEMA,
    buildGeneratePrompt, buildRevisePrompt, buildCheckPrompt, buildDirectorInstruction,
} from '../src/prompts.js';
import { createEmptyOutline } from '../src/outline-store.js';

test('OUTLINE_SCHEMA describes required top-level fields', () => {
    assert.equal(OUTLINE_SCHEMA.type, 'object');
    const required = OUTLINE_SCHEMA.required;
    assert.ok(required.includes('theme'));
    assert.ok(required.includes('beats'));
    assert.ok(required.includes('focus'));
});

test('CHECK_SCHEMA describes verdict and changed', () => {
    const required = CHECK_SCHEMA.required;
    assert.ok(required.includes('verdict'));
    assert.ok(required.includes('changed'));
});

test('buildGeneratePrompt includes character card and user request', () => {
    const { prompt } = buildGeneratePrompt({
        characterCard: { name: 'Alice', description: 'a witch' },
        userRequest: '悲剧结局',
        detail: 'medium',
    });
    assert.ok(prompt.includes('Alice'));
    assert.ok(prompt.includes('a witch'));
    assert.ok(prompt.includes('悲剧结局'));
});

test('buildRevisePrompt includes dialogue and outline', () => {
    const o = createEmptyOutline();
    o.theme = '复仇';
    const { prompt } = buildRevisePrompt({ recentDialogue: 'A: 你好', outline: o });
    assert.ok(prompt.includes('你好'));
    assert.ok(prompt.includes('复仇'));
});

test('buildCheckPrompt includes dialogue and outline', () => {
    const o = createEmptyOutline();
    o.world = '魔法大陆';
    const { prompt } = buildCheckPrompt({ recentDialogue: 'B: 再见', outline: o });
    assert.ok(prompt.includes('再见'));
    assert.ok(prompt.includes('魔法大陆'));
});

test('buildDirectorInstruction includes focus fields and strength', () => {
    const o = createEmptyOutline();
    o.focus.currentBeat = 'b1';
    o.focus.nextStep = '进入森林';
    o.focus.activeForeshadow = ['f1'];
    o.focus.avoidOffTopic = '别聊天气';
    const s = buildDirectorInstruction(o, 'strong');
    assert.ok(s.includes('b1'));
    assert.ok(s.includes('进入森林'));
    assert.ok(s.includes('f1'));
    assert.ok(s.includes('别聊天气'));
    assert.ok(s.includes('必须'));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test story-director/test/prompts.test.js`
Expected: FAIL（`Cannot find module '../src/prompts.js'`）

- [ ] **Step 3: 实现 prompts.js**

```javascript
// story-director/src/prompts.js
// 纯逻辑：提示词模板与 JSON Schema。零依赖。
import { serializeOutline } from './outline-store.js';

export const OUTLINE_SCHEMA = {
    type: 'object',
    additionalProperties: true,
    required: ['theme', 'tone', 'world', 'arcs', 'foreshadowing', 'beats', 'focus'],
    properties: {
        theme: { type: 'string', description: '故事主题' },
        tone: { type: 'string', description: '情绪基调' },
        world: { type: 'string', description: '世界观与冲突根源' },
        arcs: {
            type: 'array',
            items: {
                type: 'object',
                required: ['char', 'desire', 'flaw', 'growth'],
                properties: {
                    char: { type: 'string' },
                    desire: { type: 'string' },
                    flaw: { type: 'string' },
                    growth: { type: 'string' },
                },
            },
        },
        foreshadowing: {
            type: 'array',
            items: {
                type: 'object',
                required: ['id', 'hint', 'status', 'payoff'],
                properties: {
                    id: { type: 'string' },
                    hint: { type: 'string' },
                    status: { type: 'string', enum: ['pending', 'active', 'paid'] },
                    payoff: { type: 'string' },
                },
            },
        },
        beats: {
            type: 'array',
            items: {
                type: 'object',
                required: ['id', 'title', 'summary', 'status'],
                properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                    summary: { type: 'string' },
                    status: { type: 'string', enum: ['pending', 'active', 'done'] },
                },
            },
        },
        focus: {
            type: 'object',
            required: ['currentBeat', 'nextStep', 'activeForeshadow', 'avoidOffTopic'],
            properties: {
                currentBeat: { type: 'string' },
                nextStep: { type: 'string' },
                activeForeshadow: { type: 'array', items: { type: 'string' } },
                avoidOffTopic: { type: 'string' },
            },
        },
    },
};

export const CHECK_SCHEMA = {
    type: 'object',
    additionalProperties: true,
    required: ['verdict', 'issues', 'changed', 'changes', 'reason'],
    properties: {
        verdict: { type: 'string', enum: ['sync', 'minor-drift', 'major-drift'] },
        issues: {
            type: 'array',
            items: {
                type: 'object',
                required: ['where', 'what', 'severity'],
                properties: {
                    where: { type: 'string' },
                    what: { type: 'string' },
                    severity: { type: 'string', enum: ['low', 'mid', 'high'] },
                },
            },
        },
        changed: { type: 'boolean' },
        changes: { type: 'string' },
        reason: { type: 'string' },
    },
};

function cardToText(card) {
    const c = card || {};
    return [
        c.name ? `角色名：${c.name}` : '',
        c.description ? `角色描述：${c.description}` : '',
        c.personality ? `性格：${c.personality}` : '',
        c.scenario ? `场景：${c.scenario}` : '',
        c.first_mes ? `开场白：${c.first_mes}` : '',
        c.mes_example ? `示例对话：${c.mes_example}` : '',
        c.system_prompt ? `系统提示：${c.system_prompt}` : '',
        c.worldbook ? `世界书：${c.worldbook}` : '',
    ].filter(Boolean).join('\n');
}

export function buildGeneratePrompt({ characterCard, userRequest = '', detail = 'medium' }) {
    const detailWord = { low: '简洁', medium: '适中', high: '详尽' }[detail] || '适中';
    const system = '你是一位资深叙事设计师。根据角色卡和用户要求，构建一份结构化的故事大纲（JSON）。只输出符合 schema 的 JSON，不要任何解释。';
    const prompt = `请为以下角色扮演构建一份${detailWord}的完整故事大纲。

【角色卡】
${cardToText(characterCard)}

【用户要求】
${userRequest || '（未指定，请自行设计一个有深度的故事方向）'}

请输出包含：主题(theme)、情绪基调(tone)、世界观与冲突根源(world)、角色弧光(arcs)、伏笔(foreshadowing)、情节节点(beats，含起承转合，至少3个)、当前焦点(focus)。`;
    return { system, prompt };
}

export function buildRevisePrompt({ recentDialogue = '', outline }) {
    const system = '你是叙事导演。根据最近的对话进展，更新故事大纲（JSON）。只输出符合 schema 的更新后完整大纲，不要任何解释。';
    const prompt = `【最近对话】
${recentDialogue}

【当前大纲】
${serializeOutline(outline)}

请执行：1) 判断当前情节节点是否完成，若完成则推进到下一个节点；2) 若剧情偏离当前方向，将其吸收进大纲（改写 nextStep 或插入新 beat），而非强行拉回；3) 更新伏笔状态（标记已回收的，记录新埋下的）。输出更新后的完整大纲。`;
    return { system, prompt };
}

export function buildCheckPrompt({ recentDialogue = '', outline }) {
    const system = '你是叙事导演。对比最近对话与当前大纲，输出同步性诊断报告（JSON）。只输出符合 schema 的 JSON。';
    const prompt = `【最近对话】
${recentDialogue}

【当前大纲】
${serializeOutline(outline)}

请判断大纲是否仍与剧情同步。verdict 取 sync / minor-drift / major-drift。若需要修改，changed=true 并在 changes 里说明改了什么；若无需修改，changed=false 且 reason 说明为何仍适用。`;
    return { system, prompt };
}

export function buildDirectorInstruction(outline, strength = 'strong') {
    const f = outline?.focus || {};
    const lines = [];
    lines.push('【叙事导演指令】');
    if (strength === 'strong') {
        lines.push('你必须严格遵循以下剧情方向推进，不得偏离：');
    } else {
        lines.push('请参考以下剧情方向，尽量朝此推进：');
    }
    if (f.currentBeat) lines.push(`- 当前情节节点：${f.currentBeat}`);
    if (f.nextStep) lines.push(`- 下一步应当发生：${f.nextStep}`);
    if (Array.isArray(f.activeForeshadow) && f.activeForeshadow.length) {
        lines.push(`- 活跃伏笔：${f.activeForeshadow.join('、')}`);
    }
    if (f.avoidOffTopic) lines.push(`- 避免偏离：${f.avoidOffTopic}`);
    return lines.join('\n');
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test story-director/test/prompts.test.js`
Expected: PASS（6/6）

- [ ] **Step 5: 提交**

```bash
cd F:\deepseek\plugins
git add story-director/src/prompts.js story-director/test/prompts.test.js
git commit -m "feat: add prompt templates and JSON schemas"
```

---

### Task 4: llm-client —— LLM 调用封装与容错解析

**Files:**
- Create: `story-director/src/llm-client.js`
- Test: `story-director/test/llm-client.test.js`

**Interfaces:**
- Consumes: 无（纯逻辑部分）；`generateRaw` 由调用方注入（见 Task 5）
- Produces:
  - `extractJson(text)` → `object|null`（容错解析：纯 JSON / markdown 代码块 / 非法）
  - `stripCodeFence(text)` → `string`
  - `makeStructuredGenerator(generateRaw, schema)` → `async (promptBundle) => object|null`（调用 generateRaw 并解析，失败返回 null）

- [ ] **Step 1: 写失败测试**

```javascript
// story-director/test/llm-client.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, stripCodeFence, makeStructuredGenerator } from '../src/llm-client.js';

test('extractJson parses plain JSON', () => {
    const r = extractJson('{"a":1}');
    assert.deepEqual(r, { a: 1 });
});

test('extractJson parses markdown-fenced JSON', () => {
    const r = extractJson('```json\n{"a":1}\n```');
    assert.deepEqual(r, { a: 1 });
});

test('extractJson returns null on invalid JSON', () => {
    assert.equal(extractJson('not json'), null);
});

test('extractJson returns null on empty input', () => {
    assert.equal(extractJson(''), null);
});

test('stripCodeFence removes surrounding fences', () => {
    assert.equal(stripCodeFence('```\nhello\n```'), 'hello');
    assert.equal(stripCodeFence('plain'), 'plain');
});

test('makeStructuredGenerator returns parsed object on success', async () => {
    const fakeGen = async () => '{"theme":"X"}';
    const gen = makeStructuredGenerator(fakeGen, { type: 'object' });
    const r = await gen({ system: 's', prompt: 'p' });
    assert.deepEqual(r, { theme: 'X' });
});

test('makeStructuredGenerator returns null on parse failure', async () => {
    const fakeGen = async () => 'garbage';
    const gen = makeStructuredGenerator(fakeGen, { type: 'object' });
    const r = await gen({ system: 's', prompt: 'p' });
    assert.equal(r, null);
});

test('makeStructuredGenerator returns null when generateRaw throws', async () => {
    const fakeGen = async () => { throw new Error('boom'); };
    const gen = makeStructuredGenerator(fakeGen, { type: 'object' });
    const r = await gen({ system: 's', prompt: 'p' });
    assert.equal(r, null);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test story-director/test/llm-client.test.js`
Expected: FAIL（module not found）

- [ ] **Step 3: 实现 llm-client.js**

```javascript
// story-director/src/llm-client.js
// 纯逻辑：LLM 输出容错解析。generateRaw 由调用方注入。

export function stripCodeFence(text) {
    if (typeof text !== 'string') return '';
    let t = text.trim();
    // 剥离 ```json / ``` 围栏
    const fence = t.match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/);
    if (fence) return fence[1].trim();
    return t;
}

export function extractJson(text) {
    if (typeof text !== 'string') return null;
    const cleaned = stripCodeFence(text);
    if (!cleaned) return null;
    try {
        return JSON.parse(cleaned);
    } catch {
        // 尝试从文本中提取第一个 {...} 或 [...] 片段
        const match = cleaned.match(/[\{\[][\s\S]*[\}\]]/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]);
        } catch {
            return null;
        }
    }
}

export function makeStructuredGenerator(generateRaw, schema) {
    return async function generate({ system = '', prompt = '' }) {
        try {
            const result = await generateRaw({
                prompt,
                systemPrompt: system,
                jsonSchema: {
                    name: 'story_director_output',
                    description: 'Structured output for story-director',
                    value: schema,
                    strict: true,
                },
            });
            return extractJson(result);
        } catch (err) {
            console.warn('[story-director] structured generation failed:', err);
            return null;
        }
    };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test story-director/test/llm-client.test.js`
Expected: PASS（8/8）

- [ ] **Step 5: 提交**

```bash
cd F:\deepseek\plugins
git add story-director/src/llm-client.js story-director/test/llm-client.test.js
git commit -m "feat: add LLM client with fault-tolerant JSON parsing"
```

---

### Task 5: injector —— 注入器（渲染导演指令 + 长度截断）

**Files:**
- Create: `story-director/src/injector.js`
- Test: `story-director/test/injector.test.js`

**Interfaces:**
- Consumes:
  - `buildDirectorInstruction(outline, strength)` from `prompts.js`
- Produces:
  - `truncateByApproxTokens(text, limit)` → `string`（按近似 token 截断：中文按字符、英文按词）
  - `renderInstruction(outline, { strength, tokenLimit })` → `string`

- [ ] **Step 1: 写失败测试**

```javascript
// story-director/test/injector.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncateByApproxTokens, renderInstruction } from '../src/injector.js';
import { createEmptyOutline } from '../src/outline-store.js';

test('truncateByApproxTokens returns short text unchanged', () => {
    assert.equal(truncateByApproxTokens('hello world', 100), 'hello world');
});

test('truncateByApproxTokens truncates long english text by words', () => {
    const s = 'one two three four five six';
    const r = truncateByApproxTokens(s, 3);
    assert.ok(r.length < s.length);
    assert.ok(r.endsWith('…'));
});

test('truncateByApproxTokens truncates long chinese text by chars', () => {
    const s = '一二三四五六七八九十';
    const r = truncateByApproxTokens(s, 3);
    assert.ok(r.length < s.length);
});

test('renderInstruction includes director text', () => {
    const o = createEmptyOutline();
    o.focus.nextStep = '进入城堡';
    const s = renderInstruction(o, { strength: 'strong', tokenLimit: 500 });
    assert.ok(s.includes('进入城堡'));
});

test('renderInstruction returns empty string when focus empty', () => {
    const o = createEmptyOutline();
    const s = renderInstruction(o, { strength: 'strong', tokenLimit: 500 });
    assert.equal(s, '');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test story-director/test/injector.test.js`
Expected: FAIL（module not found）

- [ ] **Step 3: 实现 injector.js**

```javascript
// story-director/src/injector.js
// 纯逻辑：把大纲 focus 渲染成导演指令并截断。零依赖。
import { buildDirectorInstruction } from './prompts.js';

export function truncateByApproxTokens(text, limit) {
    if (typeof text !== 'string') return '';
    if (limit <= 0) return '';
    const trimmed = text.trim();
    if (!trimmed) return '';
    // 中文按字符近似，英文按空格分词近似
    const hasCJK = /[\u4e00-\u9fff]/.test(trimmed);
    if (hasCJK) {
        if (trimmed.length <= limit) return trimmed;
        return trimmed.slice(0, limit) + '…';
    }
    const words = trimmed.split(/\s+/);
    if (words.length <= limit) return trimmed;
    return words.slice(0, limit).join(' ') + ' …';
}

export function renderInstruction(outline, { strength = 'strong', tokenLimit = 300 } = {}) {
    const f = outline?.focus;
    const hasContent = f && (f.currentBeat || f.nextStep || (f.activeForeshadow && f.activeForeshadow.length) || f.avoidOffTopic);
    if (!hasContent) return '';
    const full = buildDirectorInstruction(outline, strength);
    return truncateByApproxTokens(full, tokenLimit);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test story-director/test/injector.test.js`
Expected: PASS（5/5）

- [ ] **Step 5: 提交**

```bash
cd F:\deepseek\plugins
git add story-director/src/injector.js story-director/test/injector.test.js
git commit -m "feat: add injector with instruction rendering and truncation"
```

---

### Task 6: tracker —— 情节追踪器（每轮自动修订的状态合并）

**Files:**
- Create: `story-director/src/tracker.js`
- Test: `story-director/test/tracker.test.js`

**Interfaces:**
- Consumes:
  - `normalizeOutline` from `outline-store.js`
- Produces:
  - `applyRevision(prevOutline, revisionPatch)` → `object`（把 LLM 返回的修订结果合并进现有大纲；补 meta）

- [ ] **Step 1: 写失败测试**

```javascript
// story-director/test/tracker.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRevision } from '../src/tracker.js';
import { createEmptyOutline } from '../src/outline-store.js';

test('applyRevision merges revision fields into outline', () => {
    const prev = createEmptyOutline();
    prev.theme = '复仇';
    const patch = createEmptyOutline();
    patch.theme = '救赎';
    patch.beats = [{ id: 'b1', title: '开端', summary: 's', status: 'active' }];
    const out = applyRevision(prev, patch);
    assert.equal(out.theme, '救赎');
    assert.equal(out.beats.length, 1);
});

test('applyRevision increments revisionCount', () => {
    const prev = createEmptyOutline();
    prev.meta.revisionCount = 3;
    const out = applyRevision(prev, createEmptyOutline());
    assert.equal(out.meta.revisionCount, 4);
});

test('applyRevision returns prev unchanged when patch is null', () => {
    const prev = createEmptyOutline();
    prev.theme = 'X';
    const out = applyRevision(prev, null);
    assert.equal(out.theme, 'X');
    assert.equal(out.meta.revisionCount, 0);
});

test('applyRevision sets updatedAt to non-empty', () => {
    const out = applyRevision(createEmptyOutline(), createEmptyOutline());
    assert.ok(typeof out.meta.updatedAt === 'string');
    assert.ok(out.meta.updatedAt.length > 0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test story-director/test/tracker.test.js`
Expected: FAIL（module not found）

- [ ] **Step 3: 实现 tracker.js**

```javascript
// story-director/src/tracker.js
// 纯逻辑：把 LLM 修订结果合并进现有大纲。零依赖。
import { normalizeOutline } from './outline-store.js';

export function applyRevision(prevOutline, revisionPatch) {
    if (!revisionPatch) return prevOutline;
    const merged = normalizeOutline(revisionPatch);
    merged.meta.revisionCount = (prevOutline?.meta?.revisionCount ?? 0) + 1;
    merged.meta.updatedAt = new Date().toISOString();
    return merged;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test story-director/test/tracker.test.js`
Expected: PASS（4/4）

- [ ] **Step 5: 提交**

```bash
cd F:\deepseek\plugins
git add story-director/src/tracker.js story-director/test/tracker.test.js
git commit -m "feat: add tracker with revision merge logic"
```

---

### Task 7: checker —— 大纲体检器（诊断报告解析）

**Files:**
- Create: `story-director/src/checker.js`
- Test: `story-director/test/checker.test.js`

**Interfaces:**
- Consumes:
  - `normalizeOutline` from `outline-store.js`
- Produces:
  - `applyCheckResult(outline, report)` → `{ outline, report }`（`report` 为归一化诊断报告；`outline` 为应用修改后的大纲或原大纲）
  - `normalizeReport(raw)` → `object`

- [ ] **Step 1: 写失败测试**

```javascript
// story-director/test/checker.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCheckResult, normalizeReport } from '../src/checker.js';
import { createEmptyOutline } from '../src/outline-store.js';

test('normalizeReport fills missing fields with defaults', () => {
    const r = normalizeReport({ verdict: 'sync' });
    assert.equal(r.verdict, 'sync');
    assert.equal(r.changed, false);
    assert.ok(Array.isArray(r.issues));
    assert.equal(typeof r.reason, 'string');
});

test('applyCheckResult keeps outline when report.changed is false', () => {
    const o = createEmptyOutline();
    o.theme = 'X';
    const { outline, report } = applyCheckResult(o, { verdict: 'sync', changed: false });
    assert.equal(outline.theme, 'X');
    assert.equal(report.changed, false);
});

test('applyCheckResult applies modified outline when changed is true', () => {
    const o = createEmptyOutline();
    o.theme = 'old';
    const newOutline = createEmptyOutline();
    newOutline.theme = 'new';
    const { outline, report } = applyCheckResult(o, {
        verdict: 'major-drift',
        changed: true,
        changes: '调整主题',
        updatedOutline: newOutline,
    });
    assert.equal(outline.theme, 'new');
    assert.equal(report.changed, true);
});

test('applyCheckResult handles null report gracefully', () => {
    const o = createEmptyOutline();
    const { outline, report } = applyCheckResult(o, null);
    assert.equal(outline, o);
    assert.equal(report.verdict, 'sync');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test story-director/test/checker.test.js`
Expected: FAIL（module not found）

- [ ] **Step 3: 实现 checker.js**

```javascript
// story-director/src/checker.js
// 纯逻辑：体检诊断报告的归一化与大纲应用。零依赖。
import { normalizeOutline } from './outline-store.js';

const VALID_VERDICT = new Set(['sync', 'minor-drift', 'major-drift']);

export function normalizeReport(raw) {
    const r = (raw && typeof raw === 'object') ? raw : {};
    return {
        verdict: VALID_VERDICT.has(r.verdict) ? r.verdict : 'sync',
        issues: Array.isArray(r.issues) ? r.issues : [],
        changed: r.changed === true,
        changes: typeof r.changes === 'string' ? r.changes : '',
        reason: typeof r.reason === 'string' ? r.reason : '',
    };
}

export function applyCheckResult(outline, rawReport) {
    const report = normalizeReport(rawReport);
    if (!report.changed) {
        return { outline, report };
    }
    // 若模型给出了更新后的大纲，则使用之；否则保留原大纲（不破坏数据）
    const updated = rawReport && rawReport.updatedOutline ? normalizeOutline(rawReport.updatedOutline) : outline;
    return { outline: updated, report };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test story-director/test/checker.test.js`
Expected: PASS（4/4）

- [ ] **Step 5: 提交**

```bash
cd F:\deepseek\plugins
git add story-director/src/checker.js story-director/test/checker.test.js
git commit -m "feat: add checker with diagnostic report handling"
```

---

### Task 8: director —— 导演引擎编排（生成/修订/体检 + 并发控制）

**Files:**
- Create: `story-director/src/director.js`
- Test: `story-director/test/director.test.js`

**Interfaces:**
- Consumes:
  - `normalizeOutline`, `createEmptyOutline` from `outline-store.js`
  - `buildGeneratePrompt`, `buildRevisePrompt`, `buildCheckPrompt`, `OUTLINE_SCHEMA`, `CHECK_SCHEMA` from `prompts.js`
  - `makeStructuredGenerator` from `llm-client.js`
  - `applyRevision` from `tracker.js`
  - `applyCheckResult` from `checker.js`
  - `renderInstruction` from `injector.js`
- Produces:
  - `createDirector(deps)` → director 对象，`deps` = `{ generateRaw, getOutline, setOutline, setInjectedInstruction, getSettings, getRecentDialogue, getCharacterCard, renderOutline }`
  - director 方法：`generate()`, `revise()`, `check()`, `refreshInjection()`

**设计说明**：director 是纯编排逻辑，所有酒馆能力（generateRaw、读写大纲、读对话、读角色卡、写注入、刷新 UI）都通过 `deps` 注入，因此可在 Node 中单测。

- [ ] **Step 1: 写失败测试**

```javascript
// story-director/test/director.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDirector } from '../src/director.js';
import { createEmptyOutline } from '../src/outline-store.js';

function makeDeps(overrides = {}) {
    let stored = createEmptyOutline();
    const calls = [];
    return {
        calls,
        deps: {
            generateRaw: async () => JSON.stringify(createEmptyOutline()),
            getOutline: () => stored,
            setOutline: (o) => { stored = o; },
            setInjectedInstruction: (text) => { calls.push(['inject', text]); },
            getSettings: () => ({ enabled: true, controlStrength: 'strong', injectTokenLimit: 300, recentTurns: 5 }),
            getRecentDialogue: () => 'A: 你好',
            getCharacterCard: () => ({ name: 'Alice' }),
            renderOutline: () => { calls.push(['render']); },
            ...overrides,
        },
    };
}

test('director.refreshInjection writes instruction when enabled', () => {
    const { deps, calls } = makeDeps();
    const d = createDirector(deps);
    d.refreshInjection();
    assert.ok(calls.some(([k]) => k === 'inject'));
});

test('director.refreshInjection clears injection when disabled', () => {
    const { deps, calls } = makeDeps({
        getSettings: () => ({ enabled: false, controlStrength: 'strong', injectTokenLimit: 300, recentTurns: 5 }),
    });
    const d = createDirector(deps);
    d.refreshInjection();
    assert.deepEqual(calls, [['inject', '']]);
});

test('director.generate writes outline and refreshes', async () => {
    const { deps, calls } = makeDeps();
    const d = createDirector(deps);
    await d.generate({ userRequest: '悲剧' });
    assert.ok(calls.some(([k]) => k === 'render'));
});

test('director.revise skips when already running (concurrency guard)', async () => {
    let running = true;
    const { deps } = makeDeps({
        generateRaw: async () => { await new Promise(r => setTimeout(r, 20)); return JSON.stringify(createEmptyOutline()); },
    });
    const d = createDirector(deps);
    const p1 = d.revise();
    running = false;
    const p2 = d.revise();
    await Promise.all([p1, p2]);
    assert.equal(deps.getOutline().meta.revisionCount, 1); // 第二次被并发守卫丢弃
});

test('director.revise keeps old outline when LLM returns null', async () => {
    const { deps } = makeDeps({ generateRaw: async () => 'garbage' });
    const d = createDirector(deps);
    const before = deps.getOutline();
    await d.revise();
    assert.equal(deps.getOutline(), before);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test story-director/test/director.test.js`
Expected: FAIL（module not found）

- [ ] **Step 3: 实现 director.js**

```javascript
// story-director/src/director.js
// 纯编排逻辑：生成/修订/体检/注入。所有酒馆能力经 deps 注入。
import { normalizeOutline, createEmptyOutline } from './outline-store.js';
import { buildGeneratePrompt, buildRevisePrompt, buildCheckPrompt, OUTLINE_SCHEMA, CHECK_SCHEMA } from './prompts.js';
import { makeStructuredGenerator } from './llm-client.js';
import { applyRevision } from './tracker.js';
import { applyCheckResult } from './checker.js';
import { renderInstruction } from './injector.js';

export function createDirector(deps) {
    let running = false;

    const gen = makeStructuredGenerator(deps.generateRaw, OUTLINE_SCHEMA);
    const genCheck = makeStructuredGenerator(deps.generateRaw, CHECK_SCHEMA);

    function refreshInjection() {
        const settings = deps.getSettings();
        if (!settings.enabled) {
            deps.setInjectedInstruction('');
            return;
        }
        const outline = deps.getOutline();
        const text = renderInstruction(outline, {
            strength: settings.controlStrength,
            tokenLimit: settings.injectTokenLimit,
        });
        deps.setInjectedInstruction(text);
    }

    async function generate({ userRequest = '' } = {}) {
        if (running) return null;
        running = true;
        try {
            const settings = deps.getSettings();
            const card = deps.getCharacterCard();
            const bundle = buildGeneratePrompt({ characterCard: card, userRequest, detail: settings.outlineDetail || 'medium' });
            const result = await gen(bundle);
            if (result) {
                deps.setOutline(normalizeOutline(result));
                deps.renderOutline();
            }
            refreshInjection();
            return result;
        } finally {
            running = false;
        }
    }

    async function revise() {
        if (running) return null;
        running = true;
        try {
            const settings = deps.getSettings();
            const dialogue = deps.getRecentDialogue(settings.recentTurns ?? 5);
            const outline = deps.getOutline();
            const bundle = buildRevisePrompt({ recentDialogue: dialogue, outline });
            const result = await gen(bundle);
            if (result) {
                deps.setOutline(applyRevision(outline, result));
                deps.renderOutline();
            }
            refreshInjection();
            return result;
        } finally {
            running = false;
        }
    }

    async function check() {
        if (running) return null;
        running = true;
        try {
            const settings = deps.getSettings();
            const dialogue = deps.getRecentDialogue(settings.recentTurns ?? 5);
            const outline = deps.getOutline();
            const bundle = buildCheckPrompt({ recentDialogue: dialogue, outline });
            const report = await genCheck(bundle);
            const { outline: updated, report: normalizedReport } = applyCheckResult(outline, report);
            if (normalizedReport.changed) {
                deps.setOutline(updated);
                deps.renderOutline();
            }
            refreshInjection();
            return normalizedReport;
        } finally {
            running = false;
        }
    }

    return { generate, revise, check, refreshInjection };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test story-director/test/director.test.js`
Expected: PASS（5/5）

- [ ] **Step 5: 提交**

```bash
cd F:\deepseek\plugins
git add story-director/src/director.js story-director/test/director.test.js
git commit -m "feat: add director orchestration with concurrency guard"
```

---

### Task 9: 酒馆适配层 —— 连接 director 与 SillyTavern 运行时

**Files:**
- Create: `story-director/src/adapter.js`

**Interfaces:**
- Consumes:
  - `createDirector` from `director.js`
  - `normalizeOutline`, `createEmptyOutline`, `deserializeOutline`, `serializeOutline` from `outline-store.js`
- Produces:
  - `createSillyTavernAdapter(ctx)` → `{ director, getOutline, setOutline, load, save, getCharacterCard, getRecentDialogue, renderOutline }`
  - `ctx` 为 `SillyTavern.getContext()` 的返回值。

**设计说明**：适配层是唯一 import 酒馆运行时的模块（其实也不 import，而是接收 `ctx` 参数）。它把 `ctx` 提供的 `generateRaw`、`chatMetadata`、`updateChatMetadata`、`saveMetadataDebounced`、`setExtensionPrompt`、`characters`、`characterId`、`chat`、`extensionSettings` 等桥接给 director。此模块依赖浏览器全局，不做 Node 单测，仅做语法检查。

- [ ] **Step 1: 实现 adapter.js**

```javascript
// story-director/src/adapter.js
// 酒馆运行时适配层：把 SillyTavern.getContext() 的能力桥接给 director。
import { createDirector } from './director.js';
import { normalizeOutline, createEmptyOutline, deserializeOutline, serializeOutline } from './outline-store.js';

const META_KEY = 'story_director';
const INJECT_KEY = 'story_director';
const SETTINGS_KEY = 'story_director';

export const DEFAULT_SETTINGS = {
    enabled: true,
    controlStrength: 'strong',      // 'weak' | 'strong'
    injectTokenLimit: 300,
    reviseFrequency: 'every',       // 'every' | 'everyN' | 'manual'
    reviseEveryN: 1,
    driftTolerance: 'loose',        // 'loose' | 'strict'
    outlineDetail: 'medium',        // 'low' | 'medium' | 'high'
    recentTurns: 5,
};

export function ensureSettings(ctx) {
    const settings = ctx.extensionSettings || {};
    if (!settings[SETTINGS_KEY]) {
        settings[SETTINGS_KEY] = { ...DEFAULT_SETTINGS };
    }
    return settings[SETTINGS_KEY];
}

export function getStoredOutline(ctx) {
    const meta = ctx.chatMetadata || {};
    const raw = meta[META_KEY];
    if (typeof raw === 'string') return deserializeOutline(raw);
    if (raw && typeof raw === 'object') return normalizeOutline(raw);
    return createEmptyOutline();
}

export function createSillyTavernAdapter(ctx) {
    const settings = ensureSettings(ctx);

    function getOutline() {
        return getStoredOutline(ctx);
    }

    function setOutline(outline) {
        const normalized = normalizeOutline(outline);
        ctx.updateChatMetadata({ [META_KEY]: serializeOutline(normalized) });
        ctx.saveMetadataDebounced?.();
    }

    function setInjectedInstruction(text) {
        ctx.setExtensionPrompt(INJECT_KEY, text, 0, 10000, false, 0);
    }

    function getCharacterCard() {
        const chars = ctx.characters || [];
        const chid = ctx.characterId;
        const ch = chid != null ? chars[chid] : null;
        if (!ch) return {};
        // 世界书文本（若存在）
        let worldbook = '';
        try {
            const book = ch.data?.character_book || ch.character_book;
            if (book?.entries?.length) {
                worldbook = book.entries.map(e => `${e.name ?? ''}: ${e.content ?? ''}`).join('\n');
            }
        } catch {}
        return {
            name: ch.name,
            description: ch.description,
            personality: ch.personality,
            scenario: ch.scenario,
            first_mes: ch.first_mes,
            mes_example: ch.mes_example,
            system_prompt: ch.system_prompt,
            worldbook,
        };
    }

    function getRecentDialogue(turns = 5) {
        const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
        const recent = chat.slice(-(turns * 2)); // 每轮 = 用户 + 角色两条
        return recent
            .filter(m => m && typeof m.mes === 'string')
            .map(m => `${m.is_user ? (ctx.name1 || '用户') : (m.name || ctx.name2 || '角色')}: ${m.mes}`)
            .join('\n');
    }

    const director = createDirector({
        generateRaw: (opts) => ctx.generateRaw(opts),
        getOutline,
        setOutline,
        setInjectedInstruction,
        getSettings: () => settings,
        getRecentDialogue,
        getCharacterCard,
        renderOutline: () => { /* 由 ui 层注入回调覆盖 */ },
    });

    function renderOutline() {
        // 由 ui 层通过 setRenderCallback 设置实际渲染函数
        if (renderCallback) renderCallback(getOutline());
    }
    let renderCallback = null;
    function setRenderCallback(fn) {
        renderCallback = fn;
    }

    return {
        director,
        settings,
        getOutline,
        setOutline,
        load: () => { director.refreshInjection(); setRenderCallback && 0; },
        save: () => { director.refreshInjection(); },
        getCharacterCard,
        getRecentDialogue,
        renderOutline,
        setRenderCallback,
    };
}
```

- [ ] **Step 2: 语法检查**

Run: `node --check story-director/src/adapter.js`
Expected: 无输出（语法正确）

- [ ] **Step 3: 提交**

```bash
cd F:\deepseek\plugins
git add story-director/src/adapter.js
git commit -m "feat: add SillyTavern runtime adapter"
```

---

### Task 10: UI 面板与手动编辑

**Files:**
- Create: `story-director/settings.html`
- Create: `story-director/src/ui.js`
- Modify: `story-director/style.css`

**Interfaces:**
- Consumes:
  - `createSillyTavernAdapter` from `adapter.js`（接收已创建的 adapter）
- Produces:
  - `mountUI(ctx, adapter)` → 在扩展抽屉注入面板并绑定事件

- [ ] **Step 1: 实现 settings.html**

```html
<div id="story_director_panel" class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
        <div class="flex-container alignitemscenter margin0">
            <b>叙事导演 (Story Director)</b>
        </div>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
        <div id="sd_toolbar" class="sd_toolbar">
            <div id="sd_generate" class="menu_button" title="读取当前角色卡生成整场大纲"><i class="fa-solid fa-wand-magic-sparkles"></i><span>生成大纲</span></div>
            <div id="sd_revise" class="menu_button" title="手动触发一次情节追踪"><i class="fa-solid fa-rotate"></i><span>修订</span></div>
            <div id="sd_check" class="menu_button" title="检查大纲与剧情的同步性"><i class="fa-solid fa-stethoscope"></i><span>体检</span></div>
            <div id="sd_clear" class="menu_button" title="清空大纲"><i class="fa-solid fa-trash"></i><span>清空</span></div>
            <label class="sd_enable"><input id="sd_enabled" type="checkbox" /><span>启用</span></label>
        </div>
        <div id="sd_overview" class="sd_overview"><small>尚未生成大纲。点击"生成大纲"开始。</small></div>
        <div id="sd_focus" class="sd_focus"></div>
        <div id="sd_report" class="sd_report"></div>
    </div>
</div>
```

- [ ] **Step 2: 实现 ui.js**

```javascript
// story-director/src/ui.js
// UI 层：渲染面板、绑定事件、手动编辑。依赖浏览器 DOM 与酒馆 ctx。
import { createEmptyOutline, normalizeOutline } from './outline-store.js';

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function renderOverview(outline) {
    const el = document.getElementById('sd_overview');
    if (!el) return;
    const o = normalizeOutline(outline);
    const lines = [];
    if (o.theme) lines.push(`<div class="sd_field"><b>主题：</b>${escapeHtml(o.theme)}</div>`);
    if (o.tone) lines.push(`<div class="sd_field"><b>基调：</b>${escapeHtml(o.tone)}</div>`);
    if (o.world) lines.push(`<div class="sd_field sd_world"><b>世界观：</b>${escapeHtml(o.world)}</div>`);
    if (o.beats.length) {
        const beatHtml = o.beats.map(b => {
            const badge = { pending: '⬜待开始', active: '🔄进行中', done: '✅已完成' }[b.status] || b.status;
            return `<div class="sd_beat" data-beat-id="${escapeHtml(b.id)}"><span class="sd_badge">${badge}</span> <span class="sd_beat_title">${escapeHtml(b.title || b.id)}</span></div>`;
        }).join('');
        lines.push(`<div class="sd_beats">${beatHtml}</div>`);
    }
    if (o.arcs.length) {
        const arcHtml = o.arcs.map(a => `<div class="sd_arc">${escapeHtml(a.char)}: ${escapeHtml(a.desire || '')} → ${escapeHtml(a.growth || '')}</div>`).join('');
        lines.push(`<details><summary>角色弧光</summary>${arcHtml}</details>`);
    }
    if (o.foreshadowing.length) {
        const fHtml = o.foreshadowing.map(f => `<div class="sd_fs">${escapeHtml(f.hint || f.id)} <i>(${f.status})</i></div>`).join('');
        lines.push(`<details><summary>伏笔</summary>${fHtml}</details>`);
    }
    el.innerHTML = lines.join('') || '<small>大纲为空。</small>';
}

function renderFocus(outline) {
    const el = document.getElementById('sd_focus');
    if (!el) return;
    const f = outline?.focus;
    if (!f || !(f.currentBeat || f.nextStep)) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="sd_field"><b>当前节点：</b>${escapeHtml(f.currentBeat)}</div>` +
        `<div class="sd_field"><b>下一步：</b>${escapeHtml(f.nextStep)}</div>` +
        (f.avoidOffTopic ? `<div class="sd_field"><b>避免：</b>${escapeHtml(f.avoidOffTopic)}</div>` : '');
}

function renderReport(report) {
    const el = document.getElementById('sd_report');
    if (!el) return;
    if (!report) { el.innerHTML = ''; return; }
    const verdictText = { sync: '✅ 同步', 'minor-drift': '⚠️ 轻度脱节', 'major-drift': '❌ 严重脱节' }[report.verdict] || report.verdict;
    el.innerHTML = `<div class="sd_field"><b>体检：</b>${escapeHtml(verdictText)}</div>` +
        `<div class="sd_field"><b>是否修改：</b>${report.changed ? '是' : '否'}</div>` +
        (report.reason ? `<div class="sd_field"><b>理由：</b>${escapeHtml(report.reason)}</div>` : '') +
        (report.changes ? `<div class="sd_field"><b>改动：</b>${escapeHtml(report.changes)}</div>` : '');
}

export function mountUI(ctx, adapter) {
    const target = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!target) return;
    if (document.getElementById('story_director_panel')) return;

    target.insertAdjacentHTML('beforeend', `<!-- 面板由 settings.html 通过模板加载（见 index.js 组装） -->`);
    // 实际面板 HTML 由 index.js 用 renderExtensionTemplateAsync 注入，此处仅注册渲染回调与事件
    adapter.setRenderCallback((outline) => {
        renderOverview(outline);
        renderFocus(outline);
    });

    // 事件绑定由 index.js 在模板注入后调用 bindUI
}

export function bindUI(ctx, adapter) {
    document.getElementById('sd_enabled')?.addEventListener('change', (e) => {
        adapter.settings.enabled = e.target.checked;
        ctx.saveSettingsDebounced?.();
        adapter.director.refreshInjection();
    });
    document.getElementById('sd_generate')?.addEventListener('click', async () => {
        await adapter.director.generate({ userRequest: '' });
        adapter.renderOutline();
    });
    document.getElementById('sd_revise')?.addEventListener('click', async () => {
        await adapter.director.revise();
        adapter.renderOutline();
    });
    document.getElementById('sd_check')?.addEventListener('click', async () => {
        const report = await adapter.director.check();
        renderReport(report);
        adapter.renderOutline();
    });
    document.getElementById('sd_clear')?.addEventListener('click', () => {
        adapter.setOutline(createEmptyOutline());
        adapter.director.refreshInjection();
        adapter.renderOutline();
    });

    // 手动编辑：点击 beat 进入编辑
    document.getElementById('sd_overview')?.addEventListener('click', (e) => {
        const beatEl = e.target.closest('[data-beat-id]');
        if (!beatEl) return;
        const id = beatEl.getAttribute('data-beat-id');
        const outline = adapter.getOutline();
        const beat = outline.beats.find(b => b.id === id);
        if (!beat) return;
        const newTitle = prompt('编辑节点标题：', beat.title);
        if (newTitle !== null) {
            beat.title = newTitle;
            adapter.setOutline(outline);
            adapter.renderOutline();
            adapter.director.refreshInjection();
        }
    });
}

export { renderOverview, renderFocus, renderReport };
```

- [ ] **Step 3: 补充 style.css**

```css
#story_director_panel { padding: 8px; }
.sd_toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }
.sd_toolbar .menu_button { cursor: pointer; }
.sd_enable { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.sd_overview, .sd_focus, .sd_report { font-size: 0.9em; }
.sd_field { margin: 3px 0; }
.sd_world { white-space: pre-wrap; }
.sd_beat { cursor: pointer; padding: 2px 0; }
.sd_beat:hover { background: rgba(128,128,128,0.1); }
.sd_badge { font-size: 0.85em; }
.sd_report { border-top: 1px dashed #888; margin-top: 8px; padding-top: 6px; }
```

- [ ] **Step 4: 语法检查**

Run: `node --check story-director/src/ui.js`
Expected: 无输出

- [ ] **Step 5: 提交**

```bash
cd F:\deepseek\plugins
git add story-director/settings.html story-director/src/ui.js story-director/style.css
git commit -m "feat: add UI panel with overview, focus, report and manual edit"
```

---

### Task 11: index.js 组装 —— 事件绑定与斜杠命令

**Files:**
- Modify: `story-director/index.js`

**Interfaces:**
- Consumes:
  - `createSillyTavernAdapter`, `ensureSettings`, `DEFAULT_SETTINGS` from `src/adapter.js`
  - `mountUI`, `bindUI` from `src/ui.js`
  - `SillyTavern.getContext()` 全局
- Produces:
  - 挂载后的完整扩展：面板注入、事件监听（`MESSAGE_SENT` 触发每轮修订、`CHAT_CHANGED` 重载）、斜杠命令 `/director`。

- [ ] **Step 1: 实现完整 index.js**

```javascript
// story-director 入口：加载模块、注册事件、挂载 UI
import { createSillyTavernAdapter, ensureSettings } from './src/adapter.js';
import { mountUI, bindUI } from './src/ui.js';

(function () {
    'use strict';

    const NAMESPACE = 'STORY_DIRECTOR';
    const VERSION = '0.1.0';

    if (window[NAMESPACE]?.loaded) {
        console.warn(`[story-director] Already loaded, skipping duplicate init.`);
        return;
    }
    window[NAMESPACE] = { loaded: true, version: VERSION };

    let adapter = null;
    let reviseCounter = 0;

    function getCtx() {
        return window.SillyTavern?.getContext?.();
    }

    async function bootstrap() {
        const ctx = getCtx();
        if (!ctx) {
            console.warn('[story-director] SillyTavern context not ready, retrying on APP_READY.');
            return;
        }
        ensureSettings(ctx);
        adapter = createSillyTavernAdapter(ctx);

        // 注入面板（通过酒馆模板加载）
        try {
            const html = await ctx.renderExtensionTemplateAsync('third-party/story-director', 'settings');
            const target = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
            if (target && html) {
                target.insertAdjacentHTML('beforeend', html);
            }
        } catch (err) {
            console.warn('[story-director] template load failed, using fallback mount:', err);
        }

        mountUI(ctx, adapter);
        bindUI(ctx, adapter);
        adapter.setRenderCallback(() => { /* renderOutline 内部已用 */ });
        adapter.load();

        // 每轮发言后异步修订
        const es = ctx.eventSource;
        const et = ctx.eventTypes || ctx.event_types;
        es?.on(et.MESSAGE_SENT, () => {
            const s = adapter.settings;
            if (!s.enabled) return;
            if (s.reviseFrequency === 'manual') return;
            if (s.reviseFrequency === 'everyN') {
                reviseCounter = (reviseCounter + 1) % Math.max(1, s.reviseEveryN || 1);
                if (reviseCounter !== 0) return;
            }
            adapter.director.revise().catch(() => {});
        });

        // 切换聊天时重载大纲
        es?.on(et.CHAT_CHANGED, () => {
            adapter.load();
            adapter.renderOutline();
        });

        registerSlashCommands(ctx);

        console.log(`[story-director] v${VERSION} ready.`);
    }

    function registerSlashCommands(ctx) {
        const parser = ctx.SlashCommandParser;
        const SlashCommand = ctx.SlashCommand;
        const SlashCommandArgument = ctx.SlashCommandArgument;
        const SlashCommandNamedArgument = ctx.SlashCommandNamedArgument;
        const ARGUMENT_TYPE = ctx.ARGUMENT_TYPE;
        if (!parser || !SlashCommand) return;

        parser.addCommandObject(SlashCommand.fromProps({
            name: 'director',
            callback: async (args, value) => {
                if (!adapter) return '';
                const sub = String(value ?? '').trim().toLowerCase();
                if (sub === 'generate') {
                    await adapter.director.generate({ userRequest: '' });
                    adapter.renderOutline();
                    return '大纲已生成';
                } else if (sub === 'revise') {
                    await adapter.director.revise();
                    adapter.renderOutline();
                    return '大纲已修订';
                } else if (sub === 'check') {
                    const report = await adapter.director.check();
                    adapter.renderOutline();
                    return `体检完成：${report?.verdict ?? 'sync'}`;
                } else {
                    return '用法：/director generate|revise|check|status';
                }
            },
            helpString: '叙事导演大纲控制。子命令：generate（生成）、revise（修订）、check（体检）',
            unnamedArgumentList: [
                new SlashCommandArgument('subcommand', [ARGUMENT_TYPE.STRING], false, false, ''),
            ],
            returns: ARGUMENT_TYPE.STRING,
        }));
    }

    // 等待酒馆就绪
    const es = window.SillyTavern?.getContext?.()?.eventSource;
    if (es) {
        const et = window.SillyTavern.getContext().eventTypes || window.SillyTavern.getContext().event_types;
        es.on(et.APP_READY, bootstrap);
    }
    // 兜底：DOM 就绪后重试
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { if (!adapter) bootstrap(); }, { once: true });
    } else {
        setTimeout(() => { if (!adapter) bootstrap(); }, 500);
    }
})();
```

- [ ] **Step 2: 语法检查**

Run: `node --check story-director/index.js`
Expected: 无输出（若报 import 相关错误，改为 `node --input-type=module --check` 前先确认；ES module 用 `node --check` 可能不识别 import，改用 `node --experimental-vm-modules` 或直接信任浏览器加载）

- [ ] **Step 3: 提交**

```bash
cd F:\deepseek\plugins
git add story-director/index.js
git commit -m "feat: wire up events and slash command in entry"
```

---

### Task 12: 集成验证与部署

**Files:**
- Create: `deploy.ps1`（可选，一键拷贝到酒馆）
- Create: `README.md`

**Interfaces:**
- Consumes: 所有前述模块
- Produces: 可部署到酒馆 `third-party` 目录的完整扩展

- [ ] **Step 1: 写 deploy.ps1**

```powershell
# 拷贝 story-director 到本地酒馆 third-party 目录
param(
    [string]$Target = "F:\jiuguanai\SillyTavern-Launcher\SillyTavern\public\scripts\extensions\third-party\story-director"
)
$Src = "F:\deepseek\plugins\story-director"
Write-Host "Deploying $Src -> $Target"
if (Test-Path $Target) { Remove-Item $Target -Recurse -Force }
New-Item -ItemType Directory -Path $Target -Force | Out-Null
Copy-Item -Path (Join-Path $Src '*') -Destination $Target -Recurse -Force
Write-Host "Done. Restart SillyTavern and check Extensions panel."
```

- [ ] **Step 2: 写 README.md**

```markdown
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
```

- [ ] **Step 3: 运行全量单测**

Run: `node --test story-director/test/`
Expected: 全部 PASS（Tasks 2-8 共约 32 个测试）

- [ ] **Step 4: 部署到酒馆并提交**

```bash
cd F:\deepseek\plugins
git add story-director/deploy.ps1 story-director/README.md
git commit -m "docs: add README and deploy script"
```

- [ ] **Step 5: 手动集成验证清单**

在酒馆中：
1. 扩展面板出现"叙事导演"，勾选启用。
2. 点击"生成大纲" → 面板出现主题/beats/focus。
3. 发一条消息 → 角色按大纲回复；后台修订后面板刷新。
4. 点击"体检" → 出现诊断报告。
5. 点击 beat 标题 → 弹窗编辑，保存后写回。
6. 断网/改错 API → 发消息不报错，RP 正常（降级）。
7. `/director generate` 斜杠命令可用。

---

## Self-Review 记录

- **Spec 覆盖**：数据模型（Task 2）、提示词/schema（Task 3）、LLM 容错（Task 4）、注入（Task 5）、每轮修订（Task 6）、体检（Task 7）、编排+并发（Task 8）、适配（Task 9）、UI/手动编辑/参数（Task 10）、事件+斜杠命令（Task 11）、部署与集成验证（Task 12）。Spec 第 8 节参数表中的 `driftTolerance`、`promptOverrides` 在 adapter 的 `DEFAULT_SETTINGS` 中已预留 `driftTolerance` 字段；`promptOverrides` 暂以默认提示词实现（YAGNI，后续可加）。已在 Task 9 的 `DEFAULT_SETTINGS` 保留扩展位。
- **占位符扫描**：无 TBD/TODO。
- **类型一致性**：`renderInstruction(outline, {strength, tokenLimit})`、`createDirector(deps)`、`applyRevision(prev, patch)`、`applyCheckResult(outline, report)`、`makeStructuredGenerator(generateRaw, schema)` 各 Task 签名一致。
