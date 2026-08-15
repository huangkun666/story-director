// story-director/src/llm-client.js
// 纯逻辑：LLM 输出容错解析。generateRaw 由调用方注入。
//
// 注意：不把 schema 作为 jsonSchema 传给 generateRaw。
// 原因：酒馆 generateRaw 在收到 jsonSchema 时会走内置的 extractJsonFromData，
// 那是裸 JSON.parse（不剥 markdown 代码块），Gemini 等模型返回 ```json 包裹的内容时
// 会解析失败并回退成 "{}"，导致空大纲。改为不传 jsonSchema、拿到原始文本后，
// 由本模块的 extractJson（含 stripCodeFence）负责解析。
// JSON 结构由 prompt 中的显式模板约束（见 prompts.js），本模块只负责容错解析。

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

export function makeStructuredGenerator(generateRaw, schema) {
    // schema 参数保留以兼容调用方签名，但实际解析不依赖它（prompt 已内置模板）
    void schema;
    return async function generate({ system = '', prompt = '' }) {
        try {
            const result = await generateRaw({
                prompt,
                systemPrompt: system,
            });
            return extractJson(result);
        } catch (err) {
            console.warn('[story-director] structured generation failed:', err);
            return null;
        }
    };
}
