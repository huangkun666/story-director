// story-director/test/adapter.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSillyTavernAdapter, ensureSettings, normalizeSettings, DEFAULT_SETTINGS, DEFAULT_LLM_SETTINGS } from '../src/adapter.js';
import { updateBeat, jumpToBeat } from '../src/outline-store.js';

function makeCtx(overrides = {}) {
    return {
        extensionSettings: {},
        chatMetadata: {},
        characters: [],
        characterId: null,
        chat: [],
        name1: '用户',
        name2: '角色',
        rawCalls: [],
        updateChatMetadata(patch) { Object.assign(this.chatMetadata, patch); },
        saveMetadataDebounced() {},
        setExtensionPrompt(...args) { this.injectedArgs = args; },
        generateRaw: async function (opts) { this.rawCalls.push(opts); return JSON.stringify({ theme: '主API' }); },
        ...overrides,
    };
}

test('normalizeSettings adds missing defaults including llm block', () => {
    const s = normalizeSettings({ enabled: false, llm: { mode: 'custom', apiKey: 'k' } });
    assert.equal(s.enabled, false);
    assert.equal(s.llm.mode, 'custom');
    assert.equal(s.llm.apiKey, 'k');
    assert.equal(s.llm.baseUrl, '');
    assert.equal(s.injectTokenLimit, DEFAULT_SETTINGS.injectTokenLimit);
    assert.equal(s.outlineDetail, 'medium');
    assert.equal(s.beatPacing, 'balanced');
    assert.equal(s.theme, 'light'); // 默认白天主题
    assert.equal(s.lockOutline, false);
});

test('normalizeSettings handles missing llm block from older installs', () => {
    const s = normalizeSettings({ enabled: true });
    assert.deepEqual(s.llm, DEFAULT_LLM_SETTINGS);
});

test('ensureSettings writes merged settings back to extension_settings', () => {
    const ctx = { extensionSettings: { story_director: { driftTolerance: 'strict' } } };
    const s = ensureSettings(ctx);
    assert.equal(s.driftTolerance, 'strict');
    assert.equal(s.llm.mode, 'main');
    assert.equal(ctx.extensionSettings.story_director, s);
});

test('getCharacterCard reads depth_prompt and chat-level overrides', () => {
    const ctx = makeCtx({
        characters: [{
            name: '三国卡',
            description: '',
            personality: '',
            scenario: '',
            first_mes: '',
            mes_example: '',
            system_prompt: '',
            data: { extensions: { depth_prompt: { prompt: '深度设定' } } },
        }],
        characterId: 0,
        chatMetadata: { scenario: '手动开场', mes_example: '手动示例', system_prompt: '手动系统' },
    });
    const adapter = createSillyTavernAdapter(ctx);
    const card = adapter.getCharacterCard();
    assert.equal(card.depth_prompt, '深度设定');
    assert.equal(card.scenario, '手动开场');
    assert.equal(card.mes_example, '手动示例');
    assert.equal(card.system_prompt, '手动系统');
});

test('getCharacterCard respects cardContextLimit budget', () => {
    const ctx = makeCtx({
        characters: [{
            name: '巨型卡',
            description: 'A'.repeat(10000),
            personality: '',
            scenario: '',
            first_mes: '',
            mes_example: '',
            system_prompt: '',
            data: {
                extensions: { depth_prompt: { prompt: '深'.repeat(10000) } },
                character_book: { entries: [{ name: '设定', content: '界'.repeat(10000) }] },
            },
        }],
        characterId: 0,
        chatMetadata: {},
    });
    ctx.extensionSettings.story_director = { cardContextLimit: 3000 };
    const adapter = createSillyTavernAdapter(ctx);
    const card = adapter.getCharacterCard();
    const totalChars = ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'depth_prompt', 'worldbook']
        .reduce((sum, key) => sum + String(card[key] || '').length, 0);
    assert.ok(totalChars <= 3000, `card context should be capped, got ${totalChars}`);
    assert.ok(card.depth_prompt.length > 0); // 深度提示优先保留
});

test('getRecentDialogue respects dialogueContextLimit budget', () => {
    const ctx = makeCtx({
        chat: Array.from({ length: 20 }, (_, i) => ({ mes: `消息${i}`.repeat(2000), is_user: i % 2 === 0 })),
    });
    ctx.extensionSettings.story_director = { dialogueContextLimit: 2000 };
    const adapter = createSillyTavernAdapter(ctx);
    const dialogue = adapter.getRecentDialogue(10);
    assert.ok(dialogue.length <= 2000);
});

test('getMemoryGap reads yuzuki summary pointer and computes missing floors', () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        YuzukiMemory: {
            Storage: {
                loadState: () => ({ settings: { manualPointers: { summary: 42 } } }),
            },
        },
    };
    try {
        const ctx = makeCtx({ chat: Array.from({ length: 50 }, (_, i) => ({ mes: `m${i}`, is_user: i % 2 === 0 })) });
        const adapter = createSillyTavernAdapter(ctx);
        assert.equal(adapter.getMemoryGap(), 8); // 50 - 42
    } finally {
        if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    }
});

test('getMemoryGap returns null when memory has no pointer state', () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        YuzukiMemory: {
            Storage: {
                loadState: () => ({ settings: {} }),
            },
        },
    };
    try {
        const ctx = makeCtx();
        const adapter = createSillyTavernAdapter(ctx);
        assert.equal(adapter.getMemoryGap(), null);
    } finally {
        if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    }
});

test('getMemoryGap returns null when yuzuki storage is absent', () => {
    const originalWindow = globalThis.window;
    globalThis.window = { YuzukiMemory: {} };
    try {
        const ctx = makeCtx();
        const adapter = createSillyTavernAdapter(ctx);
        assert.equal(adapter.getMemoryGap(), null);
    } finally {
        if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    }
});

test('getRecentDialogue covers the memory gap when pointer exists', () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        YuzukiMemory: {
            Storage: {
                loadState: () => ({ settings: { manualPointers: { summary: 90 } } }),
            },
        },
    };
    try {
        // 100 条消息，指针 90 → 缺口 10 条 → 动态轮数 = ceil(10/2)+1 = 6 轮（12 条）
        const ctx = makeCtx({
            chat: Array.from({ length: 100 }, (_, i) => ({ mes: `消息${i}`, is_user: i % 2 === 0 })),
        });
        const adapter = createSillyTavernAdapter(ctx);
        const dialogue = adapter.getRecentDialogue(5); // 用户配置 5 轮
        assert.ok(dialogue.includes('消息90')); // 缺口内最早的消息也在
        assert.ok(!dialogue.includes('消息87')); // 缺口之外不带
    } finally {
        if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    }
});

test('getRecentDialogue falls back to configured turns without a pointer', () => {
    const originalWindow = globalThis.window;
    globalThis.window = { YuzukiMemory: {} };
    try {
        const ctx = makeCtx({
            chat: Array.from({ length: 40 }, (_, i) => ({ mes: `消息${i}`, is_user: i % 2 === 0 })),
        });
        const adapter = createSillyTavernAdapter(ctx);
        const dialogue = adapter.getRecentDialogue(3); // 3 轮 = 6 条 → 覆盖 34..39
        assert.ok(dialogue.includes('消息34'));
        assert.ok(!dialogue.includes('消息33'));
    } finally {
        if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    }
});

test('getRecentDialogue caps dynamic turns at 60', () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        YuzukiMemory: {
            Storage: {
                loadState: () => ({ settings: { manualPointers: { summary: 0 } } }),
            },
        },
    };
    try {
        // 指针 0、聊天 300 条 → 缺口 300 → 动态轮数被 clamp 到 60（120 条）
        const ctx = makeCtx({
            chat: Array.from({ length: 300 }, (_, i) => ({ mes: `消息${i}`, is_user: i % 2 === 0 })),
        });
        const adapter = createSillyTavernAdapter(ctx);
        const dialogue = adapter.getRecentDialogue(5);
        assert.ok(dialogue.includes('消息180')); // 60 轮 = 120 条 → 覆盖 180..299
        assert.ok(!dialogue.includes('消息179'));
    } finally {
        if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    }
});

test('getRecentDialogue extracts bodies per rules and falls back to raw', () => {
    const ctx = makeCtx({
        chat: [
            { mes: '【我们进城吧】然后闲聊了几句', is_user: true },
            { mes: '【好，出发】路上小心', name: '角色' },
            { mes: '没有标签的普通轮次', is_user: true },
        ],
    });
    // 必须在创建 adapter 之前设置（ensureSettings 会锁定 settings 引用）
    ctx.extensionSettings.story_director = { dialogueExtractRules: [{ open: '【', close: '】', label: '正文' }] };
    const adapter = createSillyTavernAdapter(ctx);
    const extracted = adapter.getRecentDialogue(3);
    assert.ok(extracted.includes('我们进城吧'));
    assert.ok(extracted.includes('好，出发'));
    assert.ok(!extracted.includes('然后闲聊了几句')); // 标签外内容被剔除
    // 无规则时回退原文
    delete ctx.extensionSettings.story_director.dialogueExtractRules;
    const raw = adapter.getRecentDialogue(3);
    assert.ok(raw.includes('然后闲聊了几句'));
});

test('getCharacterCard includes a lightweight cast list to avoid invented NPCs', () => {
    const ctx = makeCtx({
        characters: [
            { name: '主角', description: '第一行身份\n更多', data: {} },
            { name: '未出场NPC', description: '十年前已存在的盟友', data: {} },
        ],
        characterId: 0,
    });
    const adapter = createSillyTavernAdapter(ctx);
    const card = adapter.getCharacterCard();
    assert.ok(card.cast.includes('主角'));
    assert.ok(card.cast.includes('未出场NPC'));
});

test('getMemoryContext reads yuzuki-Memory when enabled', () => {
    const originalWindow = globalThis.window;
    globalThis.window = { YuzukiMemory: { VariableInjector: { buildMemoryText: () => '【主线总结】长时记忆内容'.repeat(500) } } };
    try {
        const ctx = makeCtx();
        ctx.extensionSettings.story_director = { useMemoryPlugin: true, memoryContextLimit: 2000 };
        const adapter = createSillyTavernAdapter(ctx);
        const memory = adapter.getMemoryContext();
        assert.ok(memory.includes('长时记忆内容'));
        assert.ok(memory.length <= 2000);
    } finally {
        if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    }
});

test('getVectorMemoryContext searches yuzuki vector store', async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        YuzukiMemory: {
            VectorStore: {
                search: async (query) => [{ text: '赤壁之战资料'.repeat(300), source: '三国资料 #1' }],
            },
        },
    };
    try {
        const ctx = makeCtx();
        ctx.extensionSettings.story_director = { useVectorMemory: true, vectorMemoryLimit: 2000 };
        const adapter = createSillyTavernAdapter(ctx);
        const vector = await adapter.getVectorMemoryContext('赤壁之战');
        assert.ok(vector.includes('赤壁之战资料'));
        assert.ok(vector.includes('三国资料 #1'));
        assert.ok(vector.length <= 2000);
    } finally {
        if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    }
});

test('getVectorMemoryHits returns structured hits with query/source/text', async () => {
    const originalWindow = globalThis.window;
    const searchCalls = [];
    globalThis.window = {
        YuzukiMemory: {
            VectorStore: {
                search: async (query) => {
                    searchCalls.push(query);
                    if (query.includes('时间线')) return [{ text: '赤壁之战资料', source: '三国资料 #1' }, { text: '赤壁之战资料', source: '三国资料 #1' }];
                    return [{ text: '诸葛亮与周瑜的联盟', source: '人物关系' }];
                },
            },
        },
    };
    try {
        const ctx = makeCtx();
        ctx.extensionSettings.story_director = { useVectorMemory: true, vectorMemoryLimit: 6000 };
        const adapter = createSillyTavernAdapter(ctx);
        const hits = await adapter.getVectorMemoryHits(['时间线：建安十三年', '角色：诸葛亮']);
        assert.equal(hits.length, 2);
        assert.deepEqual(hits[0], { query: '时间线：建安十三年', source: '三国资料 #1', text: '赤壁之战资料' });
        assert.deepEqual(hits[1], { query: '角色：诸葛亮', source: '人物关系', text: '诸葛亮与周瑜的联盟' });
        assert.equal(searchCalls.length, 2); // 每个查询独立检索
        // 同一文本只保留一条（去重）
        assert.equal(hits.filter(h => h.text === '赤壁之战资料').length, 1);
    } finally {
        if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    }
});

test('getVectorMemoryHits returns empty when vector memory disabled', async () => {
    const ctx = makeCtx();
    ctx.extensionSettings.story_director = { useVectorMemory: false };
    const adapter = createSillyTavernAdapter(ctx);
    const hits = await adapter.getVectorMemoryHits(['随便']);
    assert.deepEqual(hits, []);
});

test('getVectorMemoryHits caps each query at top 3 results', async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        YuzukiMemory: {
            VectorStore: {
                search: async (query) => Array.from({ length: 6 }, (_, i) => ({ text: `${query}-资料${i}`, source: '库' })),
            },
        },
    };
    try {
        const ctx = makeCtx();
        ctx.extensionSettings.story_director = { useVectorMemory: true, vectorMemoryLimit: 6000 };
        const adapter = createSillyTavernAdapter(ctx);
        const hits = await adapter.getVectorMemoryHits(['时间线', '角色']);
        assert.equal(hits.length, 6); // 两路 × 每路 3 条
        const texts = hits.map(h => h.text);
        assert.ok(texts.some(t => t === '时间线-资料2')); // 每路第 3 条在内
        assert.ok(!texts.some(t => t === '时间线-资料3')); // 每路第 4 条被丢弃
        assert.ok(!texts.some(t => t === '角色-资料5'));
    } finally {
        if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    }
});



test('adapter records and restores outline history snapshots', () => {    const ctx = makeCtx();
    const adapter = createSillyTavernAdapter(ctx);
    const first = adapter.getOutline();
    first.theme = '旧主题';
    adapter.recordHistory(first, 'manual');

    const second = adapter.getOutline();
    second.theme = '新主题';
    adapter.setOutline(second);

    const history = adapter.getHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].outline.theme, '旧主题');

    assert.equal(adapter.restoreHistory(0), true);
    assert.equal(adapter.getOutline().theme, '旧主题');
});

test('custom LLM mode calls OpenAI-compatible endpoint and never main generateRaw', async () => {
    const originalFetch = globalThis.fetch;
    let captured = null;
    globalThis.fetch = async (url, init) => {
        captured = { url, init };
        return {
            ok: true,
            status: 200,
            json: async () => ({ choices: [{ message: { content: '```json\n{"theme":"独立API"}\n```' } }] }),
        };
    };
    try {
        const ctx = makeCtx();
        ctx.extensionSettings.story_director = {
            llm: { mode: 'custom', api: 'openai', baseUrl: 'https://proxy.example/v1', apiKey: 'sk-x', model: 'm-1' },
        };
        const adapter = createSillyTavernAdapter(ctx);
        const result = await adapter.director.generate({ userRequest: '测试' });
        assert.ok(result);
        assert.equal(result.theme, '独立API');
        assert.equal(ctx.rawCalls.length, 0);
        assert.equal(captured.url, 'https://proxy.example/v1/chat/completions');
        assert.equal(captured.init.headers.Authorization, 'Bearer sk-x');
        const body = JSON.parse(captured.init.body);
        assert.equal(body.model, 'm-1');
        assert.equal(body.messages.length, 2);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('main LLM mode delegates to SillyTavern generateRaw', async () => {
    const ctx = makeCtx();
    ctx.extensionSettings.story_director = { llm: { mode: 'main' } };
    const adapter = createSillyTavernAdapter(ctx);
    const result = await adapter.director.generate({ userRequest: '测试' });
    assert.ok(result);
    assert.equal(result.theme, '主API');
    assert.equal(ctx.rawCalls.length, 2); // 两阶段：方向草案 + 正式生成
    for (const call of ctx.rawCalls) {
        assert.equal(call.jsonSchema, undefined); // 回归：绝不传 jsonSchema
        assert.equal(typeof call.systemPrompt, 'string');
    }
});

test('custom LLM mode degrades to null when independent API is broken', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('boom'); };
    try {
        const ctx = makeCtx();
        ctx.extensionSettings.story_director = {
            llm: { mode: 'custom', baseUrl: 'https://proxy.example/v1', apiKey: 'bad' },
        };
        const adapter = createSillyTavernAdapter(ctx);
        const result = await adapter.director.generate({ userRequest: '测试' });
        assert.equal(result, null);
        assert.equal(ctx.rawCalls.length, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

// ---------- 操作级撤销（内存撤销栈） ----------

test('editOutline applies change through controlled function and records undo', () => {
    const ctx = makeCtx();
    const adapter = createSillyTavernAdapter(ctx);
    const o = adapter.getOutline();
    o.beats = [{ id: 'b1', title: '开端', summary: 's', status: 'pending' }];
    adapter.setOutline(o);

    adapter.editOutline('编辑节点', (prev) => updateBeat(prev, 'b1', { title: '改名' }));
    assert.equal(adapter.getOutline().beats[0].title, '改名');
    assert.equal(adapter.canUndo(), true);

    const label = adapter.undo();
    assert.equal(label, '编辑节点');
    assert.equal(adapter.getOutline().beats[0].title, '开端'); // 还原
    assert.equal(adapter.canUndo(), false);
});

test('editOutline with no-op fn does not push undo entry', () => {
    const ctx = makeCtx();
    const adapter = createSillyTavernAdapter(ctx);
    adapter.editOutline('无变更', (o) => o); // 返回同一引用 = 无变更
    assert.equal(adapter.canUndo(), false);
});

test('undo stack merges consecutive same-label edits into one step', () => {
    const ctx = makeCtx();
    const adapter = createSillyTavernAdapter(ctx);
    adapter.pushUndo('时间线'); // 第一次输入
    adapter.pushUndo('时间线'); // 同 label 连续输入 → 合并
    adapter.pushUndo('时间线');
    assert.equal(adapter.canUndo(), true);
    const label = adapter.undo();
    assert.equal(label, '时间线');
    assert.equal(adapter.canUndo(), false); // 三步合并成一步
});

test('undo stack keeps distinct labels as separate steps', () => {
    const ctx = makeCtx();
    const adapter = createSillyTavernAdapter(ctx);
    adapter.pushUndo('新增节点');
    adapter.pushUndo('删除节点');
    assert.equal(adapter.undo(), '删除节点');
    assert.equal(adapter.undo(), '新增节点');
    assert.equal(adapter.undo(), null); // 栈空
});

test('undo stack respects UNDO_LIMIT and drops oldest entries', () => {
    const ctx = makeCtx();
    const adapter = createSillyTavernAdapter(ctx);
    for (let i = 0; i < 25; i++) adapter.pushUndo(`op${i}`);
    let count = 0;
    while (adapter.undo() != null) count++;
    assert.equal(count, 20); // 只保留最近 20 步
});

test('clearUndo resets the stack and notifies callback', () => {
    const ctx = makeCtx();
    const adapter = createSillyTavernAdapter(ctx);
    const seen = [];
    adapter.setUndoChangeCallback((s) => seen.push({ ...s }));
    adapter.pushUndo('A');
    assert.deepEqual(seen[seen.length - 1], { canUndo: true, count: 1 });
    adapter.clearUndo();
    assert.deepEqual(seen[seen.length - 1], { canUndo: false, count: 0 });
    assert.equal(adapter.canUndo(), false);
});

test('undo restores outline snapshot from before the edit (manual edit + jump)', () => {
    const ctx = makeCtx();
    const adapter = createSillyTavernAdapter(ctx);
    const o = adapter.getOutline();
    o.theme = '复仇';
    o.beats = [
        { id: 'b1', title: '开端', summary: 's', status: 'done' },
        { id: 'b2', title: '发展', summary: 's', status: 'active' },
    ];
    adapter.setOutline(o);

    // 模拟跳转游玩：跳转到 b1 → 撤销应回到跳转前
    adapter.editOutline('跳转游玩', (prev) => jumpToBeat(prev, 'b1'));
    assert.equal(adapter.getOutline().focus.currentBeat, 'b1');
    adapter.undo();
    assert.equal(adapter.getOutline().focus.currentBeat, 'b2');
    assert.equal(adapter.getOutline().theme, '复仇'); // 其他字段不变
});
