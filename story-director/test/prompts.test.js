// story-director/test/prompts.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    OUTLINE_SCHEMA, CHECK_SCHEMA,
    buildGeneratePrompt, buildRevisePrompt, buildCheckPrompt, buildDirectorInstruction,
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
