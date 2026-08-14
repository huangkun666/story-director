// story-director/src/adapter.js
// 酒馆运行时适配层：把 SillyTavern.getContext() 的能力桥接给 director。
import { createDirector } from './director.js';
import { normalizeOutline, createEmptyOutline, deserializeOutline, serializeOutline } from './outline-store.js';

const META_KEY = 'story_director';
const INJECT_KEY = 'story_director';
const SETTINGS_KEY = 'story_director';

export const DEFAULT_SETTINGS = {
    enabled: true,
    controlStrength: 'strong',      // 'weak' | 'strong'
    injectTokenLimit: 300,
    reviseFrequency: 'every',       // 'every' | 'everyN' | 'manual'
    reviseEveryN: 1,
    driftTolerance: 'loose',        // 'loose' | 'strict'
    outlineDetail: 'medium',        // 'low' | 'medium' | 'high'
    recentTurns: 5,
};

export function ensureSettings(ctx) {
    const settings = ctx.extensionSettings || {};
    if (!settings[SETTINGS_KEY]) {
        settings[SETTINGS_KEY] = { ...DEFAULT_SETTINGS };
    }
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

    function getOutline() {
        return getStoredOutline(ctx);
    }

    function setOutline(outline) {
        const normalized = normalizeOutline(outline);
        ctx.updateChatMetadata({ [META_KEY]: serializeOutline(normalized) });
        ctx.saveMetadataDebounced?.();
    }

    function setInjectedInstruction(text) {
        ctx.setExtensionPrompt(INJECT_KEY, text, 0, 10000, false, 0);
    }

    function getCharacterCard() {
        const chars = ctx.characters || [];
        const chid = ctx.characterId;
        const ch = chid != null ? chars[chid] : null;
        if (!ch) return {};
        // 世界书文本（若存在）
        let worldbook = '';
        try {
            const book = ch.data?.character_book || ch.character_book;
            if (book?.entries?.length) {
                worldbook = book.entries.map(e => `${e.name ?? ''}: ${e.content ?? ''}`).join('\n');
            }
        } catch {}
        return {
            name: ch.name,
            description: ch.description,
            personality: ch.personality,
            scenario: ch.scenario,
            first_mes: ch.first_mes,
            mes_example: ch.mes_example,
            system_prompt: ch.system_prompt,
            worldbook,
        };
    }

    function getRecentDialogue(turns = 5) {
        const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
        const recent = chat.slice(-(turns * 2)); // 每轮 = 用户 + 角色两条
        return recent
            .filter(m => m && typeof m.mes === 'string')
            .map(m => `${m.is_user ? (ctx.name1 || '用户') : (m.name || ctx.name2 || '角色')}: ${m.mes}`)
            .join('\n');
    }

    const director = createDirector({
        generateRaw: (opts) => ctx.generateRaw(opts),
        getOutline,
        setOutline,
        setInjectedInstruction,
        getSettings: () => settings,
        getRecentDialogue,
        getCharacterCard,
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
        load: () => { director.refreshInjection(); renderOutline(); },
        save: () => { director.refreshInjection(); },
        getCharacterCard,
        getRecentDialogue,
        renderOutline,
        setRenderCallback,
    };
}
