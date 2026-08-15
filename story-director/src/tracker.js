// story-director/src/tracker.js
// 纯逻辑：把 LLM 修订结果合并进现有大纲。零依赖。
import { normalizeOutline } from './outline-store.js';

export function applyRevision(prevOutline, revisionPatch, { lockOutline = false } = {}) {
    if (!revisionPatch) return prevOutline;
    const merged = normalizeOutline(revisionPatch);

    if (lockOutline) {
        const base = normalizeOutline(prevOutline);
        // 用户手动编辑模式：只允许推进 status/focus/伏笔状态，
        // 不得改写用户已编辑的幕、节点内容与时间线。
        merged.timeline = base.timeline;
        const baseActIds = new Set(base.acts.map(a => a.id));
        const extraActs = merged.acts.filter(a => !baseActIds.has(a.id));
        merged.acts = base.acts.map(baseAct => {
            const patched = merged.acts.find(a => a.id === baseAct.id);
            return patched ? { ...baseAct, beats: patched.beats } : baseAct;
        });
        // 允许模型追加全新幕（例如新增过渡节点时）
        merged.acts = [...merged.acts, ...extraActs];
        merged.beats = merged.beats.map(patchedBeat => {
            const baseBeat = base.beats.find(b => b.id === patchedBeat.id);
            return baseBeat
                ? { ...patchedBeat, title: baseBeat.title, summary: baseBeat.summary, type: baseBeat.type, actId: baseBeat.actId }
                : patchedBeat;
        });
    }

    merged.meta.revisionCount = (prevOutline?.meta?.revisionCount ?? 0) + 1;
    merged.meta.updatedAt = new Date().toISOString();
    return merged;
}
