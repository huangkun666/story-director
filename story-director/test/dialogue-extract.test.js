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
