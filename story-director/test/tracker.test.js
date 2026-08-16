// story-director/test/tracker.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRevision, applyPatch } from '../src/tracker.js';
import { createEmptyOutline } from '../src/outline-store.js';

test('applyRevision merges revision fields into outline', () => {
    const prev = createEmptyOutline();
    prev.theme = '复仇';
    const patch = createEmptyOutline();
    patch.theme = '救赎';
    patch.beats = [{ id: 'b1', title: '开端', summary: 's', status: 'active' }];
    const out = applyRevision(prev, patch);
    assert.equal(out.theme, '救赎');
    assert.equal(out.beats.length, 1);
});

test('applyRevision increments revisionCount', () => {
    const prev = createEmptyOutline();
    prev.meta.revisionCount = 3;
    const out = applyRevision(prev, createEmptyOutline());
    assert.equal(out.meta.revisionCount, 4);
});

test('applyRevision returns prev unchanged when patch is null', () => {
    const prev = createEmptyOutline();
    prev.theme = 'X';
    const out = applyRevision(prev, null);
    assert.equal(out.theme, 'X');
    assert.equal(out.meta.revisionCount, 0);
});

test('applyRevision sets updatedAt to non-empty', () => {
    const out = applyRevision(createEmptyOutline(), createEmptyOutline());
    assert.ok(typeof out.meta.updatedAt === 'string');
    assert.ok(out.meta.updatedAt.length > 0);
});

test('applyRevision preserves manually edited beats and timeline when locked', () => {
    const prev = createEmptyOutline();
    prev.timeline = { start: '200年', end: '208年', note: '手动改' };
    prev.mustRead = '手动必读设定';
    prev.acts = [{ id: 'a1', title: '第一幕·手改', summary: '手动概要', beats: ['b1'] }];
    prev.beats = [{ id: 'b1', actId: 'a1', title: '手动标题', summary: '手动概要', type: 'twist', status: 'active' }];

    const patch = createEmptyOutline();
    patch.timeline = { start: '300年', end: '400年', note: '模型想改' };
    patch.mustRead = '模型想改的设定';
    patch.acts = [{ id: 'a1', title: '模型改幕', summary: '模型概要', beats: ['b1'] }];
    patch.beats = [{ id: 'b1', actId: 'a1', title: '模型改标题', summary: '模型概要', type: 'climax', status: 'done' }];

    const out = applyRevision(prev, patch, { lockOutline: true });
    assert.equal(out.timeline.start, '200年');
    assert.equal(out.mustRead, '手动必读设定'); // 必读设定同时间线：手动编辑不被覆盖
    assert.equal(out.acts[0].title, '第一幕·手改');
    assert.equal(out.beats[0].title, '手动标题');
    assert.equal(out.beats[0].summary, '手动概要');
    assert.equal(out.beats[0].type, 'twist');
    assert.equal(out.beats[0].status, 'done'); // 状态允许推进
});

test('applyRevision restores compacted done-beat details from previous outline', () => {
    const prev = createEmptyOutline();
    prev.beats = [{ id: 'b1', title: '旧标题', summary: '旧概要', type: 'climax', status: 'done', cast: ['主角', '配角'] }];
    const patch = createEmptyOutline();
    patch.beats = [{ id: 'b1', title: '旧标题', status: 'done' }]; // 压缩后的骨架
    patch.focus.nextStep = '下一步';
    const out = applyRevision(prev, patch);
    const beat = out.beats.find(b => b.id === 'b1');
    assert.equal(beat.summary, '旧概要');
    assert.equal(beat.type, 'climax');
    assert.deepEqual(beat.cast, ['主角', '配角']);
});

test('applyPatch applies status/focus/foreshadowing/arc changes only', () => {
    const prev = createEmptyOutline();
    prev.beats = [
        { id: 'b1', actId: 'a1', title: '开端', summary: 's1', type: 'setup', status: 'active', cast: ['主角'] },
        { id: 'b2', actId: 'a1', title: '冲突', summary: 's2', type: 'conflict', status: 'pending', cast: ['主角'] },
    ];
    prev.acts = [{ id: 'a1', title: '第一幕', summary: '', beats: ['b1', 'b2'] }];
    prev.focus = { currentBeat: 'b1', nextStep: '旧', activeForeshadow: [], avoidOffTopic: '' };
    prev.foreshadowing = [{ id: 'f1', hint: '旧伏笔', status: 'pending', payoff: '', beatId: 'b2' }];
    prev.arcs = [{ char: '主角', desire: 'd', flaw: '', growth: 'g', status: 'active' }];

    const out = applyPatch(prev, {
        statusChanges: [{ beatId: 'b1', status: 'done' }, { beatId: 'b2', status: 'active' }],
        focus: { currentBeat: 'b2', nextStep: '新方向', activeForeshadow: ['f1'], avoidOffTopic: '别偏离' },
        foreshadowing: [{ id: 'f1', status: 'active' }],
        arcs: [{ char: '主角', status: 'done' }],
    });
    assert.equal(out.beats[0].status, 'done');
    assert.equal(out.beats[1].status, 'active');
    assert.equal(out.beats[0].title, '开端'); // 内容未动
    assert.equal(out.focus.nextStep, '新方向');
    assert.equal(out.focus.avoidOffTopic, '别偏离');
    assert.equal(out.foreshadowing[0].status, 'active');
    assert.equal(out.arcs[0].status, 'done');
    assert.equal(out.meta.revisionCount, 1);
});

test('applyPatch ignores unknown beatIds and invalid statuses', () => {
    const prev = createEmptyOutline();
    prev.beats = [{ id: 'b1', title: '开端', status: 'pending' }];
    const out = applyPatch(prev, {
        statusChanges: [{ beatId: 'nope', status: 'done' }, { beatId: 'b1', status: 'weird' }],
        focus: { nextStep: 'ok' },
    });
    assert.equal(out.beats[0].status, 'pending');
    assert.equal(out.focus.nextStep, 'ok');
});

test('applyPatch appends new beats with act assignment', () => {
    const prev = createEmptyOutline();
    prev.acts = [{ id: 'a1', title: '第一幕', beats: [] }];
    const out = applyPatch(prev, {
        newBeatActId: 'a1',
        newBeats: [{ title: '新增', summary: '新内容', type: 'twist', cast: ['主角'] }],
    });
    assert.equal(out.beats.length, 1);
    assert.equal(out.beats[0].title, '新增');
    assert.equal(out.beats[0].actId, 'a1');
    assert.equal(out.beats[0].type, 'twist');
    assert.deepEqual(out.acts[0].beats, [out.beats[0].id]);
});

test('applyPatch falls back to focus beat act when newBeatActId is invalid', () => {
    const prev = createEmptyOutline();
    prev.acts = [{ id: 'a1', title: '第一幕', beats: ['b1'] }];
    prev.beats = [{ id: 'b1', actId: 'a1', title: '当前', status: 'active' }];
    prev.focus.currentBeat = 'b1';
    const out = applyPatch(prev, { newBeatActId: 'nonexistent', newBeats: [{ title: 'x' }] });
    assert.equal(out.beats[1].actId, 'a1');
});

test('applyPatch returns prev normalized when patch is null', () => {
    const prev = createEmptyOutline();
    prev.theme = 'X';
    const out = applyPatch(prev, null);
    assert.equal(out.theme, 'X');
    assert.equal(out.meta.revisionCount, 0);
});
