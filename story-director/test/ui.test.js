// story-director/test/ui.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampWindowPos } from '../src/ui.js';

test('clampWindowPos keeps an in-view position unchanged', () => {
    assert.deepEqual(
        clampWindowPos({ left: 100, top: 80 }, { viewportW: 1200, viewportH: 800, winW: 600, winH: 400 }),
        { left: 100, top: 80 },
    );
});

test('clampWindowPos clamps right/bottom overflow to keep window fully visible', () => {
    assert.deepEqual(
        clampWindowPos({ left: 1100, top: 700 }, { viewportW: 1200, viewportH: 800, winW: 600, winH: 400 }),
        { left: 600, top: 400 },
    );
});

test('clampWindowPos clamps negative positions to 0', () => {
    assert.deepEqual(
        clampWindowPos({ left: -50, top: -20 }, { viewportW: 1200, viewportH: 800, winW: 600, winH: 400 }),
        { left: 0, top: 0 },
    );
});

test('clampWindowPos returns null when no numeric position is stored', () => {
    assert.equal(clampWindowPos(null, { viewportW: 1200, viewportH: 800, winW: 600, winH: 400 }), null);
    assert.equal(clampWindowPos({}, { viewportW: 1200, viewportH: 800, winW: 600, winH: 400 }), null);
    assert.equal(clampWindowPos({ left: 'x', top: undefined }, { viewportW: 1200, viewportH: 800, winW: 600, winH: 400 }), null);
});

test('clampWindowPos pins window to top-left when it is larger than the viewport', () => {
    assert.deepEqual(
        clampWindowPos({ left: 300, top: 200 }, { viewportW: 500, viewportH: 300, winW: 800, winH: 600 }),
        { left: 0, top: 0 },
    );
});
