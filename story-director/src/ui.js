// story-director/src/ui.js
// UI 层：渲染面板、绑定事件、手动编辑。依赖浏览器 DOM 与酒馆 ctx。
import { createEmptyOutline, normalizeOutline } from './outline-store.js';

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

function hasOutlineContent(o) {
    return !!(o.theme || o.tone || o.world || o.arcs.length || o.foreshadowing.length || o.beats.length);
}

function renderEmptyState() {
    return `<div class="sd_empty_state">
        <div class="sd_empty_icon"><i class="fa-solid fa-clapperboard"></i></div>
        <div class="sd_empty_title">还没有大纲</div>
        <div class="sd_empty_text">读取当前角色卡，生成一份带情节节点、伏笔与当前焦点的叙事大纲。</div>
        <div id="sd_generate_empty" class="menu_button sd_btn sd_btn_primary sd_empty_cta" title="生成大纲">
            <i class="fa-solid fa-wand-magic-sparkles sd_btn_icon"></i><span>生成大纲</span>
        </div>
    </div>`;
}

function renderOverview(outline) {
    const el = document.getElementById('sd_overview');
    if (!el) return;
    const o = normalizeOutline(outline);
    if (!hasOutlineContent(o)) {
        el.innerHTML = renderEmptyState();
        return;
    }

    const cards = [];

    if (o.theme || o.tone || o.world) {
        const rows = [];
        if (o.theme) rows.push(`<div class="sd_kv"><span class="sd_kv_key">主题</span><span class="sd_kv_value">${escapeHtml(o.theme)}</span></div>`);
        if (o.tone) rows.push(`<div class="sd_kv"><span class="sd_kv_key">基调</span><span class="sd_kv_value">${escapeHtml(o.tone)}</span></div>`);
        if (o.world) rows.push(`<div class="sd_kv sd_kv_world"><span class="sd_kv_key">世界观</span><span class="sd_kv_value">${escapeHtml(o.world)}</span></div>`);
        cards.push(`<section class="sd_card sd_card_story">
            <header class="sd_card_header"><i class="fa-solid fa-book-open"></i>故事总览</header>
            <div class="sd_card_body">${rows.join('')}</div>
        </section>`);
    }

    if (o.arcs.length) {
        const arcs = o.arcs.map(a => {
            const meta = [];
            if (a.desire) meta.push(`<span class="sd_arc_meta"><b>欲望</b>${escapeHtml(a.desire)}</span>`);
            if (a.flaw) meta.push(`<span class="sd_arc_meta"><b>缺陷</b>${escapeHtml(a.flaw)}</span>`);
            return `<div class="sd_arc_item">
                <div class="sd_arc_char"><i class="fa-solid fa-user-large"></i>${escapeHtml(a.char)}</div>
                ${meta.length ? `<div class="sd_arc_meta_row">${meta.join('')}</div>` : ''}
                ${a.growth ? `<div class="sd_arc_growth"><i class="fa-solid fa-arrow-trend-up"></i>${escapeHtml(a.growth)}</div>` : ''}
            </div>`;
        }).join('');
        cards.push(`<section class="sd_card sd_card_arcs">
            <header class="sd_card_header"><i class="fa-solid fa-users"></i>角色弧光</header>
            <div class="sd_card_body sd_arc_list">${arcs}</div>
        </section>`);
    }

    if (o.foreshadowing.length) {
        const items = o.foreshadowing.map(f => {
            const m = foreshadowMeta(f.status);
            return `<div class="sd_fs_item">
                <span class="sd_badge ${m.cls}"><i class="${m.icon}"></i>${m.label}</span>
                <span class="sd_fs_hint">${escapeHtml(f.hint || f.id)}</span>
            </div>`;
        }).join('');
        cards.push(`<section class="sd_card sd_card_foreshadow">
            <header class="sd_card_header"><i class="fa-solid fa-eye"></i>伏笔</header>
            <div class="sd_card_body">${items}</div>
        </section>`);
    }

    const beatItems = o.beats.map((b) => {
        const m = beatMeta(b.status);
        return `<div class="sd_beat_item sd_beat_${escapeHtml(b.status)}" data-beat-id="${escapeHtml(b.id)}" title="点击编辑节点标题">
            <div class="sd_beat_rail"><span class="sd_beat_dot"></span></div>
            <div class="sd_beat_body">
                <div class="sd_beat_head">
                    <span class="sd_badge ${m.cls}"><i class="${m.icon}"></i>${m.label}</span>
                    <span class="sd_beat_title">${escapeHtml(b.title || b.id)}</span>
                    <i class="fa-regular fa-pen-to-square sd_edit_hint"></i>
                </div>
                ${b.summary ? `<div class="sd_beat_summary">${escapeHtml(b.summary)}</div>` : ''}
            </div>
        </div>`;
    }).join('');

    const beatsSection = o.beats.length ? `<section class="sd_card sd_card_beats">
        <header class="sd_card_header"><i class="fa-solid fa-timeline"></i>情节节点</header>
        <div class="sd_card_body sd_timeline">${beatItems}</div>
    </section>` : '';

    el.innerHTML = `<div class="sd_grid">${cards.join('')}</div>${beatsSection}`;
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
    const currentText = beat
        ? `${escapeHtml(beat.title || beat.id)} <code>${escapeHtml(beat.id)}</code>`
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

function renderReport(report, label = '体检') {
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

export function mountUI(ctx, adapter) {
    // 注册渲染回调必须在任何面板守卫之前，否则加载顺序变化时回调可能永远注册不上
    adapter.setRenderCallback((outline) => {
        renderOverview(outline);
        renderFocus(outline);
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

    // 独立窗口：关闭按钮 + Esc 关闭
    const windowEl = document.getElementById('story_director_window');
    const closeWindow = () => windowEl?.classList.remove('sd_open');
    document.getElementById('sd_window_close')?.addEventListener('click', closeWindow);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && windowEl?.classList.contains('sd_open')) closeWindow();
    });

    const enabledEl = document.getElementById('sd_enabled');
    if (enabledEl) enabledEl.checked = !!adapter.settings.enabled;
    enabledEl?.addEventListener('change', (e) => {
        adapter.settings.enabled = e.target.checked;
        ctx.saveSettingsDebounced?.();
        adapter.director.refreshInjection();
    });

    const runGenerate = (btn) => runAction(btn, {
        label: '生成',
        call: () => adapter.director.generate({ userRequest: '' }),
    });
    const runRevise = (btn) => runAction(btn, {
        label: '修订',
        call: () => adapter.director.revise(),
    });
    const runCheck = (btn) => runAction(btn, {
        label: '体检',
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
    const setNumber = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value ?? 0;
    };
    setNumber('sd_inject_limit', adapter.settings.injectTokenLimit);
    setNumber('sd_revise_every_n', adapter.settings.reviseEveryN);
    setNumber('sd_recent_turns', adapter.settings.recentTurns);

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
    bindNumber('sd_recent_turns', 'recentTurns', { min: 1, max: 50 });

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

    // 手动编辑：点击 beat 进入编辑；空状态里的"生成大纲"也走这里的事件委托
    document.getElementById('sd_overview')?.addEventListener('click', (e) => {
        const emptyCta = e.target.closest('#sd_generate_empty');
        if (emptyCta) {
            runGenerate(emptyCta);
            return;
        }
        const beatEl = e.target.closest('[data-beat-id]');
        if (!beatEl) return;
        const id = beatEl.getAttribute('data-beat-id');
        const outline = adapter.getOutline();
        const beat = outline.beats.find(b => b.id === id);
        if (!beat) return;
        const newTitle = prompt('编辑节点标题：', beat.title);
        if (newTitle !== null) {
            beat.title = newTitle;
            adapter.setOutline(outline);
            adapter.renderOutline();
            adapter.director.refreshInjection();
        }
    });
}

export { renderOverview, renderFocus, renderReport };
