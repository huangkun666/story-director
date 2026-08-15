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

test('makeStructuredGenerator returns parsed object on success without jsonSchema', async () => {
    let received = null;
    const fakeGen = async (args) => { received = args; return '{"theme":"X"}'; };
    const schema = { type: 'object' };
    const gen = makeStructuredGenerator(fakeGen, schema);
    const r = await gen({ system: 's', prompt: 'p' });
    assert.deepEqual(r, { theme: 'X' });
    assert.equal(received.prompt, 'p');
    assert.equal(received.systemPrompt, 's');
    // 关键回归断言：不再传 jsonSchema（否则酒馆 generateRaw 会走裸解析，代码块会失败）
    assert.equal(received.jsonSchema, undefined);
});

test('makeStructuredGenerator passes prompt through unchanged', async () => {
    let received = null;
    const fakeGen = async (args) => { received = args; return '{"theme":"X"}'; };
    const gen = makeStructuredGenerator(fakeGen, { type: 'object' });
    await gen({ system: 's', prompt: 'p' });
    assert.equal(received.prompt, 'p');
    assert.equal(received.systemPrompt, 's');
});

test('makeStructuredGenerator parses markdown-fenced JSON from generateRaw', async () => {
    const fakeGen = async () => '```json\n{"theme":"X"}\n```';
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
