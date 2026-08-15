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
    assert.ok(Array.isArray(o.acts));
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
    assert.ok(Array.isArray(o.acts));
    assert.equal(typeof o.focus, 'object');
    assert.deepEqual(o.timeline, { start: '', end: '', note: '' });
});

test('normalizeOutline accepts timeline object and string forms', () => {
    const obj = normalizeOutline({ timeline: { start: '200年', end: '208年', note: '含赤壁' } });
    assert.equal(obj.timeline.start, '200年');
    assert.equal(obj.timeline.end, '208年');
    assert.equal(obj.timeline.note, '含赤壁');

    const str = normalizeOutline({ timeline: '建安五年 - 建安十三年' });
    assert.equal(str.timeline.start, '建安五年');
    assert.equal(str.timeline.end, '建安十三年');
});

test('normalizeOutline accepts acts and keeps beat actId', () => {
    const o = normalizeOutline({
        acts: [
            { id: 'act_1', title: '第一幕：开端', summary: '铺垫', beats: ['beat_1'] },
            { title: '第二幕：高潮', description: '冲突爆发' },
        ],
        beats: [
            { id: 'beat_1', title: '开端', summary: 's', status: 'active' },
            { id: 'beat_2', act_id: 'act_2', name: '高潮', description: 'd', status: 'pending' },
        ],
    });
    assert.equal(o.acts.length, 2);
    assert.equal(o.acts[0].id, 'act_1');
    assert.equal(o.acts[1].title, '第二幕：高潮');
    assert.equal(o.acts[1].summary, '冲突爆发');
    assert.equal(o.beats[0].actId, 'act_1'); // 从 acts[0].beats 推断
    assert.equal(o.beats[1].actId, 'act_2'); // 兼容 act_id 字段
});

test('normalizeOutline keeps beat type, arc status and foreshadow payoff beat', () => {
    const o = normalizeOutline({
        beats: [{ id: 'b1', title: 't', summary: 's', type: 'climax', status: 'active' }],
        arcs: [{ char: '甲', growth: '成长', status: 'active' }],
        foreshadowing: [{ id: 'f1', hint: '伏笔', status: 'paid', beatId: 'b1' }],
    });
    assert.equal(o.beats[0].type, 'climax');
    assert.equal(o.arcs[0].status, 'active');
    assert.equal(o.foreshadowing[0].beatId, 'b1');
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

test('normalizeOutline accepts arcs as string array', () => {
    const o = normalizeOutline({
        arcs: ['黄坤：从战术家到战略破局者', '司马朗：从世家公子到实干治道'],
    });
    assert.equal(o.arcs.length, 2);
    assert.equal(o.arcs[0].char, '黄坤');
    assert.equal(o.arcs[0].growth, '从战术家到战略破局者');
});

test('normalizeOutline accepts beats with name/description fields', () => {
    const o = normalizeOutline({
        beats: [
            { id: 'beat_1', name: '落马余波', description: '焦土决断' },
        ],
    });
    assert.equal(o.beats.length, 1);
    assert.equal(o.beats[0].title, '落马余波');
    assert.equal(o.beats[0].summary, '焦土决断');
});

test('normalizeOutline accepts focus with immediate_goal field', () => {
    const o = normalizeOutline({
        focus: { currentBeat: 'b1', immediate_goal: '打破僵局', current_situation: '战场刚平静' },
    });
    assert.equal(o.focus.nextStep, '打破僵局');
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
