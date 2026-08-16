// story-director/src/tracker.js
// 纯逻辑：把 LLM 修订结果合并进现有大纲。零依赖。
import { normalizeOutline, normalizeBeat } from './outline-store.js';

// 锁定合并核心：以 prev 为基底，只从 patch 吸收「状态类」变更
// （status/focus/伏笔/弧光状态），用户手动编辑的内容（幕、节点、时间线）保持不变。
// 不触碰 meta（调用方决定是否递增修订计数）。
// beats 防漏删：patch 中缺失的既有节点一律保留（模型漏输出不丢节点），
// patch 新增的节点追加——「只增不删、内容不动、状态可吸收」。
export function mergeLockedOutline(prevOutline, patch) {
    const base = normalizeOutline(prevOutline);
    if (!patch) return base;
    const merged = normalizeOutline(patch);

    merged.timeline = base.timeline;
    merged.mustRead = base.mustRead;
    const baseActIds = new Set(base.acts.map(a => a.id));
    const extraActs = merged.acts.filter(a => !baseActIds.has(a.id));
    merged.acts = base.acts.map(baseAct => {
        const patched = merged.acts.find(a => a.id === baseAct.id);
        return patched ? { ...baseAct, beats: patched.beats } : baseAct;
    });
    // 允许模型追加全新幕（例如新增过渡节点时）
    merged.acts = [...merged.acts, ...extraActs];
    const patchBeatById = new Map(merged.beats.map(b => [b.id, b]));
    // base 的节点全部保留：有 patch 的按 patch 吸收状态、恢复手动编辑内容；无 patch 的原样保留
    const kept = base.beats.map(baseBeat => {
        const patched = patchBeatById.get(baseBeat.id);
        return patched
            ? { ...patched, title: baseBeat.title, summary: baseBeat.summary, type: baseBeat.type, actId: baseBeat.actId }
            : baseBeat;
    });
    // patch 新增的节点追加（保持其内容与状态）
    const added = merged.beats.filter(b => !base.beats.some(x => x.id === b.id));
    merged.beats = [...kept, ...added];
    // 唯一 active 不变量：patch 吸收后若出现多个进行中节点，只保留最后一个
    // （模型推进到的位置是当前剧情进行处），其余降为 pending
    const actives = merged.beats.filter(b => b.status === 'active');
    if (actives.length > 1) {
        for (const b of actives.slice(0, -1)) b.status = 'pending';
    }
    return merged;
}

// 修订输入侧压缩了已完成节点（见 prompts.compactOutlineForRevision）：
// 模型输出中这些节点可能只剩骨架，这里从旧大纲恢复细节，避免信息丢失。
function restoreDoneBeatDetails(prev, merged) {
    for (const beat of merged.beats) {
        if (beat.status !== 'done') continue;
        const prevBeat = prev.beats.find(b => b.id === beat.id);
        if (!prevBeat || prevBeat.status !== 'done') continue;
        if (!beat.summary) beat.summary = prevBeat.summary;
        if (!beat.type) beat.type = prevBeat.type;
        if (!Array.isArray(beat.cast) || !beat.cast.length) beat.cast = prevBeat.cast;
    }
    return merged;
}

export function applyRevision(prevOutline, revisionPatch, { lockOutline = false } = {}) {
    if (!revisionPatch) return prevOutline;
    const prev = normalizeOutline(prevOutline);
    const merged = lockOutline
        ? mergeLockedOutline(prev, revisionPatch)
        : normalizeOutline(revisionPatch);
    restoreDoneBeatDetails(prev, merged);

    merged.meta.revisionCount = (prev?.meta?.revisionCount ?? 0) + 1;
    merged.meta.updatedAt = new Date().toISOString();
    return merged;
}

const VALID_STATUS = new Set(['pending', 'active', 'done']);

// 锁定模式的增量补丁合并（见 prompts.buildRevisePatchPrompt）。
// 只应用状态类变更与追加节点，不改写任何现有内容。
// allowNewBeats=false 时忽略 patch.newBeats（纯状态推进，不追加节点）。
export function applyPatch(prevOutline, patch, { allowNewBeats = true } = {}) {
    const base = normalizeOutline(prevOutline);
    if (!patch || typeof patch !== 'object') return base;

    for (const sc of Array.isArray(patch.statusChanges) ? patch.statusChanges : []) {
        if (!sc || typeof sc !== 'object') continue;
        const beat = base.beats.find(b => b.id === sc.beatId);
        if (beat && VALID_STATUS.has(sc.status)) {
            if (sc.status === 'active') {
                // 唯一 active：推进新节点时，把现有进行中节点降为 pending
                for (const b of base.beats) {
                    if (b.status === 'active' && b.id !== sc.beatId) b.status = 'pending';
                }
            }
            beat.status = sc.status;
        }
    }

    const focus = (patch.focus && typeof patch.focus === 'object') ? patch.focus : null;
    if (focus) {
        if (typeof focus.currentBeat === 'string') base.focus.currentBeat = focus.currentBeat;
        if (typeof focus.nextStep === 'string') base.focus.nextStep = focus.nextStep;
        if (Array.isArray(focus.activeForeshadow)) {
            base.focus.activeForeshadow = focus.activeForeshadow.map(x => String(x)).filter(Boolean);
        }
        if (typeof focus.avoidOffTopic === 'string') base.focus.avoidOffTopic = focus.avoidOffTopic;
    }

    for (const fs of Array.isArray(patch.foreshadowing) ? patch.foreshadowing : []) {
        if (!fs || typeof fs !== 'object') continue;
        const item = base.foreshadowing.find(x => x.id === fs.id);
        if (!item) continue;
        if (VALID_STATUS.has(fs.status)) item.status = fs.status;
        if (typeof fs.payoff === 'string' && fs.payoff) item.payoff = fs.payoff;
    }

    for (const a of Array.isArray(patch.arcs) ? patch.arcs : []) {
        if (!a || typeof a !== 'object') continue;
        const arc = base.arcs.find(x => x.char === a.char);
        if (arc && VALID_STATUS.has(a.status)) arc.status = a.status;
    }

    const newBeats = allowNewBeats ? (Array.isArray(patch.newBeats) ? patch.newBeats : []) : [];
    if (newBeats.length) {
        let actId = typeof patch.newBeatActId === 'string' ? patch.newBeatActId : '';
        if (!base.acts.some(a => a.id === actId)) actId = '';
        if (!actId) {
            // 兜底：挂到当前焦点所在幕；否则最后一幕；否则自动建幕
            const focusBeat = base.beats.find(b => b.id === base.focus.currentBeat);
            actId = focusBeat?.actId || base.acts[base.acts.length - 1]?.id || '';
        }
        const ts = Date.now();
        for (let i = 0; i < newBeats.length; i++) {
            const raw = newBeats[i];
            if (!raw || typeof raw !== 'object') continue;
            // id 唯一化（时间戳后缀）：多次修订追加的节点不会撞 id
            const beat = normalizeBeat({ ...raw, id: `beat_patch_${ts}_${i + 1}` }, base.beats.length + i);
            beat.actId = actId;
            if (!beat.status) beat.status = 'pending';
            base.beats.push(beat);
            if (actId) {
                const act = base.acts.find(a => a.id === actId);
                if (act) {
                    act.beats = act.beats || [];
                    act.beats.push(beat.id);
                }
            }
        }
    }

    base.meta.revisionCount = (prevOutline?.meta?.revisionCount ?? 0) + 1;
    base.meta.updatedAt = new Date().toISOString();
    return base;
}
