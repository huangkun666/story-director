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

test('renderInstruction world mode renders world dynamics as environment, not commands', () => {
    const outline = {
        worldEvents: [
            { id: 'ev_1', time: '197年冬', title: '曹军集结于许都', description: '', actors: ['曹操'], trigger: '主角抵达许都周边时', impact: 'direct', status: 'active', outcome: '' },
            { id: 'ev_2', time: '198年春', title: '洛阳局势生变', description: '', actors: [], trigger: '主角抵达洛阳时', impact: 'ambient', status: 'pending', outcome: '' },
        ],
        focus: { nextStep: '许都方向传来大军集结的消息' },
    };
    const text = renderInstruction(outline, { mode: 'world', tokenLimit: 500 });
    assert.ok(text.includes('世界动态'));
    assert.ok(text.includes('曹军集结于许都'));
    assert.ok(text.includes('主角抵达许都周边时'));
    assert.ok(text.includes('环境，非主角指令'));
    assert.ok(text.includes('许都方向'));
    // 导演模式不受影响
    const directorText = renderInstruction({ focus: { nextStep: '前往许都' } }, { mode: 'director', tokenLimit: 200 });
    assert.ok(directorText.includes('前往许都'));
});
