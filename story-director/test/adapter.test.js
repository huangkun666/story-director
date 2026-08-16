// story-director/test/adapter.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSillyTavernAdapter, ensureSettings, normalizeSettings, DEFAULT_SETTINGS, DEFAULT_LLM_SETTINGS } from '../src/adapter.js';

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

test('director retrieval hits reach setRetrievalCallback end to end', async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        YuzukiMemory: {
            VectorStore: {
                search: async () => [{ text: '赤壁之战资料', source: '三国资料 #1' }],
            },
        },
    };
    try {
        const ctx = makeCtx();
        ctx.extensionSettings.story_director = { useVectorMemory: true, vectorMemoryLimit: 6000 };
        const adapter = createSillyTavernAdapter(ctx);
        let received = 'unset';
        adapter.setRetrievalCallback((hits) => { received = hits; });
        await adapter.director.generate({ userRequest: '测试' });
        assert.ok(Array.isArray(received));
        assert.equal(received.length, 1);
        assert.equal(received[0].source, '三国资料 #1');
        assert.equal(received[0].text, '赤壁之战资料');
    } finally {
        if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    }
});

test('director pushes empty hits when vector store is absent', async () => {
    const ctx = makeCtx();
    ctx.extensionSettings.story_director = { useVectorMemory: true };
    const adapter = createSillyTavernAdapter(ctx);
    let received = 'unset';
    adapter.setRetrievalCallback((hits) => { received = hits; });
    await adapter.director.generate({ userRequest: '测试' });
    assert.deepEqual(received, []);
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
    assert.equal(ctx.rawCalls.length, 1);
    assert.equal(ctx.rawCalls[0].jsonSchema, undefined); // 回归：绝不传 jsonSchema
    assert.equal(typeof ctx.rawCalls[0].systemPrompt, 'string');
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
