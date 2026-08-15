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

test('normalizeOutline accepts arcs with character/arc fields (Gemini actual output)', () => {
    const o = normalizeOutline({
        arcs: [
            { character: '黄坤', arc: '从地方军阀到霸主' },
            { char: '司马朗', desire: '复仇', flaw: '软弱', growth: '成长' },
        ],
    });
    assert.equal(o.arcs.length, 2);
    assert.equal(o.arcs[0].char, '黄坤');
    assert.equal(o.arcs[0].growth, '从地方军阀到霸主');
    assert.equal(o.arcs[1].char, '司马朗');
    assert.equal(o.arcs[1].desire, '复仇');
});

test('normalizeOutline accepts foreshadowing as string array (Gemini actual output)', () => {
    const o = normalizeOutline({
        foreshadowing: ['曹操的皮甲是阳谋', '沁水渠将成为战略武器'],
    });
    assert.equal(o.foreshadowing.length, 2);
    assert.equal(o.foreshadowing[0].hint, '曹操的皮甲是阳谋');
    assert.equal(o.foreshadowing[0].status, 'pending');
    assert.ok(o.foreshadowing[0].id); // 自动生成 id
});

test('normalizeOutline accepts foreshadowing objects with text field', () => {
    const o = normalizeOutline({
        foreshadowing: [{ text: '某伏笔', status: 'active' }],
    });
    assert.equal(o.foreshadowing.length, 1);
    assert.equal(o.foreshadowing[0].hint, '某伏笔');
    assert.equal(o.foreshadowing[0].status, 'active');
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
