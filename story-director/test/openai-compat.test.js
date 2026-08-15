// story-director/test/openai-compat.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildChatCompletionsUrl,
    buildChatCompletionsPayload,
    extractChatCompletionsContent,
    createOpenAiCompatibleGenerator,
} from '../src/openai-compat.js';

test('buildChatCompletionsUrl appends OpenAI-compatible path', () => {
    assert.equal(buildChatCompletionsUrl('https://api.example.com'), 'https://api.example.com/v1/chat/completions');
    assert.equal(buildChatCompletionsUrl('https://api.example.com/v1'), 'https://api.example.com/v1/chat/completions');
    assert.equal(buildChatCompletionsUrl('https://api.example.com/v1/'), 'https://api.example.com/v1/chat/completions');
    assert.equal(buildChatCompletionsUrl('https://api.example.com/v1/chat/completions'), 'https://api.example.com/v1/chat/completions');
    assert.equal(buildChatCompletionsUrl(''), '');
});

test('buildChatCompletionsPayload builds system/user messages and optional model', () => {
    assert.deepEqual(buildChatCompletionsPayload({ system: 'sys', prompt: 'p' }), {
        messages: [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'p' },
        ],
    });
    const withModel = buildChatCompletionsPayload({ system: '', prompt: 'p', model: 'm-1' });
    assert.deepEqual(withModel.messages, [{ role: 'user', content: 'p' }]);
    assert.equal(withModel.model, 'm-1');
});

test('extractChatCompletionsContent reads choices[0].message.content', () => {
    assert.equal(extractChatCompletionsContent({ choices: [{ message: { content: '  hello  ' } }] }), 'hello');
});

test('extractChatCompletionsContent reads legacy choices[0].text', () => {
    assert.equal(extractChatCompletionsContent({ choices: [{ text: 'legacy' }] }), 'legacy');
});

test('extractChatCompletionsContent returns null on empty/malformed payloads', () => {
    assert.equal(extractChatCompletionsContent(null), null);
    assert.equal(extractChatCompletionsContent({}), null);
    assert.equal(extractChatCompletionsContent({ choices: [{ message: { content: '   ' } }] }), null);
});

test('createOpenAiCompatibleGenerator posts payload and returns content', async () => {
    const captured = [];
    const generator = createOpenAiCompatibleGenerator({
        fetchImpl: async (url, init) => {
            captured.push({ url, init });
            return {
                ok: true,
                status: 200,
                json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
            };
        },
        getConfig: () => ({ baseUrl: 'https://proxy.example/v1', apiKey: 'sk-test', model: 'm-x' }),
    });
    const out = await generator({ system: 'sys', prompt: 'p' });
    assert.equal(out, '{"ok":true}');
    assert.equal(captured.length, 1);
    assert.equal(captured[0].url, 'https://proxy.example/v1/chat/completions');
    assert.equal(captured[0].init.headers.Authorization, 'Bearer sk-test');
    const body = JSON.parse(captured[0].init.body);
    assert.equal(body.model, 'm-x');
    assert.deepEqual(body.messages, [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'p' },
    ]);
});

test('createOpenAiCompatibleGenerator returns null on HTTP error', async () => {
    const generator = createOpenAiCompatibleGenerator({
        fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'unauthorized' }),
        getConfig: () => ({ baseUrl: 'https://proxy.example/v1', apiKey: 'bad' }),
    });
    assert.equal(await generator({ prompt: 'p' }), null);
});

test('createOpenAiCompatibleGenerator returns null when fetch throws', async () => {
    const generator = createOpenAiCompatibleGenerator({
        fetchImpl: async () => { throw new Error('network down'); },
        getConfig: () => ({ baseUrl: 'https://proxy.example/v1' }),
    });
    assert.equal(await generator({ prompt: 'p' }), null);
});

test('createOpenAiCompatibleGenerator returns null on malformed response', async () => {
    const generator = createOpenAiCompatibleGenerator({
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ nope: true }) }),
        getConfig: () => ({ baseUrl: 'https://proxy.example/v1' }),
    });
    assert.equal(await generator({ prompt: 'p' }), null);
});

test('createOpenAiCompatibleGenerator returns null when baseUrl missing', async () => {
    let called = false;
    const generator = createOpenAiCompatibleGenerator({
        fetchImpl: async () => { called = true; return null; },
        getConfig: () => ({ baseUrl: '' }),
    });
    assert.equal(await generator({ prompt: 'p' }), null);
    assert.equal(called, false);
});
