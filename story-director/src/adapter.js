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
    useMemoryPlugin: true,          // 生成/修订/体检时接入 yuzuki-Memory 等长时记忆插件
    memoryContextLimit: 8000,       // 记忆插件上下文的字符上限
    generateMemoryMode: 'auto',     // 生成大纲时的记忆模式：auto / summary / vector / none
    useVectorMemory: true,          // 使用 yuzuki-Memory 向量库检索相关资料
    vectorMemoryLimit: 6000,        // 向量检索结果的字符上限
    lockOutline: false,             // true = 自动修订只推进状态，不改写用户手动编辑的内容
    windowPos: null,                // {left, top}：独立窗口上次拖拽位置（打开时恢复）
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

    function timelineTerms() {
        const timeline = getOutline().timeline || {};
        const raw = [timeline.start, timeline.end, timeline.note].filter(Boolean).join(' ');
        const tokens = raw.match(/[\u4e00-\u9fff]{2,}|[A-Za-z0-9]{2,}/g) || [];
        return new Set(tokens.map(t => t.toLowerCase()));
    }

    function worldbookRelevance(entry, terms) {
        if (!terms.size) return 0;
        const haystack = [entry?.name, entry?.comment, ...(Array.isArray(entry?.keys) ? entry.keys : [])]
            .filter(Boolean).join(' ').toLowerCase();
        let score = 0;
        for (const term of terms) if (haystack.includes(term)) score += 1;
        return score;
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

        // 角色名录：即使不给未激活角色的完整设定，也要让大纲知道"都有谁"，
        // 避免模型自创与既有角色冲突的 NPC。每角色只取一句身份。
        let cast = '';
        try {
            const castParts = [];
            for (const member of chars.slice(0, 60)) {
                if (!member?.name) continue;
                const roleSource = member.data?.extensions?.depth_prompt?.prompt
                    || member.data?.depth_prompt?.prompt
                    || member.description
                    || member.personality
                    || '';
                const role = String(roleSource).split(/\r?\n/)[0].slice(0, 80).trim();
                castParts.push(role ? `${member.name}（${role}）` : member.name);
            }
            cast = castParts.join('；').slice(0, 2000);
        } catch {}

        const depthPrompt = spend(ch.data?.extensions?.depth_prompt?.prompt || ch.data?.depth_prompt?.prompt || '');
        const description = spend(ch.description);
        const personality = spend(ch.personality);
        const scenario = spend(meta.scenario || ch.scenario);
        const systemPrompt = spend(meta.system_prompt || ch.system_prompt);

        let worldbook = '';
        try {
            const book = ch.data?.character_book || ch.character_book;
            if (book?.entries?.length) {
                // 优先取与当前时间线相关的条目，而不是只取前 N 条
                const terms = timelineTerms();
                const entries = [...book.entries].sort((a, b) => {
                    const score = worldbookRelevance(b, terms) - worldbookRelevance(a, terms);
                    if (score !== 0) return score;
                    return (a?.insertion_order ?? 0) - (b?.insertion_order ?? 0);
                });
                const parts = [];
                for (const e of entries) {
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
            cast,
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

    function getMemoryContext() {
        if (settings.useMemoryPlugin === false) return '';
        try {
            const api = (typeof window !== 'undefined') ? window.YuzukiMemory?.VariableInjector : null;
            if (!api) return '';
            let text = '';
            if (typeof api.buildMemoryText === 'function') {
                text = api.buildMemoryText();
            } else if (typeof api.buildSummaryText === 'function') {
                text = api.buildSummaryText();
            }
            if (!text || typeof text !== 'string') return '';
            const cleaned = text.trim();
            // yuzuki-Memory 无数据时只返回空态占位，不要灌进 prompt
            if (cleaned.includes('(历史存档，当前暂无总结)') && cleaned.length < 300) return '';
            const limit = Math.max(1000, Number(settings.memoryContextLimit) || 8000);
            return cleaned.slice(0, limit);
        } catch (err) {
            console.warn('[story-director] failed to read yuzuki-Memory context:', err);
            return '';
        }
    }

    // 向量检索：复用柚月已经向量化好的资料库。
    // 支持多路 query（时间线/角色关系/当前焦点），合并去重后返回相关 chunk。
    // 返回 { text, hits }：text 是注入 prompt 的合并文本；hits 是结构化命中清单
    // （[{ query, source, text }]），供 UI 展示「本次命中了哪些资料」。
    async function searchVectorMemory(query) {
        if (settings.useVectorMemory === false) return { text: '', hits: [] };
        try {
            const store = (typeof window !== 'undefined') ? window.YuzukiMemory?.VectorStore : null;
            if (!store || typeof store.search !== 'function') return { text: '', hits: [] };
            const queries = (Array.isArray(query) ? query : [query])
                .map(q => String(q || '').trim().slice(0, 2000))
                .filter(Boolean);
            if (!queries.length) return { text: '', hits: [] };
            const seen = new Set();
            const blocks = [];
            const hits = [];
            for (const sourceQuery of queries) {
                let results;
                try {
                    results = await store.search(sourceQuery);
                } catch (err) {
                    console.warn('[story-director] vector search query failed:', err);
                    continue;
                }
                if (!Array.isArray(results)) continue;
                for (const r of results) {
                    const text = String(r?.text || '').trim();
                    if (!text || seen.has(text)) continue;
                    seen.add(text);
                    blocks.push(`【${r.source || '向量资料'}】${text}`);
                    hits.push({ query: sourceQuery, source: String(r.source || '向量资料'), text });
                }
            }
            if (!blocks.length) return { text: '', hits: [] };
            const limit = Math.max(1000, Number(settings.vectorMemoryLimit) || 6000);
            return { text: blocks.join('\n').slice(0, limit), hits };
        } catch (err) {
            console.warn('[story-director] vector memory search failed:', err);
            return { text: '', hits: [] };
        }
    }

    async function getVectorMemoryContext(query) {
        return (await searchVectorMemory(query)).text;
    }

    async function getVectorMemoryHits(query) {
        return (await searchVectorMemory(query)).hits;
    }

    // 检索命中回调：director 每次生成/修订/体检后把命中清单推给 UI 展示
    let retrievalCallback = null;
    function setRetrievalCallback(fn) {
        retrievalCallback = fn;
    }
    function setRetrievalHits(hits) {
        try {
            retrievalCallback?.(Array.isArray(hits) ? hits : []);
        } catch (err) {
            console.warn('[story-director] retrieval callback failed:', err);
        }
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
        getMemoryContext,
        getVectorMemory: searchVectorMemory,
        setRetrievalHits,
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
        load: () => { setRetrievalHits([]); director.refreshInjection(); renderOutline(); },
        save: () => { director.refreshInjection(); },
        getCharacterCard,
        getRecentDialogue,
        getMemoryContext,
        getVectorMemoryContext,
        getVectorMemoryHits,
        setRetrievalCallback,
        renderOutline,
        setRenderCallback,
    };
}
