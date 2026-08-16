// story-director/src/openai-compat.js
// 纯逻辑：OpenAI 兼容 Chat Completions 客户端。零依赖，fetch 由调用方注入。
// 用于"独立 API"模式：generateRaw 无法安全透传独立 baseUrl/apiKey，
// 因此这里直接按 OpenAI 兼容格式调用 /v1/chat/completions，任何失败都返回 null。

export function buildChatCompletionsUrl(baseUrl) {
    let base = String(baseUrl ?? '').trim().replace(/\/+$/, '');
    if (!base) return '';
    if (/\/chat\/completions$/i.test(base)) return base;
    if (/\/v1$/i.test(base)) return `${base}/chat/completions`;
    return `${base}/v1/chat/completions`;
}

// /v1/models 端点：与 buildChatCompletionsUrl 同规则归一化
export function buildModelsUrl(baseUrl) {
    let base = String(baseUrl ?? '').trim().replace(/\/+$/, '');
    if (!base) return '';
    if (/\/models$/i.test(base)) return base;
    if (/\/v1$/i.test(base)) return `${base}/models`;
    return `${base}/v1/models`;
}

// 获取模型列表：兼容 OpenAI 标准 {data:[{id}]} 与 Ollama 风格 {models:[{name}]}。
// 去重并按 id 升序。任何失败抛错（由调用方决定如何展示）。
export async function listModels({ fetchImpl, baseUrl, apiKey } = {}) {
    if (typeof fetchImpl !== 'function') {
        throw new TypeError('[story-director] listModels: fetchImpl must be a function');
    }
    const url = buildModelsUrl(baseUrl);
    if (!url) throw new Error('Base URL 未配置');

    const headers = { 'Content-Type': 'application/json' };
    const key = String(apiKey ?? '').trim();
    if (key) headers.Authorization = `Bearer ${key}`;

    const response = await fetchImpl(url, { method: 'GET', headers });
    if (!response || !response.ok) {
        throw new Error(`HTTP ${response?.status ?? 'unknown'}`);
    }
    const data = await response.json();
    let list = [];
    if (Array.isArray(data?.data)) {
        list = data.data.map(m => m && typeof m === 'object' ? m.id : null);
    } else if (Array.isArray(data?.models)) {
        list = data.models.map(m => m && typeof m === 'object' ? (m.name || m.id) : null);
    }
    return [...new Set(list.filter(x => typeof x === 'string' && x.trim()))].sort();
}

// 测试连接：先 GET /v1/models（能拉到模型说明 URL/认证/网络全通）；
// 若端点不支持（404/405 等），降级为一次最小 chat/completions 请求验证生成链路。
export async function testConnection({ fetchImpl, baseUrl, apiKey } = {}) {
    try {
        const models = await listModels({ fetchImpl, baseUrl, apiKey });
        return { ok: true, detail: 'GET /v1/models 成功', modelCount: models.length };
    } catch {
        try {
            const url = buildChatCompletionsUrl(baseUrl);
            if (!url) throw new Error('Base URL 未配置');
            const headers = { 'Content-Type': 'application/json' };
            const key = String(apiKey ?? '').trim();
            if (key) headers.Authorization = `Bearer ${key}`;
            const response = await fetchImpl(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
            });
            if (!response || !response.ok) {
                throw new Error(`HTTP ${response?.status ?? 'unknown'}`);
            }
            return { ok: true, detail: 'chat/completions 连通（/models 不可用）', modelCount: null };
        } catch (err) {
            return { ok: false, detail: String(err?.message || err) };
        }
    }
}

export function buildChatCompletionsPayload({ system = '', prompt = '', model = '' } = {}) {
    const messages = [];
    const systemText = String(system ?? '').trim();
    if (systemText) messages.push({ role: 'system', content: systemText });
    messages.push({ role: 'user', content: String(prompt ?? '') });

    const payload = { messages };
    const modelName = String(model ?? '').trim();
    if (modelName) payload.model = modelName;
    return payload;
}

export function extractChatCompletionsContent(data) {
    if (!data || typeof data !== 'object') return null;
    const choice = Array.isArray(data.choices) ? data.choices[0] : null;
    const content = choice?.message?.content ?? choice?.text;
    if (typeof content === 'string' && content.trim()) return content.trim();
    // 兼容少量非标准但常见的 OpenAI 风格返回
    if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
    if (typeof data.content === 'string' && data.content.trim()) return data.content.trim();
    return null;
}

export function createOpenAiCompatibleGenerator({ fetchImpl, getConfig } = {}) {
    if (typeof fetchImpl !== 'function') {
        throw new TypeError('[story-director] openai-compat: fetchImpl must be a function');
    }
    if (typeof getConfig !== 'function') {
        throw new TypeError('[story-director] openai-compat: getConfig must be a function');
    }

    return async function generate({ system = '', prompt = '' } = {}) {
        try {
            const config = getConfig() || {};
            const baseUrl = String(config.baseUrl ?? '').trim();
            const url = buildChatCompletionsUrl(baseUrl);
            if (!url) return null; // 独立 API 未配置完整，静默降级

            const headers = { 'Content-Type': 'application/json' };
            const apiKey = String(config.apiKey ?? '').trim();
            if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

            const payload = buildChatCompletionsPayload({
                system,
                prompt,
                model: config.model,
            });

            const response = await fetchImpl(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
            });

            if (!response || !response.ok) {
                let detail = '';
                try {
                    const text = await response?.text?.();
                    detail = String(text ?? '').slice(0, 200);
                } catch {}
                throw new Error(`HTTP ${response?.status ?? 'unknown'} ${detail}`.trim());
            }

            const data = await response.json();
            const content = extractChatCompletionsContent(data);
            if (!content) throw new Error('response contains no message content');
            return content;
        } catch (err) {
            console.warn('[story-director] independent LLM call failed, falling back:', err);
            return null;
        }
    };
}
