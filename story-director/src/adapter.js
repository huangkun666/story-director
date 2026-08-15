// story-director/src/adapter.js
// 酒馆运行时适配层：把 SillyTavern.getContext() 的能力桥接给 director。
import { createDirector } from './director.js';
import { normalizeOutline, createEmptyOutline, deserializeOutline, serializeOutline } from './outline-store.js';
import { createOpenAiCompatibleGenerator } from './openai-compat.js';

const META_KEY = 'story_director';
const INJECT_KEY = 'story_director';
const SETTINGS_KEY = 'story_director';
const HISTORY_KEY = 'story_director_history';

export const DEFAULT_LLM_SETTINGS = {
    mode: 'main',           // 'main' = 复用主 API；'custom' = 独立配置（OpenAI 兼容直连）
    api: '',                // 与酒馆 generateRaw 的 api 参数一致（openai/textgenerationwebui 等）
    baseUrl: '',            // 反向代理/网关地址，例如 https://api.example.com/v1
    apiKey: '',             // 独立密钥（仅 custom 模式使用）
    model: '',              // 独立模型名
};

export const DEFAULT_SETTINGS = {
    enabled: true,
    controlStrength: 'strong',      // 'weak' | 'strong'
    injectTokenLimit: 300,
    reviseFrequency: 'every',       // 'every' | 'everyN' | 'manual'
    reviseEveryN: 1,
    driftTolerance: 'loose',        // 'loose' | 'strict'
    outlineDetail: 'medium',        // 'low' | 'medium' | 'high'
    recentTurns: 5,
    cardContextLimit: 12000,        // 生成大纲时角色卡内容的最大字符数（防止巨型世界书/深度提示撑爆 prompt）
    dialogueContextLimit: 8000,     // 修订/体检时回看对话的最大字符数
    lockOutline: false,             // true = 自动修订只推进状态，不改写用户手动编辑的内容
    llm: { ...DEFAULT_LLM_SETTINGS },
};

function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function normalizeSettings(raw) {
    const src = isObject(raw) ? raw : {};
    const out = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(src)) {
        if (key === 'llm') {
            out.llm = { ...DEFAULT_LLM_SETTINGS, ...(isObject(src.llm) ? src.llm : {}) };
        } else if (key in out) {
            out[key] = src[key];
        } else {
            // 保留未知字段，避免破坏未来版本设置
            out[key] = src[key];
        }
    }
    return out;
}

export function ensureSettings(ctx) {
    const settings = ctx.extensionSettings || {};
    settings[SETTINGS_KEY] = normalizeSettings(settings[SETTINGS_KEY]);
    return settings[SETTINGS_KEY];
}

export function getStoredOutline(ctx) {
    const meta = ctx.chatMetadata || {};
    const raw = meta[META_KEY];
    if (typeof raw === 'string') return deserializeOutline(raw);
    if (raw && typeof raw === 'object') return normalizeOutline(raw);
    return createEmptyOutline();
}

export function createSillyTavernAdapter(ctx) {
    const settings = ensureSettings(ctx);

    // 注意：ctx.chatMetadata 是 getContext() 调用时的引用快照，
    // 而 updateChatMetadata 会重新赋值模块级 chat_metadata（新对象），
    // 导致缓存的 ctx.chatMetadata 过期。因此每次读写都要重新取最新 context。
    function freshCtx() {
        return (typeof window !== 'undefined' && window.SillyTavern?.getContext?.()) || ctx;
    }

    function getOutline() {
        return getStoredOutline(freshCtx());
    }

    function setOutline(outline) {
        const normalized = normalizeOutline(outline);
        const c = freshCtx();
        c.updateChatMetadata({ [META_KEY]: serializeOutline(normalized) });
        c.saveMetadataDebounced?.();
    }

    function getHistory() {
        const raw = freshCtx().chatMetadata?.[HISTORY_KEY];
        if (!Array.isArray(raw)) return [];
        return raw.filter(entry => entry && typeof entry === 'object' && entry.outline).map(entry => ({
            at: typeof entry.at === 'string' ? entry.at : '',
            reason: typeof entry.reason === 'string' ? entry.reason : '',
            outline: normalizeOutline(entry.outline),
        }));
    }

    function recordHistory(outline, reason = 'manual') {
        const c = freshCtx();
        const history = getHistory();
        history.unshift({
            at: new Date().toISOString(),
            reason,
            outline: normalizeOutline(outline),
        });
        c.updateChatMetadata({ [HISTORY_KEY]: history.slice(0, 30) });
        c.saveMetadataDebounced?.();
    }

    function restoreHistory(index) {
        const history = getHistory();
        const entry = history[index];
        if (!entry) return false;
        setOutline(entry.outline);
        return true;
    }

    function setInjectedInstruction(text) {
        ctx.setExtensionPrompt(INJECT_KEY, text, 0, 10000, false, 0);
    }

    function getCharacterCard() {
        const c = freshCtx();
        const chars = c.characters || [];
        const chid = c.characterId;
        const ch = chid != null ? chars[chid] : null;
        if (!ch) return {};
        const meta = c.chatMetadata || {};

        // 角色卡内容预算：防止巨型世界书 / depth_prompt 把 outline 请求撑到几十万 token。
        // generateRaw 本身不会召回聊天记忆，token 大头只可能来自这里。
        const limit = Math.max(2000, Number(settings.cardContextLimit) || 12000);
        let budget = limit;
        const spend = (text, perFieldMax = budget) => {
            if (budget <= 0) return '';
            const clipped = String(text ?? '').slice(0, Math.max(0, Math.min(perFieldMax, budget))).trim();
            budget -= clipped.length;
            return clipped;
        };

        const depthPrompt = spend(ch.data?.extensions?.depth_prompt?.prompt || ch.data?.depth_prompt?.prompt || '');
        const description = spend(ch.description);
        const personality = spend(ch.personality);
        const scenario = spend(meta.scenario || ch.scenario);
        const systemPrompt = spend(meta.system_prompt || ch.system_prompt);

        let worldbook = '';
        try {
            const book = ch.data?.character_book || ch.character_book;
            if (book?.entries?.length) {
                const parts = [];
                for (const e of book.entries) {
                    if (budget <= 0) break;
                    const text = `${e.name ?? ''}: ${e.content ?? ''}`;
                    const part = spend(text, 1000);
                    if (part) parts.push(part);
                }
                worldbook = parts.join('\n');
            }
        } catch {}

        return {
            name: ch.name,
            description,
            personality,
            scenario,
            first_mes: spend(ch.first_mes),
            mes_example: spend(meta.mes_example || ch.mes_example),
            system_prompt: systemPrompt,
            depth_prompt: depthPrompt,
            worldbook,
        };
    }

    function getRecentDialogue(turns = 5) {
        const c = freshCtx();
        const chat = Array.isArray(c.chat) ? c.chat : [];
        const recent = chat.slice(-(turns * 2)); // 每轮 = 用户 + 角色两条
        const limit = Math.max(1000, Number(settings.dialogueContextLimit) || 8000);
        const text = recent
            .filter(m => m && typeof m.mes === 'string')
            .map(m => `${m.is_user ? (c.name1 || '用户') : (m.name || c.name2 || '角色')}: ${String(m.mes).slice(0, 1200)}`)
            .join('\n');
        return text.slice(0, limit);
    }

    function getLlmSettings() {
        const llm = settings.llm || DEFAULT_LLM_SETTINGS;
        return {
            mode: llm.mode === 'custom' ? 'custom' : 'main',
            api: llm.api ?? '',
            baseUrl: llm.baseUrl ?? '',
            apiKey: llm.apiKey ?? '',
            model: llm.model ?? '',
        };
    }

    // 独立 API：generateRaw 只接受 api 参数，baseUrl/apiKey 走酒馆全局设置，
    // 无法在不污染主 API 的前提下安全透传。因此 custom 模式用 OpenAI 兼容直连，
    // 任何配置/网络/解析错误都返回 null（由 director/llm-client 降级）。
    const customGenerate = createOpenAiCompatibleGenerator({
        fetchImpl: (...args) => fetch(...args),
        getConfig: () => getLlmSettings(),
    });

    function generateRaw(opts) {
        const llm = getLlmSettings();
        if (llm.mode === 'custom') {
            return customGenerate({ system: opts?.systemPrompt, prompt: opts?.prompt });
        }
        return freshCtx().generateRaw(opts);
    }

    const director = createDirector({
        generateRaw,
        getOutline,
        setOutline,
        setInjectedInstruction,
        getSettings: () => settings,
        getRecentDialogue,
        getCharacterCard,
        recordHistory,
        renderOutline,
    });

    function renderOutline() {
        // 由 ui 层通过 setRenderCallback 设置实际渲染函数
        if (renderCallback) renderCallback(getOutline());
    }
    let renderCallback = null;
    function setRenderCallback(fn) {
        renderCallback = fn;
    }

    return {
        director,
        settings,
        getOutline,
        setOutline,
        getHistory,
        recordHistory,
        restoreHistory,
        load: () => { director.refreshInjection(); renderOutline(); },
        save: () => { director.refreshInjection(); },
        getCharacterCard,
        getRecentDialogue,
        renderOutline,
        setRenderCallback,
    };
}
