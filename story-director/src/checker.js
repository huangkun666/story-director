// story-director/src/checker.js
// 纯逻辑：体检诊断报告的归一化与大纲应用。零依赖。
import { normalizeOutline } from './outline-store.js';
import { mergeLockedOutline } from './tracker.js';

const VALID_VERDICT = new Set(['sync', 'minor-drift', 'major-drift']);

export function normalizeReport(raw) {
    const r = (raw && typeof raw === 'object') ? raw : {};
    return {
        verdict: VALID_VERDICT.has(r.verdict) ? r.verdict : 'sync',
        issues: Array.isArray(r.issues) ? r.issues : [],
        changed: r.changed === true,
        changes: typeof r.changes === 'string' ? r.changes : '',
        reason: typeof r.reason === 'string' ? r.reason : '',
    };
}

// 体检合并：以 prev 为基底，只吸收状态类变更 + 时间线顺延 + 追加节点，
// 手动编辑内容（幕/节点标题概要/必读设定）保持不变——与修订的增量语义一致。
// 与 mergeLockedOutline 的区别：时间线放行（体检报告的时间线顺延是核心功能）。
function mergeCheckOutline(prevOutline, patch) {
    const merged = mergeLockedOutline(prevOutline, patch);
    const p = normalizeOutline(patch);
    // 体检放行时间线修正（顺延/补过渡节点）
    if (p.timeline.start !== merged.timeline.start
        || p.timeline.end !== merged.timeline.end
        || p.timeline.note !== merged.timeline.note) {
        merged.timeline = p.timeline;
    }
    return merged;
}

// 体检结果应用：统一走合并（增量），不区分锁定与否——updatedOutline 不再全量替换大纲，
// 手动编辑与进行中状态不被覆盖。模型对节点内容的修正建议通过 issues/reason 展示。
export function applyCheckResult(outline, rawReport, { lockOutline = false } = {}) {
    const report = normalizeReport(rawReport);
    if (!report.changed) {
        return { outline, report };
    }
    // 若模型给出了更新后的大纲，则增量合并；否则保留原大纲（不破坏数据）
    const updated = rawReport && rawReport.updatedOutline
        ? mergeCheckOutline(outline, rawReport.updatedOutline)
        : outline;
    return { outline: updated, report };
}
