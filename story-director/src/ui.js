// story-director/src/ui.js
// UI 层：事件绑定、节点编辑器、设置、窗口逻辑。渲染函数见 ui-render.js。
import { createEmptyOutline, jumpToBeat, createBeat, updateBeat, updateAct, removeBeat, moveBeatOrder, renumberActTitles, createArc, updateArc, removeArc, createForeshadow, updateForeshadow, removeForeshadow } from './outline-store.js';
import { escapeHtml, clampWindowPos, renderOverview, renderFocus, renderStats, renderReport, syncTimelineInputs, renderBeatItem, foreshadowCardHtml, renderCharacters, renderForeshadowManager, renderTermList } from './ui-render.js';
import { logger } from './logger.js';

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


export function mountUI(ctx, adapter) {
    // 注册渲染回调必须在任何面板守卫之前，否则加载顺序变化时回调可能永远注册不上
    adapter.setRenderCallback((outline) => {
        renderOverview(outline);
        renderFocus(outline);
        renderStats(outline);
        syncTimelineInputs(outline);
        renderHistoryOptions();
        const arcsEl = document.getElementById('sd_arcs_manager');
        if (arcsEl) arcsEl.innerHTML = renderCharacters(outline.arcs, outline.beats);
        const fsEl = document.getElementById('sd_fs_manager');
        if (fsEl) fsEl.innerHTML = renderForeshadowManager(outline.foreshadowing, outline.beats, fsFilter);
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
let fsFilter = ''; // 伏笔管理筛选：'' | pending | active | paid

export function bindUI(ctx, adapter) {
    adapterRef = adapter;

    // 独立窗口：关闭按钮 + Esc 关闭
    const windowEl = document.getElementById('story_director_window');
    const closeWindow = () => windowEl?.classList.remove('sd_open');
    document.getElementById('sd_window_close')?.addEventListener('click', closeWindow);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && windowEl?.classList.contains('sd_open')) closeWindow();
    });

    // ---------- 操作级撤销：按钮 + Ctrl+Z + 按钮状态 ----------
    const undoBtn = document.getElementById('sd_undo');
    const syncUndoButton = ({ canUndo, count } = {}) => {
        if (!undoBtn) return;
        undoBtn.classList.toggle('sd_btn_disabled', !canUndo);
        undoBtn.title = canUndo
            ? `撤销上一步手动编辑（Ctrl+Z），可撤销 ${count} 步`
            : '撤销上一步手动编辑（Ctrl+Z），暂无历史';
    };
    const runUndo = () => {
        const label = adapter.undo?.();
        if (label == null) return;
        adapter.renderOutline();
        adapter.director.refreshInjection();
        renderReport({ verdict: 'sync', changed: false, reason: `已撤销：${label}` }, '撤销');
    };
    undoBtn?.addEventListener('click', runUndo);
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || (e.key !== 'z' && e.key !== 'Z')) return;
        if (!windowEl?.classList.contains('sd_open')) return;
        // 输入框内撤销文本由浏览器处理，不拦截
        const tag = (e.target?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
        e.preventDefault();
        runUndo();
    });
    adapter.setUndoChangeCallback?.(syncUndoButton);
    syncUndoButton({ canUndo: !!adapter.canUndo?.(), count: adapter.canUndo?.() ? 1 : 0 });

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

    // 主题切换：白天 / 黑灰夜晚（存 extension_settings，窗口级变量切换）
    const themeToggleEl = document.getElementById('sd_theme_toggle');
    const applyTheme = (theme) => {
        const isDark = theme === 'dark';
        windowEl?.classList.toggle('sd_theme_dark', isDark);
        if (themeToggleEl) {
            const icon = themeToggleEl.querySelector('i');
            if (icon) icon.className = `fa-solid ${isDark ? 'fa-sun' : 'fa-moon'} sd_btn_icon`;
            const span = themeToggleEl.querySelector('span');
            if (span) span.textContent = isDark ? '白天' : '夜晚';
        }
    };
    applyTheme(adapter.settings.theme || 'light');
    themeToggleEl?.addEventListener('click', () => {
        const next = (adapter.settings.theme || 'light') === 'dark' ? 'light' : 'dark';
        adapter.settings.theme = next;
        ctx.saveSettingsDebounced?.();
        applyTheme(next);
    });

    const lockEl = document.getElementById('sd_lock_outline');
    if (lockEl) lockEl.checked = !!adapter.settings.lockOutline;
    lockEl?.addEventListener('change', (e) => {
        adapter.settings.lockOutline = e.target.checked;
        ctx.saveSettingsDebounced?.();
    });

    // 时间线约束：存进当前聊天的大纲（chat_metadata），生成时作为硬约束传给模型。
    // 必读设定是顶层独立字段（世界观级硬约束），同样存进大纲。
    const timelineField = (id) => document.getElementById(id);
    const readTimeline = () => ({
        start: timelineField('sd_timeline_start')?.value?.trim() || '',
        end: timelineField('sd_timeline_end')?.value?.trim() || '',
        note: timelineField('sd_timeline_note')?.value?.trim() || '',
    });
    const readMustRead = () => timelineField('sd_must_read')?.value?.trim() || '';
    const persistTimeline = () => {
        const timeline = readTimeline();
        const mustRead = readMustRead();
        // 走受控入口并记录撤销点；连续输入合并为一步（栈顶同 label 不重复入栈）
        adapter.editOutline?.('编辑时间线', (o) => {
            if (o.timeline.start === timeline.start
                && o.timeline.end === timeline.end
                && o.timeline.note === timeline.note
                && o.mustRead === mustRead) {
                return o; // 无实际变更，不入栈
            }
            return { ...o, timeline, mustRead };
        });
        return timeline;
    };
    const bindTimelineField = (id) => {
        timelineField(id)?.addEventListener('input', () => persistTimeline());
    };
    syncTimelineInputs(adapter.getOutline());
    bindTimelineField('sd_timeline_start');
    bindTimelineField('sd_timeline_end');
    bindTimelineField('sd_timeline_note');
    bindTimelineField('sd_must_read');

    const runGenerate = (btn) => runAction(btn, {
        label: '生成',
        call: () => {
            // 全量重写警示：已有大纲时生成会替换手动编辑与未完成规划，局部重做请用幕重规划
            const existing = adapter.getOutline();
            const hasContent = existing.beats.length > 0 || existing.acts.length > 0;
            if (hasContent && !confirm('生成将全量重写当前大纲（手动编辑与未完成规划会被替换，已发生剧情保留为前情幕）。\n\n只想重做某一段？请用各幕的「修改这一幕」按钮。\n继续生成？')) {
                return null;
            }
            persistTimeline();
            return adapter.director.generate({ userRequest: '', timeline: readTimeline(), mustRead: readMustRead() });
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
            adapter.pushUndo?.('清空');
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
    setSelect('sd_preserve_history', adapter.settings.preserveHistory === false ? 'false' : 'true');
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
    bindSelect('sd_preserve_history', 'preserveHistory', () => {
        // bindSelect 存的是字符串 'true'/'false'，这里转回布尔
        adapter.settings.preserveHistory = adapter.settings.preserveHistory !== 'false';
        saveSettings();
    });
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
        const title = beatTitleEl?.value?.trim() || '未命名节点';
        const summary = beatSummaryEl?.value?.trim() || '';
        const type = beatTypeEl?.value || 'setup';
        const actId = beatActEl?.value || '';
        const cast = String(beatCastEl?.value || '').split(/[,，、;；]/).map(x => x.trim()).filter(Boolean);

        // 受控纯函数 + 撤销栈：actId 是唯一事实，acts.beats 派生；自动补幕
        adapter.editOutline?.(editingBeatId ? '编辑节点' : '新增节点', (o) => editingBeatId
            ? updateBeat(o, editingBeatId, { title, summary, type, actId, cast })
            : createBeat(o, { title, summary, type, actId, cast }));
        adapter.renderOutline();
        adapter.director.refreshInjection();
        closeBeatEditor();
    }

    function moveEditingBeat(delta) {
        if (!editingBeatId) return;
        // 已在边界时 moveBeatOrder 原样返回，editOutline 自动跳过入栈
        adapter.editOutline?.('移动节点', (o) => moveBeatOrder(o, editingBeatId, delta));
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
        // 受控删除：伏笔回收点 / 焦点节点等悬空引用由 normalize 自愈；入撤销栈
        adapter.editOutline?.('删除节点', (o) => removeBeat(o, editingBeatId));
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
        adapter.editOutline?.('跳转游玩', (o) => jumpToBeat(o, beatId));
        adapter.renderOutline();
        adapter.director.refreshInjection();
        renderReport({ verdict: 'sync', changed: false, reason: `已跳转到「${beat.title || beat.id}」，从此处开始游玩` }, '跳转');
    }

    // 幕级重规划：模态小窗口输入要求 → 只重新设计该幕（其他幕代码级不动）
    const replanEditorEl = document.getElementById('sd_replan_editor');
    const replanScopeEl = document.getElementById('sd_replan_scope');
    const replanHintEl = document.getElementById('sd_replan_hint');
    let replanActId = null;
    const openReplanEditor = (actId) => {
        const outline = adapter.getOutline();
        const actIndex = outline.acts.findIndex(a => a.id === actId);
        const act = outline.acts[actIndex];
        if (!act) return;
        replanActId = actId;
        const beatCount = outline.beats.filter(b => b.actId === actId).length;
        if (replanScopeEl) {
            replanScopeEl.innerHTML = `<b>第 ${actIndex + 1} 幕「${escapeHtml(act.title || act.id)}」</b>
                <span>现有 ${beatCount} 个节点，将重新设计为 3-6 个新节点；前后幕作为衔接约束。</span>`;
        }
        if (replanHintEl) replanHintEl.value = '';
        replanEditorEl?.classList.add('sd_open');
        replanHintEl?.focus?.();
    };
    const closeReplanEditor = () => {
        replanEditorEl?.classList.remove('sd_open');
        replanActId = null;
    };
    document.getElementById('sd_overview')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act-replan]');
        if (!btn) return;
        openReplanEditor(btn.getAttribute('data-act-replan'));
    });
    document.getElementById('sd_replan_cancel')?.addEventListener('click', closeReplanEditor);
    document.getElementById('sd_replan_editor_close')?.addEventListener('click', closeReplanEditor);
    document.getElementById('sd_replan_confirm')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (!replanActId || btn.classList.contains('sd_loading')) return;
        setButtonLoading(btn, true);
        try {
            const actTitle = adapter.getOutline().acts.find(a => a.id === replanActId)?.title || replanActId;
            const result = await adapter.director.replanAct(replanActId, { userHint: replanHintEl?.value?.trim() || '' });
            adapter.renderOutline();
            adapter.director.refreshInjection();
            if (result) {
                renderReport({ verdict: 'sync', changed: false, reason: `「${actTitle}」已重新设计为 ${result.count} 个新节点，其他幕未动` }, '重规划幕');
            } else {
                renderReport({ verdict: 'major-drift', changed: false, reason: '幕重规划失败，大纲未变' }, '重规划幕');
            }
        } finally {
            setButtonLoading(btn, false);
            closeReplanEditor();
        }
    });

    // 伏笔回收点跳转：点击「回收于 X」→ 切到大纲总览并闪烁高亮该节点
    document.getElementById('sd_sidebar_foreshadow')?.addEventListener('click', (e) => {
        const payoff = e.target.closest('[data-payoff-beat]');
        if (!payoff) return;
        const beatId = payoff.getAttribute('data-payoff-beat');
        switchView('sd_view_outline');
        setTimeout(() => {
            const beatEl = document.querySelector(`[data-beat-id="${CSS.escape(beatId)}"]`);
            if (!beatEl) return;
            beatEl.classList.add('sd_beat_flash');
            setTimeout(() => beatEl.classList.remove('sd_beat_flash'), 2000);
            beatEl.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        }, 60);
    });

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
        adapter.editOutline?.('编辑幕', (o) => updateAct(o, act.id, { title, summary }));
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
            adapter.editOutline?.('重编幕号', (o) => renumberActTitles(o));
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
            adapter.pushUndo?.('导入');
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

    // ---------- 角色与伏笔管理 ----------
    // 高亮跳转公共函数：切到大纲总览页并闪烁目标节点
    const highlightBeatInOverview = (beatId) => {
        switchView('sd_view_outline');
        setTimeout(() => {
            const beatEl = document.querySelector(`[data-beat-id="${CSS.escape(beatId)}"]`);
            if (!beatEl) return;
            beatEl.classList.add('sd_beat_flash');
            setTimeout(() => beatEl.classList.remove('sd_beat_flash'), 2000);
            beatEl.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        }, 60);
    };

    // --- 角色弧光编辑器 ---
    let editingArcChar = null;
    const arcEditorEl = document.getElementById('sd_arc_editor');
    const arcCharEl = document.getElementById('sd_arc_char');
    const arcDesireEl = document.getElementById('sd_arc_desire');
    const arcFlawEl = document.getElementById('sd_arc_flaw');
    const arcGrowthEl = document.getElementById('sd_arc_growth');
    const arcStatusEl = document.getElementById('sd_arc_status');

    function openArcEditor(char = null) {
        const outline = adapter.getOutline();
        const arc = char ? outline.arcs.find(a => a.char === char) : null;
        editingArcChar = char;
        if (arcCharEl) {
            arcCharEl.value = arc?.char || '';
            arcCharEl.readOnly = !!char; // 改名需删了重建
        }
        if (arcDesireEl) arcDesireEl.value = arc?.desire || '';
        if (arcFlawEl) arcFlawEl.value = arc?.flaw || '';
        if (arcGrowthEl) arcGrowthEl.value = arc?.growth || '';
        if (arcStatusEl) arcStatusEl.value = arc?.status || 'pending';
        arcEditorEl?.classList.add('sd_open');
    }
    function closeArcEditor() {
        arcEditorEl?.classList.remove('sd_open');
        editingArcChar = null;
    }
    function saveArcFromEditor() {
        const char = arcCharEl?.value?.trim() || '';
        if (!char) return;
        adapter.editOutline?.(editingArcChar ? '编辑角色' : '新增角色', (o) => editingArcChar
            ? updateArc(o, editingArcChar, {
                desire: arcDesireEl?.value?.trim() || '',
                flaw: arcFlawEl?.value?.trim() || '',
                growth: arcGrowthEl?.value?.trim() || '',
                status: arcStatusEl?.value || 'pending',
            })
            : createArc(o, {
                char,
                desire: arcDesireEl?.value?.trim() || '',
                flaw: arcFlawEl?.value?.trim() || '',
                growth: arcGrowthEl?.value?.trim() || '',
                status: arcStatusEl?.value || 'pending',
            }));
        adapter.renderOutline();
        closeArcEditor();
    }
    document.getElementById('sd_add_arc')?.addEventListener('click', () => openArcEditor(null));
    document.getElementById('sd_arc_save')?.addEventListener('click', saveArcFromEditor);
    document.getElementById('sd_arc_cancel')?.addEventListener('click', closeArcEditor);
    document.getElementById('sd_arc_editor_close')?.addEventListener('click', closeArcEditor);
    document.getElementById('sd_arc_delete')?.addEventListener('click', () => {
        if (!editingArcChar) return closeArcEditor();
        adapter.editOutline?.('删除角色', (o) => removeArc(o, editingArcChar));
        adapter.renderOutline();
        closeArcEditor();
    });
    // 角色卡：点击编辑；出场节点 chip 跳转
    document.getElementById('sd_arcs_manager')?.addEventListener('click', (e) => {
        const beatChip = e.target.closest('[data-arc-beat]');
        if (beatChip) {
            highlightBeatInOverview(beatChip.getAttribute('data-arc-beat'));
            return;
        }
        const card = e.target.closest('[data-arc-char]');
        if (card) openArcEditor(card.getAttribute('data-arc-char'));
    });

    // --- 伏笔编辑器与筛选 ---
    let editingFsId = null;
    const fsEditorEl = document.getElementById('sd_fs_editor');
    const fsHintEl = document.getElementById('sd_fs_hint');
    const fsStatusEl = document.getElementById('sd_fs_status');
    const fsBeatEl = document.getElementById('sd_fs_beat');
    const fsPayoffEl = document.getElementById('sd_fs_payoff');

    function fillFsBeatOptions(outline) {
        if (!fsBeatEl) return;
        const beats = outline.beats || [];
        fsBeatEl.innerHTML = '<option value="">（未指定）</option>' + beats.map(b =>
            `<option value="${escapeHtml(b.id)}">${escapeHtml(b.title || b.id)}</option>`).join('');
    }
    function openFsEditor(id = null) {
        const outline = adapter.getOutline();
        const fs = id ? outline.foreshadowing.find(f => f.id === id) : null;
        editingFsId = id;
        fillFsBeatOptions(outline);
        if (fsHintEl) fsHintEl.value = fs?.hint || '';
        if (fsStatusEl) fsStatusEl.value = fs?.status || 'pending';
        if (fsPayoffEl) fsPayoffEl.value = fs?.payoff || '';
        if (fsBeatEl) fsBeatEl.value = fs?.beatId || '';
        fsEditorEl?.classList.add('sd_open');
    }
    function closeFsEditor() {
        fsEditorEl?.classList.remove('sd_open');
        editingFsId = null;
    }
    function saveFsFromEditor() {
        const hint = fsHintEl?.value?.trim() || '';
        if (!hint) return;
        const patch = {
            hint,
            status: fsStatusEl?.value || 'pending',
            payoff: fsPayoffEl?.value?.trim() || '',
            beatId: fsBeatEl?.value || '',
        };
        adapter.editOutline?.(editingFsId ? '编辑伏笔' : '新增伏笔', (o) => editingFsId
            ? updateForeshadow(o, editingFsId, patch)
            : createForeshadow(o, patch));
        adapter.renderOutline();
        closeFsEditor();
    }
    document.getElementById('sd_add_fs')?.addEventListener('click', () => openFsEditor(null));
    document.getElementById('sd_fs_save')?.addEventListener('click', saveFsFromEditor);
    document.getElementById('sd_fs_cancel')?.addEventListener('click', closeFsEditor);
    document.getElementById('sd_fs_editor_close')?.addEventListener('click', closeFsEditor);
    document.getElementById('sd_fs_delete')?.addEventListener('click', () => {
        if (!editingFsId) return closeFsEditor();
        adapter.editOutline?.('删除伏笔', (o) => removeForeshadow(o, editingFsId));
        adapter.renderOutline();
        closeFsEditor();
    });
    // 伏笔列表：编辑 / 标记回收 / 回收节点跳转
    document.getElementById('sd_fs_manager')?.addEventListener('click', (e) => {
        const pay = e.target.closest('[data-fs-pay]');
        if (pay) {
            adapter.editOutline?.('回收伏笔', (o) => updateForeshadow(o, pay.getAttribute('data-fs-pay'), { status: 'paid' }));
            adapter.renderOutline();
            return;
        }
        const edit = e.target.closest('[data-fs-edit]');
        if (edit) {
            openFsEditor(edit.getAttribute('data-fs-edit'));
            return;
        }
        const payoff = e.target.closest('[data-payoff-beat]');
        if (payoff) highlightBeatInOverview(payoff.getAttribute('data-payoff-beat'));
    });
    // 状态筛选
    const renderFsFilter = () => {
        const outline = adapter.getOutline();
        document.querySelectorAll('[data-fs-filter]').forEach(btn => {
            btn.classList.toggle('sd_fs_filter_active', btn.getAttribute('data-fs-filter') === fsFilter);
        });
        const fsEl = document.getElementById('sd_fs_manager');
        if (fsEl) fsEl.innerHTML = renderForeshadowManager(outline.foreshadowing, outline.beats, fsFilter);
    };
    document.getElementById('sd_fs_filter')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-fs-filter]');
        if (!btn) return;
        fsFilter = btn.getAttribute('data-fs-filter') || '';
        renderFsFilter();
    });

    // ---------- 对话正文提取规则（输入即生效，白名单 + 黑名单） ----------
    const extractResultEl = document.getElementById('sd_extract_result');
    const extractTagEl = document.getElementById('sd_extract_tag');
    const extractExcludeTagEl = document.getElementById('sd_extract_exclude_tag');
    const ruleLabel = (r) => {
        if (r && typeof r.tag === 'string' && r.tag) return `<${escapeHtml(r.tag)}> … </${escapeHtml(r.tag)}>`;
        return `${escapeHtml(r?.open || '')} … ${escapeHtml(r?.close || '')}`;
    };
    // 逗号/空格/顿号分隔，容忍 <content> 写法，过滤非法标签名
    const splitTags = (v) => String(v || '')
        .split(/[,，、;；\s]+/)
        .map(t => t.replace(/[<>/]/g, '').trim())
        .filter(t => /^[A-Za-z][A-Za-z0-9_-]*$/.test(t));
    // 从设置回填输入框（AI 分析采用 tag 规则后也会重新同步）
    const syncExtractInputs = () => {
        const rules = Array.isArray(adapter.settings.dialogueExtractRules) ? adapter.settings.dialogueExtractRules : [];
        const keep = rules.filter(r => r && typeof r.tag === 'string' && r.tag && r.exclude !== true).map(r => r.tag);
        const exclude = rules.filter(r => r && typeof r.tag === 'string' && r.tag && r.exclude === true).map(r => r.tag);
        if (extractTagEl) extractTagEl.value = keep.join(', ');
        if (extractExcludeTagEl) extractExcludeTagEl.value = exclude.join(', ');
    };
    // 输入框内容 → 重建设置：tag 规则全部由输入框决定，字符对规则（AI 采用而来）保留
    const applyExtractInputs = () => {
        const rules = Array.isArray(adapter.settings.dialogueExtractRules) ? adapter.settings.dialogueExtractRules : [];
        const pairRules = rules.filter(r => r && !r.tag);
        const keepTags = splitTags(extractTagEl?.value);
        const excludeTags = splitTags(extractExcludeTagEl?.value);
        const next = [
            ...keepTags.map(tag => ({ tag, label: '正文', sample: '' })),
            ...excludeTags.map(tag => ({ tag, exclude: true, label: '排除', sample: '' })),
            ...pairRules,
        ];
        if (JSON.stringify(next) !== JSON.stringify(rules)) {
            adapter.settings.dialogueExtractRules = next;
            ctx.saveSettingsDebounced?.();
        }
    };
    let extractInputTimer = null;
    extractTagEl?.addEventListener('input', () => {
        clearTimeout(extractInputTimer);
        extractInputTimer = setTimeout(applyExtractInputs, 300);
    });
    extractExcludeTagEl?.addEventListener('input', () => {
        clearTimeout(extractInputTimer);
        extractInputTimer = setTimeout(applyExtractInputs, 300);
    });
    syncExtractInputs();
    document.getElementById('sd_extract_analyze')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (btn.classList.contains('sd_loading')) return;
        setButtonLoading(btn, true);
        if (extractResultEl) extractResultEl.innerHTML = '';
        try {
            const suggestion = await adapter.director.analyzeDialogueTags({ turns: 10 });
            if (!suggestion || !suggestion.rules?.length) {
                if (extractResultEl) extractResultEl.innerHTML = '<small class="sd_extract_msg">AI 未识别出明显的正文标签，可手动填写标签名。</small>';
                return;
            }
            const keyOf = (r) => (typeof r.tag === 'string' && r.tag) ? `tag:${r.tag}:${r.exclude === true ? 'ex' : 'keep'}` : `pair:${r.open}|${r.close}`;
            const current = (Array.isArray(adapter.settings.dialogueExtractRules) ? adapter.settings.dialogueExtractRules : []).map(keyOf);
            if (extractResultEl) extractResultEl._suggestion = suggestion; // 供「采用」按钮取用
            const items = suggestion.rules.map((r, i) => {
                const exists = current.includes(keyOf(r));
                return `<div class="sd_extract_suggest">
                    <span class="sd_chip${r.exclude === true ? ' sd_extract_chip_exclude' : ''}">${r.exclude === true ? '<i class="fa-solid fa-ban" title="黑名单：排除该标签块"></i> ' : ''}${ruleLabel(r)}（${escapeHtml(r.label || '正文')}）</span>
                    ${r.sample ? `<small class="sd_extract_sample">示例：${escapeHtml(r.sample)}</small>` : ''}
                    ${exists ? '<small class="sd_extract_msg">已存在</small>'
                        : `<span class="sd_extract_adopt" data-extract-adopt="${i}" title="采用这条规则"><i class="fa-solid fa-check"></i>采用</span>`}
                </div>`;
            }).join('');
            if (extractResultEl) extractResultEl.innerHTML = `<div class="sd_extract_suggests">${items}</div>
                ${suggestion.note ? `<small class="sd_hint">${escapeHtml(suggestion.note)}</small>` : ''}
                <small class="sd_hint">AI 建议仅供参考，请检查标签样式与示例是否符合你的对话格式。</small>`;
        } catch (err) {
            if (extractResultEl) extractResultEl.innerHTML = `<small class="sd_extract_msg">分析失败：${escapeHtml(err?.message || err)}</small>`;
        } finally {
            setButtonLoading(btn, false);
        }
    });
    extractResultEl?.addEventListener('click', (e) => {
        const adopt = e.target.closest('[data-extract-adopt]');
        if (!adopt) return;
        const suggestion = document.getElementById('sd_extract_result')?._suggestion;
        const idx = Number(adopt.getAttribute('data-extract-adopt'));
        const rule = suggestion?.rules?.[idx];
        if (!rule) return;
        const rules = Array.isArray(adapter.settings.dialogueExtractRules) ? [...adapter.settings.dialogueExtractRules] : [];
        rules.push(rule);
        adapter.settings.dialogueExtractRules = rules;
        ctx.saveSettingsDebounced?.();
        syncExtractInputs(); // tag 规则被采用后回填输入框
        adopt.closest('.sd_extract_suggest')?.remove();
    });

    // ---------- 调试终端 ----------
    const termListEl = document.getElementById('sd_term_list');
    let termLevel = 'all';      // 'all' | 'debug' | 'info' | 'warn' | 'error'
    let termCategory = '';      // '' = 全部分类
    let termKeyword = '';
    let termPinned = false;     // 用户向上滚动后不强制跟随新日志
    const TERM_SHOW_LIMIT = 200;
    const termQuery = () => {
        const level = termLevel === 'all' ? 'debug' : termLevel;
        const cats = termCategory ? [termCategory] : null;
        const kw = termKeyword.trim();
        return logger.filter({ level, categories: cats, keyword: kw });
    };
    const renderTerminal = () => {
        if (!termListEl) return;
        const all = termQuery();
        const shown = all.slice(-TERM_SHOW_LIMIT).reverse(); // 最新在前
        termListEl.innerHTML = renderTermList(shown, all.length);
        if (!termPinned) termListEl.scrollTop = 0;
    };
    // 新日志防抖刷新；倒序显示时顶部 = 最新，未钉住则跟随
    let termRenderTimer = null;
    logger.subscribe(() => {
        clearTimeout(termRenderTimer);
        termRenderTimer = setTimeout(renderTerminal, 120);
    });
    termListEl?.addEventListener('scroll', () => {
        termPinned = termListEl.scrollTop > 8;
    }, { passive: true });
    // 过滤：级别按钮 / 分类下拉 / 关键字
    document.querySelectorAll('[data-term-level]').forEach(btn => {
        btn.addEventListener('click', () => {
            termLevel = btn.getAttribute('data-term-level') || 'all';
            document.querySelectorAll('[data-term-level]').forEach(b => b.classList.toggle('sd_term_filter_active', b === btn));
            renderTerminal();
        });
    });
    document.getElementById('sd_term_category')?.addEventListener('change', (e) => {
        termCategory = e.target.value || '';
        renderTerminal();
    });
    document.getElementById('sd_term_keyword')?.addEventListener('input', (e) => {
        termKeyword = e.target.value || '';
        renderTerminal();
    });
    // 展开详情 / 清空 / 导出
    termListEl?.addEventListener('click', (e) => {
        const entry = e.target.closest('.sd_term_entry');
        if (entry && entry.querySelector('.sd_term_detail')) {
            entry.classList.toggle('sd_term_open');
        }
    });
    document.getElementById('sd_term_clear')?.addEventListener('click', () => {
        logger.clear();
        renderTerminal();
    });
    document.getElementById('sd_term_export')?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(logger.exportJson());
            renderReport({ verdict: 'sync', changed: false, reason: `已复制 ${logger.count()} 条日志到剪贴板` }, '调试终端');
        } catch (err) {
            renderReport({ verdict: 'major-drift', changed: false, reason: `导出失败：${err?.message || err}` }, '调试终端');
        }
    });
    renderTerminal();

    renderHistoryOptions();
}


export { clampWindowPos, renderOverview, renderFocus, renderStats, renderReport, renderBeatItem, foreshadowCardHtml };
