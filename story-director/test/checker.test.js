// story-director/test/checker.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCheckResult, normalizeReport } from '../src/checker.js';
import { createEmptyOutline } from '../src/outline-store.js';

test('normalizeReport fills missing fields with defaults', () => {
    const r = normalizeReport({ verdict: 'sync' });
    assert.equal(r.verdict, 'sync');
    assert.equal(r.changed, false);
    assert.ok(Array.isArray(r.issues));
    assert.equal(typeof r.reason, 'string');
});

test('applyCheckResult keeps outline when report.changed is false', () => {
    const o = createEmptyOutline();
    o.theme = 'X';
    const { outline, report } = applyCheckResult(o, { verdict: 'sync', changed: false });
    assert.equal(outline.theme, 'X');
    assert.equal(report.changed, false);
});

test('applyCheckResult applies modified outline when changed is true', () => {
    const o = createEmptyOutline();
    o.theme = 'old';
    const newOutline = createEmptyOutline();
    newOutline.theme = 'new';
    const { outline, report } = applyCheckResult(o, {
        verdict: 'major-drift',
        changed: true,
        changes: '调整主题',
        updatedOutline: newOutline,
    });
    assert.equal(outline.theme, 'new');
    assert.equal(report.changed, true);
});

test('applyCheckResult handles null report gracefully', () => {
    const o = createEmptyOutline();
    const { outline, report } = applyCheckResult(o, null);
    assert.equal(outline, o);
    assert.equal(report.verdict, 'sync');
});

test('applyCheckResult merges incrementally and keeps manual edits (any lock mode)', () => {
    const o = createEmptyOutline();
    o.timeline = { start: '200年', end: '208年', note: '', mustRead: '' };
    o.beats = [{ id: 'b1', title: '手动标题', summary: '手动概要', type: 'twist', status: 'active' }];
    const newOutline = createEmptyOutline();
    newOutline.timeline = { start: '300年', end: '400年', note: '', mustRead: '' };
    newOutline.beats = [{ id: 'b1', title: '模型标题', summary: '模型概要', type: 'climax', status: 'done' }];
    const { outline, report } = applyCheckResult(o, {
        verdict: 'major-drift',
        changed: true,
        updatedOutline: newOutline,
    }, { lockOutline: true });
    assert.equal(report.changed, true);
    assert.equal(outline.timeline.start, '300年'); // 体检放行时间线顺延
    assert.equal(outline.beats[0].title, '手动标题'); // 手动内容不被覆盖
    assert.equal(outline.beats[0].summary, '手动概要');
    assert.equal(outline.beats[0].type, 'twist');
    assert.equal(outline.beats[0].status, 'done'); // 状态可以推进
});

test('applyCheckResult without lockOutline also preserves manual edits', () => {
    const o = createEmptyOutline();
    o.beats = [{ id: 'b1', title: '手动标题', summary: '手动概要', type: 'setup', status: 'pending' }];
    const newOutline = createEmptyOutline();
    newOutline.beats = [{ id: 'b1', title: '模型标题', summary: '模型概要', type: 'climax', status: 'done' }];
    const { outline } = applyCheckResult(o, {
        verdict: 'sync',
        changed: true,
        updatedOutline: newOutline,
    }, { lockOutline: false });
    assert.equal(outline.beats[0].title, '手动标题'); // 非锁定也不再全量替换
    assert.equal(outline.beats[0].status, 'done');
});

test('applyCheckResult keeps beats the model forgot to include', () => {
    const o = createEmptyOutline();
    o.beats = [
        { id: 'b1', title: '节点一', summary: 's1', type: 'setup', status: 'pending' },
        { id: 'b2', title: '节点二', summary: 's2', type: 'conflict', status: 'pending' },
    ];
    const newOutline = createEmptyOutline();
    newOutline.beats = [{ id: 'b1', title: '模型改', summary: 's', type: 'twist', status: 'done' }]; // b2 漏输出
    const { outline } = applyCheckResult(o, { verdict: 'minor-drift', changed: true, updatedOutline: newOutline });
    assert.ok(outline.beats.some(b => b.id === 'b2')); // 漏输出的节点保留
    assert.equal(outline.beats.find(b => b.id === 'b2').title, '节点二');
    assert.equal(outline.beats.find(b => b.id === 'b1').status, 'done'); // 状态吸收
});
