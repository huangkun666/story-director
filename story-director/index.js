// story-director 入口：独立大界面（挂在魔法棒菜单里），注册事件与斜杠命令
import { createSillyTavernAdapter, ensureSettings } from './src/adapter.js';
import { mountUI, bindUI } from './src/ui.js';

(function () {
    'use strict';

    const NAMESPACE = 'STORY_DIRECTOR';
    const VERSION = '0.6.0';

    if (window[NAMESPACE]?.loaded) {
        console.warn(`[story-director] Already loaded, skipping duplicate init.`);
        return;
    }
    window[NAMESPACE] = { loaded: true, version: VERSION };

    let adapter = null;
    let reviseCounter = 0;

    function getCtx() {
        return window.SillyTavern?.getContext?.();
    }

    function getWindow() {
        return document.getElementById('story_director_window');
    }

    function openDirectorWindow() {
        const win = getWindow();
        if (!win) return;
        win.classList.add('sd_open');
        // 关闭魔法棒下拉，避免挡在大界面上
        const menu = document.getElementById('extensionsMenu');
        if (menu) menu.style.display = 'none';
        adapter?.renderOutline();
        win.querySelector('#sd_window_close')?.focus?.();
    }

    function closeDirectorWindow() {
        getWindow()?.classList.remove('sd_open');
    }

    async function ensureDirectorWindow(ctx) {
        if (getWindow()) return;

        try {
            const html = await ctx.renderExtensionTemplateAsync('third-party/story-director', 'settings');
            if (html) {
                document.body.insertAdjacentHTML('beforeend', html);
                return;
            }
        } catch (err) {
            console.warn('[story-director] template load failed, using fallback window:', err);
        }

        // 模板加载失败时的最小可用窗口（主要控件仍在，设置项不可用）
        document.body.insertAdjacentHTML('beforeend', `
            <div id="story_director_window" class="sd_window">
                <div class="sd_window_header">
                    <div class="sd_title_block">
                        <i class="fa-solid fa-clapperboard sd_title_icon"></i>
                        <b>叙事导演</b>
                        <span class="sd_subtitle">Story Director</span>
                    </div>
                    <div class="sd_window_actions">
                        <div id="sd_window_close" class="sd_window_close" title="关闭（Esc）"><i class="fa-solid fa-xmark"></i></div>
                    </div>
                </div>
                <div class="sd_window_body">
                    <div id="story_director_panel" class="sd_panel_content">
                        <div class="sd_toolbar">
                            <div id="sd_generate" class="menu_button sd_btn sd_btn_primary"><i class="fa-solid fa-wand-magic-sparkles sd_btn_icon"></i><span>生成大纲</span></div>
                            <div id="sd_revise" class="menu_button sd_btn"><i class="fa-solid fa-rotate sd_btn_icon"></i><span>修订</span></div>
                            <div id="sd_check" class="menu_button sd_btn"><i class="fa-solid fa-stethoscope sd_btn_icon"></i><span>大纲体检</span></div>
                            <div id="sd_clear" class="menu_button sd_btn sd_btn_danger"><i class="fa-solid fa-trash-can sd_btn_icon"></i><span>清空</span></div>
                            <div id="sd_add_beat" class="menu_button sd_btn"><i class="fa-solid fa-plus sd_btn_icon"></i><span>加节点</span></div>
                            <label class="sd_enable"><input id="sd_enabled" type="checkbox" /><span>启用</span></label>
                            <label class="sd_enable"><input id="sd_lock_outline" type="checkbox" /><span>锁定大纲</span></label>
                        </div>
                        <div id="sd_timeline_editor" class="sd_timeline_editor">
                            <div class="sd_timeline_head"><i class="fa-solid fa-calendar-days"></i><b>时间线约束</b></div>
                            <div class="sd_timeline_fields">
                                <input id="sd_timeline_start" type="text" placeholder="开始时间" />
                                <input id="sd_timeline_end" type="text" placeholder="结束时间" />
                                <input id="sd_timeline_note" type="text" placeholder="补充约束（可选）" />
                            </div>
                        </div>
                        <div id="sd_overview"></div>
                        <div id="sd_focus"></div>
                        <div id="sd_report"></div>
                    </div>
                </div>
            </div>`);
    }

    function ensureWandEntry() {
        const menu = document.getElementById('extensionsMenu');
        if (!menu) {
            console.warn('[story-director] extensionsMenu not ready yet; window can still be opened via /director open.');
            return;
        }
        if (document.getElementById('story_director_wand_container')) return;

        const container = document.createElement('div');
        container.id = 'story_director_wand_container';
        container.className = 'extension_container';
        container.innerHTML = `
            <div id="sd_director_wand" class="list-group-item flex-container flexGap5 interactable" title="打开叙事导演大界面">
                <div class="fa-solid fa-clapperboard extensionsMenuExtensionButton"></div>
                <span>叙事导演</span>
            </div>`;
        menu.appendChild(container);

        container.addEventListener('click', () => {
            openDirectorWindow();
        });

        // 保证魔法棒按钮可见（若其他内置扩展都关闭，按钮可能仍处于隐藏状态）
        const wandButton = document.getElementById('extensionsMenuButton');
        if (wandButton) wandButton.style.display = 'flex';
    }

    async function bootstrap() {
        if (adapter) return; // 防止 APP_READY 与兜底重试双重初始化
        const ctx = getCtx();
        if (!ctx) {
            console.warn('[story-director] SillyTavern context not ready yet; will retry via APP_READY/DOM fallback.');
            return;
        }
        ensureSettings(ctx);
        adapter = createSillyTavernAdapter(ctx);

        // 独立大界面：加载模板挂到 body，不再插入扩展设置栏
        await ensureDirectorWindow(ctx);
        ensureWandEntry();
        mountUI(ctx, adapter);
        bindUI(ctx, adapter);
        adapter.load();

        // 每轮发言后异步修订
        const es = ctx.eventSource;
        const et = ctx.eventTypes || ctx.event_types;
        es?.on(et.MESSAGE_SENT, () => {
            const s = adapter.settings;
            if (!s.enabled) return;
            if (s.reviseFrequency === 'manual') return;
            if (s.reviseFrequency === 'everyN') {
                reviseCounter = (reviseCounter + 1) % Math.max(1, s.reviseEveryN || 1);
                if (reviseCounter !== 0) return;
            }
            adapter.director.revise().catch(() => {});
        });

        // 切换聊天时重载大纲，并重置 everyN 计数器（节奏不跨聊天延续）
        es?.on(et.CHAT_CHANGED, () => {
            reviseCounter = 0;
            adapter.load();
            adapter.renderOutline();
        });

        registerSlashCommands(ctx);

        console.log(`[story-director] v${VERSION} ready (standalone window + wand menu).`);
    }

    function registerSlashCommands(ctx) {
        const parser = ctx.SlashCommandParser;
        const SlashCommand = ctx.SlashCommand;
        const SlashCommandArgument = ctx.SlashCommandArgument;
        const SlashCommandNamedArgument = ctx.SlashCommandNamedArgument;
        const ARGUMENT_TYPE = ctx.ARGUMENT_TYPE;
        if (!parser || !SlashCommand) return;

        parser.addCommandObject(SlashCommand.fromProps({
            name: 'director',
            callback: async (args, value) => {
                if (!adapter) return '';
                const sub = String(value ?? '').trim().toLowerCase();
                if (sub === 'open' || sub === 'ui') {
                    openDirectorWindow();
                    return '已打开叙事导演大界面';
                } else if (sub === 'generate') {
                    const r = await adapter.director.generate({ userRequest: '' });
                    adapter.renderOutline();
                    return r === null ? '大纲生成失败，已沿用旧大纲' : '大纲已生成';
                } else if (sub === 'revise') {
                    const r = await adapter.director.revise();
                    adapter.renderOutline();
                    return r === null ? '大纲修订失败，已沿用旧大纲' : '大纲已修订';
                } else if (sub === 'check') {
                    const report = await adapter.director.check();
                    adapter.renderOutline();
                    return report === null ? '大纲体检调用失败，已沿用旧大纲' : `大纲体检完成：${report?.verdict ?? 'sync'}`;
                } else if (sub === 'status') {
                    const s = adapter.settings;
                    const o = adapter.getOutline();
                    const current = o.beats.find(b => b.id === o.focus.currentBeat);
                    const freqText = {
                        every: '每轮',
                        everyN: `每 ${s.reviseEveryN || 1} 轮`,
                        manual: '仅手动',
                    }[s.reviseFrequency] || s.reviseFrequency;
                    const llmMode = s.llm?.mode === 'custom' ? `独立（${s.llm?.model || '未指定模型'}）` : '主 API';
                    return [
                        '叙事导演状态',
                        `- 插件：${s.enabled ? '启用' : '停用'}；控制强度：${s.controlStrength === 'weak' ? '弱引导' : '强约束'}`,
                        `- 修订：${freqText}；偏离处理：${s.driftTolerance === 'strict' ? '严格拉回' : '宽松吸收'}`,
                        `- LLM：${llmMode}`,
                        `- 时间线：${o.timeline?.start || '未设置'} → ${o.timeline?.end || '未设置'}`,
                        `- 大纲：${o.acts.length} 幕 / ${o.beats.length} 个节点；当前：${current ? `${current.title}（${current.id}）` : '无'}；已修订 ${o.meta.revisionCount} 次`,
                    ].join('\n');
                } else {
                    return '用法：/director open|generate|revise|check|status';
                }
            },
            helpString: '叙事导演大纲控制。子命令：open（打开大界面）、generate（生成大纲）、revise（修订）、check（大纲体检）、status（状态）',
            unnamedArgumentList: [
                new SlashCommandArgument('subcommand', [ARGUMENT_TYPE.STRING], false, false, ''),
            ],
            returns: ARGUMENT_TYPE.STRING,
        }));
    }

    // 等待酒馆就绪（bootstrap 内部有 adapter 守卫，重复触发安全）
    const es = getCtx()?.eventSource;
    if (es) {
        const et = getCtx().eventTypes || getCtx().event_types;
        es.on(et.APP_READY, bootstrap);
    }
    // 兜底：DOM 就绪后重试
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => bootstrap(), { once: true });
    } else {
        setTimeout(() => bootstrap(), 500);
    }
})();
