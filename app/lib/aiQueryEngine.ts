import type { DatasetSchema, QueryResult } from "../types";
import type { AIIntent } from "../api/analyze/route";

type Row = Record<string, string | number | boolean | null>;

// ─── Column resolver ──────────────────────────────────────────────────────────
function resolveCol(name: string | undefined, pool: string[]): string | undefined {
    if (!name) return undefined;
    if (pool.includes(name)) return name;
    const lower = name.toLowerCase();
    return pool.find(c => c.toLowerCase() === lower)
        ?? pool.find(c => c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase()));
}

// ─── Execute intent against local data ───────────────────────────────────────
export function executeIntent(
    intent: AIIntent,
    data: Row[],
    schema: DatasetSchema,
    question = ""
): Omit<QueryResult, "summary"> {
    const allColNames = schema.columns.map(c => c.name);
    const resolve = (name: string | undefined, pool = allColNames) => resolveCol(name, pool);

    const cellVal = (cell: string | number | boolean | null) =>
        typeof cell === "string" ? cell.toLowerCase().trim() : cell;
    const caseVal = (v: string | number) =>
        typeof v === "string" ? v.toLowerCase().trim() : v;

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

    const numericCols = schema.columns.filter(c => c.type === "number").map(c => c.name);
    const strCols = schema.columns.filter(c => c.type === "string").map(c => c.name);
    const meaningful = numericCols.filter(c => !/\bid\b|_id$/i.test(c));

    const revenueCol = (cols: string[]) => cols.find(c => /revenue|sales|amount|turnover/i.test(c));
    const profitCol = (cols: string[]) => cols.find(c => /profit|income|earnings/i.test(c));

    const addMargin = (row: Record<string, string | number | null>, sums: Map<string, number>, cols: string[]) => {
        const rc = revenueCol(cols), pc = profitCol(cols);
        if (rc && pc) {
            const rev = sums.get(rc) ?? 0, prof = sums.get(pc) ?? 0;
            row["Profit Margin"] = rev > 0 ? `${((prof / rev) * 100).toFixed(2)}%` : "0.00%";
        }
    };

    switch (intent.operation) {

        case "count_filter": {
            const filtered = data.filter(matchFilter);
            return {
                data: [{ Category: `${intent.filterCol}=${intent.filterVal}`, Count: filtered.length }],
                xKey: "Category", yKey: "Count", chartType: intent.chartType,
            };
        }

        case "count_group": {
            const col = resolve(intent.groupCol, strCols) ?? strCols[0];
            const groups = new Map<string, number>();
            data.forEach(r => { const k = String(r[col] ?? "Unknown"); groups.set(k, (groups.get(k) ?? 0) + 1); });
            const result = Array.from(groups.entries()).map(([k, v]) => ({ [col]: k, Count: v })).sort((a, b) => b.Count - a.Count);
            return { data: result, xKey: col, yKey: "Count", chartType: intent.chartType };
        }

        case "aggregate": {
            const col = resolve(intent.aggCol, numericCols) ?? numericCols[0];
            const fn = intent.aggFn ?? "count";
            let sum = 0, count = 0, min = Infinity, max = -Infinity;
            data.forEach(r => {
                const v = Number(r[col]); if (isNaN(v)) return;
                sum += v; count++;
                if (v < min) min = v; if (v > max) max = v;
            });
            let val: number;
            switch (fn) {
                case "avg": val = count > 0 ? sum / count : 0; break;
                case "sum": val = sum; break;
                case "min": val = min === Infinity ? 0 : min; break;
                case "max": val = max === -Infinity ? 0 : max; break;
                default: val = count;
            }
            return {
                data: [{ Metric: `${fn.toUpperCase()} of ${col}`, Value: Math.round(val * 100) / 100 }],
                xKey: "Metric", yKey: "Value", chartType: intent.chartType,
            };
        }

        case "aggregate_group": {
            const groupCol = resolve(intent.groupCol, strCols) ?? resolve(intent.groupCol) ?? strCols[0];
            const fn = intent.aggFn ?? "sum";
            const requested = intent.aggCols ?? (intent.aggCol ? [intent.aggCol] : []);
            const matchedCols = requested.map(c => resolve(c, numericCols)).filter(Boolean) as string[];
            const targetCols = matchedCols.length > 0 ? matchedCols : meaningful.length > 0 ? meaningful : numericCols;
            const primaryCol = (intent.aggCol && targetCols.includes(intent.aggCol)) ? intent.aggCol : targetCols[0];

            const counts = new Map<string, number>();
            const sums = new Map<string, Map<string, number>>();
            const mins = new Map<string, Map<string, number>>();
            const maxs = new Map<string, Map<string, number>>();

            data.forEach(r => {
                const k = String(r[groupCol] ?? "Unknown");
                counts.set(k, (counts.get(k) ?? 0) + 1);
                if (!sums.has(k)) { sums.set(k, new Map()); mins.set(k, new Map()); maxs.set(k, new Map()); }
                const s = sums.get(k)!, mn = mins.get(k)!, mx = maxs.get(k)!;
                targetCols.forEach(col => {
                    const v = Number(r[col]); if (isNaN(v)) return;
                    s.set(col, (s.get(col) ?? 0) + v);
                    mn.set(col, Math.min(mn.has(col) ? mn.get(col)! : Infinity, v));
                    mx.set(col, Math.max(mx.has(col) ? mx.get(col)! : -Infinity, v));
                });
            });

            const result = Array.from(counts.keys()).map(k => {
                const cnt = counts.get(k)!, s = sums.get(k)!, mn = mins.get(k)!, mx = maxs.get(k)!;
                const row: Record<string, string | number | null> = { [groupCol]: k, Orders: cnt };
                targetCols.forEach(col => {
                    const sum = s.get(col) ?? 0;
                    let v: number;
                    switch (fn) {
                        case "sum": v = sum; break;
                        case "avg": v = cnt > 0 ? sum / cnt : 0; break;
                        case "min": v = mn.get(col) ?? 0; break;
                        case "max": v = mx.get(col) ?? 0; break;
                        default: v = sum;
                    }
                    row[col] = Math.round(v * 100) / 100;
                });
                addMargin(row, s, targetCols);
                return row;
            }).sort((a, b) => Number(b[primaryCol] ?? 0) - Number(a[primaryCol] ?? 0));

            return { data: result, xKey: groupCol, yKey: primaryCol, chartType: intent.chartType };
        }

        case "filter_rows": {
            const filtered = data.filter(matchFilter);
            const cols = schema.columns.map(c => c.name).slice(0, 5);
            return {
                data: filtered.slice(0, 500).map(r => {
                    const out: Record<string, string | number | null> = {};
                    cols.forEach(c => { out[c] = r[c] as string | number | null; });
                    return out;
                }),
                xKey: cols[0], yKey: cols[1] || cols[0], chartType: intent.chartType,
            };
        }

        case "top_n": {
            const limit = intent.limit ?? 10;
            const dir = intent.sortDir ?? "desc";
            const sortCol = resolve(intent.sortCol, numericCols)
                ?? resolve(intent.sortCol)
                ?? meaningful[0] ?? numericCols[0];
            const isNumericSort = numericCols.includes(sortCol);

            if (isNumericSort && strCols.length > 0) {
                const q = question.toLowerCase();
                const entityCol = strCols.find(c => {
                    const cl = c.toLowerCase().replace(/[_\s]/g, "");
                    return q.includes(cl) || q.includes(cl.replace(/s$/, "")) || q.includes(cl + "s");
                });
                const groupCol = resolve(intent.groupCol, strCols)
                    ?? entityCol
                    ?? strCols.find(c => /product|item|category|brand|title|sku/i.test(c))
                    ?? strCols.find(c => !/customer|client|user|name|id$/i.test(c))
                    ?? strCols[0];

                const sums = new Map<string, Map<string, number>>();
                const counts = new Map<string, number>();
                data.forEach(r => {
                    const k = String(r[groupCol] ?? "Unknown");
                    counts.set(k, (counts.get(k) ?? 0) + 1);
                    if (!sums.has(k)) sums.set(k, new Map());
                    const s = sums.get(k)!;
                    meaningful.forEach(col => {
                        const v = Number(r[col]); if (!isNaN(v)) s.set(col, (s.get(col) ?? 0) + v);
                    });
                });

                const result = Array.from(sums.entries()).map(([k, s]) => {
                    const row: Record<string, string | number | null> = { [groupCol]: k };
                    meaningful.forEach(col => { row[col] = Math.round((s.get(col) ?? 0) * 100) / 100; });
                    addMargin(row, s, meaningful);
                    return row;
                }).sort((a, b) => {
                    const av = Number(a[sortCol] ?? 0), bv = Number(b[sortCol] ?? 0);
                    return dir === "asc" ? av - bv : bv - av;
                }).slice(0, limit);

                return { data: result, xKey: groupCol, yKey: sortCol, chartType: intent.chartType };
            }

            const cols = schema.columns.map(c => c.name).slice(0, 6);
            const sorted = [...data].sort((a, b) => {
                const av = Number(a[sortCol] ?? 0), bv = Number(b[sortCol] ?? 0);
                return dir === "asc" ? av - bv : bv - av;
            }).slice(0, limit);
            return {
                data: sorted.map(r => { const out: Record<string, string | number | null> = {}; cols.forEach(c => { out[c] = r[c] as string | number | null; }); return out; }),
                xKey: cols[0], yKey: sortCol, chartType: intent.chartType,
            };
        }

        case "trend": {
            const dateCol = resolve(intent.dateCol, schema.columns.filter(c => c.type === "date").map(c => c.name))
                ?? resolve(intent.dateCol)
                ?? schema.columns.find(c => c.type === "date")?.name
                ?? schema.columns.find(c => /date|time|day|month|year/i.test(c.name))?.name;
            if (!dateCol) throw new Error("No date column found for trend analysis.");

            const requested = intent.aggCols ?? (intent.aggCol ? [intent.aggCol] : []);
            const matchedCols = requested.map(c => resolve(c, numericCols)).filter(Boolean) as string[];
            const targetCols = matchedCols.length > 0 ? matchedCols : meaningful.length > 0 ? meaningful : numericCols;
            const fn = intent.aggFn ?? "sum";
            const period = intent.datePeriod ?? "month";
            const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

            const bucketKey = (raw: string | number | boolean | null): string | null => {
                if (!raw) return null;
                const d = new Date(String(raw).trim());
                if (isNaN(d.getTime())) return null;
                const y = d.getFullYear(), m = d.getMonth();
                switch (period) {
                    case "day": return `${y}-${String(m + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                    case "week": { const j = new Date(y, 0, 1); const w = Math.ceil(((d.getTime() - j.getTime()) / 86400000 + j.getDay() + 1) / 7); return `${y}-W${String(w).padStart(2, "0")}`; }
                    case "month": return `${MONTHS[m]} ${y}`;
                    case "quarter": return `${y} Q${Math.floor(m / 3) + 1}`;
                    case "year": return `${y}`;
                }
            };
            const sortKey = (raw: string | number | boolean | null): string => {
                if (!raw) return "";
                const d = new Date(String(raw).trim());
                if (isNaN(d.getTime())) return "";
                const y = d.getFullYear(), m = d.getMonth();
                switch (period) {
                    case "day": return `${y}-${String(m + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                    case "week": { const j = new Date(y, 0, 1); const w = Math.ceil(((d.getTime() - j.getTime()) / 86400000 + j.getDay() + 1) / 7); return `${y}-W${String(w).padStart(2, "0")}`; }
                    case "month": return `${y}-${String(m + 1).padStart(2, "0")}`;
                    case "quarter": return `${y}-Q${Math.floor(m / 3) + 1}`;
                    case "year": return `${y}`;
                }
            };

            const bSums = new Map<string, Map<string, number>>();
            const bCounts = new Map<string, number>();
            const bSortK = new Map<string, string>();
            const bMins = new Map<string, Map<string, number>>();
            const bMaxs = new Map<string, Map<string, number>>();

            data.forEach(r => {
                const label = bucketKey(r[dateCol]); if (!label) return;
                bSortK.set(label, sortKey(r[dateCol]));
                bCounts.set(label, (bCounts.get(label) ?? 0) + 1);
                if (!bSums.has(label)) { bSums.set(label, new Map()); bMins.set(label, new Map()); bMaxs.set(label, new Map()); }
                const s = bSums.get(label)!, mn = bMins.get(label)!, mx = bMaxs.get(label)!;
                targetCols.forEach(col => {
                    const v = Number(r[col]); if (isNaN(v)) return;
                    s.set(col, (s.get(col) ?? 0) + v);
                    mn.set(col, Math.min(mn.has(col) ? mn.get(col)! : Infinity, v));
                    mx.set(col, Math.max(mx.has(col) ? mx.get(col)! : -Infinity, v));
                });
            });

            const result = Array.from(bSums.keys())
                .sort((a, b) => (bSortK.get(a) ?? "").localeCompare(bSortK.get(b) ?? ""))
                .map(label => {
                    const cnt = bCounts.get(label)!, s = bSums.get(label)!, mn = bMins.get(label)!, mx = bMaxs.get(label)!;
                    const row: Record<string, string | number | null> = { Month: label };
                    targetCols.forEach(col => {
                        const sum = s.get(col) ?? 0;
                        let v: number;
                        switch (fn) {
                            case "sum": v = sum; break;
                            case "avg": v = cnt > 0 ? sum / cnt : 0; break;
                            case "min": v = mn.get(col) ?? 0; break;
                            case "max": v = mx.get(col) ?? 0; break;
                            default: v = sum;
                        }
                        row[col] = Math.round(v * 100) / 100;
                    });
                    addMargin(row, s, targetCols);
                    return row;
                });

            return { data: result, xKey: "Month", yKey: targetCols[0] ?? "Count", chartType: intent.chartType ?? "line" };
        }

        default:
            throw new Error(`Unknown operation: ${(intent as AIIntent).operation}`);
    }
}

// ─── Main entry point ─────────────────────────────────────────────────────────
export async function processQuestion(
    question: string,
    schema: DatasetSchema,
    data: Row[]
): Promise<QueryResult> {
    // Step 1: get intent from API (schema only — no data sent)
    const intentRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, schema }),
    });
    if (!intentRes.ok) {
        const err = await intentRes.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `AI service error (${intentRes.status})`);
    }
    const intent = await intentRes.json() as AIIntent;

    // Step 2: execute intent locally against full dataset (never leaves browser)
    const rawResult = executeIntent(intent, data, schema, question);

    // Step 3: get AI summary (send only top-5 rows, not full data)
    let summary = "";
    try {
        const sumRes = await fetch("/api/summarize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question, data: rawResult.data.slice(0, 5), total: rawResult.data.length }),
        });
        if (sumRes.ok) summary = (await sumRes.json()).summary ?? "";
    } catch { /* summary is optional */ }

    return { ...rawResult, summary };
}
