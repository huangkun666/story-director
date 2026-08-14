// story-director 入口：加载模块、注册事件、挂载 UI
import { createSillyTavernAdapter, ensureSettings } from './src/adapter.js';
import { mountUI, bindUI } from './src/ui.js';

(function () {
    'use strict';

    const NAMESPACE = 'STORY_DIRECTOR';
    const VERSION = '0.1.0';

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

    async function bootstrap() {
        const ctx = getCtx();
        if (!ctx) {
            console.warn('[story-director] SillyTavern context not ready, retrying on APP_READY.');
            return;
        }
        ensureSettings(ctx);
        adapter = createSillyTavernAdapter(ctx);

        // 注入面板（通过酒馆模板加载）
        try {
            const html = await ctx.renderExtensionTemplateAsync('third-party/story-director', 'settings');
            const target = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
            if (target && html) {
                target.insertAdjacentHTML('beforeend', html);
            }
        } catch (err) {
            console.warn('[story-director] template load failed, using fallback mount:', err);
        }

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

        // 切换聊天时重载大纲
        es?.on(et.CHAT_CHANGED, () => {
            adapter.load();
            adapter.renderOutline();
        });

        registerSlashCommands(ctx);

        console.log(`[story-director] v${VERSION} ready.`);
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
                if (sub === 'generate') {
                    await adapter.director.generate({ userRequest: '' });
                    adapter.renderOutline();
                    return '大纲已生成';
                } else if (sub === 'revise') {
                    await adapter.director.revise();
                    adapter.renderOutline();
                    return '大纲已修订';
                } else if (sub === 'check') {
                    const report = await adapter.director.check();
                    adapter.renderOutline();
                    return `体检完成：${report?.verdict ?? 'sync'}`;
                } else {
                    return '用法：/director generate|revise|check|status';
                }
            },
            helpString: '叙事导演大纲控制。子命令：generate（生成）、revise（修订）、check（体检）',
            unnamedArgumentList: [
                new SlashCommandArgument('subcommand', [ARGUMENT_TYPE.STRING], false, false, ''),
            ],
            returns: ARGUMENT_TYPE.STRING,
        }));
    }

    // 等待酒馆就绪
    const es = window.SillyTavern?.getContext?.()?.eventSource;
    if (es) {
        const et = window.SillyTavern.getContext().eventTypes || window.SillyTavern.getContext().event_types;
        es.on(et.APP_READY, bootstrap);
    }
    // 兜底：DOM 就绪后重试
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { if (!adapter) bootstrap(); }, { once: true });
    } else {
        setTimeout(() => { if (!adapter) bootstrap(); }, 500);
    }
})();
