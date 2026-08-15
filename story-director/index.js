// story-director 入口：加载模块、注册事件、挂载 UI
import { createSillyTavernAdapter, ensureSettings } from './src/adapter.js';
import { mountUI, bindUI } from './src/ui.js';

(function () {
    'use strict';

    const NAMESPACE = 'STORY_DIRECTOR';
    const VERSION = '0.2.0';

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
        if (adapter) return; // 防止 APP_READY 与兜底重试双重初始化
        const ctx = getCtx();
        if (!ctx) {
            console.warn('[story-director] SillyTavern context not ready yet; will retry via APP_READY/DOM fallback.');
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

        // 切换聊天时重载大纲，并重置 everyN 计数器（节奏不跨聊天延续）
        es?.on(et.CHAT_CHANGED, () => {
            reviseCounter = 0;
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
                    return report === null ? '体检调用失败，已沿用旧大纲' : `体检完成：${report?.verdict ?? 'sync'}`;
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
                        `- 大纲：${o.beats.length} 个节点；当前：${current ? `${current.title}（${current.id}）` : '无'}；已修订 ${o.meta.revisionCount} 次`,
                    ].join('\n');
                } else {
                    return '用法：/director generate|revise|check|status';
                }
            },
            helpString: '叙事导演大纲控制。子命令：generate（生成）、revise（修订）、check（体检）、status（状态）',
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
