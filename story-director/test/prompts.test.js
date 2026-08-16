// story-director/test/prompts.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    OUTLINE_SCHEMA, CHECK_SCHEMA,
    buildGeneratePrompt, buildRevisePrompt, buildRevisePatchPrompt, buildCheckPrompt, buildDirectorInstruction,
    buildBeatPrompt, buildHistoryContext,
    compactOutlineForRevision,
} from '../src/prompts.js';
import { createEmptyOutline } from '../src/outline-store.js';

test('OUTLINE_SCHEMA describes required top-level fields', () => {
    assert.equal(OUTLINE_SCHEMA.type, 'object');
    const required = OUTLINE_SCHEMA.required;
    assert.ok(required.includes('theme'));
    assert.ok(required.includes('beats'));
    assert.ok(required.includes('focus'));
});

test('CHECK_SCHEMA describes verdict and changed', () => {
    const required = CHECK_SCHEMA.required;
    assert.ok(required.includes('verdict'));
    assert.ok(required.includes('changed'));
});

test('buildGeneratePrompt includes character card and user request', () => {
    const { prompt } = buildGeneratePrompt({
        characterCard: { name: 'Alice', description: 'a witch' },
        userRequest: '悲剧结局',
        detail: 'medium',
    });
    assert.ok(prompt.includes('Alice'));
    assert.ok(prompt.includes('a witch'));
    assert.ok(prompt.includes('悲剧结局'));
});

test('buildGeneratePrompt asks for a full act-based outline, not loose nodes', () => {
    const { prompt } = buildGeneratePrompt({ characterCard: {}, detail: 'high' });
    assert.ok(prompt.includes('完整故事大纲'));
    assert.ok(prompt.includes('acts'));
    assert.ok(prompt.includes('起承转合'));
    assert.ok(prompt.includes('6-8 个'));
    assert.ok(prompt.includes('actId'));
});

test('buildGeneratePrompt is genre-agnostic and asks for ensemble cast lines', () => {
    const { prompt } = buildGeneratePrompt({ characterCard: {} });
    assert.ok(prompt.includes('题材不限'));
    assert.ok(prompt.includes('主角线'));
    assert.ok(prompt.includes('对抗线'));
    assert.ok(prompt.includes('配角线'));
    assert.ok(prompt.includes('世界/势力线'));
    assert.ok(prompt.includes('避免独角戏'));
    assert.ok(prompt.includes('cast'));
});

test('buildGeneratePrompt treats mustRead lore as highest priority', () => {
    const { prompt } = buildGeneratePrompt({
        characterCard: {},
        timeline: { start: '', end: '', note: '', mustRead: '这个世界魔法会消耗寿命' },
    });
    assert.ok(prompt.includes('必读设定（最高优先级'));
    assert.ok(prompt.includes('魔法会消耗寿命'));
});

test('buildGeneratePrompt enforces a specified story timeline', () => {
    const { prompt } = buildGeneratePrompt({
        characterCard: {},
        timeline: { start: '建安五年', end: '建安十三年', note: '必须包含赤壁之战' },
    });
    assert.ok(prompt.includes('时间线约束（必须遵守）'));
    assert.ok(prompt.includes('建安五年'));
    assert.ok(prompt.includes('建安十三年'));
    assert.ok(prompt.includes('必须包含赤壁之战'));
    assert.ok(prompt.includes('所有 beats 必须落在该区间内'));
});

test('buildGeneratePrompt asks model to infer timeline when none provided', () => {
    const { prompt } = buildGeneratePrompt({ characterCard: {} });
    assert.ok(prompt.includes('用户未指定时间线'));
    assert.ok(prompt.includes('自行推定'));
});

test('buildGeneratePrompt injects long-term memory context when provided', () => {
    const { prompt } = buildGeneratePrompt({ characterCard: {}, memoryContext: '【主线总结】已发生赤壁之战' });
    assert.ok(prompt.includes('长时记忆（来自记忆插件，优先采信）'));
    assert.ok(prompt.includes('已发生赤壁之战'));
});

test('buildGeneratePrompt injects vector-retrieved lore when provided', () => {
    const { prompt } = buildGeneratePrompt({ characterCard: {}, vectorContext: '【三国资料 #1】赤壁水文' });
    assert.ok(prompt.includes('向量检索到的相关资料'));
    assert.ok(prompt.includes('赤壁水文'));
});

test('OUTLINE_SCHEMA requires acts for full outline', () => {
    assert.ok(OUTLINE_SCHEMA.required.includes('acts'));
    assert.ok(OUTLINE_SCHEMA.properties.acts);
});

test('buildRevisePrompt includes dialogue and outline', () => {
    const o = createEmptyOutline();
    o.theme = '复仇';
    const { prompt } = buildRevisePrompt({ recentDialogue: 'A: 你好', outline: o });
    assert.ok(prompt.includes('你好'));
    assert.ok(prompt.includes('复仇'));
});

test('buildRevisePrompt defaults to loose drift absorption', () => {
    const o = createEmptyOutline();
    const { prompt } = buildRevisePrompt({ recentDialogue: '', outline: o });
    assert.ok(prompt.includes('宽松吸收'));
});

test('buildRevisePrompt uses strict pull-back instruction when requested', () => {
    const o = createEmptyOutline();
    const { prompt } = buildRevisePrompt({ recentDialogue: '', outline: o, driftTolerance: 'strict' });
    assert.ok(prompt.includes('严格拉回'));
    assert.ok(prompt.includes('最小化吸收'));
    assert.ok(!prompt.includes('宽松吸收'));
});

test('buildRevisePrompt tells model not to rewrite locked outline', () => {
    const o = createEmptyOutline();
    const { prompt } = buildRevisePrompt({ recentDialogue: '', outline: o, locked: true });
    assert.ok(prompt.includes('锁定'));
    assert.ok(prompt.includes('禁止改写'));
});

test('OUTLINE_SCHEMA exposes beat types and arc status', () => {
    assert.ok(OUTLINE_SCHEMA.properties.beats.items.properties.type);
    assert.ok(OUTLINE_SCHEMA.properties.arcs.items.properties.status);
});

test('buildCheckPrompt includes dialogue and outline', () => {
    const o = createEmptyOutline();
    o.world = '魔法大陆';
    const { prompt } = buildCheckPrompt({ recentDialogue: 'B: 再见', outline: o });
    assert.ok(prompt.includes('再见'));
    assert.ok(prompt.includes('魔法大陆'));
});

test('CHECK_SCHEMA exposes optional updatedOutline', () => {
    assert.ok(CHECK_SCHEMA.properties.updatedOutline);
    assert.ok(!CHECK_SCHEMA.required.includes('updatedOutline'));
});

test('buildDirectorInstruction includes focus fields and strength', () => {
    const o = createEmptyOutline();
    o.focus.currentBeat = 'b1';
    o.focus.nextStep = '进入森林';
    o.focus.activeForeshadow = ['f1'];
    o.focus.avoidOffTopic = '别聊天气';
    const s = buildDirectorInstruction(o, 'strong');
    assert.ok(s.includes('b1'));
    assert.ok(s.includes('进入森林'));
    assert.ok(s.includes('f1'));
    assert.ok(s.includes('别聊天气'));
    assert.ok(s.includes('必须'));
});

test('compactOutlineForRevision keeps only skeleton for done beats', () => {
    const o = createEmptyOutline();
    o.beats = [
        { id: 'b1', title: '旧', summary: '秘密细节', type: 'climax', status: 'done', cast: ['A'] },
        { id: 'b2', title: '新', summary: '细节', type: 'setup', status: 'active', cast: ['B'] },
    ];
    const c = compactOutlineForRevision(o);
    assert.deepEqual(c.beats[0], { id: 'b1', title: '旧', status: 'done', actId: '' });
    assert.equal(c.beats[1].summary, '细节'); // 进行中的节点保留全部字段
});

test('buildRevisePrompt omits compacted done-beat details from prompt', () => {
    const o = createEmptyOutline();
    const longSummary = '长'.repeat(500);
    o.beats = [
        { id: 'b1', title: '已完成节点', summary: longSummary, type: 'climax', status: 'done', cast: ['A'] },
        { id: 'b2', title: '进行中', summary: '细节', type: 'conflict', status: 'active', cast: ['B'] },
    ];
    const { prompt } = buildRevisePrompt({ recentDialogue: '', outline: o });
    assert.ok(!prompt.includes(longSummary)); // done 细节被省略
    assert.ok(prompt.includes('已完成节点'));
    assert.ok(prompt.includes('细节')); // 非 done 保留
    assert.ok(prompt.includes('原样保留'));
});

test('buildRevisePatchPrompt asks for minimal patch, not full outline', () => {
    const o = createEmptyOutline();
    o.beats = [{ id: 'b1', title: '开端', status: 'active' }];
    const { prompt } = buildRevisePatchPrompt({ recentDialogue: 'A: hi', outline: o });
    assert.ok(prompt.includes('statusChanges'));
    assert.ok(prompt.includes('newBeats'));
    assert.ok(prompt.includes('变更补丁'));
    assert.ok(prompt.includes('锁定'));
    assert.ok(!prompt.includes('更新后的完整大纲'));
});

test('buildGeneratePrompt includes relative pacing instruction with balanced default', () => {
    const { prompt } = buildGeneratePrompt({
        characterCard: {},
        timeline: { start: '建安五年', end: '建安十三年' },
    });
    assert.ok(prompt.includes('节点节奏'));
    assert.ok(prompt.includes('总跨度 ÷ 节点数'));
    assert.ok(prompt.includes('均衡'));
    assert.ok(prompt.includes('不要用绝对时间硬套')); // 相对跨度而非绝对时间
});

test('buildGeneratePrompt honors dense and sparse pacing bands', () => {
    const dense = buildGeneratePrompt({ characterCard: {}, pacing: 'dense' });
    assert.ok(dense.prompt.includes('紧凑'));
    assert.ok(dense.prompt.includes('时间感被压缩'));
    const sparse = buildGeneratePrompt({ characterCard: {}, pacing: 'sparse' });
    assert.ok(sparse.prompt.includes('宽松'));
    assert.ok(sparse.prompt.includes('时间跳跃与留白'));
});

test('buildRevisePrompt instructs pacing-aware new beats', () => {
    const o = createEmptyOutline();
    const { prompt } = buildRevisePrompt({ recentDialogue: '', outline: o, pacing: 'dense' });
    assert.ok(prompt.includes('节点节奏档位（紧凑）'));
    assert.ok(prompt.includes('不要与既有节点全部扎堆'));
});

test('buildRevisePrompt tells model not to record every turn as a new beat', () => {
    const o = createEmptyOutline();
    const { prompt } = buildRevisePrompt({ recentDialogue: '', outline: o });
    assert.ok(prompt.includes('大纲不是剧情日志')); // 定位声明
    assert.ok(prompt.includes('常规对话轮次不要推进节点状态')); // 保守推进
    assert.ok(prompt.includes('里程碑式')); // 只认里程碑
});

test('buildRevisePatchPrompt also restricts beat advancement to milestones', () => {
    const o = createEmptyOutline();
    const { prompt } = buildRevisePatchPrompt({ recentDialogue: '', outline: o });
    assert.ok(prompt.includes('大纲不是剧情日志'));
    assert.ok(prompt.includes('常规对话轮次不要推进节点'));
});

test('buildCheckPrompt checks pacing distribution across the span', () => {
    const o = createEmptyOutline();
    const { prompt } = buildCheckPrompt({ recentDialogue: '', outline: o });
    assert.ok(prompt.includes('节点时间分布'));
    assert.ok(prompt.includes('异常大的时间跳跃'));
});

test('buildBeatPrompt includes current outline and user hint', () => {
    const o = createEmptyOutline();
    o.theme = '复仇';
    const { system, prompt } = buildBeatPrompt({ outline: o, userHint: '主角发现对手的阴谋' });
    assert.ok(prompt.includes('复仇'));
    assert.ok(prompt.includes('主角发现对手的阴谋'));
    assert.ok(prompt.includes('"actId"')); // 建议归属幕
    assert.ok(system.includes('新情节节点'));
});

test('buildBeatPrompt handles empty hint with a default instruction', () => {
    const o = createEmptyOutline();
    const { prompt } = buildBeatPrompt({ outline: o });
    assert.ok(prompt.includes('（未指定，请根据大纲当前焦点')); // 默认引导文案
});

test('buildHistoryContext lists only done beats with summaries', () => {
    const o = createEmptyOutline();
    o.beats = [
        { id: 'b1', title: '已发生', summary: '前情概要', status: 'done' },
        { id: 'b2', title: '未发生', summary: 'x', status: 'pending' },
    ];
    const ctx = buildHistoryContext(o);
    assert.ok(ctx.includes('已发生'));
    assert.ok(ctx.includes('前情概要'));
    assert.ok(!ctx.includes('未发生'));
});

test('buildHistoryContext includes in-progress beats marked as ongoing', () => {
    const o = createEmptyOutline();
    o.beats = [
        { id: 'b1', title: '正在进行', summary: 's', status: 'active' },
        { id: 'b2', title: '计划中', status: 'pending' },
    ];
    const ctx = buildHistoryContext(o);
    assert.ok(ctx.includes('正在进行'));
    assert.ok(ctx.includes('（进行中）'));
    assert.ok(!ctx.includes('计划中'));
});

test('buildHistoryContext returns empty when nothing happened yet', () => {
    const o = createEmptyOutline();
    assert.equal(buildHistoryContext(o), '');
    o.beats = [{ id: 'b1', title: 'x', status: 'pending' }];
    assert.equal(buildHistoryContext(o), '');
});

test('buildGeneratePrompt includes history block with continuation rules', () => {
    const { prompt } = buildGeneratePrompt({
        characterCard: {},
        historyContext: '【已发生的剧情事实（来自旧大纲，时间线调整前的既定历史）】\n- 落马余波：焦土决断',
    });
    assert.ok(prompt.includes('已发生的剧情事实'));
    assert.ok(prompt.includes('落马余波'));
    assert.ok(prompt.includes('发生在新时间线开始之前的属于既定事实'));
    assert.ok(prompt.includes('发生在新时间线内或之后的旧规划一律作废'));
});

test('buildGeneratePrompt explicitly permits new characters with obligations', () => {
    const { prompt } = buildGeneratePrompt({ characterCard: { cast: '黄坤（主角）' } });
    assert.ok(prompt.includes('新人物许可'));
    assert.ok(prompt.includes('允许引入新人物')); // 显式许可
    assert.ok(prompt.includes('不得与角色名录中的既有角色重名或冲突')); // 防冲突仍在
    assert.ok(prompt.includes('身份、动机与作用必须在 arcs 或 beats 中交代清楚'));
    assert.ok(prompt.includes('角色名录')); // 名录块保留
});

test('buildBeatPrompt allows new characters when necessary with identity note', () => {
    const o = createEmptyOutline();
    const { prompt } = buildBeatPrompt({ outline: o });
    assert.ok(prompt.includes('优先从大纲已有角色中选择'));
    assert.ok(prompt.includes('确有必要引入新角色时须简要交代其身份'));
});

test('buildRevisePrompt absorbs new characters from dialogue with identity', () => {
    const o = createEmptyOutline();
    const { prompt } = buildRevisePrompt({ recentDialogue: '', outline: o });
    assert.ok(prompt.includes('名录外新角色'));
    assert.ok(prompt.includes('允许将其纳入 arcs 或后续节点'));
});

test('buildGeneratePrompt adds fact-boundary block when an ongoing beat exists', () => {
    const { prompt } = buildGeneratePrompt({
        characterCard: {},
        timeline: { start: '建安五年', end: '建安十三年' },
        ongoingBeatText: '追查阴谋（正在进行：主角潜入都城）',
    });
    assert.ok(prompt.includes('事实边界'));
    assert.ok(prompt.includes('追查阴谋'));
    assert.ok(prompt.includes('timeline.start 顺延'));
    assert.ok(prompt.includes('不得与已发生或正在进行的剧情在时间上重叠'));
});

test('buildGeneratePrompt omits fact-boundary block without an ongoing beat', () => {
    const { prompt } = buildGeneratePrompt({ characterCard: {} });
    assert.ok(!prompt.includes('事实边界'));
});
