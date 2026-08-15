// story-director/test/tracker.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRevision } from '../src/tracker.js';
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
    prev.acts = [{ id: 'a1', title: '第一幕·手改', summary: '手动概要', beats: ['b1'] }];
    prev.beats = [{ id: 'b1', actId: 'a1', title: '手动标题', summary: '手动概要', type: 'twist', status: 'active' }];

    const patch = createEmptyOutline();
    patch.timeline = { start: '300年', end: '400年', note: '模型想改' };
    patch.acts = [{ id: 'a1', title: '模型改幕', summary: '模型概要', beats: ['b1'] }];
    patch.beats = [{ id: 'b1', actId: 'a1', title: '模型改标题', summary: '模型概要', type: 'climax', status: 'done' }];

    const out = applyRevision(prev, patch, { lockOutline: true });
    assert.equal(out.timeline.start, '200年');
    assert.equal(out.acts[0].title, '第一幕·手改');
    assert.equal(out.beats[0].title, '手动标题');
    assert.equal(out.beats[0].summary, '手动概要');
    assert.equal(out.beats[0].type, 'twist');
    assert.equal(out.beats[0].status, 'done'); // 状态允许推进
});
