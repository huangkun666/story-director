// story-director/test/director.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDirector } from '../src/director.js';
import { createEmptyOutline } from '../src/outline-store.js';

function makeDeps(overrides = {}) {
    let stored = createEmptyOutline();
    const calls = [];
    return {
        calls,
        deps: {
            generateRaw: async () => JSON.stringify(createEmptyOutline()),
            getOutline: () => stored,
            setOutline: (o) => { stored = o; },
            setInjectedInstruction: (text) => { calls.push(['inject', text]); },
            getSettings: () => ({ enabled: true, controlStrength: 'strong', injectTokenLimit: 300, recentTurns: 5 }),
            getRecentDialogue: () => 'A: 你好',
            getCharacterCard: () => ({ name: 'Alice' }),
            renderOutline: () => { calls.push(['render']); },
            ...overrides,
        },
    };
}

test('director.refreshInjection writes instruction when enabled', () => {
    const { deps, calls } = makeDeps();
    const d = createDirector(deps);
    d.refreshInjection();
    assert.ok(calls.some(([k]) => k === 'inject'));
});

test('director.refreshInjection clears injection when disabled', () => {
    const { deps, calls } = makeDeps({
        getSettings: () => ({ enabled: false, controlStrength: 'strong', injectTokenLimit: 300, recentTurns: 5 }),
    });
    const d = createDirector(deps);
    d.refreshInjection();
    assert.deepEqual(calls, [['inject', '']]);
});

test('director.generate writes outline and refreshes', async () => {
    const { deps, calls } = makeDeps();
    const d = createDirector(deps);
    await d.generate({ userRequest: '悲剧' });
    assert.ok(calls.some(([k]) => k === 'render'));
});

test('director.revise skips when already running (concurrency guard)', async () => {
    let running = true;
    const { deps } = makeDeps({
        generateRaw: async () => { await new Promise(r => setTimeout(r, 20)); return JSON.stringify(createEmptyOutline()); },
    });
    const d = createDirector(deps);
    const p1 = d.revise();
    running = false;
    const p2 = d.revise();
    await Promise.all([p1, p2]);
    assert.equal(deps.getOutline().meta.revisionCount, 1); // 第二次被并发守卫丢弃
});

test('director.revise keeps old outline when LLM returns null', async () => {
    const { deps } = makeDeps({ generateRaw: async () => 'garbage' });
    const d = createDirector(deps);
    const before = deps.getOutline();
    await d.revise();
    assert.equal(deps.getOutline(), before);
});
