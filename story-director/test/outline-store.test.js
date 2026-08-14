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
