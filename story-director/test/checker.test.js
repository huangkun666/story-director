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

test('applyCheckResult respects lockOutline and keeps manual edits', () => {
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
    assert.equal(outline.timeline.start, '200年'); // 时间线不被覆盖
    assert.equal(outline.beats[0].title, '手动标题'); // 内容不被覆盖
    assert.equal(outline.beats[0].status, 'done'); // 状态可以推进
});
