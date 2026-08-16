// story-director/test/dialogue-extract.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDialogueBodies } from '../src/dialogue-extract.js';

test('extracts content inside matched tags per line', () => {
    const dialogue = '主角: 【我们进城吧】\n角色: 好啊';
    const out = extractDialogueBodies(dialogue, [{ open: '【', close: '】' }]);
    assert.equal(out, '主角: 我们进城吧\n角色: 好啊'); // 匹配行提取，无匹配行保留原文
});

test('keeps unmatched lines as-is and merges multiple fragments', () => {
    const dialogue = '主角: 【进城】再说【还有埋伏】\n旁白: 天色渐暗';
    const out = extractDialogueBodies(dialogue, [{ open: '【', close: '】' }]);
    assert.equal(out, '主角: 进城；还有埋伏\n旁白: 天色渐暗');
});

test('falls back to original text when nothing matches', () => {
    const dialogue = '主角: 我们进城吧';
    const out = extractDialogueBodies(dialogue, [{ open: '【', close: '】' }]);
    assert.equal(out, dialogue);
});

test('falls back to original when rules are empty or invalid', () => {
    const dialogue = '主角: 你好';
    assert.equal(extractDialogueBodies(dialogue, []), dialogue);
    assert.equal(extractDialogueBodies(dialogue, null), dialogue);
    assert.equal(extractDialogueBodies(dialogue, [{ open: '', close: '】' }]), dialogue);
    assert.equal(extractDialogueBodies(dialogue, 'not-array'), dialogue);
});

test('supports multiple rules and avoids empty fragments', () => {
    const dialogue = '主角: 【正文一】动作【正文二】\n角色: *心声* 说话';
    const rules = [{ open: '【', close: '】' }, { open: '*', close: '*' }];
    const out = extractDialogueBodies(dialogue, rules);
    assert.ok(out.includes('正文一；正文二'));
    assert.ok(out.includes('心声'));
});

test('handles non-string input', () => {
    assert.equal(extractDialogueBodies(null, [{ open: '【', close: '】' }]), '');
    assert.equal(extractDialogueBodies('', [{ open: '【', close: '】' }]), '');
});

// ---------- HTML 标签模式（正文标签不硬编码，由用户/AI 指定） ----------

test('extracts content inside HTML tags across lines', () => {
    const dialogue = 'AI: <think>用户想进城</think>\n<content>我们进城吧，城门今晚就开。</content>\nAI: <content>小心埋伏！</content>';
    const out = extractDialogueBodies(dialogue, [{ tag: 'content' }]);
    assert.ok(out.includes('我们进城吧，城门今晚就开。'));
    assert.ok(out.includes('小心埋伏！'));
    assert.ok(!out.includes('用户想进城')); // think 内容被排除
    assert.ok(!out.includes('<content>'));  // 标签本身不保留
});

test('supports tag names with attributes and tolerates angle brackets', () => {
    const dialogue = 'AI: <content lang="zh">正文内容</content>\n<think>思考</think>';
    assert.equal(extractDialogueBodies(dialogue, [{ tag: '<content>' }]), '正文内容'); // 容忍 <content> 写法
    assert.equal(extractDialogueBodies(dialogue, [{ tag: 'content' }]), '正文内容');
});

test('extracts multiple tags of same name and skips empty fragments', () => {
    const dialogue = 'A\n<speech>第一句</speech>\n<speech></speech>\n<speech>第二句</speech>';
    const out = extractDialogueBodies(dialogue, [{ tag: 'speech' }]);
    assert.equal(out, '第一句\n第二句');
});

test('falls back to full text when html tag rules match nothing', () => {
    const dialogue = 'AI: 我们直接说话没有标签';
    assert.equal(extractDialogueBodies(dialogue, [{ tag: 'content' }]), dialogue); // 默认提取全文
});

test('ignores invalid tag names', () => {
    const dialogue = '<content>正文</content>';
    assert.equal(extractDialogueBodies(dialogue, [{ tag: '<bad tag>' }]), dialogue); // 非法标签名被忽略
    assert.equal(extractDialogueBodies(dialogue, [{ tag: '' }]), dialogue);
    assert.equal(extractDialogueBodies(dialogue, [{ tag: '123abc' }]), dialogue); // 数字开头非法
});

test('html tag rules take priority over pair rules when mixed', () => {
    const dialogue = '主角: 【动作】\n<content>真正的正文</content>';
    const rules = [{ tag: 'content' }, { open: '【', close: '】' }];
    const out = extractDialogueBodies(dialogue, rules);
    assert.equal(out, '真正的正文'); // 标签模式优先，pair 规则不参与
});

test('no rules returns full text by default', () => {
    const dialogue = '主角: 没有规则的全文';
    assert.equal(extractDialogueBodies(dialogue, []), dialogue);
    assert.equal(extractDialogueBodies(dialogue, null), dialogue);
    assert.equal(extractDialogueBodies(dialogue, [{ label: '正文', sample: '' }]), dialogue); // 无 tag 也无 open/close
});
