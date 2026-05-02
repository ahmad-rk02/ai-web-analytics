import { NextRequest, NextResponse } from "next/server";
import type { DatasetSchema } from "../../types";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

export interface AIIntent {
    operation: "count_filter" | "count_group" | "aggregate" | "aggregate_group" | "filter_rows" | "top_n" | "trend";
    filterCol?: string;
    filterOp?: "=" | "!=" | "<" | ">" | "<=" | ">=";
    filterVal?: string | number;
    groupCol?: string;
    aggFn?: "avg" | "sum" | "min" | "max" | "count";
    aggCol?: string;
    aggCols?: string[];
    dateCol?: string;
    datePeriod?: "month" | "quarter" | "year" | "week" | "day";
    limit?: number;
    sortCol?: string;
    sortDir?: "asc" | "desc";
    chartType: "bar" | "line" | "pie";
}

function buildSchemaContext(schema: DatasetSchema): string {
    return schema.columns.map(col => {
        if (col.type === "number") return `  ${col.name}: number`;
        if (col.type === "date") return `  ${col.name}: date`;
        const unique = [...new Set(
            (schema.previewRows ?? []).slice(0, 50)
                .map(r => r[col.name])
                .filter(v => v !== null && v !== undefined && v !== "")
                .map(String)
        )].slice(0, 4);
        return `  ${col.name}: string [${unique.join(", ")}]`;
    }).join("\n");
}

async function getIntent(question: string, schema: DatasetSchema): Promise<AIIntent> {
    const ctx = buildSchemaContext(schema);
    const cols = schema.columns.map(c => c.name).join(", ");

    const prompt = `Dataset columns:
${ctx}

Question: "${question}"

Return JSON with ONE of these operations:

count_filter — count rows matching a condition
{"operation":"count_filter","filterCol":"sex","filterOp":"=","filterVal":"F","chartType":"bar"}

count_group — count rows grouped by a column
{"operation":"count_group","groupCol":"school","chartType":"bar"}

aggregate — single aggregate (avg/sum/min/max) of a numeric column
{"operation":"aggregate","aggFn":"avg","aggCol":"age","chartType":"bar"}

aggregate_group — aggregate grouped by a column (use aggCols array for multiple metrics)
{"operation":"aggregate_group","aggFn":"sum","aggCol":"Revenue","aggCols":["Quantity","Revenue","Profit"],"groupCol":"State","chartType":"bar"}

filter_rows — show rows matching a condition
{"operation":"filter_rows","filterCol":"age","filterOp":"<","filterVal":18,"chartType":"bar"}

top_n — top N rows sorted by a column, always include groupCol for the entity being ranked
{"operation":"top_n","groupCol":"Product_Name","sortCol":"Revenue","sortDir":"desc","limit":10,"chartType":"bar"}

trend — aggregate numeric columns grouped by a time period from a date column
{"operation":"trend","dateCol":"Order_Date","datePeriod":"month","aggFn":"sum","aggCols":["Revenue","Profit"],"chartType":"line"}

Rules:
- Only use column names from: ${cols}
- filterVal must use EXACT casing from dataset values shown above
- For numeric columns, filterVal must be a number not a string
- chartType: "pie" only if groupCol has ≤6 unique values, "line" for time trends, else "bar"
- Use "trend" for any question about monthly/weekly/daily/yearly/quarterly patterns or "over time"
- "how many X are Y" = count_filter on the column containing Y values`;

    const callAI = async (messages: { role: string; content: string }[]) => {
        if (OPENAI_API_KEY) {
            const res = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
                body: JSON.stringify({ model: "gpt-4o-mini", messages, response_format: { type: "json_object" }, temperature: 0 }),
            });
            if (!res.ok) throw new Error(`OpenAI ${res.status}`);
            const json = await res.json();
            const content = json?.choices?.[0]?.message?.content;
            if (!content) throw new Error("Invalid OpenAI response");
            console.log("[AI provider] OpenAI");
            return JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
        }

        if (GEMINI_API_KEY) {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: messages.map(m => m.content).join("\n") }] }],
                        generationConfig: { temperature: 0 },
                    }),
                }
            );
            if (res.ok) {
                const text = (await res.json()).candidates[0].content.parts[0].text;
                const m = text.match(/\{[\s\S]*\}/);
                if (m) { console.log("[AI provider] Gemini"); return JSON.parse(m[0]); }
            }
            console.warn(`[Gemini] status ${res.status} — trying Groq`);
        }

        if (GROQ_API_KEY) {
            const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
                body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages, temperature: 0, response_format: { type: "json_object" } }),
            });
            if (!res.ok) throw new Error(`Groq ${res.status}`);
            const json = await res.json();
            const content = json?.choices?.[0]?.message?.content;
            if (!content) throw new Error("Invalid Groq response");
            console.log("[AI provider] Groq");
            return JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
        }

        throw new Error("No AI key configured");
    };

    const result = await callAI([
        { role: "system", content: "You are a data analyst. Return only valid JSON matching one of the operation schemas." },
        { role: "user", content: prompt },
    ]);
    console.log("[Intent]", JSON.stringify(result));
    return result as AIIntent;
}

// Heuristic fallback — runs server-side when all AI providers fail
function heuristicIntent(question: string, schema: DatasetSchema): AIIntent {
    const q = question.toLowerCase();
    const allCols = schema.columns.map(c => c.name);
    const numCols = schema.columns.filter(c => c.type === "number").map(c => c.name);
    const strCols = schema.columns.filter(c => c.type === "string").map(c => c.name);

    const mentionedCols = allCols.filter(c => q.includes(c.toLowerCase())).sort((a, b) => b.length - a.length);
    const mentionedStr = mentionedCols.find(c => strCols.includes(c)) || strCols[0];
    const mentionedNum = mentionedCols.find(c => numCols.includes(c)) || numCols[0];

    const topMatch = question.match(/top\s+(\d+)/i);
    const limit = topMatch ? parseInt(topMatch[1]) : undefined;

    const groupPattern = /\bwise\b|\bby\b|\bper\b|\beach\b|\bbreakdown\b|\bdistribution\b|\bshare\b/i;
    const byMatch = question.match(/\bby\s+(\w+)/i) || question.match(/\bper\s+(\w+)/i);
    const byCol = byMatch ? allCols.find(c => c.toLowerCase() === byMatch[1].toLowerCase()) : undefined;

    const trendPattern = /\btrend\b|\bover time\b|\bmonthly\b|\bweekly\b|\bdaily\b|\byearly\b|\bannual\b|\bquarterly\b|\bby month\b|\bby year\b/i;
    const dateCols = schema.columns.filter(c => c.type === "date").map(c => c.name);
    const dateCol = dateCols[0] ?? schema.columns.find(c => /date|time|day|month|year/i.test(c.name))?.name;

    if (trendPattern.test(q) && dateCol) {
        let datePeriod: AIIntent["datePeriod"] = "month";
        if (/daily|by day/.test(q)) datePeriod = "day";
        else if (/weekly|by week/.test(q)) datePeriod = "week";
        else if (/yearly|annual|by year/.test(q)) datePeriod = "year";
        else if (/quarterly|by quarter/.test(q)) datePeriod = "quarter";
        const meaningful = numCols.filter(c => !/\bid\b|_id$/i.test(c));
        const aggCols = meaningful.length > 0 ? meaningful : numCols;
        const primaryCol = (mentionedNum && aggCols.includes(mentionedNum)) ? mentionedNum : aggCols[0];
        return { operation: "trend", aggFn: "sum", aggCol: primaryCol, aggCols, dateCol, datePeriod, chartType: "line" };
    }

    if (groupPattern.test(q) && mentionedNum && mentionedStr && !/how many|count/.test(q)) {
        const groupCol = byCol || mentionedStr || strCols[0];
        const meaningful = numCols.filter(c => !/\bid\b|_id$/i.test(c));
        const aggCols = meaningful.length > 0 ? meaningful : numCols;
        const primaryCol = (mentionedNum && aggCols.includes(mentionedNum)) ? mentionedNum : aggCols[0];
        return { operation: "aggregate_group", aggFn: "sum", aggCol: primaryCol, aggCols, groupCol, limit, chartType: "bar" };
    }

    const belowMatch = question.match(/(\w+)\s+(?:below|less\s+than|under|<)\s+(\d+(?:\.\d+)?)/i);
    const aboveMatch = question.match(/(\w+)\s+(?:above|greater\s+than|over|more\s+than|>)\s+(\d+(?:\.\d+)?)/i);
    if (belowMatch) {
        const col = allCols.find(c => c.toLowerCase() === belowMatch[1].toLowerCase()) || numCols[0];
        return { operation: "count_filter", filterCol: col, filterOp: "<", filterVal: Number(belowMatch[2]), chartType: "bar" };
    }
    if (aboveMatch) {
        const col = allCols.find(c => c.toLowerCase() === aboveMatch[1].toLowerCase()) || numCols[0];
        return { operation: "count_filter", filterCol: col, filterOp: ">", filterVal: Number(aboveMatch[2]), chartType: "bar" };
    }

    const hasGroupContext = byCol || (strCols.some(c => q.includes(c.toLowerCase())) && /average|avg|mean|sum|total/.test(q));
    if (/average|avg|mean/.test(q)) {
        if (hasGroupContext) return { operation: "aggregate_group", aggFn: "avg", aggCol: mentionedNum || numCols[0], aggCols: [mentionedNum || numCols[0]], groupCol: byCol || mentionedStr || strCols[0], limit, chartType: "bar" };
        return { operation: "aggregate", aggFn: "avg", aggCol: mentionedNum || numCols[0], chartType: "bar" };
    }
    if (/\bsum\b|total/.test(q)) {
        if (hasGroupContext) return { operation: "aggregate_group", aggFn: "sum", aggCol: mentionedNum || numCols[0], aggCols: numCols, groupCol: byCol || mentionedStr || strCols[0], limit, chartType: "bar" };
        return { operation: "aggregate", aggFn: "sum", aggCol: mentionedNum || numCols[0], chartType: "bar" };
    }
    if (/\bmin\b|minimum|lowest/.test(q)) return { operation: "aggregate", aggFn: "min", aggCol: mentionedNum || numCols[0], chartType: "bar" };
    if (/\bmax\b|maximum|highest/.test(q)) return { operation: "aggregate", aggFn: "max", aggCol: mentionedNum || numCols[0], chartType: "bar" };

    if (/how many|count of|number of/.test(q)) {
        return { operation: "count_group", groupCol: mentionedStr || strCols[0], chartType: "bar" };
    }

    return { operation: "count_group", groupCol: mentionedStr || strCols[0], chartType: "bar" };
}

// POST /api/analyze — returns intent only (no data sent, no data processed here)
export async function POST(req: NextRequest) {
    try {
        const { question, schema } = await req.json() as { question: string; schema: DatasetSchema };
        if (!question?.trim()) return NextResponse.json({ error: "Question is required" }, { status: 400 });

        let intent: AIIntent;
        try {
            if (OPENAI_API_KEY || GEMINI_API_KEY || GROQ_API_KEY) {
                intent = await getIntent(question, schema);
            } else {
                intent = heuristicIntent(question, schema);
            }
        } catch (e) {
            console.warn("[Intent error — using heuristic]", e instanceof Error ? e.message : e);
            intent = heuristicIntent(question, schema);
        }

        return NextResponse.json(intent);
    } catch (err) {
        const message = err instanceof Error ? err.message : "An unexpected error occurred";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
