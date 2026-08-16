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

test('director.generate keeps user-specified mustRead as top-level field', async () => {
    const patch = createEmptyOutline();
    patch.theme = 'X';
    const { deps } = makeDeps({ generateRaw: async () => JSON.stringify(patch) });
    const d = createDirector(deps);
    await d.generate({
        userRequest: '',
        mustRead: '这个世界魔法会消耗寿命',
    });
    assert.equal(deps.getOutline().mustRead, '这个世界魔法会消耗寿命');
    assert.equal(deps.getOutline().timeline.mustRead, undefined); // 不再落进 timeline
});

test('director.generate inherits stored mustRead when not explicitly passed', async () => {
    const patch = createEmptyOutline();
    patch.theme = 'X';
    const { deps } = makeDeps({ generateRaw: async () => JSON.stringify(patch) });
    deps.getOutline().mustRead = '已有必读设定';
    const d = createDirector(deps);
    await d.generate({ userRequest: '' });
    assert.equal(deps.getOutline().mustRead, '已有必读设定');
});

test('director.generate migrates model timeline.mustRead output to top-level', async () => {
    const patch = createEmptyOutline();
    patch.timeline = { start: '200年', end: '208年', note: '', mustRead: '模型给的设定' };
    const { deps } = makeDeps({ generateRaw: async () => JSON.stringify(patch) });
    const d = createDirector(deps);
    await d.generate({ userRequest: '' });
    const o = deps.getOutline();
    assert.equal(o.mustRead, '模型给的设定'); // normalize 迁移到顶层
    assert.equal(o.timeline.mustRead, undefined);
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

test('director.analyzeDialogueTags returns normalized rule suggestions', async () => {
    const { deps } = makeDeps({
        generateRaw: async () => JSON.stringify({
            patterns: [
                { open: '【', close: '】', label: '正文', sample: '主角: 我们进城吧' },
                { open: '', close: 'x', label: '坏的' }, // 非法规则被过滤
            ],
            note: '正文包裹在【】中',
        }),
        getRecentDialogue: () => '主角: 【我们进城吧】',
    });
    const d = createDirector(deps);
    const suggestion = await d.analyzeDialogueTags();
    assert.equal(suggestion.rules.length, 1);
    assert.equal(suggestion.rules[0].open, '【');
    assert.equal(suggestion.rules[0].close, '】');
    assert.equal(suggestion.rules[0].sample, '主角: 我们进城吧');
    assert.equal(suggestion.note, '正文包裹在【】中');
});

test('director.analyzeDialogueTags normalizes html_tag rules and filters invalid tags', async () => {
    const { deps } = makeDeps({
        generateRaw: async () => JSON.stringify({
            patterns: [
                { type: 'html_tag', tag: '<content>', label: '正文', sample: '我们进城吧' },
                { type: 'html_tag', tag: 'bad tag', label: '坏标签' }, // 非法标签名被过滤
                { type: 'html_tag', tag: '', label: '空标签' },        // 空标签被过滤
                { open: '*', close: '*', label: '心声' },
            ],
            note: '正文在 content 标签里',
        }),
        getRecentDialogue: () => 'AI: <think>x</think>\n<content>我们进城吧</content>',
    });
    const d = createDirector(deps);
    const suggestion = await d.analyzeDialogueTags();
    assert.equal(suggestion.rules.length, 2); // content + 字符对
    assert.equal(suggestion.rules[0].tag, 'content'); // <content> 写法被归一化为 content
    assert.equal(suggestion.rules[0].sample, '我们进城吧');
    assert.equal(suggestion.rules[1].open, '*');
    assert.equal(suggestion.note, '正文在 content 标签里');
});

test('director.analyzeDialogueTags falls back to parsing tag from sample', async () => {
    // 模型没给 tag 字段、只给了示例（示例里带标签）：从 sample 兜底解析标签名
    const { deps } = makeDeps({
        generateRaw: async () => JSON.stringify({
            patterns: [
                { type: 'html_tag', label: '正文', sample: '<content>我们进城吧</content>' },
                { type: 'html_tag', label: '思考', sample: '<think>让我想想</think>' },
                { label: '无标签示例', sample: '纯文本没有标签' }, // 解析不出 → 被过滤
            ],
        }),
        getRecentDialogue: () => 'AI: <content>我们进城吧</content>',
    });
    const d = createDirector(deps);
    const suggestion = await d.analyzeDialogueTags();
    assert.equal(suggestion.rules.length, 2);
    assert.equal(suggestion.rules[0].tag, 'content');
    assert.equal(suggestion.rules[1].tag, 'think');
    // 兼容 html_tag / tagName 字段名
    const { deps: deps2 } = makeDeps({
        generateRaw: async () => JSON.stringify({
            patterns: [{ html_tag: '<speech>', label: '正文', sample: '说话' }],
        }),
        getRecentDialogue: () => '',
    });
    const s2 = await createDirector(deps2).analyzeDialogueTags();
    assert.equal(s2.rules[0].tag, 'speech');
});

test('director.analyzeDialogueTags returns null on garbage output', async () => {
    const { deps } = makeDeps({ generateRaw: async () => 'garbage' });
    const d = createDirector(deps);
    assert.equal(await d.analyzeDialogueTags(), null);
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

test('director.generate includes recent dialogue when timeline unchanged (continue from present)', async () => {
    let receivedPrompt = '';
    const prev = createEmptyOutline();
    prev.timeline = { start: '建安五年', end: '建安十三年', note: '', mustRead: '' };
    prev.beats = [{ id: 'b1', title: '当前', summary: 's', status: 'active' }];
    let stored = prev;
    const { deps } = makeDeps({
        generateRaw: async (opts) => {
            receivedPrompt = opts.prompt;
            return JSON.stringify({ theme: '新' });
        },
        getRecentDialogue: () => '主角: 我们进城吧',
        getSettings: () => ({ enabled: true, recentTurns: 5 }),
    });
    deps.getOutline = () => stored;
    deps.setOutline = (o) => { stored = o; };
    const d = createDirector(deps);
    await d.generate({ userRequest: '测试', timeline: { start: '建安五年', end: '建安十三年', note: '', mustRead: '' } });
    assert.ok(receivedPrompt.includes('近期对话'));
    assert.ok(receivedPrompt.includes('我们进城吧'));
});

test('director.generate includes recent dialogue even when timeline was edited (memory lags ~20 turns)', async () => {
    let receivedPrompt = '';
    const prev = createEmptyOutline();
    prev.timeline = { start: '建安五年', end: '建安十三年', note: '', mustRead: '' };
    prev.beats = [{ id: 'b1', title: '当前', summary: 's', status: 'active' }];
    let stored = prev;
    const { deps } = makeDeps({
        generateRaw: async (opts) => {
            receivedPrompt = opts.prompt;
            return JSON.stringify({ theme: '新' });
        },
        getRecentDialogue: () => '主角: 我们进城吧',
        getSettings: () => ({ enabled: true, recentTurns: 5 }),
    });
    deps.getOutline = () => stored;
    deps.setOutline = (o) => { stored = o; };
    const d = createDirector(deps);
    await d.generate({ userRequest: '测试', timeline: { start: '建安十年', end: '建安十三年', note: '', mustRead: '' } });
    // 记忆库落后最近约 20 轮：无论是否改时间线，近期对话始终携带
    assert.ok(receivedPrompt.includes('近期对话'));
    assert.ok(receivedPrompt.includes('我们进城吧'));
});

test('director.generate includes recent dialogue on first generation (empty outline)', async () => {
    let receivedPrompt = '';
    const { deps } = makeDeps({
        generateRaw: async (opts) => {
            receivedPrompt = opts.prompt;
            return JSON.stringify({ theme: '新' });
        },
        getRecentDialogue: () => '主角: 出发',
        getSettings: () => ({ enabled: true, recentTurns: 5 }),
    });
    const d = createDirector(deps);
    await d.generate({ userRequest: '测试' });
    assert.ok(receivedPrompt.includes('近期对话'));
    assert.ok(receivedPrompt.includes('出发'));
});

test('director.generate trims cast query to the first five characters', async () => {
    const receivedQueries = [];
    const { deps } = makeDeps({
        generateRaw: async () => JSON.stringify({ theme: '新' }),
        getVectorMemory: async (queries) => { receivedQueries.push(...queries); return { text: '', hits: [] }; },
        getCharacterCard: () => ({
            name: 'Alice',
            cast: Array.from({ length: 8 }, (_, i) => `角色${i}（身份${i}）`).join('；'),
        }),
        getSettings: () => ({ enabled: true, recentTurns: 5 }),
    });
    const d = createDirector(deps);
    await d.generate({ userRequest: '测试' });
    const castQuery = receivedQueries.find(q => q.startsWith('角色与关系'));
    assert.ok(castQuery.includes('角色4')); // 前 5 个在内
    assert.ok(!castQuery.includes('角色5')); // 第 6 个被截掉
});

test('director.generate runs two-stage retrieval with model queries first', async () => {
    const calls = [];
    const receivedQueries = [];
    const { deps } = makeDeps({
        generateRaw: async (opts) => {
            calls.push(opts.prompt);
            // 第一次调用 = 方向草案；第二次 = 正式生成
            if (calls.length === 1) {
                return JSON.stringify({ direction: '追查曹操的皮甲，沁水渠决战', queries: ['曹操的皮甲', '沁水渠'] });
            }
            return JSON.stringify({ theme: '新' });
        },
        getVectorMemory: async (queries) => {
            receivedQueries.push(...queries);
            return { text: '【资料】皮甲情报', hits: [{ query: '曹操的皮甲', source: '资料', text: '皮甲情报' }] };
        },
        getCharacterCard: () => ({ name: 'Alice', cast: '黄坤（主角）；司马朗（配角）' }),
        getSettings: () => ({ enabled: true, recentTurns: 5 }),
    });
    const d = createDirector(deps);
    await d.generate({ userRequest: '测试' });
    // 定向查询在最前，保底查询随后
    assert.equal(receivedQueries[0], '曹操的皮甲');
    assert.equal(receivedQueries[1], '沁水渠');
    assert.ok(receivedQueries.some(q => q.startsWith('角色与关系')));
    // 正式生成 prompt 含方向草案与检索资料
    const finalPrompt = calls[1];
    assert.ok(finalPrompt.includes('大纲方向（先行草案'));
    assert.ok(finalPrompt.includes('追查曹操的皮甲'));
    assert.ok(finalPrompt.includes('皮甲情报'));
});

test('director.generate degrades to single-stage when direction draft fails', async () => {
    const calls = [];
    const { deps } = makeDeps({
        generateRaw: async (opts) => {
            calls.push(opts.prompt);
            if (calls.length === 1) return 'garbage'; // 草案解析失败
            return JSON.stringify({ theme: '新' });
        },
        getVectorMemory: async () => ({ text: '资料', hits: [] }),
        getSettings: () => ({ enabled: true, recentTurns: 5 }),
    });
    const d = createDirector(deps);
    const result = await d.generate({ userRequest: '测试' });
    assert.ok(result); // 生成不中断
    assert.equal(calls.length, 2);
    assert.ok(!calls[1].includes('大纲方向（先行草案')); // 无 direction 块
    assert.ok(calls[1].includes('资料')); // 保底检索结果仍在
});

test('director.generate skips direction draft when advancedRetrieval is off', async () => {
    const calls = [];
    const { deps } = makeDeps({
        generateRaw: async (opts) => {
            calls.push(opts.prompt);
            return JSON.stringify({ theme: '新' });
        },
        getVectorMemory: async () => ({ text: '', hits: [] }),
        getSettings: () => ({ enabled: true, recentTurns: 5, advancedRetrieval: false }),
    });
    const d = createDirector(deps);
    await d.generate({ userRequest: '测试' });
    assert.equal(calls.length, 1); // 单轮
    assert.ok(!calls[0].includes('大纲方向（先行草案'));
});

test('director.generate runs vector retrieval in two batches (model queries then fallback)', async () => {
    const batchCalls = [];
    let llmCalls = 0;
    const { deps } = makeDeps({
        generateRaw: async (opts) => {
            llmCalls++;
            if (llmCalls === 1) return JSON.stringify({ direction: '追查皮甲', queries: ['皮甲'] });
            return JSON.stringify({ theme: '新' });
        },
        getVectorMemory: async (queries) => { batchCalls.push([...queries]); return { text: '资料', hits: [] }; },
        getCharacterCard: () => ({ name: 'Alice', cast: '黄坤（主角）；司马朗（配角）' }),
        getSettings: () => ({ enabled: true, recentTurns: 5 }),
    });
    const d = createDirector(deps);
    await d.generate({ userRequest: '测试' });
    // 两次独立检索：模型定向一批 + 保底一批（终端可见两次搜索）
    assert.equal(batchCalls.length, 2);
    assert.deepEqual(batchCalls[0], ['皮甲']); // 第一批 = 模型定向查询
    assert.ok(batchCalls[1].some(q => q.startsWith('角色与关系'))); // 第二批 = 保底查询
});
