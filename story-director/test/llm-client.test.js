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
