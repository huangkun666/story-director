// story-director/src/logger.js
// 调试终端日志核心：纯逻辑环形缓冲 + 分级过滤 + 订阅。零 DOM 依赖，可单测。
// 条目：{ id, ts, level, category, message, detail }
//   level:    debug < info < warn < error
//   category: llm（LLM 调用）/ retrieval（检索）/ memory（记忆）/ engine（引擎）/
//             edit（手动编辑）/ lifecycle（生命周期）
// warn/error 同时透传浏览器 console，保留原有排障路径。

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];
export const LOG_CATEGORIES = ['llm', 'retrieval', 'memory', 'engine', 'edit', 'lifecycle'];

const DEFAULT_LIMIT = 500;

export function createLogger(limit = DEFAULT_LIMIT) {
    let entries = [];
    let seq = 0;
    let subscriber = null;

    function log(level, category, message, detail = '') {
        const lv = LOG_LEVELS.includes(level) ? level : 'info';
        const cat = LOG_CATEGORIES.includes(category) ? category : 'engine';
        const entry = {
            id: ++seq,
            ts: new Date().toISOString(),
            level: lv,
            category: cat,
            message: String(message ?? ''),
            detail: detail == null ? '' : String(detail),
        };
        entries.push(entry);
        if (entries.length > limit) entries = entries.slice(entries.length - limit);
        // 高优先级同时透传浏览器 console，保留现有排障路径
        if (lv === 'warn') console.warn(`[story-director] ${entry.message}`);
        if (lv === 'error') console.error(`[story-director] ${entry.message}`);
        try { subscriber?.(entry); } catch { /* 订阅方异常不影响日志 */ }
        return entry;
    }

    function subscribe(fn) {
        subscriber = typeof fn === 'function' ? fn : null;
        return () => { if (subscriber === fn) subscriber = null; };
    }

    function all() { return entries; }
    function clear() { entries = []; }
    function count() { return entries.length; }

    // 过滤：level 及以上 + 分类白名单 + 关键字（匹配 message/detail）。纯函数。
    function filter({ level = 'debug', categories = null, keyword = '' } = {}) {
        const minIdx = LOG_LEVELS.indexOf(level);
        const kw = String(keyword || '').trim().toLowerCase();
        return entries.filter(e => {
            if (LOG_LEVELS.indexOf(e.level) < minIdx) return false;
            if (Array.isArray(categories) && categories.length && !categories.includes(e.category)) return false;
            if (kw && !e.message.toLowerCase().includes(kw) && !e.detail.toLowerCase().includes(kw)) return false;
            return true;
        });
    }

    function exportJson() {
        return JSON.stringify(entries, null, 2);
    }

    return { log, subscribe, all, clear, count, filter, exportJson, limit };
}

// 全局单例（浏览器与 Node 测试共用）
export const logger = createLogger();

export function log(level, category, message, detail = '') {
    return logger.log(level, category, message, detail);
}
