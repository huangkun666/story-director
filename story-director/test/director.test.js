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
        mustRead: '',
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

test('director.generate forwards retrieval hits to setRetrievalHits', async () => {
    const hits = [{ query: 'q1', source: '资料A', text: '内容A' }];
    const received = [];
    const { deps } = makeDeps({
        getVectorMemory: async () => ({ text: '【资料A】内容A', hits }),
        setRetrievalHits: (h) => { received.push(h); },
    });
    const d = createDirector(deps);
    await d.generate({ userRequest: '测试' });
    assert.equal(received.length, 1);
    assert.deepEqual(received[0], hits);
});

test('director.revise falls back to getVectorMemoryContext when getVectorMemory absent', async () => {
    let receivedPrompt = '';
    let receivedHits = 'unset';
    const { deps } = makeDeps({
        generateRaw: async (opts) => {
            receivedPrompt = opts.prompt;
            return JSON.stringify(createEmptyOutline());
        },
        getVectorMemoryContext: async () => '【旧接口资料】兜底内容',
        setRetrievalHits: (h) => { receivedHits = h; },
    });
    const d = createDirector(deps);
    await d.revise();
    assert.ok(receivedPrompt.includes('兜底内容'));
    assert.deepEqual(receivedHits, []); // 旧接口没有结构化命中，清空展示
});

test('director.generate passes empty hits when vector memory disabled', async () => {
    const received = [];
    const { deps } = makeDeps({
        getVectorMemory: async () => ({ text: '', hits: [] }),
        setRetrievalHits: (h) => { received.push(h); },
    });
    const d = createDirector(deps);
    await d.generate({ userRequest: '测试' });
    assert.equal(received.length, 1);
    assert.deepEqual(received[0], []);
});

test('director.revise uses patch merge when outline is locked', async () => {
    const prev = createEmptyOutline();
    prev.beats = [{ id: 'b1', title: '手动标题', summary: '手动概要', status: 'active' }];
    let stored = prev;
    const { deps } = makeDeps({
        generateRaw: async () => JSON.stringify({
            statusChanges: [{ beatId: 'b1', status: 'done' }],
            focus: { nextStep: '推进' },
        }),
        getSettings: () => ({ enabled: true, recentTurns: 5, lockOutline: true, driftTolerance: 'loose' }),
    });
    deps.getOutline = () => stored;
    deps.setOutline = (o) => { stored = o; };
    const d = createDirector(deps);
    await d.revise();
    assert.equal(stored.beats[0].status, 'done');
    assert.equal(stored.beats[0].title, '手动标题'); // 锁定内容保留
    assert.equal(stored.focus.nextStep, '推进');
});

test('director.revise uses full merge when outline is not locked', async () => {
    let receivedPrompt = '';
    const { deps } = makeDeps({
        generateRaw: async (opts) => {
            receivedPrompt = opts.prompt;
            return JSON.stringify(createEmptyOutline());
        },
        getSettings: () => ({ enabled: true, recentTurns: 5, lockOutline: false, driftTolerance: 'loose' }),
    });
    const d = createDirector(deps);
    await d.revise();
    assert.ok(receivedPrompt.includes('更新后的完整大纲')); // 全量修订路径
    assert.ok(!receivedPrompt.includes('statusChanges'));
});

test('director.check records verdict into meta.checkHistory even when unchanged', async () => {
    const { deps } = makeDeps({
        generateRaw: async () => JSON.stringify({ verdict: 'minor-drift', changed: false, reason: '轻微偏差' }),
    });
    const d = createDirector(deps);
    await d.check();
    const history = deps.getOutline().meta.checkHistory;
    assert.equal(history.length, 1);
    assert.equal(history[0].verdict, 'minor-drift');
});

test('director.check appends verdict history across multiple runs', async () => {
    let verdicts = ['sync', 'major-drift'];
    const { deps } = makeDeps({
        generateRaw: async () => JSON.stringify({ verdict: verdicts.shift(), changed: false }),
    });
    const d = createDirector(deps);
    await d.check();
    await d.check();
    const history = deps.getOutline().meta.checkHistory;
    assert.equal(history.length, 2);
    assert.equal(history[0].verdict, 'major-drift'); // 最新在前
    assert.equal(history[1].verdict, 'sync');
});

test('director.isRunning is true while a call is in flight', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const { deps } = makeDeps({
        generateRaw: async () => { await gate; return JSON.stringify(createEmptyOutline()); },
    });
    const d = createDirector(deps);
    const p = d.revise();
    assert.equal(d.isRunning(), true); // 执行中
    release();
    await p;
    assert.equal(d.isRunning(), false); // 结束后复位
});

test('director.suggestBeat returns a normalized beat suggestion', async () => {
    const { deps } = makeDeps({
        generateRaw: async () => JSON.stringify({
            title: '发现阴谋',
            summary: '主角在宴会上发现对手的密信',
            type: 'twist',
            cast: ['主角', '对手'],
            actId: 'act_2',
        }),
    });
    const d = createDirector(deps);
    const beat = await d.suggestBeat({ userHint: '发现阴谋' });
    assert.equal(beat.title, '发现阴谋');
    assert.equal(beat.summary, '主角在宴会上发现对手的密信');
    assert.equal(beat.type, 'twist');
    assert.deepEqual(beat.cast, ['主角', '对手']);
    assert.equal(beat.actId, 'act_2');
});

test('director.suggestBeat normalizes invalid fields', async () => {
    const { deps } = makeDeps({
        generateRaw: async () => JSON.stringify({
            title: '  X  ',
            type: 'bogus',
            cast: ['A', '', 'B'],
            actId: 42,
        }),
    });
    const d = createDirector(deps);
    const beat = await d.suggestBeat({});
    assert.equal(beat.title, 'X'); // trim
    assert.equal(beat.type, 'setup'); // 非法类型回落
    assert.deepEqual(beat.cast, ['A', 'B']); // 空串过滤
    assert.equal(beat.actId, '42'); // 转字符串
});

test('director.suggestBeat returns null on garbage output', async () => {
    const { deps } = makeDeps({ generateRaw: async () => 'garbage' });
    const d = createDirector(deps);
    assert.equal(await d.suggestBeat({ userHint: 'x' }), null);
});

test('director.generate preserves done beats as history by default', async () => {
    const prev = createEmptyOutline();
    prev.beats = [{ id: 'b1', title: '已发生', summary: 's', status: 'done' }];
    let stored = prev;
    const { deps } = makeDeps({
        generateRaw: async () => JSON.stringify({ theme: '新', beats: [{ id: 'beat_1', title: '新节点', status: 'active' }] }),
        getSettings: () => ({ enabled: true, recentTurns: 5 }),
    });
    deps.getOutline = () => stored;
    deps.setOutline = (o) => { stored = o; };
    const d = createDirector(deps);
    await d.generate({ userRequest: '测试' });
    assert.ok(stored.acts.some(a => a.id === 'act_history')); // 前情幕
    assert.equal(stored.beats[0].id, 'hist_b1'); // 旧 done 节点保留在最前
    assert.equal(stored.beats[0].status, 'done');
    assert.equal(stored.beats[1].title, '新节点');
});

test('director.generate skips history merge when preserveHistory is false', async () => {
    const prev = createEmptyOutline();
    prev.beats = [{ id: 'b1', title: '已发生', status: 'done' }];
    let stored = prev;
    const { deps } = makeDeps({
        generateRaw: async () => JSON.stringify({ theme: '新', beats: [{ id: 'beat_1', title: '新节点', status: 'active' }] }),
        getSettings: () => ({ enabled: true, recentTurns: 5, preserveHistory: false }),
    });
    deps.getOutline = () => stored;
    deps.setOutline = (o) => { stored = o; };
    const d = createDirector(deps);
    await d.generate({ userRequest: '测试' });
    assert.ok(!stored.acts.some(a => a.id === 'act_history'));
    assert.deepEqual(stored.beats.map(b => b.id), ['beat_1']);
});

test('director.generate passes the ongoing beat as fact boundary to the prompt', async () => {
    let receivedPrompt = '';
    const prev = createEmptyOutline();
    prev.beats = [{ id: 'b1', title: '追查阴谋', summary: '主角潜入都城', status: 'active' }];
    let stored = prev;
    const { deps } = makeDeps({
        generateRaw: async (opts) => {
            receivedPrompt = opts.prompt;
            return JSON.stringify({ theme: '新', beats: [{ id: 'beat_1', title: '新节点', status: 'active' }] });
        },
        getSettings: () => ({ enabled: true, recentTurns: 5 }),
    });
    deps.getOutline = () => stored;
    deps.setOutline = (o) => { stored = o; };
    const d = createDirector(deps);
    await d.generate({ userRequest: '测试', timeline: { start: '建安五年', end: '建安十三年' } });
    assert.ok(receivedPrompt.includes('事实边界'));
    assert.ok(receivedPrompt.includes('追查阴谋'));
    assert.ok(receivedPrompt.includes('主角潜入都城'));
});
