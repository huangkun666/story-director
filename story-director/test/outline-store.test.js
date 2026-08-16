// story-director/test/outline-store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyOutline, normalizeOutline, serializeOutline, deserializeOutline, jumpToBeat, createBeat, updateBeat, removeBeat, moveBeatOrder, renumberActTitles } from '../src/outline-store.js';

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
    assert.deepEqual(o.timeline, { start: '', end: '', note: '', mustRead: '' });
});

test('normalizeOutline accepts timeline object and string forms', () => {
    const obj = normalizeOutline({ timeline: { start: '200年', end: '208年', note: '含赤壁' } });
    assert.equal(obj.timeline.start, '200年');
    assert.equal(obj.timeline.end, '208年');
    assert.equal(obj.timeline.note, '含赤壁');

    const str = normalizeOutline({ timeline: '建安五年 - 建安十三年' });
    assert.equal(str.timeline.start, '建安五年');
    assert.equal(str.timeline.end, '建安十三年');
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
    assert.equal(out.focus.currentBeat, '');
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
