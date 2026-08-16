// story-director/src/ui-render.js
// 渲染层：纯渲染函数（HTML 字符串 / DOM 填充），不绑定业务事件。
// 从 ui.js 拆分而来；bindUI 的事件逻辑与状态留在 ui.js。
import { normalizeOutline } from './outline-store.js';


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
    return !!(o.theme || o.tone || o.world || o.mustRead || o.timeline?.start || o.timeline?.end || o.arcs.length || o.foreshadowing.length || o.acts.length || o.beats.length);
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

function renderBeatItem(b, foreshadowing = []) {
    const m = beatMeta(b.status);
    const tm = beatTypeMeta(b.type);
    // 指向该节点的活跃伏笔（已回收的伏笔不在节点上重复显示）
    const fsChips = (Array.isArray(foreshadowing) ? foreshadowing : [])
        .filter(f => f.beatId === b.id && f.status !== 'paid')
        .map(f => `<span class="sd_fs_chip" title="伏笔：${escapeHtml(f.hint || f.id)}"><i class="fa-solid fa-link"></i>${escapeHtml(String(f.hint || f.id).slice(0, 18))}</span>`)
        .join('');
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
            ${fsChips ? `<div class="sd_beat_fs">${fsChips}</div>` : ''}
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
    if (o.mustRead) rows.push(`<div class="sd_kv sd_kv_mustread"><span class="sd_kv_key">必读设定</span><span class="sd_kv_value">${escapeHtml(o.mustRead)}</span></div>`);
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
            <span class="sd_fs_hint">${escapeHtml(f.hint || f.id)}${beat ? `<small class="sd_fs_payoff">回收于 <a class="sd_fs_payoff_link" data-payoff-beat="${escapeHtml(beat.id)}" title="跳转到该节点">${escapeHtml(beat.title || beat.id)}</a></small>` : ''}</span>
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
        const isHistory = String(act.id).startsWith('act_history');
        const replanBtn = isHistory ? '' : `<span class="sd_act_replan" data-act-replan="${escapeHtml(act.id)}" title="只重新设计这一幕（其他幕不动）"><i class="fa-solid fa-wand-magic-sparkles"></i>修改这一幕</span>`;
        const head = `<div class="sd_act_head" title="双击编辑幕">
                ${numBadge}
                <span class="sd_act_title">${escapeHtml(act.title || act.id)}</span>
                ${act.summary ? `<span class="sd_act_summary">${escapeHtml(act.summary)}</span>` : ''}
                ${replanBtn}
                <i class="fa-regular fa-pen-to-square sd_edit_hint"></i>
            </div>`;
        const body = beats.length ? `<div class="sd_timeline">${beats.map(b => renderBeatItem(b, o.foreshadowing)).join('')}</div>` : '<small class="sd_act_empty">本幕暂无节点</small>';
        // 前情幕默认折叠（原生 details/summary，零 JS）
        if (isHistory) {
            return `<details class="sd_act sd_act_history" data-act-id="${escapeHtml(act.id)}">
                <summary class="sd_act_head" title="点击展开/折叠前情">${numBadge}
                    <span class="sd_act_title">${escapeHtml(act.title || act.id)}</span>
                    <span class="sd_act_summary">${escapeHtml(act.summary || '已发生的剧情（点击展开）')}</span>
                    <span class="sd_act_toggle"><i class="fa-solid fa-chevron-down"></i></span>
                </summary>
                ${body}
            </details>`;
        }
        return `<div class="sd_act" data-act-id="${escapeHtml(act.id)}">${head}${body}</div>`;
    }).join('');

    const unassigned = o.beats.filter(b => !usedBeatIds.has(b.id));
    const unassignedSection = unassigned.length
        ? `<div class="sd_act"><div class="sd_act_head"><span class="sd_act_title">未分幕节点</span></div><div class="sd_timeline">${unassigned.map(b => renderBeatItem(b, o.foreshadowing)).join('')}</div></div>`
        : '';

    return `<section class="sd_card sd_card_beats sd_card_outline">
        <header class="sd_card_header"><i class="fa-solid fa-timeline"></i>故事大纲</header>
        <div class="sd_card_body">${actSections}${unassignedSection}</div>
    </section>`;
}

// 世界事件区块（世界模式）：总览页展示世界动态时间轴——只读，管理在「角色与伏笔」页
function worldEventsSectionHtml(o) {
    const events = Array.isArray(o.worldEvents) ? o.worldEvents : [];
    if (!events.length) return '';
    const order = { active: 0, pending: 1, paid: 2 };
    const sorted = [...events].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));
    const items = sorted.map(e => {
        const statusCls = `sd_badge ${e.status === 'active' ? 'sd_badge_active' : (e.status === 'paid' ? 'sd_badge_paid' : 'sd_badge_pending')}`;
        const statusLabel = e.status === 'active' ? '⚡进行中' : (e.status === 'paid' ? '✓已发生' : '⏳待触发');
        const impactCls = e.impact === 'direct' ? ' sd_ev_direct' : ' sd_ev_ambient';
        const impactLabel = e.impact === 'direct' ? '会相遇' : '背景';
        return `<div class="sd_ev_item">
            <span class="sd_badge ${statusCls}">${statusLabel}</span>
            <span class="sd_ev_time">${escapeHtml(e.time || '?')}</span>
            <span class="sd_ev_title">${escapeHtml(e.title || e.id)}</span>
            <span class="sd_ev_impact${impactCls}">${impactLabel}</span>
            ${e.actors?.length ? `<span class="sd_ev_actors">（${escapeHtml(e.actors.join('、'))}）</span>` : ''}
            ${e.trigger ? `<small class="sd_ev_trigger">触发：${escapeHtml(e.trigger)}</small>` : ''}
            ${e.outcome ? `<small class="sd_ev_outcome">结果：${escapeHtml(e.outcome)}</small>` : ''}
        </div>`;
    }).join('');
    return `<section class="sd_card sd_card_world">
        <header class="sd_card_header"><i class="fa-solid fa-earth-asia"></i>世界动态 <small class="sd_hint">主角行动完全自由，世界会回应</small></header>
        <div class="sd_card_body sd_ev_list">${items}</div>
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
        // 世界模式：世界动态时间轴置顶（环境，非主角指令）
        el.innerHTML = `${worldEventsSectionHtml(o)}${outlineSectionHtml(o)}`;
        return;
    }

    // 旧版单栏兜底：全部塞进主区域
    el.innerHTML = `<div class="sd_grid">${storyCardHtml(o)}${arcsCardHtml(o)}${foreshadowCardHtml(o)}</div>${worldEventsSectionHtml(o)}${outlineSectionHtml(o)}`;
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
    set('sd_must_read', o.mustRead);
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

// 角色弧光管理卡：每个角色一张卡（欲望/缺陷/成长 + 出场节点 chips）
function renderCharacters(arcs, beats) {
    const list = Array.isArray(arcs) ? arcs : [];
    if (!list.length) {
        return `<div class="sd_empty_state sd_empty_small">
            <div class="sd_empty_text">还没有角色弧光。点击右上角「加角色」，或先生成大纲。</div>
        </div>`;
    }
    const cards = list.map(a => {
        const m = arcMeta(a.status);
        const castBeats = (Array.isArray(beats) ? beats : [])
            .filter(b => Array.isArray(b.cast) && b.cast.includes(a.char));
        const beatChips = castBeats.length
            ? `<div class="sd_arc_beats"><small class="sd_arc_beats_label">出场：</small>${castBeats.map(b => `<span class="sd_chip sd_arc_beat_chip" data-arc-beat="${escapeHtml(b.id)}" title="跳到该节点">${escapeHtml(b.title || b.id)}</span>`).join('')}</div>`
            : '';
        const meta = [];
        if (a.desire) meta.push(`<span class="sd_arc_meta"><b>欲望</b>${escapeHtml(a.desire)}</span>`);
        if (a.flaw) meta.push(`<span class="sd_arc_meta"><b>缺陷</b>${escapeHtml(a.flaw)}</span>`);
        return `<div class="sd_arc_card" data-arc-char="${escapeHtml(a.char)}" title="点击编辑弧光">
            <div class="sd_arc_char"><i class="fa-solid fa-user-large"></i>${escapeHtml(a.char)}<span class="sd_badge ${m.cls}"><i class="${m.icon}"></i>${m.label}</span></div>
            ${meta.length ? `<div class="sd_arc_meta_row">${meta.join('')}</div>` : ''}
            ${a.growth ? `<div class="sd_arc_growth"><i class="fa-solid fa-arrow-trend-up"></i>${escapeHtml(a.growth)}</div>` : ''}
            ${beatChips}
        </div>`;
    }).join('');
    return `<div class="sd_arc_grid">${cards}</div>`;
}

// 伏笔管理列表：状态筛选 + 每条的编辑/回收操作
function renderForeshadowManager(foreshadowing, beats, filter = '') {
    const list = (Array.isArray(foreshadowing) ? foreshadowing : [])
        .filter(f => !filter || f.status === filter);
    if (!list.length) {
        return `<div class="sd_empty_state sd_empty_small"><div class="sd_empty_text">${filter ? '该状态下暂无伏笔。' : '还没有伏笔。点击右上角「加伏笔」，或先生成大纲。'}</div></div>`;
    }
    const items = list.map(f => {
        const m = foreshadowMeta(f.status);
        const beat = f.beatId ? (Array.isArray(beats) ? beats : []).find(b => b.id === f.beatId) : null;
        const payoffLink = beat
            ? `<a class="sd_fs_payoff_link" data-payoff-beat="${escapeHtml(beat.id)}" title="跳到该节点">回收于 ${escapeHtml(beat.title || beat.id)}</a>`
            : (f.payoff ? `<small class="sd_fs_payoff">${escapeHtml(f.payoff)}</small>` : '');
        const actions = f.status === 'paid'
            ? `<span class="sd_fs_actions"><span class="sd_fs_edit" data-fs-edit="${escapeHtml(f.id)}" title="编辑"><i class="fa-regular fa-pen-to-square"></i></span></span>`
            : `<span class="sd_fs_actions">
                <span class="sd_fs_edit" data-fs-edit="${escapeHtml(f.id)}" title="编辑"><i class="fa-regular fa-pen-to-square"></i></span>
                <span class="sd_fs_pay" data-fs-pay="${escapeHtml(f.id)}" title="标记为已回收"><i class="fa-solid fa-check-double"></i></span>
              </span>`;
        return `<div class="sd_fs_item sd_fs_item_manage">
            <span class="sd_badge ${m.cls}"><i class="${m.icon}"></i>${m.label}</span>
            <span class="sd_fs_hint">${escapeHtml(f.hint || f.id)}${payoffLink ? `<small class="sd_fs_payoff">${payoffLink}</small>` : ''}</span>
            ${actions}
        </div>`;
    }).join('');
    return `<div class="sd_fs_list">${items}</div>`;
}

// 世界事件管理列表（世界模式）：状态筛选 + 编辑/标记发生/删除
function renderWorldEventsManager(events, filter = '') {
    const list = (Array.isArray(events) ? events : [])
        .filter(e => !filter || e.status === filter);
    if (!list.length) {
        return `<div class="sd_empty_state sd_empty_small"><div class="sd_empty_text">${filter ? '该状态下暂无事件。' : '还没有世界事件。切到「世界模式」生成大纲，或手动添加。'}</div></div>`;
    }
    const items = list.map(e => {
        const m = e.status === 'active' ? { cls: 'sd_badge_active', label: '⚡进行中' }
            : (e.status === 'paid' ? { cls: 'sd_badge_paid', label: '✓已发生' } : { cls: 'sd_badge_pending', label: '⏳待触发' });
        const actions = e.status === 'paid'
            ? `<span class="sd_fs_actions"><span class="sd_ev_edit" data-ev-edit="${escapeHtml(e.id)}" title="编辑"><i class="fa-regular fa-pen-to-square"></i></span></span>`
            : `<span class="sd_fs_actions">
                <span class="sd_ev_edit" data-ev-edit="${escapeHtml(e.id)}" title="编辑"><i class="fa-regular fa-pen-to-square"></i></span>
                <span class="sd_ev_pay" data-ev-pay="${escapeHtml(e.id)}" title="标记为已发生"><i class="fa-solid fa-check-double"></i></span>
              </span>`;
        return `<div class="sd_fs_item sd_fs_item_manage">
            <span class="sd_badge ${m.cls}">${m.label}</span>
            <span class="sd_fs_hint">${e.impact === 'direct' ? '<span class="sd_ev_direct_tag">相遇</span>' : '<span class="sd_ev_ambient_tag">背景</span>'}${escapeHtml(e.time || '?')}｜${escapeHtml(e.title || e.id)}${e.trigger ? `<small class="sd_fs_payoff">触发：${escapeHtml(e.trigger)}</small>` : ''}${e.outcome ? `<small class="sd_fs_payoff">结果：${escapeHtml(e.outcome)}</small>` : ''}</span>
            ${actions}
        </div>`;
    }).join('');
    return `<div class="sd_fs_list">${items}</div>`;
}


const TERM_CAT_LABELS = {
    llm: 'LLM',
    retrieval: '检索',
    memory: '记忆',
    engine: '引擎',
    edit: '编辑',
    lifecycle: '生命周期',
};

// 调试终端：单条日志条目 HTML（展开详情由点击切换，默认折叠）
function renderTermEntry(entry) {
    const time = String(entry?.ts || '').slice(11, 23) || '';
    const lv = entry?.level || 'info';
    const cat = TERM_CAT_LABELS[entry?.category] || entry?.category || '';
    const detail = entry?.detail ? `<pre class="sd_term_detail">${escapeHtml(entry.detail)}</pre>` : '';
    return `<div class="sd_term_entry" data-term-id="${entry?.id ?? ''}">
        <span class="sd_term_time">${escapeHtml(time)}</span>
        <span class="sd_term_lv sd_term_lv_${escapeHtml(lv)}">${escapeHtml(lv)}</span>
        <span class="sd_term_cat">${escapeHtml(cat)}</span>
        <span class="sd_term_msg">${escapeHtml(entry?.message || '')}</span>
        ${detail}
    </div>`;
}

// 调试终端：条目列表（entries 已按显示顺序排好，最新在前）；total 是过滤后总数
function renderTermList(entries, total = entries.length) {
    if (!Array.isArray(entries) || !entries.length) {
        return `<div class="sd_term_empty">暂无日志${total ? `（共 ${total} 条被过滤）` : ''}。触发一次生成/修订即可看到 LLM 调用记录。</div>`;
    }
    const head = total > entries.length
        ? `<div class="sd_term_more">仅显示最近 ${entries.length} 条，共 ${total} 条（调整过滤条件查看）</div>`
        : '';
    return `${head}${entries.map(renderTermEntry).join('')}`;
}


export { escapeHtml, renderOverview, renderFocus, renderStats, renderReport, syncTimelineInputs, renderBeatItem, foreshadowCardHtml, renderCharacters, renderForeshadowManager, renderWorldEventsManager, renderTermEntry, renderTermList };
