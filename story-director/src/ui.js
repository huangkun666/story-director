// story-director/src/ui.js
// UI 层：渲染面板、绑定事件、手动编辑。依赖浏览器 DOM 与酒馆 ctx。
import { createEmptyOutline, normalizeOutline, jumpToBeat, createBeat, updateBeat, removeBeat, moveBeatOrder, renumberActTitles } from './outline-store.js';

const BEAT_META = {
    pending: { label: '待开始', cls: 'sd_badge_pending', icon: 'fa-regular fa-circle' },
    active: { label: '进行中', cls: 'sd_badge_active', icon: 'fa-solid fa-play' },
    done: { label: '已完成', cls: 'sd_badge_done', icon: 'fa-solid fa-check' },
};

const FORESHADOW_META = {
    pending: { label: '待揭晓', cls: 'sd_badge_pending', icon: 'fa-regular fa-clock' },
    active: { label: '活跃', cls: 'sd_badge_active', icon: 'fa-solid fa-fire' },
    paid: { label: '已回收', cls: 'sd_badge_done', icon: 'fa-solid fa-check-double' },
};

const VERDICT_META = {
    sync: { label: '同步', cls: 'sd_verdict_sync', icon: 'fa-solid fa-circle-check' },
    'minor-drift': { label: '轻度脱节', cls: 'sd_verdict_minor', icon: 'fa-solid fa-triangle-exclamation' },
    'major-drift': { label: '严重脱节', cls: 'sd_verdict_major', icon: 'fa-solid fa-circle-xmark' },
};

const BEAT_TYPE_META = {
    setup: { label: '铺垫', cls: 'sd_type_setup', icon: 'fa-solid fa-seedling' },
    conflict: { label: '冲突', cls: 'sd_type_conflict', icon: 'fa-solid fa-bolt' },
    twist: { label: '转折', cls: 'sd_type_twist', icon: 'fa-solid fa-shuffle' },
    climax: { label: '高潮', cls: 'sd_type_climax', icon: 'fa-solid fa-fire' },
    resolution: { label: '收束', cls: 'sd_type_resolution', icon: 'fa-solid fa-flag-checkered' },
    '': { label: '节点', cls: 'sd_type_plain', icon: 'fa-regular fa-circle' },
};

const ARC_META = {
    pending: { label: '未启动', cls: 'sd_badge_pending', icon: 'fa-regular fa-circle' },
    active: { label: '进行中', cls: 'sd_badge_active', icon: 'fa-solid fa-play' },
    done: { label: '已完成', cls: 'sd_badge_done', icon: 'fa-solid fa-check' },
};

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function beatMeta(status) {
    return BEAT_META[status] || { label: status || '未知', cls: 'sd_badge_pending', icon: 'fa-regular fa-circle' };
}

function foreshadowMeta(status) {
    return FORESHADOW_META[status] || { label: status || '未知', cls: 'sd_badge_pending', icon: 'fa-regular fa-clock' };
}

function beatTypeMeta(type) {
    return BEAT_TYPE_META[type] || BEAT_TYPE_META[''];
}

function arcMeta(status) {
    return ARC_META[status] || ARC_META.pending;
}

function hasOutlineContent(o) {
    return !!(o.theme || o.tone || o.world || o.timeline?.start || o.timeline?.end || o.timeline?.mustRead || o.arcs.length || o.foreshadowing.length || o.acts.length || o.beats.length);
}

// 窗口位置视口钳制：把 {left, top} 夹进可视区域，保证窗口不会开在屏幕外。
// 窗口比视口大时按视口尺寸收缩（maxLeft=0 → 贴左上角）。纯函数，无 DOM。
export function clampWindowPos(pos, { viewportW = 0, viewportH = 0, winW = 0, winH = 0 } = {}) {
    const left = Number.isFinite(pos?.left) ? pos.left : null;
    const top = Number.isFinite(pos?.top) ? pos.top : null;
    if (left === null && top === null) return null;
    const vw = Math.max(0, viewportW);
    const vh = Math.max(0, viewportH);
    const w = Math.min(Math.max(0, winW), vw);
    const h = Math.min(Math.max(0, winH), vh);
    const maxLeft = Math.max(0, vw - w);
    const maxTop = Math.max(0, vh - h);
    return {
        left: left === null ? null : Math.round(Math.min(Math.max(0, left), maxLeft)),
        top: top === null ? null : Math.round(Math.min(Math.max(0, top), maxTop)),
    };
}

function renderBeatItem(b) {
    const m = beatMeta(b.status);
    const tm = beatTypeMeta(b.type);
    return `<div class="sd_beat_item sd_beat_${escapeHtml(b.status)}" data-beat-id="${escapeHtml(b.id)}" title="点击编辑节点">
        <div class="sd_beat_rail"><span class="sd_beat_dot"></span></div>
        <div class="sd_beat_body">
            <div class="sd_beat_head">
                <span class="sd_badge ${m.cls}"><i class="${m.icon}"></i>${m.label}</span>
                <span class="sd_type_badge ${tm.cls}"><i class="${tm.icon}"></i>${tm.label}</span>
                <span class="sd_beat_title">${escapeHtml(b.title || b.id)}</span>
                <i class="fa-regular fa-pen-to-square sd_edit_hint"></i>
                <span class="sd_beat_jump" data-jump-id="${escapeHtml(b.id)}" title="从该节点开始游玩（之前的节点标记为已完成，可回滚）">
                    <i class="fa-solid fa-flag-checkered"></i>
                </span>
            </div>
            ${b.summary ? `<div class="sd_beat_summary">${escapeHtml(b.summary)}</div>` : ''}
            ${(b.cast || []).length ? `<div class="sd_beat_cast">${b.cast.map(c => `<span class="sd_chip">${escapeHtml(c)}</span>`).join('')}</div>` : ''}
        </div>
    </div>`;
}

function renderEmptyState() {
    return `<div class="sd_empty_state">
        <div class="sd_empty_icon"><i class="fa-solid fa-clapperboard"></i></div>
        <div class="sd_empty_title">还没有大纲</div>
        <div class="sd_empty_text">读取当前角色卡，生成包含分幕结构、情节节点、角色弧光与伏笔的完整故事大纲。</div>
        <div id="sd_generate_empty" class="menu_button sd_btn sd_btn_primary sd_empty_cta" title="生成大纲">
            <i class="fa-solid fa-wand-magic-sparkles sd_btn_icon"></i><span>生成大纲</span>
        </div>
    </div>`;
}

function storyCardHtml(o) {
    const rows = [];
    if (o.timeline?.start || o.timeline?.end) {
        const range = [o.timeline.start, o.timeline.end].filter(Boolean).join(' → ');
        rows.push(`<div class="sd_kv sd_kv_timeline"><span class="sd_kv_key">时间线</span><span class="sd_kv_value">${escapeHtml(range)}${o.timeline.note ? `（${escapeHtml(o.timeline.note)}）` : ''}</span></div>`);
    }
    if (o.timeline?.mustRead) rows.push(`<div class="sd_kv sd_kv_mustread"><span class="sd_kv_key">必读设定</span><span class="sd_kv_value">${escapeHtml(o.timeline.mustRead)}</span></div>`);
    if (o.theme) rows.push(`<div class="sd_kv"><span class="sd_kv_key">主题</span><span class="sd_kv_value">${escapeHtml(o.theme)}</span></div>`);
    if (o.tone) rows.push(`<div class="sd_kv"><span class="sd_kv_key">基调</span><span class="sd_kv_value">${escapeHtml(o.tone)}</span></div>`);
    if (o.world) rows.push(`<div class="sd_kv sd_kv_world"><span class="sd_kv_key">世界观</span><span class="sd_kv_value">${escapeHtml(o.world)}</span></div>`);
    if (!rows.length) return '';
    return `<section class="sd_card sd_card_story">
        <header class="sd_card_header"><i class="fa-solid fa-book-open"></i>故事总览</header>
        <div class="sd_card_body">${rows.join('')}</div>
    </section>`;
}

function arcsCardHtml(o) {
    if (!o.arcs.length) return '';
    const arcs = o.arcs.map(a => {
        const m = arcMeta(a.status);
        const meta = [];
        if (a.desire) meta.push(`<span class="sd_arc_meta"><b>欲望</b>${escapeHtml(a.desire)}</span>`);
        if (a.flaw) meta.push(`<span class="sd_arc_meta"><b>缺陷</b>${escapeHtml(a.flaw)}</span>`);
        return `<div class="sd_arc_item">
            <div class="sd_arc_char"><i class="fa-solid fa-user-large"></i>${escapeHtml(a.char)}<span class="sd_badge ${m.cls}"><i class="${m.icon}"></i>${m.label}</span></div>
            ${meta.length ? `<div class="sd_arc_meta_row">${meta.join('')}</div>` : ''}
            ${a.growth ? `<div class="sd_arc_growth"><i class="fa-solid fa-arrow-trend-up"></i>${escapeHtml(a.growth)}</div>` : ''}
        </div>`;
    }).join('');
    return `<section class="sd_card sd_card_arcs">
        <header class="sd_card_header"><i class="fa-solid fa-users"></i>角色弧光</header>
        <div class="sd_card_body sd_arc_list">${arcs}</div>
    </section>`;
}

function foreshadowCardHtml(o) {
    if (!o.foreshadowing.length) return '';
    const items = o.foreshadowing.map(f => {
        const m = foreshadowMeta(f.status);
        const beat = f.beatId ? o.beats.find(b => b.id === f.beatId) : null;
        return `<div class="sd_fs_item">
            <span class="sd_badge ${m.cls}"><i class="${m.icon}"></i>${m.label}</span>
            <span class="sd_fs_hint">${escapeHtml(f.hint || f.id)}${beat ? `<small class="sd_fs_payoff">回收于 ${escapeHtml(beat.title || beat.id)}</small>` : ''}</span>
        </div>`;
    }).join('');
    return `<section class="sd_card sd_card_foreshadow">
        <header class="sd_card_header"><i class="fa-solid fa-eye"></i>伏笔</header>
        <div class="sd_card_body">${items}</div>
    </section>`;
}

function outlineSectionHtml(o) {
    if (!o.acts.length && !o.beats.length) return '';
    const usedBeatIds = new Set();
    const actSections = o.acts.map((act, index) => {
        const beats = o.beats.filter(b => b.actId === act.id || (act.beats || []).includes(b.id));
        beats.forEach(b => usedBeatIds.add(b.id));
        // 幕序号由数组顺序派生：删插/移动幕都不会跳号
        const numBadge = `<span class="sd_act_badge" title="第 ${index + 1} 幕（按当前顺序）">${index + 1}</span>`;
        return `<div class="sd_act" data-act-id="${escapeHtml(act.id)}">
            <div class="sd_act_head" title="双击编辑幕">
                ${numBadge}
                <span class="sd_act_title">${escapeHtml(act.title || act.id)}</span>
                ${act.summary ? `<span class="sd_act_summary">${escapeHtml(act.summary)}</span>` : ''}
                <i class="fa-regular fa-pen-to-square sd_edit_hint"></i>
            </div>
            ${beats.length ? `<div class="sd_timeline">${beats.map(renderBeatItem).join('')}</div>` : '<small class="sd_act_empty">本幕暂无节点</small>'}
        </div>`;
    }).join('');

    const unassigned = o.beats.filter(b => !usedBeatIds.has(b.id));
    const unassignedSection = unassigned.length
        ? `<div class="sd_act"><div class="sd_act_head"><span class="sd_act_title">未分幕节点</span></div><div class="sd_timeline">${unassigned.map(renderBeatItem).join('')}</div></div>`
        : '';

    return `<section class="sd_card sd_card_beats sd_card_outline">
        <header class="sd_card_header"><i class="fa-solid fa-timeline"></i>故事大纲</header>
        <div class="sd_card_body">${actSections}${unassignedSection}</div>
    </section>`;
}

function renderOverview(outline) {
    const el = document.getElementById('sd_overview');
    if (!el) return;
    const o = normalizeOutline(outline);

    const sideStory = document.getElementById('sd_sidebar_story');
    const sideArcs = document.getElementById('sd_sidebar_arcs');
    const sideForeshadow = document.getElementById('sd_sidebar_foreshadow');

    if (!hasOutlineContent(o)) {
        if (sideStory) sideStory.innerHTML = '';
        if (sideArcs) sideArcs.innerHTML = '';
        if (sideForeshadow) sideForeshadow.innerHTML = '';
        el.innerHTML = renderEmptyState();
        return;
    }

    if (sideStory || sideArcs || sideForeshadow) {
        if (sideStory) sideStory.innerHTML = storyCardHtml(o);
        if (sideArcs) sideArcs.innerHTML = arcsCardHtml(o);
        if (sideForeshadow) sideForeshadow.innerHTML = foreshadowCardHtml(o);
        el.innerHTML = outlineSectionHtml(o);
        return;
    }

    // 旧版单栏兜底：全部塞进主区域
    el.innerHTML = `<div class="sd_grid">${storyCardHtml(o)}${arcsCardHtml(o)}${foreshadowCardHtml(o)}</div>${outlineSectionHtml(o)}`;
}

function renderStats(outline) {
    const el = document.getElementById('sd_stats');
    if (!el) return;
    const o = normalizeOutline(outline);
    if (!hasOutlineContent(o)) { el.innerHTML = ''; return; }
    const done = o.beats.filter(b => b.status === 'done').length;
    const active = o.beats.find(b => b.status === 'active');
    const activeAct = active ? o.acts.find(a => a.id === active.actId || (a.beats || []).includes(active.id)) : null;

    // 体检历史：图标序列（旧 → 新），鼠标悬停显示每次的时间
    let checkStat = '';
    const history = Array.isArray(o.meta?.checkHistory) ? o.meta.checkHistory : [];
    if (history.length) {
        const icons = [...history].reverse().slice(-6).map(h => {
            const meta = VERDICT_META[h.verdict] || VERDICT_META.sync;
            const time = h.at ? new Date(h.at).toLocaleString() : '';
            return `<i class="${meta.icon} sd_check_hist_${escapeHtml(h.verdict)}" title="体检 · ${escapeHtml(meta.label)} · ${escapeHtml(time)}"></i>`;
        }).join('');
        checkStat = `<div class="sd_stat" title="最近 ${history.length} 次大纲体检结论（左旧右新）"><i class="fa-solid fa-stethoscope"></i>体检 <span class="sd_check_history">${icons}</span></div>`;
    }

    el.innerHTML = `<div class="sd_stat"><i class="fa-solid fa-layer-group"></i>${o.acts.length || 1} 幕</div>
        <div class="sd_stat"><i class="fa-solid fa-list-check"></i>${o.beats.length} 节点 · 已完成 ${done}</div>
        <div class="sd_stat"><i class="fa-solid fa-bullseye"></i>进行中：${activeAct ? escapeHtml(activeAct.title) : (active ? escapeHtml(active.title || active.id) : '无')}</div>
        <div class="sd_stat"><i class="fa-solid fa-clock-rotate-left"></i>已修订 ${o.meta.revisionCount} 次</div>
        ${checkStat}`;
}

function renderFocus(outline) {
    const el = document.getElementById('sd_focus');
    if (!el) return;
    const o = normalizeOutline(outline);
    const f = o.focus;
    if (!f || !(f.currentBeat || f.nextStep || (f.activeForeshadow?.length) || f.avoidOffTopic)) {
        el.innerHTML = '';
        return;
    }

    const beat = o.beats.find(b => b.id === f.currentBeat);
    const act = beat ? o.acts.find(a => a.id === beat.actId || (a.beats || []).includes(beat.id)) : null;
    const currentText = beat
        ? `${act ? `<span class="sd_focus_act">${escapeHtml(act.title)}</span> · ` : ''}${escapeHtml(beat.title || beat.id)} <code>${escapeHtml(beat.id)}</code>`
        : escapeHtml(f.currentBeat);
    const foreshadowTexts = (f.activeForeshadow || []).map(id => {
        const fs = o.foreshadowing.find(x => x.id === id);
        return fs ? (fs.hint || fs.id) : id;
    });

    el.innerHTML = `<section class="sd_card sd_focus_card">
        <header class="sd_card_header"><i class="fa-solid fa-bullseye"></i>当前焦点</header>
        <div class="sd_card_body">
            ${f.currentBeat ? `<div class="sd_focus_row sd_focus_current"><span class="sd_focus_label">当前节点</span><span class="sd_focus_value">${currentText}</span></div>` : ''}
            ${f.nextStep ? `<div class="sd_focus_row sd_focus_next"><span class="sd_focus_label">下一步</span><span class="sd_focus_value">${escapeHtml(f.nextStep)}</span></div>` : ''}
            ${foreshadowTexts.length ? `<div class="sd_focus_row"><span class="sd_focus_label">活跃伏笔</span><span class="sd_focus_value sd_focus_chips">${foreshadowTexts.map(x => `<span class="sd_chip">${escapeHtml(x)}</span>`).join('')}</span></div>` : ''}
            ${f.avoidOffTopic ? `<div class="sd_focus_row sd_focus_avoid"><span class="sd_focus_label">避免偏离</span><span class="sd_focus_value">${escapeHtml(f.avoidOffTopic)}</span></div>` : ''}
        </div>
    </section>`;
}

function syncTimelineInputs(outline) {
    const o = normalizeOutline(outline);
    const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value ?? '';
    };
    set('sd_timeline_start', o.timeline?.start);
    set('sd_timeline_end', o.timeline?.end);
    set('sd_timeline_note', o.timeline?.note);
    set('sd_timeline_must_read', o.timeline?.mustRead);
}

function renderHistoryOptions() {
    const sel = document.getElementById('sd_history_select');
    if (!sel) return;
    const history = adapterRef?.getHistory?.() || [];
    const reasonText = { generate: '生成', revise: '修订', check: '体检', manual: '手动编辑', import: '导入' };
    sel.innerHTML = history.length
        ? history.map((h, i) => {
            const time = h.at ? new Date(h.at).toLocaleString() : '';
            return `<option value="${i}">${reasonText[h.reason] || h.reason || '快照'} · ${time}</option>`;
        }).join('')
        : '<option value="">（无历史）</option>';
}

function renderReport(report, label = '大纲体检') {
    const el = document.getElementById('sd_report');
    if (!el) return;
    if (!report) { el.innerHTML = ''; return; }
    const verdict = VERDICT_META[report.verdict] ? report.verdict : 'sync';
    const meta = VERDICT_META[verdict];

    const issues = Array.isArray(report.issues)
        ? report.issues.map((issue) => {
            if (typeof issue === 'string') return escapeHtml(issue);
            if (issue && typeof issue === 'object') {
                const where = issue.where ? `<b>${escapeHtml(issue.where)}</b>：` : '';
                return `${where}${escapeHtml(issue.what || issue.description || '')}`;
            }
            return '';
        }).filter(Boolean)
        : [];

    el.innerHTML = `<section class="sd_report_card ${meta.cls}">
        <header class="sd_report_header">
            <i class="${meta.icon}"></i>
            <b>${escapeHtml(label)}报告</b>
            <span class="sd_verdict_badge">${meta.label}</span>
        </header>
        <div class="sd_report_body">
            ${issues.length ? `<div class="sd_report_issues">${issues.map(x => `<div class="sd_report_issue">• ${x}</div>`).join('')}</div>` : ''}
            ${report.reason ? `<div class="sd_report_row"><b>判断依据</b>${escapeHtml(report.reason)}</div>` : ''}
            ${report.changes ? `<div class="sd_report_row"><b>改动摘要</b>${escapeHtml(report.changes)}</div>` : ''}
            ${report.changed !== undefined ? `<div class="sd_report_row"><b>是否修改</b>${report.changed ? '是' : '否'}</div>` : ''}
        </div>
    </section>`;
}

// 向量检索命中展示：生成/修订/体检后由 adapter.setRetrievalCallback 推送
function renderRetrieval(hits) {
    const el = document.getElementById('sd_retrieval');
    if (!el) return;
    const list = (Array.isArray(hits) ? hits : [])
        .filter(h => h && typeof h === 'object' && (h.text || h.source))
        .map(h => ({
            query: String(h.query || '').trim(),
            source: String(h.source || '向量资料'),
            text: String(h.text || '').trim(),
        }));
    if (!list.length) {
        el.innerHTML = '';
        return;
    }
    const items = list.map(h => `
        <div class="sd_retrieval_hit">
            <span class="sd_chip sd_retrieval_source">${escapeHtml(h.source)}</span>
            <div class="sd_retrieval_text" title="${escapeHtml(h.text)}">${escapeHtml(h.text)}</div>
            ${h.query ? `<small class="sd_retrieval_query">查询：${escapeHtml(h.query.slice(0, 80))}</small>` : ''}
        </div>`).join('');
    el.innerHTML = `<section class="sd_card sd_retrieval_card">
        <header class="sd_card_header">
            <i class="fa-solid fa-database"></i>本次检索命中
            <span class="sd_retrieval_count">${list.length} 条</span>
        </header>
        <div class="sd_card_body sd_retrieval_list">${items}</div>
    </section>`;
}

export function mountUI(ctx, adapter) {
    // 注册渲染回调必须在任何面板守卫之前，否则加载顺序变化时回调可能永远注册不上
    adapter.setRenderCallback((outline) => {
        renderOverview(outline);
        renderFocus(outline);
        renderStats(outline);
        syncTimelineInputs(outline);
        renderHistoryOptions();
    });

    // 独立大界面由 index.js 负责加载到 body；若尚未就绪则等待 bindUI 时再补
    if (document.getElementById('story_director_window')) return;
}

function setButtonLoading(btn, loading) {
    if (!btn) return;
    btn.classList.toggle('sd_loading', loading);
    if (loading) {
        btn.setAttribute('aria-disabled', 'true');
    } else {
        btn.removeAttribute('aria-disabled');
    }
}

async function runAction(btn, { label, isCheck = false, call }) {
    if (!btn || btn.classList.contains('sd_loading')) return;
    // 自动修订可能正在后台运行：并发时手动操作会被 director 守卫丢弃，
    // 这里提前检查并给出「进行中」提示，避免误报为失败
    if (adapterRef?.director?.isRunning?.()) {
        renderReport({ verdict: 'sync', changed: false, reason: `${label}已跳过：上一次生成/修订/体检还在进行中，请稍候再试` }, label);
        return;
    }
    setButtonLoading(btn, true);
    try {
        const result = await call();
        if (result === null) {
            renderReport({ verdict: 'major-drift', changed: false, reason: `${label}失败，已沿用旧大纲` }, label);
        } else if (isCheck) {
            renderReport(result, label);
        } else {
            renderReport(null);
        }
        adapterRef?.renderOutline();
    } catch (e) {
        renderReport({ verdict: 'major-drift', changed: false, reason: `${label}失败：${e?.message || e}` }, label);
        adapterRef?.renderOutline();
    } finally {
        setButtonLoading(btn, false);
    }
}

let adapterRef = null;

export function bindUI(ctx, adapter) {
    adapterRef = adapter;
    adapter.setRetrievalCallback?.(renderRetrieval);

    // 独立窗口：关闭按钮 + Esc 关闭
    const windowEl = document.getElementById('story_director_window');
    const closeWindow = () => windowEl?.classList.remove('sd_open');
    document.getElementById('sd_window_close')?.addEventListener('click', closeWindow);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && windowEl?.classList.contains('sd_open')) closeWindow();
    });

    // 功能页签：主界面只放大纲总览，其余收进「设置与工具」
    const tabs = [...(document.querySelectorAll?.('.sd_tab') || [])];
    const switchView = (viewId) => {
        const views = [...(document.querySelectorAll?.('.sd_view') || [])];
        for (const view of views) view.classList.toggle('sd_hidden', view.id !== viewId);
        for (const tab of tabs) tab.classList.toggle('sd_tab_active', tab.getAttribute('data-sd-view') === viewId);
    };
    for (const tab of tabs) {
        tab.addEventListener('click', () => switchView(tab.getAttribute('data-sd-view')));
    }

    const enabledEl = document.getElementById('sd_enabled');
    if (enabledEl) enabledEl.checked = !!adapter.settings.enabled;
    enabledEl?.addEventListener('change', (e) => {
        adapter.settings.enabled = e.target.checked;
        ctx.saveSettingsDebounced?.();
        adapter.director.refreshInjection();
    });

    const lockEl = document.getElementById('sd_lock_outline');
    if (lockEl) lockEl.checked = !!adapter.settings.lockOutline;
    lockEl?.addEventListener('change', (e) => {
        adapter.settings.lockOutline = e.target.checked;
        ctx.saveSettingsDebounced?.();
    });

    // 时间线约束：存进当前聊天的大纲（chat_metadata），生成时作为硬约束传给模型
    const timelineField = (id) => document.getElementById(id);
    const readTimeline = () => ({
        start: timelineField('sd_timeline_start')?.value?.trim() || '',
        end: timelineField('sd_timeline_end')?.value?.trim() || '',
        note: timelineField('sd_timeline_note')?.value?.trim() || '',
        mustRead: timelineField('sd_timeline_must_read')?.value?.trim() || '',
    });
    const persistTimeline = () => {
        const outline = adapter.getOutline();
        outline.timeline = readTimeline();
        adapter.setOutline(outline);
        return outline.timeline;
    };
    const bindTimelineField = (id) => {
        timelineField(id)?.addEventListener('input', () => persistTimeline());
    };
    syncTimelineInputs(adapter.getOutline());
    bindTimelineField('sd_timeline_start');
    bindTimelineField('sd_timeline_end');
    bindTimelineField('sd_timeline_note');
    bindTimelineField('sd_timeline_must_read');

    const runGenerate = (btn) => runAction(btn, {
        label: '生成',
        call: () => {
            persistTimeline();
            return adapter.director.generate({ userRequest: '', timeline: readTimeline() });
        },
    });
    const runRevise = (btn) => runAction(btn, {
        label: '修订',
        call: () => adapter.director.revise(),
    });
    const runCheck = (btn) => runAction(btn, {
        label: '大纲体检',
        isCheck: true,
        call: () => adapter.director.check(),
    });

    document.getElementById('sd_generate')?.addEventListener('click', (e) => runGenerate(e.currentTarget));
    document.getElementById('sd_revise')?.addEventListener('click', (e) => runRevise(e.currentTarget));
    document.getElementById('sd_check')?.addEventListener('click', (e) => runCheck(e.currentTarget));
    document.getElementById('sd_clear')?.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        if (!btn || btn.classList.contains('sd_loading')) return;
        setButtonLoading(btn, true);
        try {
            adapter.recordHistory?.(adapter.getOutline(), 'manual');
            adapter.setOutline(createEmptyOutline());
            adapter.director.refreshInjection();
            renderReport(null);
            adapter.renderOutline();
        } finally {
            setButtonLoading(btn, false);
        }
    });

    // 参数设置（任务 B）：每个控件即时写回 extension_settings 并保存
    const saveSettings = () => ctx.saveSettingsDebounced?.();
    const setSelect = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value ?? '';
    };
    const bindSelect = (id, key, after) => {
        document.getElementById(id)?.addEventListener('change', (e) => {
            adapter.settings[key] = e.target.value;
            saveSettings();
            after?.();
        });
    };
    const bindNumber = (id, key, { min = 0, max = 1000, integer = true, after } = {}) => {
        document.getElementById(id)?.addEventListener('input', (e) => {
            const raw = Number(e.target.value);
            let value = Number.isFinite(raw) ? raw : adapter.settings[key];
            value = Math.min(max, Math.max(min, value));
            adapter.settings[key] = integer ? Math.floor(value) : value;
            saveSettings();
            after?.();
        });
    };

    setSelect('sd_control_strength', adapter.settings.controlStrength);
    setSelect('sd_revise_frequency', adapter.settings.reviseFrequency);
    setSelect('sd_drift_tolerance', adapter.settings.driftTolerance);
    setSelect('sd_outline_detail', adapter.settings.outlineDetail);
    setSelect('sd_beat_pacing', adapter.settings.beatPacing || 'balanced');
    setSelect('sd_generate_memory_mode', adapter.settings.generateMemoryMode || 'auto');
    const setNumber = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value ?? 0;
    };
    setNumber('sd_inject_limit', adapter.settings.injectTokenLimit);
    setNumber('sd_revise_every_n', adapter.settings.reviseEveryN);
    setNumber('sd_recent_turns', adapter.settings.recentTurns);
    setNumber('sd_card_context_limit', adapter.settings.cardContextLimit ?? 12000);
    setNumber('sd_dialogue_context_limit', adapter.settings.dialogueContextLimit ?? 8000);
    setNumber('sd_memory_context_limit', adapter.settings.memoryContextLimit ?? 8000);
    setNumber('sd_vector_memory_limit', adapter.settings.vectorMemoryLimit ?? 6000);
    const memoryToggleEl = document.getElementById('sd_use_memory_plugin');
    if (memoryToggleEl) memoryToggleEl.value = adapter.settings.useMemoryPlugin === false ? 'false' : 'true';
    memoryToggleEl?.addEventListener('change', (e) => {
        adapter.settings.useMemoryPlugin = e.target.value !== 'false';
        saveSettings();
    });
    const vectorToggleEl = document.getElementById('sd_use_vector_memory');
    if (vectorToggleEl) vectorToggleEl.value = adapter.settings.useVectorMemory === false ? 'false' : 'true';
    vectorToggleEl?.addEventListener('change', (e) => {
        adapter.settings.useVectorMemory = e.target.value !== 'false';
        saveSettings();
    });

    const syncReviseEveryNVisibility = () => {
        document.getElementById('sd_revise_every_n_row')?.classList.toggle('sd_hidden', adapter.settings.reviseFrequency !== 'everyN');
    };
    syncReviseEveryNVisibility();

    bindSelect('sd_control_strength', 'controlStrength', () => adapter.director.refreshInjection());
    bindNumber('sd_inject_limit', 'injectTokenLimit', { min: 0, max: 4000, after: () => adapter.director.refreshInjection() });
    bindSelect('sd_revise_frequency', 'reviseFrequency', syncReviseEveryNVisibility);
    bindNumber('sd_revise_every_n', 'reviseEveryN', { min: 1, max: 20 });
    bindSelect('sd_drift_tolerance', 'driftTolerance');
    bindSelect('sd_outline_detail', 'outlineDetail');
    bindSelect('sd_beat_pacing', 'beatPacing');
    bindSelect('sd_generate_memory_mode', 'generateMemoryMode');
    bindNumber('sd_recent_turns', 'recentTurns', { min: 1, max: 50 });
    bindNumber('sd_card_context_limit', 'cardContextLimit', { min: 2000, max: 200000 });
    bindNumber('sd_dialogue_context_limit', 'dialogueContextLimit', { min: 1000, max: 50000 });
    bindNumber('sd_memory_context_limit', 'memoryContextLimit', { min: 1000, max: 50000 });
    bindNumber('sd_vector_memory_limit', 'vectorMemoryLimit', { min: 1000, max: 30000 });

    // 独立 API 配置（任务 A）：即时写回 extension_settings
    const llm = adapter.settings.llm || { mode: 'main', api: '', baseUrl: '', apiKey: '', model: '' };
    const llmModeEl = document.getElementById('sd_llm_mode');
    const llmFieldsEl = document.getElementById('sd_llm_fields');
    const syncLlmVisibility = () => {
        llmFieldsEl?.classList.toggle('sd_hidden', llmModeEl?.value !== 'custom');
    };
    if (llmModeEl) llmModeEl.value = llm.mode === 'custom' ? 'custom' : 'main';
    const setLlmField = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value ?? '';
    };
    setLlmField('sd_llm_api', llm.api);
    setLlmField('sd_llm_base_url', llm.baseUrl);
    setLlmField('sd_llm_api_key', llm.apiKey);
    setLlmField('sd_llm_model', llm.model);
    syncLlmVisibility();
    llmModeEl?.addEventListener('change', () => {
        llm.mode = llmModeEl.value;
        saveSettings();
        syncLlmVisibility();
    });
    const bindLlmField = (id, key) => {
        document.getElementById(id)?.addEventListener('input', (e) => {
            llm[key] = e.target.value;
            saveSettings();
        });
    };
    bindLlmField('sd_llm_api', 'api');
    bindLlmField('sd_llm_base_url', 'baseUrl');
    bindLlmField('sd_llm_api_key', 'apiKey');
    bindLlmField('sd_llm_model', 'model');

    // 模型列表 / 连接测试：使用表单当前值（可能尚未触发保存）
    const llmTestResultEl = document.getElementById('sd_llm_test_result');
    const showLlmTest = (text, ok) => {
        if (!llmTestResultEl) return;
        llmTestResultEl.textContent = text || '';
        llmTestResultEl.className = `sd_llm_test_result ${ok ? 'sd_llm_test_ok' : 'sd_llm_test_fail'}`;
    };
    const currentLlmForm = () => ({
        baseUrl: document.getElementById('sd_llm_base_url')?.value?.trim() || '',
        apiKey: document.getElementById('sd_llm_api_key')?.value?.trim() || '',
    });
    const llmModelInput = document.getElementById('sd_llm_model');
    const llmModelChips = document.getElementById('sd_llm_model_chips');
    // 模型 chip 面板：全部模型常驻可见，点击填入输入框（datalist 会被输入值过滤，弃用）
    const renderModelChips = (models) => {
        if (!llmModelChips) return;
        if (!models?.length) { llmModelChips.innerHTML = ''; return; }
        const current = llmModelInput?.value?.trim() || '';
        llmModelChips.innerHTML = models.map(m => `
            <span class="sd_chip sd_llm_model_chip${m === current ? ' sd_llm_model_chip_active' : ''}" data-model="${escapeHtml(m)}">${escapeHtml(m)}</span>
        `).join('');
    };
    llmModelChips?.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-model]');
        if (!chip || !llmModelInput) return;
        const model = chip.getAttribute('data-model');
        llmModelInput.value = model;
        llm.model = model;
        saveSettings();
        renderModelChips([...llmModelChips.querySelectorAll('[data-model]')].map(c => c.getAttribute('data-model')));
    });
    document.getElementById('sd_llm_fetch_models')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (btn.classList.contains('sd_loading')) return;
        setButtonLoading(btn, true);
        showLlmTest('', true);
        try {
            const models = await adapter.listModels(currentLlmForm());
            renderModelChips(models);
            if (models.length) {
                showLlmTest(`已获取 ${models.length} 个模型，点击下方标签即可选用`, true);
            } else {
                showLlmTest('获取失败：连接成功但未返回模型列表', false);
            }
        } catch (err) {
            renderModelChips([]);
            showLlmTest(`获取失败：${err?.message || err}`, false);
        } finally {
            setButtonLoading(btn, false);
        }
    });
    document.getElementById('sd_llm_test')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (btn.classList.contains('sd_loading')) return;
        setButtonLoading(btn, true);
        showLlmTest('', true);
        try {
            const r = await adapter.testApiConnection(currentLlmForm());
            if (r?.ok) {
                const suffix = r.modelCount != null ? `（${r.modelCount} 个模型可用）` : '';
                showLlmTest(`连接成功：${r.detail}${suffix}`, true);
            } else {
                showLlmTest(`连接失败：${r?.detail || '请检查 Base URL 与 API Key'}`, false);
            }
        } catch (err) {
            showLlmTest(`连接失败：${err?.message || err}`, false);
        } finally {
            setButtonLoading(btn, false);
        }
    });

    // ---------- 节点编辑器 ----------
    let editingBeatId = null;
    const beatEditorEl = document.getElementById('sd_beat_editor');
    const beatTitleEl = document.getElementById('sd_beat_title');
    const beatSummaryEl = document.getElementById('sd_beat_summary');
    const beatActEl = document.getElementById('sd_beat_act');
    const beatTypeEl = document.getElementById('sd_beat_type');
    const beatCastEl = document.getElementById('sd_beat_cast');

    function fillActOptions(outline) {
        if (!beatActEl) return;
        const acts = outline.acts.length ? outline.acts : [{ id: '', title: '（无幕，自动创建）' }];
        beatActEl.innerHTML = acts.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.title || a.id)}</option>`).join('');
    }

    function openBeatEditor(beatId = null) {
        const outline = adapter.getOutline();
        fillActOptions(outline);
        editingBeatId = beatId;
        const beat = beatId ? outline.beats.find(b => b.id === beatId) : null;
        if (beatTitleEl) beatTitleEl.value = beat?.title || '';
        if (beatSummaryEl) beatSummaryEl.value = beat?.summary || '';
        if (beatTypeEl) beatTypeEl.value = beat?.type || 'setup';
        if (beatCastEl) beatCastEl.value = (beat?.cast || []).join('，');
        if (beatActEl && beat) beatActEl.value = beat.actId || outline.acts[0]?.id || '';
        beatEditorEl?.classList.add('sd_open');
    }

    function closeBeatEditor() {
        beatEditorEl?.classList.remove('sd_open');
        editingBeatId = null;
    }

    function saveBeatFromEditor() {
        const outline = adapter.getOutline();
        const title = beatTitleEl?.value?.trim() || '未命名节点';
        const summary = beatSummaryEl?.value?.trim() || '';
        const type = beatTypeEl?.value || 'setup';
        const actId = beatActEl?.value || '';
        const cast = String(beatCastEl?.value || '').split(/[,，、;；]/).map(x => x.trim()).filter(Boolean);

        adapter.recordHistory?.(outline, 'manual');

        // 受控纯函数：actId 是唯一事实，acts.beats 派生；自动补幕
        const updated = editingBeatId
            ? updateBeat(outline, editingBeatId, { title, summary, type, actId, cast })
            : createBeat(outline, { title, summary, type, actId, cast });

        adapter.setOutline(updated);
        adapter.renderOutline();
        adapter.director.refreshInjection();
        closeBeatEditor();
    }

    function moveEditingBeat(delta) {
        if (!editingBeatId) return;
        const outline = adapter.getOutline();
        const updated = moveBeatOrder(outline, editingBeatId, delta);
        // 已在边界时顺序不变，不产生无效快照
        if (updated.beats.map(b => b.id).join() === outline.beats.map(b => b.id).join()) return;
        adapter.recordHistory?.(outline, 'manual');
        adapter.setOutline(updated);
        adapter.renderOutline();
    }

    document.getElementById('sd_add_beat')?.addEventListener('click', () => openBeatEditor(null));
    document.getElementById('sd_beat_ai')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (btn.classList.contains('sd_loading')) return;
        setButtonLoading(btn, true);
        try {
            const hint = document.getElementById('sd_beat_ai_hint')?.value?.trim() || '';
            const beat = await adapter.director.suggestBeat({ userHint: hint });
            if (!beat) {
                renderReport({ verdict: 'major-drift', changed: false, reason: 'AI 生成节点失败，请手动填写或稍后再试' }, 'AI 生成');
                return;
            }
            if (beatTitleEl) beatTitleEl.value = beat.title;
            if (beatSummaryEl) beatSummaryEl.value = beat.summary;
            if (beatTypeEl) beatTypeEl.value = beat.type;
            if (beatCastEl) beatCastEl.value = beat.cast.join('，');
            if (beatActEl && beat.actId) {
                const outline = adapter.getOutline();
                fillActOptions(outline);
                if (outline.acts.some(a => a.id === beat.actId)) beatActEl.value = beat.actId;
            }
            renderReport({ verdict: 'sync', changed: false, reason: 'AI 已生成节点内容，请确认后保存' }, 'AI 生成');
        } catch (err) {
            renderReport({ verdict: 'major-drift', changed: false, reason: `AI 生成节点失败：${err?.message || err}` }, 'AI 生成');
        } finally {
            setButtonLoading(btn, false);
        }
    });
    document.getElementById('sd_beat_save')?.addEventListener('click', saveBeatFromEditor);
    document.getElementById('sd_beat_cancel')?.addEventListener('click', closeBeatEditor);
    document.getElementById('sd_beat_editor_close')?.addEventListener('click', closeBeatEditor);
    document.getElementById('sd_beat_move_up')?.addEventListener('click', () => moveEditingBeat(-1));
    document.getElementById('sd_beat_move_down')?.addEventListener('click', () => moveEditingBeat(1));
    document.getElementById('sd_beat_jump_here')?.addEventListener('click', () => {
        if (!editingBeatId) return;
        jumpToBeatUI(editingBeatId);
        closeBeatEditor();
    });
    document.getElementById('sd_beat_delete')?.addEventListener('click', () => {
        if (!editingBeatId) return closeBeatEditor();
        const outline = adapter.getOutline();
        adapter.recordHistory?.(outline, 'manual');
        // 受控删除：伏笔回收点 / 焦点节点等悬空引用由 normalize 自愈
        const updated = removeBeat(outline, editingBeatId);
        adapter.setOutline(updated);
        adapter.renderOutline();
        adapter.director.refreshInjection();
        closeBeatEditor();
    });

    // 跳转：从指定节点开始游玩（目标 active、之前 done、焦点指向目标，留快照可回滚）
    function jumpToBeatUI(beatId) {
        const outline = adapter.getOutline();
        const beat = outline.beats.find(b => b.id === beatId);
        if (!beat) return;
        if (!confirm(`从「${beat.title || beat.id}」开始游玩？\n该节点之前的节点将标记为已完成，随时可从快照回滚。`)) return;
        adapter.recordHistory?.(outline, 'manual');
        const updated = jumpToBeat(outline, beatId);
        adapter.setOutline(updated);
        adapter.renderOutline();
        adapter.director.refreshInjection();
        renderReport({ verdict: 'sync', changed: false, reason: `已跳转到「${beat.title || beat.id}」，从此处开始游玩` }, '跳转');
    }

    // 主区事件委托：空状态生成按钮 / 点击节点编辑 / 跳转按钮 / 双击幕编辑
    document.getElementById('sd_overview')?.addEventListener('click', (e) => {
        const emptyCta = e.target.closest('#sd_generate_empty');
        if (emptyCta) {
            runGenerate(emptyCta);
            return;
        }
        const jumpBtn = e.target.closest('[data-jump-id]');
        if (jumpBtn) {
            jumpToBeatUI(jumpBtn.getAttribute('data-jump-id'));
            return;
        }
        const beatEl = e.target.closest('[data-beat-id]');
        if (beatEl) openBeatEditor(beatEl.getAttribute('data-beat-id'));
    });
    document.getElementById('sd_overview')?.addEventListener('dblclick', (e) => {
        const actEl = e.target.closest('[data-act-id]');
        if (!actEl || e.target.closest('[data-beat-id]')) return;
        const outline = adapter.getOutline();
        const act = outline.acts.find(a => a.id === actEl.getAttribute('data-act-id'));
        if (!act) return;
        const title = prompt('编辑幕标题：', act.title);
        if (title === null) return;
        const summary = prompt('编辑幕概要：', act.summary || '');
        if (summary === null) return;
        adapter.recordHistory?.(outline, 'manual');
        act.title = title;
        act.summary = summary;
        adapter.setOutline(outline);
        adapter.renderOutline();
    });

    // ---------- 快照回滚 / 导出 / 导入 ----------
    document.getElementById('sd_history_rollback')?.addEventListener('click', () => {
        const sel = document.getElementById('sd_history_select');
        const index = Number(sel?.value);
        if (!Number.isInteger(index) || index < 0) return;
        if (adapter.restoreHistory?.(index)) {
            adapter.renderOutline();
            adapter.director.refreshInjection();
            renderReport({ verdict: 'sync', changed: false, reason: `已回滚到快照 #${index + 1}` }, '回滚');
        }
    });

    document.getElementById('sd_renumber_acts')?.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        if (btn.classList.contains('sd_loading')) return;
        setButtonLoading(btn, true);
        try {
            const outline = adapter.getOutline();
            adapter.recordHistory?.(outline, 'manual');
            adapter.setOutline(renumberActTitles(outline));
            adapter.renderOutline();
            renderReport({ verdict: 'sync', changed: false, reason: '幕标题编号已按当前顺序重编（不含编号的标题未动）' }, '重编幕号');
        } finally {
            setButtonLoading(btn, false);
        }
    });

    document.getElementById('sd_export')?.addEventListener('click', async () => {
        const json = JSON.stringify(adapter.getOutline(), null, 2);
        try {
            await navigator.clipboard?.writeText(json);
            renderReport({ verdict: 'sync', changed: false, reason: '大纲 JSON 已复制到剪贴板' }, '导出');
        } catch {
            prompt('复制以下大纲 JSON：', json);
        }
    });

    document.getElementById('sd_import')?.addEventListener('click', () => {
        const raw = prompt('粘贴大纲 JSON：');
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw);
            adapter.recordHistory?.(adapter.getOutline(), 'import');
            adapter.setOutline(parsed);
            adapter.renderOutline();
            adapter.director.refreshInjection();
            renderReport({ verdict: 'sync', changed: false, reason: '大纲已导入' }, '导入');
        } catch (e) {
            renderReport({ verdict: 'major-drift', changed: false, reason: `导入失败：${e?.message || e}` }, '导入');
        }
    });

    // ---------- 窗口拖拽 ----------
    const header = windowEl?.querySelector('.sd_window_header');
    if (windowEl && header) {
        let dragging = null;
        header.addEventListener('pointerdown', (e) => {
            if (e.target.closest('#sd_window_close')) return;
            const rect = windowEl.getBoundingClientRect();
            dragging = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
            windowEl.classList.add('sd_dragging');
        });
        document.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            windowEl.style.left = `${e.clientX - dragging.dx}px`;
            windowEl.style.top = `${e.clientY - dragging.dy}px`;
            windowEl.style.right = 'auto';
            windowEl.style.bottom = 'auto';
            windowEl.style.margin = '0';
        });
        document.addEventListener('pointerup', () => {
            if (!dragging) return;
            dragging = null;
            windowEl.classList.remove('sd_dragging');
            // 记住窗口位置（随 extension_settings 持久化，下次打开恢复）
            const rect = windowEl.getBoundingClientRect();
            adapter.settings.windowPos = { left: Math.round(rect.left), top: Math.round(rect.top) };
            ctx.saveSettingsDebounced?.();
        });
    }

    renderHistoryOptions();
}

export { renderOverview, renderFocus, renderReport, renderRetrieval };
