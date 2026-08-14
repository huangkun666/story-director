// story-director/src/tracker.js
// 纯逻辑：把 LLM 修订结果合并进现有大纲。零依赖。
import { normalizeOutline } from './outline-store.js';

export function applyRevision(prevOutline, revisionPatch) {
    if (!revisionPatch) return prevOutline;
    const merged = normalizeOutline(revisionPatch);
    merged.meta.revisionCount = (prevOutline?.meta?.revisionCount ?? 0) + 1;
    merged.meta.updatedAt = new Date().toISOString();
    return merged;
}
