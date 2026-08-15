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

test('adapter records and restores outline history snapshots', () => {
    const ctx = makeCtx();
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
