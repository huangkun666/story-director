// story-director/src/outline-store.js
// 纯逻辑：大纲数据模型、默认值、校验。零依赖。

export const OUTLINE_VERSION = 1;

const VALID_BEAT_STATUS = new Set(['pending', 'active', 'done']);
const VALID_FORESHADOW_STATUS = new Set(['pending', 'active', 'paid']);
const VALID_BEAT_TYPE = new Set(['setup', 'conflict', 'twist', 'climax', 'resolution']);
const VALID_ARC_STATUS = new Set(['pending', 'active', 'done']);

export function createEmptyOutline() {
    return {
        version: OUTLINE_VERSION,
        theme: '',
        tone: '',
        world: '',
        timeline: {
            start: '',
            end: '',
            note: '',
            mustRead: '',
        },
        arcs: [],
        foreshadowing: [],
        acts: [],
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

function normalizeAct(a, index) {
    // 兼容字符串形式："第一幕：开端"
    if (typeof a === 'string') {
        const s = a.trim();
        if (!s) return null;
        const sepIndex = s.indexOf('：') >= 0 ? s.indexOf('：') : (s.indexOf(':') >= 0 ? s.indexOf(':') : -1);
        if (sepIndex >= 0) {
            const title = s.slice(0, sepIndex).trim();
            const summary = s.slice(sepIndex + 1).trim();
            if (!title && !summary) return null;
            return { id: `act_${index + 1}`, title: title || `第${index + 1}幕`, summary };
        }
        return { id: `act_${index + 1}`, title: s, summary: '' };
    }
    if (!a || typeof a !== 'object') return null;
    const id = asString(a.id, '') || `act_${index + 1}`;
    const title = asString(a.title, '') || asString(a.name, '') || `第${index + 1}幕`;
    return {
        id,
        title,
        summary: asString(a.summary, '') || asString(a.description, ''),
        beats: Array.isArray(a.beats) ? a.beats.map(x => asString(x, '')).filter(Boolean) : [],
    };
}

function asStringList(v) {
    if (Array.isArray(v)) return v.map(x => asString(x, '')).filter(Boolean);
    if (typeof v === 'string') return v.split(/[,，、;；]/).map(x => x.trim()).filter(Boolean);
    return [];
}

export function normalizeBeat(b, index) {    if (!b || typeof b !== 'object') return null;
    const id = asString(b.id, '') || `beat_${index + 1}`;
    return {
        id,
        actId: asString(b.actId, '') || asString(b.act_id, ''),
        title: asString(b.title, '') || asString(b.name, ''),
        summary: asString(b.summary, '') || asString(b.description, ''),
        type: VALID_BEAT_TYPE.has(b.type) ? b.type : '',
        status: VALID_BEAT_STATUS.has(b.status) ? b.status : 'pending',
        cast: asStringList(b.cast),
    };
}

function normalizeForeshadow(f, index) {
    // 兼容字符串形式（模型常直接返回字符串列表）
    if (typeof f === 'string') {
        const hint = f.trim();
        if (!hint) return null;
        return { id: `f${index + 1}`, hint, status: 'pending', payoff: '', beatId: '' };
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
        beatId: asString(f.beatId, '') || asString(f.payoffBeat, ''),
    };
}

function normalizeArc(a) {
    // 兼容字符串形式："角色名：弧光描述"
    if (typeof a === 'string') {
        const s = a.trim();
        if (!s) return null;
        const sep = s.indexOf('：') >= 0 ? '：' : (s.indexOf(':') >= 0 ? ':' : null);
        if (sep) {
            const char = s.slice(0, s.indexOf(sep)).trim();
            const growth = s.slice(s.indexOf(sep) + sep.length).trim();
            if (!char && !growth) return null;
            return { char: char || '（未命名角色）', desire: '', flaw: '', growth, status: 'pending' };
        }
        return { char: '（未命名角色）', desire: '', flaw: '', growth: s, status: 'pending' };
    }
    if (!a || typeof a !== 'object') return null;
    const char = asString(a.char, '') || asString(a.character, '') || asString(a.name, '');
    if (!char) return null;
    return {
        char,
        desire: asString(a.desire, ''),
        flaw: asString(a.flaw, ''),
        growth: asString(a.growth, '') || asString(a.arc, ''),
        status: VALID_ARC_STATUS.has(a.status) ? a.status : 'pending',
    };
}

function normalizeTimeline(raw) {
    const t = (raw && typeof raw === 'object') ? raw : {};
    // 兼容字符串形式："建安五年 - 建安十三年"
    if (typeof raw === 'string') {
        const s = raw.trim();
        if (!s) return { start: '', end: '', note: '', mustRead: '' };
        const parts = s.split(/\s*[-–—~至到]\s*/);
        return {
            start: parts[0]?.trim() || '',
            end: parts[1]?.trim() || '',
            note: parts.length > 2 ? parts.slice(2).join(' - ').trim() : '',
            mustRead: '',
        };
    }
    return {
        start: asString(t.start, ''),
        end: asString(t.end, ''),
        note: asString(t.note, '') || asString(t.constraint, ''),
        mustRead: asString(t.mustRead, '') || asString(t.must_read, '') || asString(t.requiredLore, ''),
    };
}

export function normalizeOutline(raw) {
    const base = createEmptyOutline();
    if (!raw || typeof raw !== 'object') return base;

    base.version = OUTLINE_VERSION;
    base.theme = asString(raw.theme, '');
    base.tone = asString(raw.tone, '');
    base.world = asString(raw.world, '');
    base.timeline = normalizeTimeline(raw.timeline);
    base.arcs = Array.isArray(raw.arcs) ? raw.arcs.map(normalizeArc).filter(Boolean) : [];
    base.foreshadowing = Array.isArray(raw.foreshadowing) ? raw.foreshadowing.map((f, i) => normalizeForeshadow(f, i)).filter(Boolean) : [];
    base.acts = Array.isArray(raw.acts) ? raw.acts.map((a, i) => normalizeAct(a, i)).filter(Boolean) : [];
    base.beats = Array.isArray(raw.beats) ? raw.beats.map((b, i) => normalizeBeat(b, i)).filter(Boolean) : [];

    // 兼容旧数据/模型输出：若 beat 没有 actId，但从某个 act.beats 能推出归属，则补上
    for (const act of base.acts) {
        for (const beatId of act.beats) {
            const beat = base.beats.find(b => b.id === beatId && !b.actId);
            if (beat) beat.actId = act.id;
        }
    }

    const focus = (raw.focus && typeof raw.focus === 'object') ? raw.focus : {};
    base.focus.currentBeat = asString(focus.currentBeat, '') || asString(focus.current_beat, '');
    base.focus.nextStep = asString(focus.nextStep, '') || asString(focus.immediate_goal, '') || asString(focus.goal, '');
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
