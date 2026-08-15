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

        // 世界书文本（若存在）
        let worldbook = '';
        try {
            const book = ch.data?.character_book || ch.character_book;
            if (book?.entries?.length) {
                worldbook = book.entries.map(e => `${e.name ?? ''}: ${e.content ?? ''}`).join('\n');
            }
        } catch {}

        // 很多卡把设定放在 depth_prompt / 聊天级覆盖里，标准字段为空，必须一起读取
        const depthPrompt = ch.data?.extensions?.depth_prompt?.prompt || ch.data?.depth_prompt?.prompt || '';

        return {
            name: ch.name,
            description: ch.description,
            personality: ch.personality,
            scenario: meta.scenario || ch.scenario,
            first_mes: ch.first_mes,
            mes_example: meta.mes_example || ch.mes_example,
            system_prompt: meta.system_prompt || ch.system_prompt,
            depth_prompt: depthPrompt,
            worldbook,
        };
    }

    function getRecentDialogue(turns = 5) {
        const c = freshCtx();
        const chat = Array.isArray(c.chat) ? c.chat : [];
        const recent = chat.slice(-(turns * 2)); // 每轮 = 用户 + 角色两条
        return recent
            .filter(m => m && typeof m.mes === 'string')
            .map(m => `${m.is_user ? (c.name1 || '用户') : (m.name || c.name2 || '角色')}: ${m.mes}`)
            .join('\n');
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
