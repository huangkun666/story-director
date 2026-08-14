// story-director/src/llm-client.js
// 纯逻辑：LLM 输出容错解析。generateRaw 由调用方注入。

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
    return async function generate({ system = '', prompt = '' }) {
        try {
            const result = await generateRaw({
                prompt,
                systemPrompt: system,
                jsonSchema: {
                    name: 'story_director_output',
                    description: 'Structured output for story-director',
                    value: schema,
                    strict: false,
                },
            });
            return extractJson(result);
        } catch (err) {
            console.warn('[story-director] structured generation failed:', err);
            return null;
        }
    };
}
