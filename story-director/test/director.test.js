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

test('director.generate keeps user-specified timeline after LLM returns outline', async () => {
    const patch = createEmptyOutline();
    patch.theme = 'X';
    const { deps } = makeDeps({ generateRaw: async () => JSON.stringify(patch) });
    const d = createDirector(deps);
    await d.generate({
        userRequest: '',
        timeline: { start: '建安五年', end: '建安十三年', note: '含赤壁' },
    });
    assert.deepEqual(deps.getOutline().timeline, {
        start: '建安五年',
        end: '建安十三年',
        note: '含赤壁',
    });
});

test('director.revise skips when already running (concurrency guard)', async () => {
    const { deps } = makeDeps({
        generateRaw: async () => { await new Promise(r => setTimeout(r, 20)); return JSON.stringify(createEmptyOutline()); },
    });
    const d = createDirector(deps);
    const p1 = d.revise();
    const p2 = d.revise();
    const r1 = await p1;
    const r2 = await p2;
    assert.notEqual(r1, null);
    assert.equal(r2, null); // 第二次被并发守卫丢弃
});

test('director.revise keeps old outline when LLM returns null', async () => {
    const { deps } = makeDeps({ generateRaw: async () => 'garbage' });
    const d = createDirector(deps);
    const before = deps.getOutline();
    await d.revise();
    assert.equal(deps.getOutline(), before);
});

test('director.revise passes driftTolerance setting into revision prompt', async () => {
    let receivedPrompt = '';
    const { deps } = makeDeps({
        generateRaw: async (opts) => {
            receivedPrompt = opts.prompt;
            return JSON.stringify(createEmptyOutline());
        },
        getSettings: () => ({ enabled: true, recentTurns: 5, driftTolerance: 'strict' }),
    });
    const d = createDirector(deps);
    await d.revise();
    assert.ok(receivedPrompt.includes('严格拉回'));
});

test('director.check applies modified outline when changed is true', async () => {
    const calls = [];
    const newOutline = createEmptyOutline();
    newOutline.theme = 'updated';
    const { deps } = makeDeps({
        generateRaw: async () => JSON.stringify({
            verdict: 'major-drift',
            changed: true,
            changes: '调整主题',
            reason: '剧情已偏离',
            updatedOutline: newOutline,
        }),
    });
    deps.renderOutline = () => { calls.push('render'); };
    const d = createDirector(deps);
    const report = await d.check();
    assert.equal(report.verdict, 'major-drift');
    assert.equal(report.changed, true);
    assert.equal(deps.getOutline().theme, 'updated');
    assert.ok(calls.includes('render'));
});

test('director.check returns null and keeps outline on null result', async () => {
    const { deps } = makeDeps({ generateRaw: async () => 'garbage' });
    const before = deps.getOutline();
    const d = createDirector(deps);
    const report = await d.check();
    assert.equal(report, null);
    assert.equal(deps.getOutline(), before);
});
