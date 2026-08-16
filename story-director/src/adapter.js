// story-director/src/adapter.js
// 酒馆运行时适配层：把 SillyTavern.getContext() 的能力桥接给 director。
import { createDirector } from './director.js';
import { normalizeOutline, createEmptyOutline, deserializeOutline, serializeOutline, diagnoseOutline } from './outline-store.js';
import { createOpenAiCompatibleGenerator, listModels as listModelsApi, testConnection as testConnectionApi } from './openai-compat.js';
import { extractDialogueBodies } from './dialogue-extract.js';
import { log } from './logger.js';

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
    beatPacing: 'balanced',         // 节点节奏：'balanced' 均衡 / 'dense' 紧凑 / 'sparse' 宽松（间隔相对大纲总跨度）
    preserveHistory: true,          // 生成大纲时保留旧大纲已发生（done）节点为「前情·已完成」幕
    recentTurns: 5,
    cardContextLimit: 12000,        // 生成大纲时角色卡内容的最大字符数（防止巨型世界书/深度提示撑爆 prompt）
    dialogueContextLimit: 8000,     // 修订/体检时回看对话的最大字符数
    dialogueExtractRules: [],      // 对话正文提取规则：[{open, close, label, sample}]，空 = 用原文
    useMemoryPlugin: true,          // 生成/修订/体检时接入 yuzuki-Memory 等长时记忆插件
    memoryContextLimit: 8000,       // 记忆插件上下文的字符上限
    generateMemoryMode: 'auto',     // 生成大纲时的记忆模式：auto / summary / vector / none
    useVectorMemory: true,          // 使用 yuzuki-Memory 向量库检索相关资料
    vectorMemoryLimit: 6000,        // 向量检索结果的字符上限
    advancedRetrieval: true,        // 两阶段检索：先定方向草案再定向检索（更准，多一次轻量调用）
    lockOutline: false,             // true = 自动修订只推进状态，不改写用户手动编辑的内容
    windowPos: null,                // {left, top}：独立窗口上次拖拽位置（打开时恢复）
    theme: 'light',                 // 'light' 白天 / 'dark' 黑灰夜晚
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
        const d = diagnoseOutline(normalized);
        log('debug', 'engine', '大纲保存',
            `${d.beats} 节点（done ${d.doneBeats}/active ${d.activeBeats}/pending ${d.pendingBeats}）、${d.acts} 幕、${d.arcs} 弧光、${d.foreshadowing} 伏笔${d.issues.length ? `；待修复：${d.issues.join('；')}` : ''}`);
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

        const result = {
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
        log('debug', 'llm', '角色卡读取（预算内）',
            `预算 ${limit} 字符：名录 ${cast.length} / 深度设定 ${depthPrompt.length} / 描述 ${description.length} / 人格 ${personality.length} / 场景 ${scenario.length} / 世界书 ${worldbook.length}`);
        return result;
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
            const clipped = cleaned.slice(0, limit);
            log('debug', 'memory', '记忆摘要读取', `字符 ${clipped.length}/${limit}${clipped.length >= limit ? '（触顶截断）' : ''}`);
            return clipped;
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
                // 每路只取前 3 条：多路合并时防止某一路的低相关结果占满预算
                for (const r of results.slice(0, 3)) {
                    const text = String(r?.text || '').trim();
                    if (!text || seen.has(text)) continue;
                    seen.add(text);
                    blocks.push(`【${r.source || '向量资料'}】${text}`);
                    hits.push({ query: sourceQuery, source: String(r.source || '向量资料'), text });
                }
            }
            if (!blocks.length) return { text: '', hits: [] };
            const limit = Math.max(1000, Number(settings.vectorMemoryLimit) || 6000);
            const merged = blocks.join('\n').slice(0, limit);
            const perQuery = queries.map(q => {
                const n = hits.filter(h => h.query === q).length;
                return `${q}×${n}`;
            }).join('\n');
            const hitSamples = hits.slice(0, 5).map(h => `- [${h.source || '向量资料'}] ${String(h.text || '').slice(0, 300)}`).join('\n');
            log('info', 'retrieval', '向量检索',
                `查询 ${queries.length} 路（每路 top 3）：\n${perQuery}\n命中 ${hits.length} 条 / 文本 ${merged.length} 字符${hitSamples ? `\n${hitSamples}` : ''}`);
            return { text: merged, hits };
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

    // 记忆缺口：yuzuki-Memory 每 N 轮（默认 20）才更新一次记忆，期间维护一个
    // 「记忆指针」（manualPointers.summary = 已存储楼层）。缺失楼层数 = 聊天楼层数 - 指针，
    // 这是聊天历史需要精确覆盖的范围。只读调用公开 API（Storage.loadState），
    // 记忆未启用/无指针时返回 null（由调用方回落默认轮数）。
    function getMemoryGap() {
        try {
            const api = (typeof window !== 'undefined') ? window.YuzukiMemory?.Storage : null;
            if (!api || typeof api.loadState !== 'function') return null;
            const state = api.loadState({});
            const pointers = state?.settings?.manualPointers;
            if (!pointers || typeof pointers !== 'object') return null; // 无记忆状态
            const pointer = Math.max(0, Number(pointers.summary) || 0);
            const chatLength = Array.isArray(freshCtx().chat) ? freshCtx().chat.length : 0;
            if (!chatLength) return 0;
            return Math.max(0, chatLength - pointer);
        } catch (err) {
            console.warn('[story-director] failed to read yuzuki memory pointer:', err);
            return null;
        }
    }

    function getRecentDialogue(turns = 5) {
        const c = freshCtx();
        const chat = Array.isArray(c.chat) ? c.chat : [];
        const limit = Math.max(1000, Number(settings.dialogueContextLimit) || 8000);
        // 动态轮数：以记忆缺口为准（覆盖指针之后的全部楼层 + 1 轮余量），
        // 无指针信息（记忆未启用/读取失败）时回落用户配置的默认轮数。
        const preferred = Math.max(1, Math.round(Number(turns) || 5));
        const gap = getMemoryGap();
        const effectiveTurns = gap != null
            ? Math.min(60, Math.max(1, Math.ceil(gap / 2) + 1))
            : preferred;
        const recent = chat.slice(-(effectiveTurns * 2)); // 每轮 = 用户 + 角色两条
        const text = recent
            .filter(m => m && typeof m.mes === 'string')
            .map(m => `${m.is_user ? (c.name1 || '用户') : (m.name || c.name2 || '角色')}: ${String(m.mes).slice(0, 1200)}`)
            .join('\n');
        // 有提取规则时按标签提取正文（无匹配自动回退原文），
        // 相同预算覆盖更多轮次——记忆库落后期间，近期剧情靠对话
        const rules = settings.dialogueExtractRules;
        const finalText = (Array.isArray(rules) && rules.length) ? extractDialogueBodies(text, rules) : text;
        const clipped = finalText.slice(0, limit);
        log('debug', 'memory', '近期对话窗口',
            `记忆缺口 ${gap == null ? '无指针（回落默认）' : `${gap} 层`} → 生效 ${effectiveTurns} 轮；字符 ${clipped.length}/${limit}${(Array.isArray(rules) && rules.length) ? '（正文提取规则生效）' : ''}`);
        return clipped;
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

    // 模型列表 / 连接测试：可用表单当前值覆盖已保存配置（未填则回落已保存值）
    function llmConfigFor(opts) {
        const llm = settings.llm || DEFAULT_LLM_SETTINGS;
        return {
            baseUrl: String(opts?.baseUrl ?? llm.baseUrl ?? '').trim(),
            apiKey: String(opts?.apiKey ?? llm.apiKey ?? '').trim(),
        };
    }

    function listModels(opts) {
        return listModelsApi({ fetchImpl: (...args) => fetch(...args), ...llmConfigFor(opts) });
    }

    function testApiConnection(opts) {
        return testConnectionApi({ fetchImpl: (...args) => fetch(...args), ...llmConfigFor(opts) });
    }

    // 终端内容详情限长：prompt/返回各存前 N 字符（展开详情可看全文片段），防环形缓冲内存膨胀
    const LLM_LOG_PREVIEW = 4000;

    function generateRaw(opts) {
        const llm = getLlmSettings();
        const t0 = Date.now();
        const promptChars = String(opts?.prompt || '').length;
        const systemChars = String(opts?.systemPrompt || '').length;
        // 所有 LLM 调用（方向草案/生成/修订/体检/AI 节点/标签分析）统一打点，
        // 终端可看到每次调用的模式/模型/上下文体积/耗时/返回 + prompt/返回内容片段
        const logCall = (result, err) => {
            const ms = Date.now() - t0;
            const resultStr = result != null ? String(typeof result === 'string' ? result : JSON.stringify(result) || '') : '';
            const resultChars = resultStr.length;
            const promptStr = String(opts?.prompt || '');
            const promptPreview = promptStr.slice(0, LLM_LOG_PREVIEW);
            const resultPreview = resultStr.slice(0, LLM_LOG_PREVIEW);
            const parts = [
                `${llm.mode === 'custom' ? `独立模式${llm.model ? ` / ${llm.model}` : ''}` : '主 API'}；上下文 ${(systemChars + promptChars).toLocaleString()} 字符（system ${systemChars.toLocaleString()} + prompt ${promptChars.toLocaleString()}）；耗时 ${ms}ms；返回 ${resultChars.toLocaleString()} 字符${err ? `；失败：${String(err?.message || err)}` : ''}`,
            ];
            if (promptPreview) {
                parts.push(`【prompt（前 ${LLM_LOG_PREVIEW} 字符）】\n${promptPreview}${promptChars > LLM_LOG_PREVIEW ? '\n…（已截断）' : ''}`);
            }
            if (resultPreview) {
                parts.push(`【返回（前 ${LLM_LOG_PREVIEW} 字符）】\n${resultPreview}${resultChars > LLM_LOG_PREVIEW ? '\n…（已截断）' : ''}`);
            }
            log('info', 'llm', 'LLM 调用', parts.join('\n'));
            return result;
        };
        if (llm.mode === 'custom') {
            return customGenerate({ system: opts?.systemPrompt, prompt: opts?.prompt }).then(
                (r) => logCall(r, null),
                (err) => { logCall(null, err); throw err; },
            );
        }
        const p = freshCtx().generateRaw(opts);
        if (p && typeof p.then === 'function') {
            return p.then(
                (r) => logCall(r, null),
                (err) => { logCall(null, err); throw err; },
            );
        }
        return logCall(p, null);
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

    // ---------- 操作级撤销（内存撤销栈） ----------
    // 原理：受控编辑函数是写时复制（normalizeOutline 深拷贝 + 只改副本），
    // 变更前的大纲引用永远不会被后续操作修改，因此撤销栈只需保存
    // 「变更前大纲引用 + 操作名」，undo = 把该引用写回存储。
    // 内存栈（不落 chatMetadata，避免序列化膨胀 + 失去结构共享）；
    // 切换聊天时由调用方 clearUndo()。
    // 大操作（生成/修订/体检）走 30 条持久快照，不入本栈；
    // 手动编辑（节点/幕/弧光/伏笔/时间线/导入/清空/跳转）逐步入栈。
    let undoStack = [];
    const UNDO_LIMIT = 20;
    let undoChangeCallback = null;
    function setUndoChangeCallback(fn) {
        undoChangeCallback = typeof fn === 'function' ? fn : null;
    }
    function notifyUndoChanged() {
        try {
            undoChangeCallback?.({ canUndo: undoStack.length > 0, count: undoStack.length });
        } catch (err) {
            console.warn('[story-director] undo change callback failed:', err);
        }
    }
    function pushUndo(label) {
        const name = String(label || '编辑');
        // 合并连续同类编辑为一步：如时间线输入框的逐次 input 只记最早状态
        const top = undoStack[undoStack.length - 1];
        if (top && top.label === name) return;
        undoStack.push({ outline: getOutline(), label: name });
        if (undoStack.length > UNDO_LIMIT) undoStack.shift();
        notifyUndoChanged();
    }
    // 统一的手动编辑入口：先记录变更前状态，再应用受控纯函数，最后写回。
    // fn 接收当前大纲（深拷贝）返回新大纲；受控函数永远返回新对象，
    // 因此用序列化比较判断「无实质变更」（如移动已在边界），此时不入栈。
    function editOutline(label, fn) {
        if (typeof fn !== 'function') return null;
        const prev = getOutline();
        const next = fn(prev);
        if (!next || next === prev) return prev;
        if (serializeOutline(next) === serializeOutline(prev)) return prev; // 无实质变更
        pushUndo(label);
        setOutline(next);
        log('info', 'edit', `编辑：${String(label || '手动编辑')}`,
            `撤销栈 ${undoStack.length}/${UNDO_LIMIT} 步`);
        return next;
    }
    function undo() {
        const entry = undoStack.pop();
        if (!entry) return null;
        setOutline(entry.outline);
        notifyUndoChanged();
        log('info', 'edit', `撤销：${entry.label}`);
        return entry.label;
    }
    function canUndo() {
        return undoStack.length > 0;
    }
    function clearUndo() {
        if (!undoStack.length) return;
        undoStack = [];
        notifyUndoChanged();
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
        getMemoryGap,
        getMemoryContext,
        getVectorMemoryContext,
        getVectorMemoryHits,
        listModels,
        testApiConnection,
        setRetrievalCallback,
        renderOutline,
        setRenderCallback,
        pushUndo,
        editOutline,
        undo,
        canUndo,
        clearUndo,
        setUndoChangeCallback,
    };
}
