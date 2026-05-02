import { NextRequest, NextResponse } from "next/server";
import type { DatasetSchema, QueryResult } from "../../types";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

type Row = Record<string, string | number | boolean | null>;

interface AIIntent {
    operation: "count_filter" | "count_group" | "aggregate" | "aggregate_group" | "filter_rows" | "top_n" | "trend";
    filterCol?: string;
    filterOp?: "=" | "!=" | "<" | ">" | "<=" | ">=";
    filterVal?: string | number;
    groupCol?: string;
    aggFn?: "avg" | "sum" | "min" | "max" | "count";
    aggCol?: string;
    aggCols?: string[]; // multiple numeric columns to aggregate
    dateCol?: string;   // date column for trend grouping
    datePeriod?: "month" | "quarter" | "year" | "week" | "day"; // granularity
    limit?: number;
    sortCol?: string;
    sortDir?: "asc" | "desc";
    chartType: "bar" | "line" | "pie";
}

function buildSchemaContext(schema: DatasetSchema, data: Row[]): string {
    // Keep prompt tiny — only column name, type, and 3 sample values for strings
    // This minimises token usage and avoids Gemini free-tier 429s
    return schema.columns.map(col => {
        if (col.type === "number") {
            // Just show type — range is not needed for intent detection
            return `  ${col.name}: number`;
        }
        if (col.type === "date") {
            const sample = data.find(r => r[col.name])?.[col.name];
            return `  ${col.name}: date${sample ? ` (e.g. ${sample})` : ""}`;
        }
        // For strings, show up to 4 unique values so AI knows what values exist
        const unique = [...new Set(
            data.slice(0, 50).map(r => r[col.name]).filter(v => v !== null && v !== undefined && v !== "").map(String)
        )].slice(0, 4);
        return `  ${col.name}: string [${unique.join(", ")}]`;
    }).join("\n");
}

async function getIntent(question: string, schema: DatasetSchema, data: Row[]): Promise<AIIntent> {
    // Use lightweight schema — just column names/types + sample values (no full data)
    // This minimizes token usage and avoids Gemini TPM limits
    const ctx = buildSchemaContext(schema, data.slice(0, 100)); // sample only 100 rows for context
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
{"operation":"aggregate_group","aggFn":"sum","aggCol":"Revenue","aggCols":["Order_ID","Quantity","Revenue","Profit"],"groupCol":"State","chartType":"bar"}

filter_rows — show rows matching a condition
{"operation":"filter_rows","filterCol":"age","filterOp":"<","filterVal":18,"chartType":"bar"}

top_n — top N rows sorted by a column, always include groupCol for the entity being ranked
{"operation":"top_n","groupCol":"Product","sortCol":"Revenue","sortDir":"desc","limit":10,"chartType":"bar"}

trend — aggregate numeric columns grouped by a time period from a date column
{"operation":"trend","dateCol":"Order_Date","datePeriod":"month","aggFn":"sum","aggCols":["Revenue","Profit"],"chartType":"line"}

Rules:
- Only use column names from: ${cols}
- filterVal must use EXACT casing from dataset values shown above
- For numeric columns, filterVal must be a number not a string
- chartType: "pie" only if groupCol has ≤6 unique values, "line" for time trends, else "bar"
- Use "trend" operation for any question about monthly/weekly/daily/yearly/quarterly patterns or "over time"
- "female" maps to the actual value in sex column (check values above)
- "how many X are Y" = count_filter on the column containing Y values`;

    const callAI = async (messages: { role: string; content: string }[]) => {
        // 1. OpenAI
        if (OPENAI_API_KEY) {
            const res = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
                body: JSON.stringify({
                    model: "gpt-4o-mini",
                    messages,
                    response_format: { type: "json_object" },
                    temperature: 0,
                }),
            });
            if (res.status === 429) throw new Error("OpenAI 429");
            if (!res.ok) throw new Error(`OpenAI ${res.status}`);
            const json = await res.json();
            const content = json?.choices?.[0]?.message?.content;
            if (!content) throw new Error("Invalid OpenAI response");
            console.log("[AI provider] OpenAI");
            return JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
        }

        // 2. Gemini — try first, fall through to Groq on 429
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
                if (m) {
                    console.log("[AI provider] Gemini");
                    return JSON.parse(m[0]);
                }
            }
            console.warn(`[Gemini] status ${res.status} — trying Groq fallback`);
        }

        // 3. Groq (free tier, OpenAI-compatible) — fallback when Gemini rate-limits
        if (GROQ_API_KEY) {
            const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
                body: JSON.stringify({
                    model: "llama-3.3-70b-versatile",
                    messages,
                    temperature: 0,
                    response_format: { type: "json_object" },
                }),
            });
            if (res.status === 429) throw new Error("Groq 429");
            if (!res.ok) throw new Error(`Groq ${res.status}`);
            const json = await res.json();
            const content = json?.choices?.[0]?.message?.content;
            if (!content) throw new Error("Invalid Groq response");
            console.log("[AI provider] Groq");
            return JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
        }

        throw new Error("No AI key configured");
    };

    try {
        const result = await callAI([
            { role: "system", content: "You are a data analyst. Return only valid JSON matching one of the operation schemas." },
            { role: "user", content: prompt },
        ]);

        console.log("[Intent]", JSON.stringify(result));
        return result as AIIntent;
    } catch (error) {
        console.warn("[AI fallback] Unable to parse intent from AI, using heuristic fallback.", error instanceof Error ? error.message : error);
        return heuristicIntent(question, schema, data);
    }
}

function executeIntent(intent: AIIntent, data: Row[], schema: DatasetSchema, question = ""): Omit<QueryResult, "summary"> {
    const allColNames = schema.columns.map(c => c.name);

    // Case-insensitive fuzzy column name resolver — handles AI returning slightly wrong names
    const resolveCol = (name: string | undefined, pool: string[] = allColNames): string | undefined => {
        if (!name) return undefined;
        if (pool.includes(name)) return name;
        const lower = name.toLowerCase();
        return pool.find(c => c.toLowerCase() === lower)
            ?? pool.find(c => c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase()));
    };

    const caseVal = (v: string | number) => typeof v === "string" ? v.toLowerCase().trim() : v;
    const cellVal = (cell: string | number | boolean | null) =>
        typeof cell === "string" ? cell.toLowerCase().trim() : cell;

    const matchFilter = (row: Row): boolean => {
        if (!intent.filterCol || !intent.filterOp || intent.filterVal === undefined) return true;
        const cell = row[intent.filterCol];
        if (cell === null || cell === undefined) return false;
        const cv = cellVal(cell);
        const fv = caseVal(intent.filterVal);
        switch (intent.filterOp) {
            case "=": return cv === fv;
            case "!=": return cv !== fv;
            case "<": return Number(cell) < Number(intent.filterVal);
            case ">": return Number(cell) > Number(intent.filterVal);
            case "<=": return Number(cell) <= Number(intent.filterVal);
            case ">=": return Number(cell) >= Number(intent.filterVal);
        }
    };

    switch (intent.operation) {
        case "count_filter": {
            const filtered = data.filter(matchFilter);
            const label = `${intent.filterCol}=${intent.filterVal}`;
            return {
                data: [{ Category: label, Count: filtered.length }],
                xKey: "Category", yKey: "Count", chartType: intent.chartType,
            };
        }

        case "count_group": {
            const col = intent.groupCol!;
            const groups = new Map<string, number>();
            data.forEach(r => {
                const k = String(r[col] ?? "Unknown");
                groups.set(k, (groups.get(k) ?? 0) + 1);
            });
            const result = Array.from(groups.entries())
                .map(([k, v]) => ({ [col]: k, Count: v }))
                .sort((a, b) => b.Count - a.Count);
            return { data: result, xKey: col, yKey: "Count", chartType: intent.chartType };
        }

        case "aggregate": {
            const col = intent.aggCol!;
            const fn = intent.aggFn!;
            // Accumulate from raw rows — no intermediate rounding
            let sum = 0, count = 0, min = Infinity, max = -Infinity;
            data.forEach(r => {
                const v = Number(r[col]);
                if (isNaN(v)) return;
                sum += v;
                count++;
                if (v < min) min = v;
                if (v > max) max = v;
            });
            let val: number;
            switch (fn) {
                case "avg": val = count > 0 ? sum / count : 0; break;
                case "sum": val = sum; break;
                case "min": val = min === Infinity ? 0 : min; break;
                case "max": val = max === -Infinity ? 0 : max; break;
                default: val = count;
            }
            val = Math.round(val * 100) / 100;
            const label = `${fn.toUpperCase()} of ${col}`;
            return {
                data: [{ Metric: label, Value: val }],
                xKey: "Metric", yKey: "Value", chartType: intent.chartType,
            };
        }

        case "aggregate_group": {
            const groupCol = resolveCol(intent.groupCol, schema.columns.filter(c => c.type === "string").map(c => c.name))
                ?? resolveCol(intent.groupCol)
                ?? schema.columns.find(c => c.type === "string")?.name!;
            const fn = intent.aggFn ?? "sum";
            const numericCols = schema.columns.filter(c => c.type === "number").map(c => c.name);
            const meaningfulNumCols = numericCols.filter(c => !/\bid\b|_id$/i.test(c));
            // Resolve requested cols with fuzzy matching, then fall back to all meaningful numeric cols
            const requestedCols = intent.aggCols ?? (intent.aggCol ? [intent.aggCol] : []);
            const matched = requestedCols.map(c => resolveCol(c, numericCols)).filter(Boolean) as string[];
            const targetCols: string[] = matched.length > 0
                ? matched
                : meaningfulNumCols.length > 0 ? meaningfulNumCols : numericCols;

            // Accumulate raw values from every row — no rounding until the very end
            const groupCounts = new Map<string, number>();
            const groupSums = new Map<string, Map<string, number>>();   // col → running sum
            const groupMins = new Map<string, Map<string, number>>();
            const groupMaxs = new Map<string, Map<string, number>>();

            data.forEach(r => {
                const k = String(r[groupCol] ?? "Unknown");
                groupCounts.set(k, (groupCounts.get(k) ?? 0) + 1);

                if (!groupSums.has(k)) {
                    groupSums.set(k, new Map());
                    groupMins.set(k, new Map());
                    groupMaxs.set(k, new Map());
                }
                const sums = groupSums.get(k)!;
                const mins = groupMins.get(k)!;
                const maxs = groupMaxs.get(k)!;

                targetCols.forEach(col => {
                    const raw = r[col];
                    if (raw === null || raw === undefined || raw === "") return;
                    const v = Number(raw);
                    if (isNaN(v)) return;
                    sums.set(col, (sums.get(col) ?? 0) + v);
                    mins.set(col, Math.min(mins.has(col) ? mins.get(col)! : Infinity, v));
                    maxs.set(col, Math.max(maxs.has(col) ? maxs.get(col)! : -Infinity, v));
                });
            });

            // Primary sort column
            const primaryCol = (intent.aggCol && targetCols.includes(intent.aggCol))
                ? intent.aggCol
                : targetCols[0];

            // Detect revenue/profit columns for margin (computed from raw sums, not rounded values)
            const revenueCol = targetCols.find(c => /revenue|sales|amount|turnover/i.test(c));
            const profitCol = targetCols.find(c => /profit|income|earnings/i.test(c));

            const result = Array.from(groupCounts.keys()).map(k => {
                const count = groupCounts.get(k)!;
                const sums = groupSums.get(k)!;
                const mins = groupMins.get(k)!;
                const maxs = groupMaxs.get(k)!;

                const row: Record<string, string | number | null> = {
                    [groupCol]: k,
                    Orders: count,
                };

                targetCols.forEach(col => {
                    const sum = sums.get(col) ?? 0;
                    let v: number;
                    switch (fn) {
                        case "sum": v = sum; break;
                        case "avg": v = count > 0 ? sum / count : 0; break;
                        case "min": v = mins.get(col) ?? 0; break;
                        case "max": v = maxs.get(col) ?? 0; break;
                        case "count": v = count; break;
                        default: v = sum;
                    }
                    // Round only at output time
                    row[col] = Math.round(v * 100) / 100;
                });

                // Profit Margin = raw profit sum / raw revenue sum — computed from raw sums
                if (revenueCol && profitCol && fn === "sum") {
                    const rawRev = sums.get(revenueCol) ?? 0;
                    const rawProfit = sums.get(profitCol) ?? 0;
                    row["Profit Margin"] = rawRev > 0
                        ? `${((rawProfit / rawRev) * 100).toFixed(2)}%`
                        : "0.00%";
                }

                return row;
            }).sort((a, b) => Number(b[primaryCol] ?? 0) - Number(a[primaryCol] ?? 0));

            return { data: result, xKey: groupCol, yKey: primaryCol, chartType: intent.chartType };
        }

        case "filter_rows": {
            const filtered = data.filter(matchFilter);
            const cols = schema.columns.map(c => c.name).slice(0, 5);
            const xKey = cols[0];
            const yKey = cols[1] || cols[0];
            return {
                data: filtered.slice(0, 500).map(r => {
                    const out: Record<string, string | number | null> = {};
                    cols.forEach(c => { out[c] = r[c] as string | number | null; });
                    return out;
                }),
                xKey, yKey, chartType: intent.chartType,
            };
        }

        case "top_n": {
            const limit = intent.limit ?? 10;
            const dir = intent.sortDir ?? "desc";
            const numericCols = schema.columns.filter(c => c.type === "number").map(c => c.name);
            const strCols = schema.columns.filter(c => c.type === "string").map(c => c.name);

            // Case-insensitive fuzzy match for column names from AI
            const resolveCol = (name: string | undefined, pool: string[]): string | undefined => {
                if (!name) return undefined;
                // Exact match first
                if (pool.includes(name)) return name;
                // Case-insensitive
                const lower = name.toLowerCase();
                return pool.find(c => c.toLowerCase() === lower)
                    // Partial match — AI said "Revenue", actual col is "Sale_Revenue"
                    ?? pool.find(c => c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase()));
            };

            const sortCol = resolveCol(intent.sortCol, numericCols)
                ?? resolveCol(intent.sortCol, schema.columns.map(c => c.name))
                ?? numericCols.find(c => !/\bid\b|_id$/i.test(c))
                ?? numericCols[0];

            const isNumericSort = numericCols.includes(sortCol);

            if (isNumericSort && strCols.length > 0) {
                // Extract entity word from question: "top 10 Products" → "product"
                // Match against column names to find the right grouping column
                const q = question.toLowerCase();
                const entityFromQuestion = strCols.find(c => {
                    const cLower = c.toLowerCase().replace(/[_\s]/g, "");
                    // Check if question contains the column name (singular or plural)
                    return q.includes(cLower) || q.includes(cLower.replace(/s$/, "")) || q.includes(cLower + "s");
                });

                // Pick grouping column: AI hint → question entity → product-like col (not customer/name) → first non-id
                const groupCol = resolveCol(intent.groupCol, strCols)
                    ?? entityFromQuestion
                    ?? strCols.find(c => /product|item|category|brand|title|sku/i.test(c))
                    ?? strCols.find(c => !/customer|client|user|name|id$/i.test(c))
                    ?? strCols[0];

                const meaningfulNumCols = numericCols.filter(c => !/\bid\b|_id$/i.test(c));

                // Accumulate raw sums per group from every row
                const groupSums = new Map<string, Map<string, number>>();
                const groupCounts = new Map<string, number>();
                data.forEach(r => {
                    const k = String(r[groupCol] ?? "Unknown");
                    groupCounts.set(k, (groupCounts.get(k) ?? 0) + 1);
                    if (!groupSums.has(k)) groupSums.set(k, new Map());
                    const sums = groupSums.get(k)!;
                    meaningfulNumCols.forEach(col => {
                        const v = Number(r[col]);
                        if (!isNaN(v)) sums.set(col, (sums.get(col) ?? 0) + v);
                    });
                });

                const revenueCol = meaningfulNumCols.find(c => /revenue|sales|amount|turnover/i.test(c));
                const profitCol = meaningfulNumCols.find(c => /profit|income|earnings/i.test(c));

                const result = Array.from(groupSums.entries())
                    .map(([k, sums]) => {
                        const row: Record<string, string | number | null> = { [groupCol]: k };
                        meaningfulNumCols.forEach(col => {
                            row[col] = Math.round((sums.get(col) ?? 0) * 100) / 100;
                        });
                        if (revenueCol && profitCol) {
                            const rawRev = sums.get(revenueCol) ?? 0;
                            const rawProfit = sums.get(profitCol) ?? 0;
                            row["Profit Margin"] = rawRev > 0
                                ? `${((rawProfit / rawRev) * 100).toFixed(2)}%`
                                : "0.00%";
                        }
                        return row;
                    })
                    .sort((a, b) => {
                        const av = Number(a[sortCol] ?? 0);
                        const bv = Number(b[sortCol] ?? 0);
                        return dir === "asc" ? av - bv : bv - av;
                    })
                    .slice(0, limit);

                console.log(`[top_n] groupCol=${groupCol}, sortCol=${sortCol}, groups=${groupSums.size}, result=${result.length}`);
                return { data: result, xKey: groupCol, yKey: sortCol, chartType: intent.chartType };
            }

            // Fallback: raw row sort
            const cols = schema.columns.map(c => c.name).slice(0, 6);
            const sorted = [...data]
                .sort((a, b) => {
                    const av = Number(a[sortCol] ?? 0);
                    const bv = Number(b[sortCol] ?? 0);
                    return dir === "asc" ? av - bv : bv - av;
                })
                .slice(0, limit);
            return {
                data: sorted.map(r => {
                    const out: Record<string, string | number | null> = {};
                    cols.forEach(c => { out[c] = r[c] as string | number | null; });
                    return out;
                }),
                xKey: cols[0], yKey: sortCol, chartType: intent.chartType,
            };
        }

        case "trend": {
            const dateCol = resolveCol(intent.dateCol, schema.columns.filter(c => c.type === "date").map(c => c.name))
                ?? resolveCol(intent.dateCol)
                ?? schema.columns.find(c => c.type === "date")?.name
                ?? schema.columns.find(c => /date|time|day|month|year/i.test(c.name))?.name;

            if (!dateCol) throw new Error("No date column found for trend analysis.");

            const numericCols = schema.columns.filter(c => c.type === "number").map(c => c.name);
            const meaningfulNumCols = numericCols.filter(c => !/\bid\b|_id$/i.test(c));
            // Fuzzy-resolve requested cols, fall back to all meaningful numeric cols
            const requestedCols = intent.aggCols ?? (intent.aggCol ? [intent.aggCol] : []);
            const matched = requestedCols.map(c => resolveCol(c, numericCols)).filter(Boolean) as string[];
            const targetCols: string[] = matched.length > 0
                ? matched
                : meaningfulNumCols.length > 0 ? meaningfulNumCols : numericCols;
            const fn = intent.aggFn ?? "sum";
            const period = intent.datePeriod ?? "month";

            const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

            function bucketKey(raw: string | number | boolean | null): string | null {
                if (!raw) return null;
                const d = new Date(String(raw).trim());
                if (isNaN(d.getTime())) return null;
                const y = d.getFullYear(), m = d.getMonth();
                switch (period) {
                    case "day": return `${y}-${String(m + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                    case "week": {
                        const jan1 = new Date(y, 0, 1);
                        const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
                        return `${y}-W${String(week).padStart(2, "0")}`;
                    }
                    case "month": return `${MONTHS[m]} ${y}`;
                    case "quarter": return `${y} Q${Math.floor(m / 3) + 1}`;
                    case "year": return `${y}`;
                }
            }

            function sortKey(raw: string | number | boolean | null): string {
                if (!raw) return "";
                const d = new Date(String(raw).trim());
                if (isNaN(d.getTime())) return "";
                const y = d.getFullYear(), m = d.getMonth();
                switch (period) {
                    case "day": return `${y}-${String(m + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                    case "week": {
                        const jan1 = new Date(y, 0, 1);
                        const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
                        return `${y}-W${String(week).padStart(2, "0")}`;
                    }
                    case "month": return `${y}-${String(m + 1).padStart(2, "0")}`;
                    case "quarter": return `${y}-Q${Math.floor(m / 3) + 1}`;
                    case "year": return `${y}`;
                }
            }

            const bucketSums = new Map<string, Map<string, number>>();
            const bucketCounts = new Map<string, number>();
            const bucketSortKeys = new Map<string, string>();
            const bucketMins = new Map<string, Map<string, number>>();
            const bucketMaxs = new Map<string, Map<string, number>>();

            data.forEach(r => {
                const label = bucketKey(r[dateCol]);
                if (!label) return;
                bucketSortKeys.set(label, sortKey(r[dateCol]));
                bucketCounts.set(label, (bucketCounts.get(label) ?? 0) + 1);
                if (!bucketSums.has(label)) {
                    bucketSums.set(label, new Map());
                    bucketMins.set(label, new Map());
                    bucketMaxs.set(label, new Map());
                }
                const sums = bucketSums.get(label)!;
                const mins = bucketMins.get(label)!;
                const maxs = bucketMaxs.get(label)!;
                targetCols.forEach(col => {
                    const v = Number(r[col]);
                    if (isNaN(v)) return;
                    sums.set(col, (sums.get(col) ?? 0) + v);
                    mins.set(col, Math.min(mins.has(col) ? mins.get(col)! : Infinity, v));
                    maxs.set(col, Math.max(maxs.has(col) ? maxs.get(col)! : -Infinity, v));
                });
            });

            const revenueCol = targetCols.find(c => /revenue|sales|amount|turnover/i.test(c));
            const profitCol = targetCols.find(c => /profit|income|earnings/i.test(c));

            const result = Array.from(bucketSums.keys())
                .sort((a, b) => (bucketSortKeys.get(a) ?? "").localeCompare(bucketSortKeys.get(b) ?? ""))
                .map(label => {
                    const count = bucketCounts.get(label)!;
                    const sums = bucketSums.get(label)!;
                    const mins = bucketMins.get(label)!;
                    const maxs = bucketMaxs.get(label)!;
                    const row: Record<string, string | number | null> = { Month: label };
                    targetCols.forEach(col => {
                        const sum = sums.get(col) ?? 0;
                        let v: number;
                        switch (fn) {
                            case "sum": v = sum; break;
                            case "avg": v = count > 0 ? sum / count : 0; break;
                            case "min": v = mins.get(col) ?? 0; break;
                            case "max": v = maxs.get(col) ?? 0; break;
                            case "count": v = count; break;
                            default: v = sum;
                        }
                        row[col] = Math.round(v * 100) / 100;
                    });
                    if (revenueCol && profitCol && fn === "sum") {
                        const rawRev = sums.get(revenueCol) ?? 0;
                        const rawProfit = sums.get(profitCol) ?? 0;
                        row["Profit Margin"] = rawRev > 0
                            ? `${((rawProfit / rawRev) * 100).toFixed(2)}%`
                            : "0.00%";
                    }
                    return row;
                });

            const primaryY = targetCols[0] ?? "Count";
            return { data: result, xKey: "Month", yKey: primaryY, chartType: intent.chartType ?? "line" };
        }

        default:
            throw new Error(`Unknown operation: ${(intent as AIIntent).operation}`);
    }
}

function heuristicIntent(question: string, schema: DatasetSchema, data?: Row[]): AIIntent {
    const q = question.toLowerCase();
    const allCols = schema.columns.map(c => c.name);
    const numCols = schema.columns.filter(c => c.type === "number").map(c => c.name);
    const strCols = schema.columns.filter(c => c.type === "string").map(c => c.name);

    // Find mentioned columns (longest match first)
    const mentionedCols = allCols
        .filter(c => q.includes(c.toLowerCase()))
        .sort((a, b) => b.length - a.length);
    const mentionedStr = mentionedCols.find(c => strCols.includes(c)) || strCols[0];
    const mentionedNum = mentionedCols.find(c => numCols.includes(c)) || numCols[0];

    // Parse "Top N" limit early
    const topMatch = question.match(/top\s+(\d+)/i);
    const limit = topMatch ? parseInt(topMatch[1]) : undefined;

    // Check for grouping patterns
    const groupPattern = /\bwise\b|\bby\b|\bper\b|\beach\b|\bbreakdown\b|\bdistribution\b|\bshare\b/i;
    const byMatch = question.match(/\bby\s+(\w+)/i) || question.match(/\bper\s+(\w+)/i) || question.match(/\beach\s+(\w+)/i);
    const byCol = byMatch ? allCols.find(c => c.toLowerCase() === byMatch[1].toLowerCase()) : undefined;

    // **PRIORITY 0: Time-series trend detection**
    const trendPattern = /\btrend\b|\bover time\b|\bmonthly\b|\bweekly\b|\bdaily\b|\byearly\b|\bannual\b|\bquarterly\b|\bby month\b|\bby year\b|\bby quarter\b|\bby week\b|\bby day\b/i;
    const dateCols = schema.columns.filter(c => c.type === "date").map(c => c.name);
    const dateColFallback = schema.columns.find(c => /date|time|day|month|year/i.test(c.name))?.name;
    const dateCol = dateCols[0] ?? dateColFallback;

    if (trendPattern.test(q) && dateCol) {
        let datePeriod: AIIntent["datePeriod"] = "month";
        if (/\bdaily\b|\bby day\b/.test(q)) datePeriod = "day";
        else if (/\bweekly\b|\bby week\b/.test(q)) datePeriod = "week";
        else if (/\byearly\b|\bannual\b|\bby year\b/.test(q)) datePeriod = "year";
        else if (/\bquarterly\b|\bby quarter\b/.test(q)) datePeriod = "quarter";

        // Exclude ID-like columns — they're meaningless to sum
        const meaningfulNumCols = numCols.filter(c => !/\bid\b|_id$/i.test(c));
        const aggCols = meaningfulNumCols.length > 0 ? meaningfulNumCols : numCols;
        const primaryCol = (mentionedNum && aggCols.includes(mentionedNum))
            ? mentionedNum
            : aggCols[0];
        return { operation: "trend", aggFn: "sum", aggCol: primaryCol, aggCols, dateCol, datePeriod, chartType: "line" };
    }

    // **PRIORITY 1: ANY grouping pattern + any numeric + any string = aggregate_group**
    // This catches "Revenue by State", "Orders wise Region", etc.
    if (groupPattern.test(q) && mentionedNum && mentionedStr && !/how many|count/.test(q)) {
        const groupCol = byCol || mentionedStr || strCols[0];
        // Exclude ID-like columns from aggregation
        const meaningfulNumCols = numCols.filter(c => !/\bid\b|_id$/i.test(c));
        const aggCols = meaningfulNumCols.length > 0 ? meaningfulNumCols : numCols;
        const primaryCol = (mentionedNum && aggCols.includes(mentionedNum))
            ? mentionedNum
            : aggCols[0];
        return { operation: "aggregate_group", aggFn: "sum", aggCol: primaryCol, aggCols, groupCol, limit, chartType: "bar" };
    }

    // Numeric range: "age below 18", "age > 20"
    const belowMatch = question.match(/(\w+)\s+(?:below|less\s+than|under|<)\s+(\d+(?:\.\d+)?)/i);
    const aboveMatch = question.match(/(\w+)\s+(?:above|greater\s+than|over|more\s+than|>)\s+(\d+(?:\.\d+)?)/i);
    if (belowMatch) {
        const col = allCols.find(c => c.toLowerCase() === belowMatch[1].toLowerCase()) || mentionedNum || numCols[0];
        return { operation: "count_filter", filterCol: col, filterOp: "<", filterVal: Number(belowMatch[2]), chartType: "bar" };
    }
    if (aboveMatch) {
        const col = allCols.find(c => c.toLowerCase() === aboveMatch[1].toLowerCase()) || mentionedNum || numCols[0];
        return { operation: "count_filter", filterCol: col, filterOp: ">", filterVal: Number(aboveMatch[2]), chartType: "bar" };
    }

    // Aggregate: avg/sum/min/max patterns
    // (byMatch, byCol, groupPattern, limit already defined above)

    // "average of male and female" or "avg age by sex" → aggregate_group
    const hasGroupContext = byCol ||
        (strCols.some(c => q.includes(c.toLowerCase())) && /average|avg|mean|sum|total|min|max/.test(q));

    if (/average|avg|mean/.test(q)) {
        if (hasGroupContext) {
            const groupCol = byCol || mentionedStr || strCols[0];
            return { operation: "aggregate_group", aggFn: "avg", aggCol: mentionedNum || numCols[0], aggCols: [mentionedNum || numCols[0]], groupCol, limit, chartType: "bar" };
        }
        return { operation: "aggregate", aggFn: "avg", aggCol: mentionedNum || numCols[0], chartType: "bar" };
    }
    if (/\bsum\b|total/.test(q)) {
        if (hasGroupContext) {
            const groupCol = byCol || mentionedStr || strCols[0];
            return { operation: "aggregate_group", aggFn: "sum", aggCol: mentionedNum || numCols[0], aggCols: numCols, groupCol, limit, chartType: "bar" };
        }
        return { operation: "aggregate", aggFn: "sum", aggCol: mentionedNum || numCols[0], chartType: "bar" };
    }
    if (/\bmin\b|minimum|lowest/.test(q)) return { operation: "aggregate", aggFn: "min", aggCol: mentionedNum || numCols[0], chartType: "bar" };
    if (/\bmax\b|maximum|highest/.test(q)) return { operation: "aggregate", aggFn: "max", aggCol: mentionedNum || numCols[0], chartType: "bar" };

    // "how many X" — try to find a filter value
    if (/how many|count of|number of/.test(q)) {
        const stopWords = new Set(["how", "many", "are", "is", "the", "a", "an", "of", "in",
            "students", "people", "rows", "records", "entries", "have", "has", "from", "with",
            "there", "total", "all"]);

        // Map common words to actual data values
        const valueMap: Record<string, string> = {
            "female": "F", "females": "F", "women": "F", "woman": "F", "girl": "F", "girls": "F",
            "male": "M", "males": "M", "men": "M", "man": "M", "boy": "M", "boys": "M",
        };

        const words = question.split(/\s+/);
        const candidates = words
            .map(w => w.replace(/[^a-zA-Z0-9]/g, ""))
            .filter(w => w.length >= 1 && !stopWords.has(w.toLowerCase()) && !allCols.map(c => c.toLowerCase()).includes(w.toLowerCase()));

        if (candidates.length > 0) {
            const rawVal = candidates[0];
            const mappedVal = valueMap[rawVal.toLowerCase()] ?? rawVal;

            // Find which column actually contains this value in the data
            let targetCol = mentionedStr || strCols[0];
            if (data && data.length > 0) {
                const matchingCol = strCols.find(col =>
                    data.some(row => String(row[col] ?? "").toLowerCase() === mappedVal.toLowerCase())
                );
                if (matchingCol) targetCol = matchingCol;
            }

            return { operation: "count_filter", filterCol: targetCol, filterOp: "=", filterVal: mappedVal, chartType: "bar" };
        }
        return { operation: "aggregate", aggFn: "count", aggCol: allCols[0], chartType: "bar" };
    }

    // Distribution / group by
    return { operation: "count_group", groupCol: mentionedStr || strCols[0], chartType: "bar" };
}

async function generateSummary(question: string, result: Omit<QueryResult, "summary">): Promise<string> {
    const prompt = `Summarize in plain English, max 50 words. Be specific with numbers.
Question: "${question}"
Results: ${JSON.stringify(result.data.slice(0, 5))}
Total: ${result.data.length} rows`;

    // OpenAI
    if (OPENAI_API_KEY) {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
            body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 80, temperature: 0.3 }),
        });
        if (res.ok) return (await res.json()).choices[0].message.content.trim();
    }

    // Gemini
    if (GEMINI_API_KEY) {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }
        );
        if (res.ok) return (await res.json()).candidates[0].content.parts[0].text.trim();
    }

    // Groq fallback
    if (GROQ_API_KEY) {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [{ role: "user", content: prompt }],
                max_tokens: 80,
                temperature: 0.3,
            }),
        });
        if (res.ok) return (await res.json()).choices[0].message.content.trim();
    }

    if (result.data.length === 0) return "No matching data found.";
    const top = result.data[0];
    return `Found ${result.data.length.toLocaleString()} result(s). Top: ${Object.entries(top).map(([k, v]) => `${k}: ${v}`).join(", ")}.`;
}

export async function POST(req: NextRequest) {
    try {
        const { question, schema, data } = await req.json() as { question: string; schema: DatasetSchema; data: Row[] };
        if (!question?.trim()) return NextResponse.json({ error: "Question is required" }, { status: 400 });

        let intent: AIIntent;
        try {
            if (OPENAI_API_KEY || GEMINI_API_KEY || GROQ_API_KEY) {
                intent = await getIntent(question, schema, data);
            } else {
                intent = heuristicIntent(question, schema, data);
            }
        } catch (e) {
            console.error("[Intent error]", e);
            intent = heuristicIntent(question, schema, data);
        }

        const rawResult = executeIntent(intent, data, schema, question);
        console.log("[Result]", `${rawResult.data.length} rows, xKey=${rawResult.xKey}, yKey=${rawResult.yKey}`);

        const summary = await generateSummary(question, rawResult);
        return NextResponse.json({ ...rawResult, summary });
    } catch (err) {
        const message = err instanceof Error ? err.message : "An unexpected error occurred";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
