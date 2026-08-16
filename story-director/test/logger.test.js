// story-director/test/logger.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, LOG_LEVELS, LOG_CATEGORIES } from '../src/logger.js';

test('createLogger logs entries with id, ts, level, category', () => {
    const l = createLogger();
    const entry = l.log('info', 'llm', '生成完成');
    assert.equal(typeof entry.id, 'number');
    assert.equal(typeof entry.ts, 'string');
    assert.equal(entry.level, 'info');
    assert.equal(entry.category, 'llm');
    assert.equal(entry.message, '生成完成');
    assert.equal(entry.detail, '');
    assert.equal(l.count(), 1);
});

test('createLogger normalizes invalid level and category', () => {
    const l = createLogger();
    const e1 = l.log('nope', 'llm', 'x');
    assert.equal(e1.level, 'info');
    const e2 = l.log('warn', 'unknown-cat', 'x');
    assert.equal(e2.category, 'engine');
});

test('createLogger keeps detail string', () => {
    const l = createLogger();
    const e = l.log('warn', 'retrieval', '降级', '模型未返回方向');
    assert.equal(e.detail, '模型未返回方向');
});

test('createLogger enforces ring buffer limit', () => {
    const l = createLogger(3);
    l.log('info', 'llm', 'a');
    l.log('info', 'llm', 'b');
    l.log('info', 'llm', 'c');
    l.log('info', 'llm', 'd');
    assert.equal(l.count(), 3);
    assert.deepEqual(l.all().map(e => e.message), ['b', 'c', 'd']); // 最旧的被挤掉
});

test('filter selects level and above', () => {
    const l = createLogger();
    l.log('debug', 'llm', 'd1');
    l.log('info', 'llm', 'i1');
    l.log('warn', 'llm', 'w1');
    l.log('error', 'llm', 'e1');
    assert.deepEqual(l.filter({ level: 'warn' }).map(e => e.level), ['warn', 'error']);
    assert.deepEqual(l.filter({ level: 'debug' }).map(e => e.message), ['d1', 'i1', 'w1', 'e1']);
    assert.deepEqual(l.filter({ level: 'error' }).map(e => e.message), ['e1']);
});

test('filter narrows by categories and keyword', () => {
    const l = createLogger();
    l.log('info', 'llm', '生成完成', '耗时 100ms');
    l.log('info', 'edit', '编辑：删除节点');
    l.log('warn', 'retrieval', '检索降级');
    const cats = l.filter({ categories: ['llm', 'edit'] });
    assert.equal(cats.length, 2);
    const kw = l.filter({ keyword: '耗时' });
    assert.equal(kw.length, 1);
    assert.equal(kw[0].message, '生成完成');
    const kwDetail = l.filter({ keyword: '删除' });
    assert.equal(kwDetail[0].category, 'edit'); // 关键字也匹配 detail
});

test('subscribe receives new entries and can unsubscribe', () => {
    const l = createLogger();
    const seen = [];
    const off = l.subscribe((e) => seen.push(e.message));
    l.log('info', 'llm', 'one');
    l.log('warn', 'llm', 'two');
    assert.deepEqual(seen, ['one', 'two']);
    off();
    l.log('info', 'llm', 'three');
    assert.deepEqual(seen, ['one', 'two']); // 退订后不再收到
});

test('clear resets entries and count', () => {
    const l = createLogger();
    l.log('info', 'llm', 'x');
    l.clear();
    assert.equal(l.count(), 0);
    assert.equal(l.all().length, 0);
});

test('exportJson produces parseable JSON array', () => {
    const l = createLogger();
    l.log('info', 'llm', 'hello', 'world');
    const parsed = JSON.parse(l.exportJson());
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].message, 'hello');
});

test('level and category vocabularies are stable', () => {
    assert.deepEqual(LOG_LEVELS, ['debug', 'info', 'warn', 'error']);
    assert.deepEqual(LOG_CATEGORIES, ['llm', 'retrieval', 'memory', 'engine', 'edit', 'lifecycle']);
});
