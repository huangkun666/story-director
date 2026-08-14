// story-director/src/checker.js
// 纯逻辑：体检诊断报告的归一化与大纲应用。零依赖。
import { normalizeOutline } from './outline-store.js';

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

export function applyCheckResult(outline, rawReport) {
    const report = normalizeReport(rawReport);
    if (!report.changed) {
        return { outline, report };
    }
    // 若模型给出了更新后的大纲，则使用之；否则保留原大纲（不破坏数据）
    const updated = rawReport && rawReport.updatedOutline ? normalizeOutline(rawReport.updatedOutline) : outline;
    return { outline: updated, report };
}
