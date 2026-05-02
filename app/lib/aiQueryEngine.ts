import type { DatasetSchema, StructuredQuery, QueryResult } from "../types";

export async function processQuestion(
    question: string,
    schema: DatasetSchema,
    data: Record<string, string | number | boolean | null>[]
): Promise<QueryResult> {
    const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, schema, data }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `AI service error (${res.status})`);
    }

    return res.json() as Promise<QueryResult>;
}

export function buildHeuristicQuery(
    question: string,
    schema: DatasetSchema
): StructuredQuery {
    const q = question.toLowerCase().trim();
    const allCols = schema.columns.map((c) => c.name);
    const numericCols = schema.columns.filter((c) => c.type === "number").map((c) => c.name);
    const stringCols = schema.columns.filter((c) => c.type === "string").map((c) => c.name);
    const dateCols = schema.columns.filter((c) => c.type === "date").map((c) => c.name);

    const firstNum = numericCols[0] || schema.columns[0]?.name || "value";
    const firstStr = stringCols[0] || schema.columns[0]?.name || "label";
    const firstDate = dateCols[0] || firstStr;

    // --- Detect aggregation function ---
    let aggFn: "sum" | "avg" | "count" | "min" | "max" = "count";
    if (/average|avg|mean/.test(q)) aggFn = "avg";
    else if (/\bsum\b|total/.test(q)) aggFn = "sum";
    else if (/\bmin\b|lowest|least/.test(q)) aggFn = "min";
    else if (/\bmax\b|highest/.test(q)) aggFn = "max";
    else if (/count|how many|number of/.test(q)) aggFn = "count";

    // --- Detect chart type ---
    let chartType: "bar" | "line" | "pie" = "bar";
    if (/trend|over time|monthly|weekly|daily|timeline/.test(q)) chartType = "line";
    else if (/proportion|share|breakdown|distribution|percent/.test(q)) chartType = "pie";

    // --- Detect limit ---
    const topMatch = q.match(/top\s+(\d+)/);
    const limit = topMatch ? parseInt(topMatch[1]) : undefined;

    // --- Find all column names mentioned in question (longest first) ---
    const mentionedCols = allCols
        .filter((c) => q.includes(c.toLowerCase()))
        .sort((a, b) => b.length - a.length);

    // --- Detect filters ---
    const stopWords = new Set(["is", "are", "the", "a", "an", "of", "in", "for", "with",
        "how", "many", "show", "get", "count", "sum", "avg", "top", "and", "or",
        "where", "that", "have", "has", "been", "what", "which", "who", "there",
        "their", "them", "than", "then", "from", "by", "to", "at", "be", "do",
        "below", "above", "less", "greater", "more", "equal"]);

    const filters: StructuredQuery["filters"] = [];

    // Detect numeric range filters: "age below 18", "age > 20", "age less than 15"
    const numericPatterns: { re: RegExp; op: string }[] = [
        { re: /(\w+)\s+(?:below|less\s+than|under|<)\s+(\d+(?:\.\d+)?)/i, op: "<" },
        { re: /(\w+)\s+(?:above|greater\s+than|over|more\s+than|>)\s+(\d+(?:\.\d+)?)/i, op: ">" },
        { re: /(\w+)\s+(?:at\s+least|>=)\s+(\d+(?:\.\d+)?)/i, op: ">=" },
        { re: /(\w+)\s+(?:at\s+most|<=)\s+(\d+(?:\.\d+)?)/i, op: "<=" },
        { re: /(\w+)\s+(?:equals?|=|==)\s+(\d+(?:\.\d+)?)/i, op: "=" },
    ];

    for (const { re, op } of numericPatterns) {
        const m = question.match(re);
        if (m) {
            const colCandidate = m[1].toLowerCase();
            const matchedCol = allCols.find(c => c.toLowerCase() === colCandidate);
            if (matchedCol) {
                filters.push({ column: matchedCol, operator: op, value: Number(m[2]) });
            }
        }
    }

    // Detect string equality filters from remaining words
    const words = question.split(/\s+/);
    const potentialValues = words.filter(w => {
        const wl = w.toLowerCase().replace(/[^a-z0-9_]/g, "");
        return wl.length >= 1
            && !stopWords.has(wl)
            && !allCols.map(c => c.toLowerCase()).includes(wl)
            && isNaN(Number(wl)); // skip pure numbers — handled above
    });

    // For each potential value, find which column it most likely belongs to
    for (const val of potentialValues) {
        const valClean = val.replace(/[^a-zA-Z0-9_]/g, "");
        if (!valClean) continue;

        // Find the closest mentioned column to this value in the question
        // Prefer string columns since values are usually strings
        const targetCol = mentionedCols.find(c => stringCols.includes(c))
            || stringCols[0];

        if (targetCol && !filters.find(f => f.column === targetCol)) {
            filters.push({ column: targetCol, operator: "=", value: valClean });
        }
    }

    const groupingKeywords = /\bwise\b|\bby\b|\bper\b|\beach\b|\bbreakdown\b|\bdistribution\b|\bshare\b/i;

    // --- Detect groupBy ---
    // If we have filters, don't group by the filtered column
    const filterCols = new Set(filters.map(f => f.column));

    let groupBy: string | undefined;

    // "how many X" with a filter = just count, no groupBy needed
    const isSimpleCount = /how many|count/.test(q) && filters.length > 0;

    if (!isSimpleCount) {
        // Find a groupBy column: mentioned string col not in filters
        groupBy = mentionedCols.find(c => stringCols.includes(c) && !filterCols.has(c));
        if (!groupBy && /trend|over time|monthly/.test(q)) groupBy = firstDate;
        if (!groupBy && !filters.length) groupBy = firstStr;
    }

    if (groupBy && aggFn === "count" && numericCols.some((col) => q.includes(col.toLowerCase())) && groupingKeywords.test(q)) {
        aggFn = "sum";
    }

    // --- Detect aggCol ---
    const aggCol = mentionedCols.find(c => numericCols.includes(c)) || firstNum;

    return {
        type: filters.length > 0 ? "filter" : limit ? "ranking" : chartType === "line" ? "trend" : "aggregation",
        columns: groupBy ? [groupBy, aggCol] : [aggCol],
        aggregation: { function: aggFn, column: aggCol },
        filters: filters.length > 0 ? filters : undefined,
        groupBy,
        orderBy: limit ? { column: aggCol, direction: "desc" } : undefined,
        limit,
        chartType,
    };
}
