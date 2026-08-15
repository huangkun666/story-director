// story-director/src/outline-store.js
// 纯逻辑：大纲数据模型、默认值、校验。零依赖。

export const OUTLINE_VERSION = 1;

const VALID_BEAT_STATUS = new Set(['pending', 'active', 'done']);
const VALID_FORESHADOW_STATUS = new Set(['pending', 'active', 'paid']);

export function createEmptyOutline() {
    return {
        version: OUTLINE_VERSION,
        theme: '',
        tone: '',
        world: '',
        arcs: [],
        foreshadowing: [],
        beats: [],
        focus: {
            currentBeat: '',
            nextStep: '',
            activeForeshadow: [],
            avoidOffTopic: '',
        },
        meta: { updatedAt: '', revisionCount: 0 },
    };
}

function asString(v, d = '') {
    return typeof v === 'string' ? v : d;
}

function normalizeBeat(b) {
    if (!b || typeof b !== 'object') return null;
    const id = asString(b.id, '');
    if (!id) return null;
    return {
        id,
        title: asString(b.title, ''),
        summary: asString(b.summary, ''),
        status: VALID_BEAT_STATUS.has(b.status) ? b.status : 'pending',
    };
}

function normalizeForeshadow(f, index) {
    // 兼容字符串形式（模型常直接返回字符串列表）
    if (typeof f === 'string') {
        const hint = f.trim();
        if (!hint) return null;
        return { id: `f${index + 1}`, hint, status: 'pending', payoff: '' };
    }
    if (!f || typeof f !== 'object') return null;
    const id = asString(f.id, '');
    const hint = asString(f.hint, '') || asString(f.text, '') || asString(f.description, '');
    if (!id && !hint) return null;
    return {
        id: id || `f${index + 1}`,
        hint: hint || id,
        status: VALID_FORESHADOW_STATUS.has(f.status) ? f.status : 'pending',
        payoff: asString(f.payoff, ''),
    };
}

function normalizeArc(a) {
    if (!a || typeof a !== 'object') return null;
    const char = asString(a.char, '') || asString(a.character, '') || asString(a.name, '');
    if (!char) return null;
    return {
        char,
        desire: asString(a.desire, ''),
        flaw: asString(a.flaw, ''),
        growth: asString(a.growth, '') || asString(a.arc, ''),
    };
}

export function normalizeOutline(raw) {
    const base = createEmptyOutline();
    if (!raw || typeof raw !== 'object') return base;

    base.version = OUTLINE_VERSION;
    base.theme = asString(raw.theme, '');
    base.tone = asString(raw.tone, '');
    base.world = asString(raw.world, '');
    base.arcs = Array.isArray(raw.arcs) ? raw.arcs.map(normalizeArc).filter(Boolean) : [];
    base.foreshadowing = Array.isArray(raw.foreshadowing) ? raw.foreshadowing.map((f, i) => normalizeForeshadow(f, i)).filter(Boolean) : [];
    base.beats = Array.isArray(raw.beats) ? raw.beats.map(normalizeBeat).filter(Boolean) : [];

    const focus = (raw.focus && typeof raw.focus === 'object') ? raw.focus : {};
    base.focus.currentBeat = asString(focus.currentBeat, '');
    base.focus.nextStep = asString(focus.nextStep, '');
    base.focus.activeForeshadow = Array.isArray(focus.activeForeshadow)
        ? focus.activeForeshadow.map(x => asString(x, '')).filter(Boolean)
        : [];
    base.focus.avoidOffTopic = asString(focus.avoidOffTopic, '');

    // 修复悬空的 currentBeat
    if (base.focus.currentBeat && !base.beats.some(b => b.id === base.focus.currentBeat)) {
        const firstActiveOrPending = base.beats.find(b => b.status === 'active' || b.status === 'pending');
        base.focus.currentBeat = firstActiveOrPending ? firstActiveOrPending.id : '';
    }

    const meta = (raw.meta && typeof raw.meta === 'object') ? raw.meta : {};
    base.meta.updatedAt = asString(meta.updatedAt, '');
    base.meta.revisionCount = Number.isFinite(meta.revisionCount) ? Math.max(0, Math.floor(meta.revisionCount)) : 0;

    return base;
}

export function serializeOutline(outline) {
    return JSON.stringify(normalizeOutline(outline), null, 2);
}

export function deserializeOutline(json) {
    if (typeof json !== 'string') return createEmptyOutline();
    try {
        return normalizeOutline(JSON.parse(json));
    } catch {
        return createEmptyOutline();
    }
}
