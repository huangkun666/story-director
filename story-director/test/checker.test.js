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
