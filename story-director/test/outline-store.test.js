// story-director/test/outline-store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyOutline, normalizeOutline, serializeOutline, deserializeOutline, jumpToBeat, createBeat, updateBeat, updateAct, removeBeat, moveBeatOrder, renumberActTitles, mergeHistoryIntoOutline, replaceActBeats, createArc, updateArc, removeArc, createForeshadow, updateForeshadow, removeForeshadow, createWorldEvent, updateWorldEvent, removeWorldEvent, diagnoseOutline } from '../src/outline-store.js';

test('createEmptyOutline returns valid empty structure', () => {
    const o = createEmptyOutline();
    assert.equal(o.version, 1);
    assert.equal(typeof o.theme, 'string');
    assert.equal(typeof o.tone, 'string');
    assert.equal(typeof o.world, 'string');
    assert.ok(Array.isArray(o.arcs));
    assert.ok(Array.isArray(o.foreshadowing));
    assert.ok(Array.isArray(o.acts));
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
    assert.ok(Array.isArray(o.acts));
    assert.equal(typeof o.focus, 'object');
    assert.deepEqual(o.timeline, { start: '', end: '', note: '' });
    assert.equal(o.mustRead, '');
});

test('normalizeOutline accepts timeline object and string forms', () => {
    const obj = normalizeOutline({ timeline: { start: '200年', end: '208年', note: '含赤壁' } });
    assert.equal(obj.timeline.start, '200年');
    assert.equal(obj.timeline.end, '208年');
    assert.equal(obj.timeline.note, '含赤壁');
    assert.equal(obj.mustRead, '');

    const str = normalizeOutline({ timeline: '建安五年 - 建安十三年' });
    assert.equal(str.timeline.start, '建安五年');
    assert.equal(str.timeline.end, '建安十三年');
});

test('normalizeOutline migrates legacy timeline.mustRead to top-level mustRead', () => {
    // 旧数据/模型输出：必读设定塞在 timeline 里 → 自动搬到顶层独立字段
    const legacy = normalizeOutline({
        timeline: { start: '200年', end: '208年', note: '', mustRead: '魔法会消耗寿命' },
    });
    assert.equal(legacy.mustRead, '魔法会消耗寿命');
    assert.equal(legacy.timeline.mustRead, undefined);
    // 顶层优先于 timeline 内旧值
    const both = normalizeOutline({
        mustRead: '顶层设定',
        timeline: { start: '', end: '', note: '', mustRead: '旧位置' },
    });
    assert.equal(both.mustRead, '顶层设定');
    // 兼容旧别名
    assert.equal(normalizeOutline({ timeline: { must_read: '蛇形别名' } }).mustRead, '蛇形别名');
    assert.equal(normalizeOutline({ timeline: { requiredLore: '老字段' } }).mustRead, '老字段');
});

test('normalizeOutline accepts acts and keeps beat actId', () => {
    const o = normalizeOutline({
        acts: [
            { id: 'act_1', title: '第一幕：开端', summary: '铺垫', beats: ['beat_1'] },
            { title: '第二幕：高潮', description: '冲突爆发' },
        ],
        beats: [
            { id: 'beat_1', title: '开端', summary: 's', status: 'active' },
            { id: 'beat_2', act_id: 'act_2', name: '高潮', description: 'd', status: 'pending' },
        ],
    });
    assert.equal(o.acts.length, 2);
    assert.equal(o.acts[0].id, 'act_1');
    assert.equal(o.acts[1].title, '第二幕：高潮');
    assert.equal(o.acts[1].summary, '冲突爆发');
    assert.equal(o.beats[0].actId, 'act_1'); // 从 acts[0].beats 推断
    assert.equal(o.beats[1].actId, 'act_2'); // 兼容 act_id 字段
});

test('normalizeOutline keeps beat type, arc status and foreshadow payoff beat', () => {
    const o = normalizeOutline({
        beats: [{ id: 'b1', title: 't', summary: 's', type: 'climax', status: 'active', cast: '主角，对手' }],
        arcs: [{ char: '甲', growth: '成长', status: 'active' }],
        foreshadowing: [{ id: 'f1', hint: '伏笔', status: 'paid', beatId: 'b1' }],
    });
    assert.equal(o.beats[0].type, 'climax');
    assert.deepEqual(o.beats[0].cast, ['主角', '对手']);
    assert.equal(o.arcs[0].status, 'active');
    assert.equal(o.foreshadowing[0].beatId, 'b1');
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

test('normalizeOutline accepts arcs with character/arc fields (Gemini actual output)', () => {
    const o = normalizeOutline({
        arcs: [
            { character: '黄坤', arc: '从地方军阀到霸主' },
            { char: '司马朗', desire: '复仇', flaw: '软弱', growth: '成长' },
        ],
    });
    assert.equal(o.arcs.length, 2);
    assert.equal(o.arcs[0].char, '黄坤');
    assert.equal(o.arcs[0].growth, '从地方军阀到霸主');
    assert.equal(o.arcs[1].char, '司马朗');
    assert.equal(o.arcs[1].desire, '复仇');
});

test('normalizeOutline accepts foreshadowing as string array (Gemini actual output)', () => {
    const o = normalizeOutline({
        foreshadowing: ['曹操的皮甲是阳谋', '沁水渠将成为战略武器'],
    });
    assert.equal(o.foreshadowing.length, 2);
    assert.equal(o.foreshadowing[0].hint, '曹操的皮甲是阳谋');
    assert.equal(o.foreshadowing[0].status, 'pending');
    assert.ok(o.foreshadowing[0].id); // 自动生成 id
});

test('normalizeOutline accepts foreshadowing objects with text field', () => {
    const o = normalizeOutline({
        foreshadowing: [{ text: '某伏笔', status: 'active' }],
    });
    assert.equal(o.foreshadowing.length, 1);
    assert.equal(o.foreshadowing[0].hint, '某伏笔');
    assert.equal(o.foreshadowing[0].status, 'active');
});

test('normalizeOutline accepts arcs as string array', () => {
    const o = normalizeOutline({
        arcs: ['黄坤：从战术家到战略破局者', '司马朗：从世家公子到实干治道'],
    });
    assert.equal(o.arcs.length, 2);
    assert.equal(o.arcs[0].char, '黄坤');
    assert.equal(o.arcs[0].growth, '从战术家到战略破局者');
});

test('normalizeOutline accepts beats with name/description fields', () => {
    const o = normalizeOutline({
        beats: [
            { id: 'beat_1', name: '落马余波', description: '焦土决断' },
        ],
    });
    assert.equal(o.beats.length, 1);
    assert.equal(o.beats[0].title, '落马余波');
    assert.equal(o.beats[0].summary, '焦土决断');
});

test('normalizeOutline accepts focus with immediate_goal field', () => {
    const o = normalizeOutline({
        focus: { currentBeat: 'b1', immediate_goal: '打破僵局', current_situation: '战场刚平静' },
    });
    assert.equal(o.focus.nextStep, '打破僵局');
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

test('jumpToBeat activates target and marks previous beats done', () => {
    const o = createEmptyOutline();
    o.beats = [
        { id: 'b1', title: '开端', status: 'active' },
        { id: 'b2', title: '发展', status: 'pending' },
        { id: 'b3', title: '高潮', status: 'pending' },
    ];
    const out = jumpToBeat(o, 'b2');
    assert.equal(out.beats[0].status, 'done'); // 之前的节点已完成
    assert.equal(out.beats[1].status, 'active'); // 目标是 active
    assert.equal(out.beats[2].status, 'pending'); // 之后保持
    assert.equal(out.focus.currentBeat, 'b2');
    assert.equal(out.focus.nextStep, ''); // 旧方向清空
});

test('jumpToBeat resets later active beats to pending', () => {
    const o = createEmptyOutline();
    o.beats = [
        { id: 'b1', title: '一', status: 'done' },
        { id: 'b2', title: '二', status: 'active' },
        { id: 'b3', title: '三', status: 'pending' },
    ];
    const out = jumpToBeat(o, 'b1');
    assert.equal(out.beats[0].status, 'active');
    assert.equal(out.beats[1].status, 'pending'); // 后面的 active 重置为待开始
    assert.equal(out.beats[2].status, 'pending');
});

test('jumpToBeat returns same outline when beat not found', () => {
    const o = createEmptyOutline();
    o.theme = 'X';
    o.beats = [{ id: 'b1', title: '开端', status: 'active' }];
    const out = jumpToBeat(o, 'nonexistent');
    assert.equal(out.theme, 'X');
    assert.equal(out.beats[0].status, 'active'); // 状态未被改动
    assert.equal(out.focus.currentBeat, 'b1'); // normalize 自愈补上当前节点
});

test('normalizeOutline fills missing currentBeat from first active beat', () => {
    const o = normalizeOutline({
        beats: [{ id: 'b2', title: '进行中', status: 'active' }],
    });
    assert.equal(o.focus.currentBeat, 'b2');
});

test('jumpToBeat does not mutate the input outline', () => {
    const o = createEmptyOutline();
    o.beats = [{ id: 'b1', title: '开端', status: 'pending' }, { id: 'b2', title: '发展', status: 'pending' }];
    jumpToBeat(o, 'b2');
    assert.equal(o.beats[0].status, 'pending'); // 入参未被修改
    assert.equal(o.focus.currentBeat, '');
});

test('normalizeOutline keeps valid checkHistory entries', () => {
    const o = normalizeOutline({
        meta: {
            checkHistory: [
                { at: '2026-01-01T00:00:00Z', verdict: 'sync' },
                { at: '2026-01-02T00:00:00Z', verdict: 'minor-drift' },
            ],
        },
    });
    assert.equal(o.meta.checkHistory.length, 2);
    assert.equal(o.meta.checkHistory[0].verdict, 'sync');
    assert.equal(o.meta.checkHistory[1].verdict, 'minor-drift');
});

test('normalizeOutline drops invalid checkHistory entries', () => {
    const o = normalizeOutline({
        meta: {
            checkHistory: [
                { at: '2026-01-01T00:00:00Z', verdict: 'sync' },
                { at: 'not-a-time', verdict: 'bogus' },
                { verdict: 'major-drift' }, // 缺 at
                'garbage',
                null,
            ],
        },
    });
    assert.equal(o.meta.checkHistory.length, 1);
    assert.equal(o.meta.checkHistory[0].verdict, 'sync');
});

test('normalizeOutline caps checkHistory at 10 entries', () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({ at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`, verdict: 'sync' }));
    const o = normalizeOutline({ meta: { checkHistory: entries } });
    assert.equal(o.meta.checkHistory.length, 10);
});

test('normalizeOutline derives acts.beats from beat.actId as single source of truth', () => {
    const o = normalizeOutline({
        acts: [
            { id: 'a1', title: '第一幕', beats: ['b1', 'b2'] }, // 陈旧列表
            { id: 'a2', title: '第二幕', beats: [] },
        ],
        beats: [
            { id: 'b1', actId: 'a1', title: '一', status: 'pending' },
            { id: 'b2', actId: 'a2', title: '二', status: 'pending' }, // actId 说在 a2
        ],
    });
    assert.deepEqual(o.acts[0].beats, ['b1']); // b2 按 actId 归入 a2
    assert.deepEqual(o.acts[1].beats, ['b2']);
});

test('normalizeOutline clears foreshadowing beatId pointing at a missing beat', () => {
    const o = normalizeOutline({
        beats: [{ id: 'b1', title: '一', status: 'pending' }],
        foreshadowing: [
            { id: 'f1', hint: '回收于已删节点', status: 'pending', beatId: 'beat_gone' },
            { id: 'f2', hint: '回收于现存节点', status: 'pending', beatId: 'b1' },
        ],
    });
    assert.equal(o.foreshadowing[0].beatId, '');
    assert.equal(o.foreshadowing[1].beatId, 'b1');
});

test('normalizeOutline filters dangling activeForeshadow ids', () => {
    const o = normalizeOutline({
        foreshadowing: [{ id: 'f1', hint: 'x', status: 'active' }],
        focus: { activeForeshadow: ['f1', 'f_gone'] },
    });
    assert.deepEqual(o.focus.activeForeshadow, ['f1']);
});

test('createBeat appends a normalized beat and derives act lists', () => {
    const o = createEmptyOutline();
    o.acts = [{ id: 'a1', title: '第一幕', beats: [] }];
    const out = createBeat(o, { title: '新节点', summary: '内容', type: 'twist', actId: 'a1', cast: ['主角'] });
    assert.equal(out.beats.length, 1);
    assert.equal(out.beats[0].title, '新节点');
    assert.equal(out.beats[0].type, 'twist');
    assert.deepEqual(out.acts[0].beats, [out.beats[0].id]);
    assert.equal(o.beats.length, 0); // 入参未修改
});

test('createBeat auto-creates the act when actId does not exist', () => {
    const o = createEmptyOutline();
    const out = createBeat(o, { title: 'x', actId: 'act_new' });
    assert.ok(out.acts.some(a => a.id === 'act_new'));
    assert.equal(out.beats[0].actId, 'act_new');
});

test('updateBeat changes fields and re-derives act membership on actId change', () => {
    const o = createEmptyOutline();
    o.acts = [{ id: 'a1', title: '一', beats: [] }, { id: 'a2', title: '二', beats: [] }];
    o.beats = [{ id: 'b1', actId: 'a1', title: '旧', summary: 's', type: 'setup', status: 'pending', cast: [] }];
    const out = updateBeat(o, 'b1', { title: '新标题', type: 'climax', actId: 'a2', cast: ['主角', '配角'] });
    assert.equal(out.beats[0].title, '新标题');
    assert.equal(out.beats[0].type, 'climax');
    assert.equal(out.beats[0].actId, 'a2');
    assert.deepEqual(out.acts[0].beats, []); // 旧幕移除
    assert.deepEqual(out.acts[1].beats, ['b1']); // 新幕加入
    assert.deepEqual(o.acts[0].beats, []); // 入参未修改
});

test('updateBeat ignores unknown beat and invalid type', () => {
    const o = createEmptyOutline();
    o.beats = [{ id: 'b1', title: 'x', type: 'setup', status: 'pending' }];
    const out = updateBeat(o, 'nope', { title: 'y' });
    assert.equal(out.beats[0].title, 'x');
    const out2 = updateBeat(o, 'b1', { type: 'bogus' });
    assert.equal(out2.beats[0].type, 'setup');
});

test('removeBeat deletes beat and heals dangling references', () => {
    const o = createEmptyOutline();
    o.acts = [{ id: 'a1', title: '一', beats: ['b1'] }];
    o.beats = [{ id: 'b1', actId: 'a1', title: '旧', status: 'active' }];
    o.foreshadowing = [{ id: 'f1', hint: 'h', status: 'pending', payoff: '', beatId: 'b1' }];
    o.focus.currentBeat = 'b1';
    const out = removeBeat(o, 'b1');
    assert.equal(out.beats.length, 0);
    assert.deepEqual(out.acts[0].beats, []); // 派生列表同步
    assert.equal(out.foreshadowing[0].beatId, ''); // 伏笔引用自愈
    assert.equal(out.focus.currentBeat, ''); // 焦点自愈（无剩余节点）
});

test('removeBeat heals focus to the next active/pending beat', () => {
    const o = createEmptyOutline();
    o.beats = [
        { id: 'b1', title: '当前', status: 'active' },
        { id: 'b2', title: '下一个', status: 'pending' },
    ];
    o.focus.currentBeat = 'b1';
    const out = removeBeat(o, 'b1');
    assert.equal(out.focus.currentBeat, 'b2');
});

test('moveBeatOrder swaps within the same act only', () => {
    const o = createEmptyOutline();
    o.beats = [
        { id: 'b1', actId: 'a1', title: '一', status: 'pending' },
        { id: 'b2', actId: 'a1', title: '二', status: 'pending' },
        { id: 'b3', actId: 'a2', title: '三', status: 'pending' },
    ];
    const down = moveBeatOrder(o, 'b1', 1);
    assert.equal(down.beats[0].id, 'b2'); // 与 b2 交换
    assert.equal(down.beats[1].id, 'b1');
    const up = moveBeatOrder(o, 'b1', -1);
    assert.deepEqual(up.beats.map(b => b.id), ['b1', 'b2', 'b3']); // 已在开头，不动
});

test('renumberActTitles renumbers numbered act titles in current order', () => {
    const o = createEmptyOutline();
    o.acts = [
        { id: 'a1', title: '第一幕：开端', summary: '', beats: [] },
        { id: 'a2', title: '第2幕 发展', summary: '', beats: [] },
        { id: 'a3', title: '高潮（未编号，不动）', summary: '', beats: [] },
    ];
    const out = renumberActTitles(o);
    assert.equal(out.acts[0].title, '第一幕：开端'); // 序号没变也规范化
    assert.equal(out.acts[1].title, '第二幕：发展'); // 中文数字统一
    assert.equal(out.acts[2].title, '高潮（未编号，不动）'); // 未编号不动
});

test('renumberActTitles fixes skipped numbers after deletion', () => {
    const o = createEmptyOutline();
    o.acts = [
        { id: 'a1', title: '第一幕', summary: '', beats: [] },
        { id: 'a2', title: '第三幕', summary: '', beats: [] }, // 第二幕被删过
        { id: 'a3', title: '第五幕：终局', summary: '', beats: [] },
    ];
    const out = renumberActTitles(o);
    assert.equal(out.acts[0].title, '第一幕：');
    assert.equal(out.acts[1].title, '第二幕：');
    assert.equal(out.acts[2].title, '第三幕：终局');
});

test('renumberActTitles uses arabic numerals beyond ten acts', () => {
    const o = createEmptyOutline();
    o.acts = Array.from({ length: 12 }, (_, i) => ({ id: `a${i + 1}`, title: `第${i + 1}幕`, summary: '', beats: [] }));
    const out = renumberActTitles(o);
    assert.equal(out.acts[9].title, '第十幕：'); // ≤10 用中文数字
    assert.equal(out.acts[10].title, '第11幕：'); // >10 用阿拉伯数字
    assert.equal(out.acts[11].title, '第12幕：');
});

test('mergeHistoryIntoOutline moves done beats into a leading history act', () => {
    const oldOutline = createEmptyOutline();
    oldOutline.acts = [{ id: 'a1', title: '旧幕', beats: ['b1', 'b2'] }];
    oldOutline.beats = [
        { id: 'b1', title: '已发生一', summary: 's1', type: 'conflict', status: 'done', actId: 'a1', cast: ['主角'] },
        { id: 'b2', title: '未发生', summary: 's2', type: 'setup', status: 'pending', actId: 'a1' },
    ];

    const newOutline = createEmptyOutline();
    newOutline.acts = [{ id: 'n1', title: '新幕', beats: [] }];
    newOutline.beats = [{ id: 'beat_1', actId: 'n1', title: '新节点', status: 'active' }];

    const out = mergeHistoryIntoOutline(newOutline, oldOutline);
    assert.equal(out.acts.length, 2);
    assert.equal(out.acts[0].id, 'act_history');
    assert.equal(out.acts[0].title.includes('前情'), true);
    // 只保留 done 节点，id 加 hist_ 前缀，排在前面
    assert.equal(out.beats.length, 2);
    assert.equal(out.beats[0].id, 'hist_b1');
    assert.equal(out.beats[0].title, '已发生一');
    assert.equal(out.beats[0].status, 'done');
    assert.equal(out.beats[0].actId, 'act_history');
    assert.deepEqual(out.acts[0].beats, ['hist_b1']); // 派生列表
    // 新大纲节点不受影响
    assert.equal(out.beats[1].id, 'beat_1');
    assert.deepEqual(out.acts[1].beats, ['beat_1']);
});

test('mergeHistoryIntoOutline keeps in-progress beats as the single active focus', () => {
    const oldOutline = createEmptyOutline();
    oldOutline.beats = [
        { id: 'b1', title: '已发生', status: 'done' },
        { id: 'b2', title: '正在进行', summary: 's', status: 'active' },
        { id: 'b3', title: '未发生', status: 'pending' },
    ];
    const newOutline = createEmptyOutline();
    newOutline.beats = [{ id: 'beat_1', title: '新节点', status: 'active' }]; // 模型输出的第一个 active

    const out = mergeHistoryIntoOutline(newOutline, oldOutline);
    assert.equal(out.beats.length, 3); // b1 + b2 保留 + 新节点
    assert.equal(out.beats[0].status, 'done');
    assert.equal(out.beats[1].id, 'hist_b2');
    assert.equal(out.beats[1].status, 'active'); // 进行中保留
    assert.equal(out.beats[2].id, 'beat_1');
    assert.equal(out.beats[2].status, 'pending'); // 新大纲的 active 降为 pending
    assert.equal(out.focus.currentBeat, 'hist_b2'); // 焦点指向进行中节点
    // 全大纲唯一 active
    assert.equal(out.beats.filter(b => b.status === 'active').length, 1);
});

test('mergeHistoryIntoOutline keeps only done beats when nothing is ongoing', () => {
    const oldOutline = createEmptyOutline();
    oldOutline.beats = [{ id: 'b1', title: '已发生', status: 'done' }];
    const newOutline = createEmptyOutline();
    newOutline.beats = [{ id: 'beat_1', title: '新起点', status: 'active' }];
    const out = mergeHistoryIntoOutline(newOutline, oldOutline);
    assert.equal(out.beats[0].id, 'hist_b1');
    assert.equal(out.beats[1].id, 'beat_1');
    assert.equal(out.beats[1].status, 'active'); // 无进行中节点时新大纲起点保持 active
    assert.equal(out.focus.currentBeat, 'beat_1');
});

test('mergeHistoryIntoOutline is idempotent on repeated merge', () => {
    const oldOutline = createEmptyOutline();
    oldOutline.beats = [{ id: 'hist_b1', title: '已发生', status: 'done' }];
    const newOutline = createEmptyOutline();
    newOutline.beats = [{ id: 'beat_1', title: '新节点', status: 'active' }];
    const once = mergeHistoryIntoOutline(newOutline, oldOutline);
    const twice = mergeHistoryIntoOutline(once, oldOutline);
    assert.equal(twice.beats.filter(b => b.id === 'hist_b1').length, 1); // 不叠加
    assert.equal(twice.acts.filter(a => a.id === 'act_history').length, 1);
});

test('mergeHistoryIntoOutline returns new outline unchanged when no done beats', () => {
    const oldOutline = createEmptyOutline();
    oldOutline.beats = [{ id: 'b1', title: '未发生', status: 'pending' }];
    const newOutline = createEmptyOutline();
    newOutline.beats = [{ id: 'beat_1', title: '新', status: 'active' }];
    const out = mergeHistoryIntoOutline(newOutline, oldOutline);
    assert.deepEqual(out.acts.map(a => a.id), []);
    assert.deepEqual(out.beats.map(b => b.id), ['beat_1']);
});

test('createArc adds a new arc and normalizes status', () => {
    const o = createEmptyOutline();
    const out = createArc(o, { char: '黄坤', desire: '复仇', growth: '从复仇到释然', status: 'active' });
    assert.equal(out.arcs.length, 1);
    assert.equal(out.arcs[0].char, '黄坤');
    assert.equal(out.arcs[0].status, 'active');
    assert.equal(o.arcs.length, 0); // 入参未修改
    // 非法状态回落
    const bad = createArc(o, { char: 'X', status: 'bogus' });
    assert.equal(bad.arcs[0].status, 'pending');
});

test('createArc upserts when the character already exists', () => {
    const o = createEmptyOutline();
    o.arcs = [{ char: '黄坤', desire: '旧', flaw: '', growth: '', status: 'active' }];
    const out = createArc(o, { char: ' 黄坤 ', desire: '新', growth: 'g' });
    assert.equal(out.arcs.length, 1);
    assert.equal(out.arcs[0].desire, '新');
});

test('createArc ignores empty char name', () => {
    const o = createEmptyOutline();
    const out = createArc(o, { char: '  ' });
    assert.equal(out.arcs.length, 0);
});

test('updateArc changes fields by char name only', () => {
    const o = createEmptyOutline();
    o.arcs = [{ char: 'A', desire: 'd1', flaw: '', growth: 'g1', status: 'pending' }];
    const out = updateArc(o, 'A', { desire: 'd2', status: 'done' });
    assert.equal(out.arcs[0].desire, 'd2');
    assert.equal(out.arcs[0].status, 'done');
    assert.equal(out.arcs[0].growth, 'g1'); // 未传字段保留
    const unchanged = updateArc(o, 'NOPE', { desire: 'x' });
    assert.equal(unchanged.arcs[0].desire, 'd1');
});

test('removeArc deletes the character arc', () => {
    const o = createEmptyOutline();
    o.arcs = [{ char: 'A', desire: '', flaw: '', growth: '', status: 'pending' }];
    const out = removeArc(o, 'A');
    assert.equal(out.arcs.length, 0);
});

test('createForeshadow adds a foreshadow with generated id', () => {
    const o = createEmptyOutline();
    o.beats = [{ id: 'b1', title: '回收节点', status: 'pending' }]; // beatId 自愈需要节点存在
    const out = createForeshadow(o, { hint: '断剑的秘密', status: 'active', beatId: 'b1' });
    assert.equal(out.foreshadowing.length, 1);
    assert.equal(out.foreshadowing[0].hint, '断剑的秘密');
    assert.equal(out.foreshadowing[0].status, 'active');
    assert.equal(out.foreshadowing[0].beatId, 'b1');
    assert.ok(out.foreshadowing[0].id.startsWith('fs_'));
    assert.equal(createForeshadow(o, { hint: '  ' }).foreshadowing.length, 0); // 空 hint 忽略
});

test('updateForeshadow changes status/payoff/beatId and heals dangling beatId', () => {
    const o = createEmptyOutline();
    o.beats = [{ id: 'b1', title: 'x', status: 'pending' }];
    o.foreshadowing = [{ id: 'f1', hint: 'h', status: 'pending', payoff: '', beatId: 'b1' }];
    const out = updateForeshadow(o, 'f1', { status: 'paid', payoff: '终局揭晓', beatId: 'b1' });
    assert.equal(out.foreshadowing[0].status, 'paid');
    assert.equal(out.foreshadowing[0].payoff, '终局揭晓');
    const dangling = updateForeshadow(o, 'f1', { beatId: 'beat_gone' });
    assert.equal(dangling.foreshadowing[0].beatId, ''); // 悬空自愈
});

test('removeForeshadow deletes and heals activeForeshadow references', () => {
    const o = createEmptyOutline();
    o.foreshadowing = [{ id: 'f1', hint: 'h', status: 'active', payoff: '', beatId: '' }];
    o.focus.activeForeshadow = ['f1'];
    const out = removeForeshadow(o, 'f1');
    assert.equal(out.foreshadowing.length, 0);
    assert.deepEqual(out.focus.activeForeshadow, []);
});

test('updateAct edits act title and summary without mutating input', () => {
    const o = normalizeOutline({
        acts: [{ id: 'act_1', title: '第一幕', summary: '旧概要', beats: [] }],
    });
    const before = JSON.stringify(o);
    const updated = updateAct(o, 'act_1', { title: '改名幕', summary: '新概要' });
    assert.equal(updated.acts[0].title, '改名幕');
    assert.equal(updated.acts[0].summary, '新概要');
    // 入参不被修改（写时复制）
    assert.equal(JSON.stringify(o), before);
    // 不存在的幕 / 空 patch：内容不变（受控函数始终返回新对象，但无实质变更）
    assert.equal(updateAct(o, 'nope', { title: 'x' }).acts[0].title, '第一幕');
    assert.equal(updateAct(o, 'act_1', null).acts[0].title, '第一幕');
});

test('diagnoseOutline reports stats and self-healing issues without mutating', () => {
    // 原始输入（未 normalize）：包含悬空引用，normalize 会自愈——诊断要能报出证据
    const raw = {
        mustRead: '设定',
        timeline: { start: '200年', end: '208年' },
        acts: [{ id: 'act_1', title: '第一幕', summary: '', beats: [] }],
        beats: [
            { id: 'b1', title: '已发生', summary: 's', status: 'done' },
            { id: 'b2', title: '进行中', summary: 's', status: 'active' },
        ],
        arcs: [{ char: '主角', desire: '', flaw: '', growth: 'g', status: 'active' }],
        foreshadowing: [
            { id: 'f1', hint: 'h', status: 'pending', payoff: '', beatId: 'ghost_beat' }, // 悬空
        ],
    };
    const before = JSON.stringify(raw);
    const d = diagnoseOutline(raw);
    assert.equal(d.beats, 2);
    assert.equal(d.doneBeats, 1);
    assert.equal(d.activeBeats, 1);
    assert.equal(d.hasTimeline, true);
    assert.equal(d.hasMustRead, true);
    assert.equal(d.foreshadowing, 1);
    // 悬空伏笔回收节点被报告（normalize 已自愈清空 beatId）
    assert.ok(d.issues.some(s => s.includes('伏笔的回收节点悬空')));
    // 只读：入参不变
    assert.equal(JSON.stringify(raw), before);
});

test('diagnoseOutline flags legacy timeline.mustRead migration and empty outline', () => {
    const legacy = diagnoseOutline({ timeline: { mustRead: '旧设定' } });
    assert.ok(legacy.issues.some(s => s.includes('迁移到顶层 mustRead')));
    const empty = diagnoseOutline({});
    assert.equal(empty.beats, 0);
    assert.equal(empty.focusBeat, '（无）');
    assert.equal(empty.issues.length, 0);
});



test('replaceActBeats replaces only the target act beats and heals references', () => {
    const o = normalizeOutline({
        acts: [
            { id: 'act_1', title: '第一幕', summary: '旧概要', beats: [] },
            { id: 'act_2', title: '第二幕', summary: 's2', beats: [] },
        ],
        beats: [
            { id: 'b1', actId: 'act_1', title: '旧一', summary: 's', status: 'done', cast: ['主角'] },
            { id: 'b2', actId: 'act_2', title: '被替换', summary: 's', status: 'pending', cast: ['主角'] },
            { id: 'b3', actId: 'act_2', title: '也被替换', summary: 's', status: 'pending', cast: ['配角'] },
        ],
        foreshadowing: [{ id: 'f1', hint: 'h', status: 'pending', payoff: '', beatId: 'b2' }],
        focus: { currentBeat: 'b2', nextStep: '', activeForeshadow: [] },
    });
    const next = replaceActBeats(o, 'act_2', [
        { title: '新节点一', summary: '新概要一', type: 'conflict', cast: ['主角'] },
        { title: '新节点二', summary: '新概要二', type: 'twist' },
    ], { title: '第二幕（新版）', summary: '新幕概要' });
    // 其他幕节点不动
    assert.ok(next.beats.some(b => b.id === 'b1' && b.title === '旧一'));
    // 目标幕旧节点全删、新节点带新 id 加入
    assert.ok(!next.beats.some(b => b.id === 'b2' || b.id === 'b3'));
    const newBeats = next.beats.filter(b => b.actId === 'act_2');
    assert.equal(newBeats.length, 2);
    assert.ok(newBeats.every(b => String(b.id).startsWith('beat_')));
    assert.equal(newBeats[0].title, '新节点一');
    // 幕标题/概要更新
    const act = next.acts.find(a => a.id === 'act_2');
    assert.equal(act.title, '第二幕（新版）');
    assert.equal(act.summary, '新幕概要');
    // 悬空引用自愈：伏笔 beatId 清空、焦点重定向到新节点
    assert.equal(next.foreshadowing[0].beatId, '');
    assert.equal(next.focus.currentBeat, newBeats[0].id);
});

test('replaceActBeats keeps input unchanged and no-ops for missing act', () => {
    const o = createEmptyOutline();
    o.beats = [{ id: 'b1', title: 'x', summary: 's', status: 'pending' }];
    const before = JSON.stringify(o);
    const next = replaceActBeats(o, 'nope', [{ title: 'y' }]);
    assert.equal(JSON.stringify(o), before);
    assert.equal(next.beats.length, 1);
    assert.equal(next.beats[0].title, 'x');
});


test('mergeHistoryIntoOutline excludeIds prevents duplicate preserved beats', () => {
    const oldOutline = normalizeOutline({
        beats: [{ id: 'b1', title: '已发生', summary: 's', type: 'setup', status: 'done' }],
    });
    // 模型输出保留了 b1（范围外保留）→ 不再收进前情幕（防双份）
    const modelOut = normalizeOutline({
        beats: [{ id: 'b1', title: '已发生', summary: 's', type: 'setup', status: 'done' }],
    });
    const merged = mergeHistoryIntoOutline(modelOut, oldOutline, { excludeIds: ['b1'] });
    const histBeats = merged.beats.filter(b => String(b.id).startsWith('hist_'));
    assert.equal(histBeats.length, 0); // 不重复
    assert.equal(merged.beats.filter(b => b.id === 'b1').length, 1);
    // 未排除的仍正常收进前情幕
    const merged2 = mergeHistoryIntoOutline(modelOut, oldOutline);
    assert.equal(merged2.beats.filter(b => String(b.id).startsWith('hist_')).length, 1);
});

test('replaceActBeats lets new first beat inherit active when replanned act is ongoing', () => {
    const o = normalizeOutline({
        acts: [{ id: 'act_1', title: '进行中的幕', summary: '', beats: [] }],
        beats: [{ id: 'b1', actId: 'act_1', title: '旧进行中', summary: 's', type: 'conflict', status: 'active', cast: ['主角'] }],
    });
    const next = replaceActBeats(o, 'act_1', [
        { title: '新节点一', summary: 's1', type: 'setup' },
        { title: '新节点二', summary: 's2', type: 'conflict' },
    ]);
    const newBeats = next.beats.filter(b => b.actId === 'act_1');
    assert.equal(newBeats[0].status, 'active'); // 承接进行中
    assert.equal(newBeats[1].status, 'pending');
    assert.equal(next.focus.currentBeat, newBeats[0].id); // 焦点指向
    // 全大纲唯一 active
    assert.equal(next.beats.filter(b => b.status === 'active').length, 1);
});

test('replaceActBeats moves done beats to history act and forces new beats to pending', () => {
    const o = normalizeOutline({
        acts: [{ id: 'act_1', title: '第一幕', summary: '', beats: [] }],
        beats: [
            { id: 'b1', actId: 'act_1', title: '已发生', summary: 's', type: 'setup', status: 'done', cast: ['主角'] },
            { id: 'b2', actId: 'act_1', title: '未发生', summary: 's', type: 'conflict', status: 'pending', cast: ['主角'] },
        ],
        foreshadowing: [{ id: 'f1', hint: 'h', status: 'pending', payoff: '', beatId: 'b1' }],
    });
    // 模型输出带 done 状态的新节点（应被强制为 pending——新设计不该出现已发生）
    const next = replaceActBeats(o, 'act_1', [
        { title: '新节点', summary: 's', type: 'twist', status: 'done' },
    ]);
    // done 旧节点挪进前情幕（历史不可重规划）
    const histBeat = next.beats.find(b => String(b.id).startsWith('hist_'));
    assert.ok(histBeat);
    assert.equal(histBeat.title, '已发生');
    assert.equal(histBeat.status, 'done');
    assert.ok(next.acts.some(a => a.id === 'act_history'));
    // 未发生旧节点被重规划删除
    assert.ok(!next.beats.some(b => b.id === 'b2'));
    // 新节点强制 pending（模型给的 done 被忽略）
    const newBeat = next.beats.find(b => b.actId === 'act_1');
    assert.equal(newBeat.status, 'pending');
    // 悬空伏笔引用自愈
    assert.equal(next.foreshadowing[0].beatId, '');
});

// ---------- 世界事件（世界模式） ----------

test('normalizeOutline accepts worldEvents with defaults and string form', () => {
    const o = normalizeOutline({
        worldEvents: [
            { id: 'ev_1', time: '197年冬', title: '曹军集结', description: '调集大军', actors: ['曹操'], trigger: '主角抵达许都时', impact: 'direct', status: 'active', outcome: '' },
            '198年春：洛阳局势生变', // 字符串形式：时间：标题
        ],
    });
    assert.equal(o.worldEvents.length, 2);
    assert.equal(o.worldEvents[0].impact, 'direct');
    assert.equal(o.worldEvents[0].status, 'active');
    assert.equal(o.worldEvents[1].time, '198年春');
    assert.equal(o.worldEvents[1].title, '洛阳局势生变');
    assert.equal(o.worldEvents[1].impact, 'ambient'); // 默认背景
    // 非法 impact/status 归位
    const bad = normalizeOutline({ worldEvents: [{ title: 'x', impact: 'boom', status: 'nope' }] });
    assert.equal(bad.worldEvents[0].impact, 'ambient');
    assert.equal(bad.worldEvents[0].status, 'pending');
    // 空大纲默认空数组
    assert.deepEqual(normalizeOutline({}).worldEvents, []);
});

test('world event controlled edits create/update/remove without mutation', () => {
    let o = createEmptyOutline();
    o = createWorldEvent(o, { time: '197年冬', title: '曹军集结', description: 'd', actors: ['曹操'], trigger: 't', impact: 'direct' });
    assert.equal(o.worldEvents.length, 1);
    assert.equal(o.worldEvents[0].id.startsWith('ev_'), true);
    const before = JSON.stringify(o);
    o = updateWorldEvent(o, o.worldEvents[0].id, { status: 'paid', outcome: '曹军占领许都' });
    assert.equal(o.worldEvents[0].status, 'paid');
    assert.equal(o.worldEvents[0].outcome, '曹军占领许都');
    assert.equal(JSON.stringify(before) !== JSON.stringify(o), true);
    o = removeWorldEvent(o, o.worldEvents[0].id);
    assert.equal(o.worldEvents.length, 0);
    // 空标题 / 不存在的 id：无变更
    assert.equal(createWorldEvent(o, { title: '' }).worldEvents.length, 0);
    assert.equal(updateWorldEvent(o, 'nope', { status: 'paid' }).worldEvents.length, 0);
});
