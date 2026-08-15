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
