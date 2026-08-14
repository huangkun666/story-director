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
