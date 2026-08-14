// story-director/src/ui.js
// UI 层：渲染面板、绑定事件、手动编辑。依赖浏览器 DOM 与酒馆 ctx。
import { createEmptyOutline, normalizeOutline } from './outline-store.js';

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function renderOverview(outline) {
    const el = document.getElementById('sd_overview');
    if (!el) return;
    const o = normalizeOutline(outline);
    const lines = [];
    if (o.theme) lines.push(`<div class="sd_field"><b>主题：</b>${escapeHtml(o.theme)}</div>`);
    if (o.tone) lines.push(`<div class="sd_field"><b>基调：</b>${escapeHtml(o.tone)}</div>`);
    if (o.world) lines.push(`<div class="sd_field sd_world"><b>世界观：</b>${escapeHtml(o.world)}</div>`);
    if (o.beats.length) {
        const beatHtml = o.beats.map(b => {
            const badge = { pending: '⬜待开始', active: '🔄进行中', done: '✅已完成' }[b.status] || b.status;
            return `<div class="sd_beat" data-beat-id="${escapeHtml(b.id)}"><span class="sd_badge">${badge}</span> <span class="sd_beat_title">${escapeHtml(b.title || b.id)}</span></div>`;
        }).join('');
        lines.push(`<div class="sd_beats">${beatHtml}</div>`);
    }
    if (o.arcs.length) {
        const arcHtml = o.arcs.map(a => `<div class="sd_arc">${escapeHtml(a.char)}: ${escapeHtml(a.desire || '')} → ${escapeHtml(a.growth || '')}</div>`).join('');
        lines.push(`<details><summary>角色弧光</summary>${arcHtml}</details>`);
    }
    if (o.foreshadowing.length) {
        const fHtml = o.foreshadowing.map(f => `<div class="sd_fs">${escapeHtml(f.hint || f.id)} <i>(${f.status})</i></div>`).join('');
        lines.push(`<details><summary>伏笔</summary>${fHtml}</details>`);
    }
    el.innerHTML = lines.join('') || '<small>大纲为空。</small>';
}

function renderFocus(outline) {
    const el = document.getElementById('sd_focus');
    if (!el) return;
    const f = outline?.focus;
    if (!f || !(f.currentBeat || f.nextStep)) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="sd_field"><b>当前节点：</b>${escapeHtml(f.currentBeat)}</div>` +
        `<div class="sd_field"><b>下一步：</b>${escapeHtml(f.nextStep)}</div>` +
        (f.avoidOffTopic ? `<div class="sd_field"><b>避免：</b>${escapeHtml(f.avoidOffTopic)}</div>` : '');
}

function renderReport(report) {
    const el = document.getElementById('sd_report');
    if (!el) return;
    if (!report) { el.innerHTML = ''; return; }
    const verdictText = { sync: '✅ 同步', 'minor-drift': '⚠️ 轻度脱节', 'major-drift': '❌ 严重脱节' }[report.verdict] || report.verdict;
    el.innerHTML = `<div class="sd_field"><b>体检：</b>${escapeHtml(verdictText)}</div>` +
        `<div class="sd_field"><b>是否修改：</b>${report.changed ? '是' : '否'}</div>` +
        (report.reason ? `<div class="sd_field"><b>理由：</b>${escapeHtml(report.reason)}</div>` : '') +
        (report.changes ? `<div class="sd_field"><b>改动：</b>${escapeHtml(report.changes)}</div>` : '');
}

export function mountUI(ctx, adapter) {
    const target = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!target) return;
    if (document.getElementById('story_director_panel')) return;

    target.insertAdjacentHTML('beforeend', `<!-- 面板由 settings.html 通过模板加载（见 index.js 组装） -->`);
    // 实际面板 HTML 由 index.js 用 renderExtensionTemplateAsync 注入，此处仅注册渲染回调与事件
    adapter.setRenderCallback((outline) => {
        renderOverview(outline);
        renderFocus(outline);
    });

    // 事件绑定由 index.js 在模板注入后调用 bindUI
}

export function bindUI(ctx, adapter) {
    const enabledEl = document.getElementById('sd_enabled');
    if (enabledEl) enabledEl.checked = !!adapter.settings.enabled;
    enabledEl?.addEventListener('change', (e) => {
        adapter.settings.enabled = e.target.checked;
        ctx.saveSettingsDebounced?.();
        adapter.director.refreshInjection();
    });
    document.getElementById('sd_generate')?.addEventListener('click', async () => {
        try {
            await adapter.director.generate({ userRequest: '' });
            adapter.renderOutline();
        } catch (e) {
            renderReport({ verdict: 'major-drift', changed: false, reason: `生成失败：${e?.message || e}` });
        }
    });
    document.getElementById('sd_revise')?.addEventListener('click', async () => {
        try {
            await adapter.director.revise();
            adapter.renderOutline();
        } catch (e) {
            renderReport({ verdict: 'major-drift', changed: false, reason: `修订失败：${e?.message || e}` });
        }
    });
    document.getElementById('sd_check')?.addEventListener('click', async () => {
        try {
            const report = await adapter.director.check();
            renderReport(report);
            adapter.renderOutline();
        } catch (e) {
            renderReport({ verdict: 'major-drift', changed: false, reason: `体检失败：${e?.message || e}` });
        }
    });
    document.getElementById('sd_clear')?.addEventListener('click', () => {
        adapter.setOutline(createEmptyOutline());
        adapter.director.refreshInjection();
        adapter.renderOutline();
    });

    // 手动编辑：点击 beat 进入编辑
    document.getElementById('sd_overview')?.addEventListener('click', (e) => {
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
