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
