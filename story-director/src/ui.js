// story-director/src/ui.js
// UI 层：事件绑定、节点编辑器、设置、窗口逻辑。渲染函数见 ui-render.js。
import { createEmptyOutline, jumpToBeat, createBeat, updateBeat, removeBeat, moveBeatOrder, renumberActTitles } from './outline-store.js';
import { escapeHtml, clampWindowPos, renderOverview, renderFocus, renderStats, renderReport, renderRetrieval, syncTimelineInputs, renderBeatItem, foreshadowCardHtml } from './ui-render.js';

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


export { clampWindowPos, renderOverview, renderFocus, renderStats, renderReport, renderRetrieval, renderBeatItem, foreshadowCardHtml };
