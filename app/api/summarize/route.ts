import { NextRequest, NextResponse } from "next/server";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// POST /api/summarize — receives question + small result sample, returns plain-English summary
export async function POST(req: NextRequest) {
    try {
        const { question, data, total } = await req.json() as {
            question: string;
            data: Record<string, string | number | null>[];
            total: number;
        };

        const prompt = `Summarize in plain English, max 50 words. Be specific with numbers.
Question: "${question}"
Results (top 5): ${JSON.stringify(data.slice(0, 5))}
Total rows: ${total}`;

        if (OPENAI_API_KEY) {
            const res = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
                body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 80, temperature: 0.3 }),
            });
            if (res.ok) {
                const summary = (await res.json()).choices[0].message.content.trim();
                return NextResponse.json({ summary });
            }
        }

        if (GEMINI_API_KEY) {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
                { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }
            );
            if (res.ok) {
                const summary = (await res.json()).candidates[0].content.parts[0].text.trim();
                return NextResponse.json({ summary });
            }
        }

        if (GROQ_API_KEY) {
            const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
                body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], max_tokens: 80, temperature: 0.3 }),
            });
            if (res.ok) {
                const summary = (await res.json()).choices[0].message.content.trim();
                return NextResponse.json({ summary });
            }
        }

        // Fallback: generate summary locally
        if (total === 0) return NextResponse.json({ summary: "No matching data found." });
        const top = data[0];
        const summary = `Found ${total.toLocaleString()} result(s). Top: ${Object.entries(top).map(([k, v]) => `${k}: ${v}`).join(", ")}.`;
        return NextResponse.json({ summary });
    } catch (err) {
        return NextResponse.json({ summary: "" }, { status: 500 });
    }
}
