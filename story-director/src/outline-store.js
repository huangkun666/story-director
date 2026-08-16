// story-director/src/outline-store.js
// 纯逻辑：大纲数据模型、默认值、校验。零依赖。

export const OUTLINE_VERSION = 1;

const VALID_BEAT_STATUS = new Set(['pending', 'active', 'done']);
const VALID_FORESHADOW_STATUS = new Set(['pending', 'active', 'paid']);
const VALID_BEAT_TYPE = new Set(['setup', 'conflict', 'twist', 'climax', 'resolution']);
const VALID_ARC_STATUS = new Set(['pending', 'active', 'done']);
const VALID_CHECK_VERDICT = new Set(['sync', 'minor-drift', 'major-drift']);
const CHECK_HISTORY_LIMIT = 10;

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
        meta: { updatedAt: '', revisionCount: 0, checkHistory: [] },
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

    // 引用完整性：beat.actId 是唯一事实来源，acts[].beats 一律派生重建，
    // 消灭「两边各存一份、只改一边就过时」的双向不一致
    for (const act of base.acts) {
        act.beats = base.beats.filter(b => b.actId === act.id).map(b => b.id);
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

    // 引用自愈：伏笔的回收节点已不存在 → 清空 beatId（由下次修订重新安排回收点）
    for (const f of base.foreshadowing) {
        if (f.beatId && !base.beats.some(b => b.id === f.beatId)) f.beatId = '';
    }
    // 引用自愈：焦点里活跃伏笔已不存在 → 过滤
    base.focus.activeForeshadow = base.focus.activeForeshadow.filter(id => base.foreshadowing.some(f => f.id === id));

    const meta = (raw.meta && typeof raw.meta === 'object') ? raw.meta : {};
    base.meta.updatedAt = asString(meta.updatedAt, '');
    base.meta.revisionCount = Number.isFinite(meta.revisionCount) ? Math.max(0, Math.floor(meta.revisionCount)) : 0;
    // 体检历史：{at, verdict} 列表，按新到旧，最多 CHECK_HISTORY_LIMIT 条
    base.meta.checkHistory = Array.isArray(meta.checkHistory)
        ? meta.checkHistory
            .filter(h => h && typeof h === 'object' && typeof h.at === 'string' && VALID_CHECK_VERDICT.has(h.verdict))
            .map(h => ({ at: h.at, verdict: h.verdict }))
            .slice(0, CHECK_HISTORY_LIMIT)
        : [];

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

// 跳转到指定节点开始游玩：目标节点置为 active，其之前的节点全部视为已完成，
// 目标之后若有 active 则重置为 pending（保证唯一 active），focus 指向目标。
// 返回新大纲，不修改入参。手动操作，不递增 revisionCount（UI 层会留快照）。
export function jumpToBeat(outline, beatId) {
    const o = normalizeOutline(outline);
    const target = o.beats.find(b => b.id === beatId);
    if (!target) return o;
    const targetIdx = o.beats.indexOf(target);
    for (let i = 0; i < o.beats.length; i++) {
        const b = o.beats[i];
        if (i < targetIdx) {
            if (b.status !== 'done') b.status = 'done';
        } else if (i === targetIdx) {
            b.status = 'active';
        } else if (b.status === 'active') {
            b.status = 'pending';
        }
    }
    o.focus.currentBeat = beatId;
    // 旧方向已不适用于新时间点，清空由下一轮修订重新生成
    o.focus.nextStep = '';
    o.meta.updatedAt = new Date().toISOString();
    return o;
}

// ---------- 受控编辑纯函数 ----------
// 所有修改都返回新大纲（不修改入参），引用完整性由 normalizeOutline 统一保证：
// beat.actId 是唯一事实，acts[].beats 派生；悬空引用自愈。

// 确保 actId 指向的幕存在（手动编辑时用户意图明确，自动补幕）
function ensureAct(o, actId) {
    if (!actId) return o;
    if (o.acts.some(a => a.id === actId)) return o;
    o.acts.push({ id: actId, title: actId, summary: '', beats: [] });
    return o;
}

export function createBeat(outline, { title = '未命名节点', summary = '', type = 'setup', status = 'pending', actId = '', cast = [] } = {}) {
    const o = normalizeOutline(outline);
    ensureAct(o, actId);
    const beat = normalizeBeat({
        id: `beat_${Date.now()}_${o.beats.length + 1}`,
        title,
        summary,
        type,
        status,
        actId,
        cast,
    }, o.beats.length);
    o.beats.push(beat);
    return normalizeOutline(o);
}

export function updateBeat(outline, beatId, patch) {
    const o = normalizeOutline(outline);
    const beat = o.beats.find(b => b.id === beatId);
    if (!beat || !patch || typeof patch !== 'object') return o;
    if (typeof patch.title === 'string') beat.title = patch.title;
    if (typeof patch.summary === 'string') beat.summary = patch.summary;
    if (VALID_BEAT_TYPE.has(patch.type)) beat.type = patch.type;
    if (Array.isArray(patch.cast)) beat.cast = patch.cast.map(x => String(x).trim()).filter(Boolean);
    if (typeof patch.actId === 'string' && patch.actId !== beat.actId) {
        beat.actId = patch.actId;
        ensureAct(o, patch.actId);
    }
    return normalizeOutline(o);
}

export function removeBeat(outline, beatId) {
    const o = normalizeOutline(outline);
    const idx = o.beats.findIndex(b => b.id === beatId);
    if (idx < 0) return o;
    o.beats.splice(idx, 1);
    // 伏笔回收点、焦点节点等悬空引用由 normalizeOutline 自愈
    return normalizeOutline(o);
}

// 同幕内上移/下移（delta = -1 / +1），数组顺序即时间线顺序
export function moveBeatOrder(outline, beatId, delta) {
    const o = normalizeOutline(outline);
    const beat = o.beats.find(b => b.id === beatId);
    if (!beat) return o;
    const siblings = o.beats.filter(b => b.actId === beat.actId);
    const idx = siblings.findIndex(b => b.id === beatId);
    const target = siblings[idx + delta];
    if (idx < 0 || !target) return o;
    const i = o.beats.indexOf(beat);
    const j = o.beats.indexOf(target);
    [o.beats[i], o.beats[j]] = [o.beats[j], o.beats[i]];
    return normalizeOutline(o);
}

const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function ordinal(n) {
    return n <= 10 ? CN_NUM[n] : String(n);
}

// 标题文本重编号：把幕标题开头的「第X幕/第X章」（X 为数字或中文数字）按当前顺序规范化。
// 只改编号前缀，标题其余部分与不含编号的标题原样保留。返回新大纲。
export function renumberActTitles(outline) {
    const o = normalizeOutline(outline);
    const pattern = /^第\s*[\d一二三四五六七八九十]+\s*[幕章][：:、\s]*/;
    o.acts.forEach((act, i) => {
        if (pattern.test(act.title)) {
            act.title = act.title.replace(pattern, `第${ordinal(i + 1)}幕：`);
        }
    });
    return o;
}

const HISTORY_ACT_ID = 'act_history';

// 生成新大纲时保留「已发生/正在进行」剧情：旧大纲中 status=done 或 active 的节点
// 收进前情幕，置于新大纲最前。done 保持 done；active 保持 active（进度不丢，不改成完成）。
// 旧节点 id 加 hist_ 前缀防冲突（已是 hist_ 的保持原名，幂等）。
// 旧伏笔/弧光/焦点/时间线一律以新大纲为准（生成 prompt 已把旧剧情作为前情参考传入）。
export function mergeHistoryIntoOutline(newOutline, oldOutline) {
    const o = normalizeOutline(newOutline);
    if (!oldOutline || typeof oldOutline !== 'object') return o;
    const old = normalizeOutline(oldOutline);
    const historyBeats = old.beats.filter(b => b.status === 'done' || b.status === 'active');
    if (!historyBeats.length) return o;

    const keptBeats = historyBeats.map((b) => {
        const newId = String(b.id).startsWith('hist_') ? b.id : `hist_${b.id || 'b'}`;
        return { ...b, id: newId, actId: HISTORY_ACT_ID, status: b.status };
    });
    // 前情幕幂等：新大纲已带前情幕时替换其内容，而不是叠加
    const existing = o.acts.find(a => a.id === HISTORY_ACT_ID);
    const historyAct = {
        id: HISTORY_ACT_ID,
        title: '前情·已发生（保留自旧大纲）',
        summary: '时间线调整前已发生或正在进行的剧情，新规划必须与之衔接',
        beats: [],
    };
    if (existing) {
        o.acts = o.acts.map(a => (a.id === HISTORY_ACT_ID ? historyAct : a));
        o.beats = o.beats.filter(b => b.actId !== HISTORY_ACT_ID);
    } else {
        o.acts.unshift(historyAct);
    }
    o.beats = [...keptBeats, ...o.beats];
    return normalizeOutline(o);
}
