// story-director/test/ui.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampWindowPos, renderBeatItem, foreshadowCardHtml, renderCharacters, renderForeshadowManager } from '../src/ui-render.js';
import { createEmptyOutline } from '../src/outline-store.js';

test('clampWindowPos keeps an in-view position unchanged', () => {
    assert.deepEqual(
        clampWindowPos({ left: 100, top: 80 }, { viewportW: 1200, viewportH: 800, winW: 600, winH: 400 }),
        { left: 100, top: 80 },
    );
});

test('clampWindowPos clamps right/bottom overflow to keep window fully visible', () => {
    assert.deepEqual(
        clampWindowPos({ left: 1100, top: 700 }, { viewportW: 1200, viewportH: 800, winW: 600, winH: 400 }),
        { left: 600, top: 400 },
    );
});

test('clampWindowPos clamps negative positions to 0', () => {
    assert.deepEqual(
        clampWindowPos({ left: -50, top: -20 }, { viewportW: 1200, viewportH: 800, winW: 600, winH: 400 }),
        { left: 0, top: 0 },
    );
});

test('clampWindowPos returns null when no numeric position is stored', () => {
    assert.equal(clampWindowPos(null, { viewportW: 1200, viewportH: 800, winW: 600, winH: 400 }), null);
    assert.equal(clampWindowPos({}, { viewportW: 1200, viewportH: 800, winW: 600, winH: 400 }), null);
    assert.equal(clampWindowPos({ left: 'x', top: undefined }, { viewportW: 1200, viewportH: 800, winW: 600, winH: 400 }), null);
});

test('clampWindowPos pins window to top-left when it is larger than the viewport', () => {
    assert.deepEqual(
        clampWindowPos({ left: 300, top: 200 }, { viewportW: 500, viewportH: 300, winW: 800, winH: 600 }),
        { left: 0, top: 0 },
    );
});

test('renderBeatItem shows foreshadow chips for active foreshadowing of the beat', () => {
    const beat = { id: 'b1', title: '回城', status: 'pending', type: 'conflict', cast: [] };
    const foreshadowing = [
        { id: 'f1', hint: '断剑的秘密', status: 'pending', beatId: 'b1' },
        { id: 'f2', hint: '已回收的伏笔', status: 'paid', beatId: 'b1' },
        { id: 'f3', hint: '别的节点', status: 'active', beatId: 'b2' },
    ];
    const html = renderBeatItem(beat, foreshadowing);
    assert.ok(html.includes('sd_fs_chip'));
    assert.ok(html.includes('断剑的秘密'));
    assert.ok(!html.includes('已回收的伏笔')); // paid 不显示
    assert.ok(!html.includes('别的节点')); // 不指向本节点的不显示
});

test('renderBeatItem renders no foreshadow section without matches', () => {
    const html = renderBeatItem({ id: 'b1', title: 'x', status: 'pending', type: 'setup', cast: [] }, []);
    assert.ok(!html.includes('sd_beat_fs'));
});

test('foreshadowCardHtml renders clickable payoff link with data attribute', () => {
    const o = createEmptyOutline();
    o.beats = [{ id: 'b1', title: '终局之战', status: 'pending' }];
    o.foreshadowing = [{ id: 'f1', hint: '断剑的秘密', status: 'pending', payoff: '', beatId: 'b1' }];
    const html = foreshadowCardHtml(o);
    assert.ok(html.includes('data-payoff-beat="b1"'));
    assert.ok(html.includes('sd_fs_payoff_link'));
    assert.ok(html.includes('终局之战'));
});

test('renderCharacters renders arc cards with derived appearance chips', () => {
    const arcs = [{ char: '黄坤', desire: '复仇', flaw: '冲动', growth: '成长', status: 'active' }];
    const beats = [
        { id: 'b1', title: '初入都城', status: 'pending', cast: ['黄坤', '路人'] },
        { id: 'b2', title: '其他戏', status: 'pending', cast: ['司马朗'] },
    ];
    const html = renderCharacters(arcs, beats);
    assert.ok(html.includes('黄坤'));
    assert.ok(html.includes('欲望'));
    assert.ok(html.includes('初入都城'));
    assert.ok(html.includes('data-arc-beat="b1"'));
    assert.ok(!html.includes('其他戏')); // 不涉及该角色的节点不显示
    const empty = renderCharacters([], beats);
    assert.ok(empty.includes('还没有角色弧光'));
});

test('renderForeshadowManager filters by status and renders actions', () => {
    const fs = [
        { id: 'f1', hint: '待揭晓的伏笔', status: 'pending', payoff: '', beatId: '' },
        { id: 'f2', hint: '活跃的伏笔', status: 'active', payoff: '', beatId: '' },
        { id: 'f3', hint: '已回收的伏笔', status: 'paid', payoff: '终局', beatId: '' },
    ];
    const all = renderForeshadowManager(fs, [], '');
    assert.ok(all.includes('待揭晓的伏笔'));
    assert.ok(all.includes('活跃的伏笔'));
    assert.ok(all.includes('已回收的伏笔'));
    assert.ok(all.includes('data-fs-pay="f1"')); // 未回收的有一键回收
    assert.ok(!all.includes('data-fs-pay="f3"')); // 已回收的没有回收按钮
    const activeOnly = renderForeshadowManager(fs, [], 'active');
    assert.ok(activeOnly.includes('活跃的伏笔'));
    assert.ok(!activeOnly.includes('待揭晓的伏笔'));
    const empty = renderForeshadowManager(fs, [], 'paid');
    assert.ok(empty.includes('已回收的伏笔'));
});
