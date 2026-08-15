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

// lockOutline=true 时体检结果只吸收状态类变更（与修订的锁定语义一致），
// 防止模型用 updatedOutline 全量覆盖用户手动编辑的幕/节点/时间线。
export function applyCheckResult(outline, rawReport, { lockOutline = false } = {}) {
    const report = normalizeReport(rawReport);
    if (!report.changed) {
        return { outline, report };
    }
    // 若模型给出了更新后的大纲，则使用之；否则保留原大纲（不破坏数据）
    const updated = rawReport && rawReport.updatedOutline
        ? (lockOutline ? mergeLockedOutline(outline, rawReport.updatedOutline) : normalizeOutline(rawReport.updatedOutline))
        : outline;
    return { outline: updated, report };
}
