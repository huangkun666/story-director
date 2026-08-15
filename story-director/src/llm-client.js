// story-director/src/llm-client.js
// 纯逻辑：LLM 输出容错解析。generateRaw 由调用方注入。
//
// 注意：不把 schema 作为 jsonSchema 传给 generateRaw。
// 原因：酒馆 generateRaw 在收到 jsonSchema 时会走内置的 extractJsonFromData，
// 那是裸 JSON.parse（不剥 markdown 代码块），Gemini 等模型返回 ```json 包裹的内容时
// 会解析失败并回退成 "{}"，导致空大纲。改为不传 jsonSchema、拿到原始文本后，
// 由本模块的 extractJson（含 stripCodeFence）负责解析。

export function stripCodeFence(text) {
    if (typeof text !== 'string') return '';
    let t = text.trim();
    // 剥离 ```json / ``` 围栏
    const fence = t.match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/);
    if (fence) return fence[1].trim();
    return t;
}

export function extractJson(text) {
    if (typeof text !== 'string') return null;
    const cleaned = stripCodeFence(text);
    if (!cleaned) return null;
    try {
        return JSON.parse(cleaned);
    } catch {
        // 尝试从文本中提取第一个 {...} 或 [...] 片段
        const match = cleaned.match(/[\{\[][\s\S]*[\}\]]/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]);
        } catch {
            return null;
        }
    }
}

function schemaToFormatHint(schema) {
    if (!schema || typeof schema !== 'object') return '';
    const required = Array.isArray(schema.required) ? schema.required : [];
    const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    const lines = [];
    for (const key of required) {
        const p = props[key];
        const type = p?.type ?? 'any';
        const desc = p?.description ?? '';
        lines.push(`- ${key}（${type}${desc ? '：' + desc : ''}）`);
    }
    return lines.length ? `\n输出字段说明：\n${lines.join('\n')}` : '';
}

export function makeStructuredGenerator(generateRaw, schema) {
    const formatHint = schemaToFormatHint(schema);
    return async function generate({ system = '', prompt = '' }) {
        try {
            const finalPrompt = formatHint ? `${prompt}\n${formatHint}` : prompt;
            const result = await generateRaw({
                prompt: finalPrompt,
                systemPrompt: system,
            });
            return extractJson(result);
        } catch (err) {
            console.warn('[story-director] structured generation failed:', err);
            return null;
        }
    };
}
