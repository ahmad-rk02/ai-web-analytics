import type { StructuredQuery, QueryResult } from "../types";

type Row = Record<string, string | number | boolean | null>;

function applyFilters(data: Row[], filters: StructuredQuery["filters"]): Row[] {
    if (!filters || filters.length === 0) return data;
    return data.filter((row) =>
        filters!.every(({ column, operator, value }) => {
            const cell = row[column];
            if (cell === null || cell === undefined) return false;

            // For numeric comparisons, always use Number()
            const cellNum = Number(cell);
            const valNum = Number(value);
            const bothNumeric = !isNaN(cellNum) && !isNaN(valNum);

            const cellStr = String(cell).toLowerCase().trim();
            const valStr = String(value).toLowerCase().trim();

            switch (operator) {
                case "=": case "==":
                    // Try numeric equality first, then string
                    return bothNumeric ? cellNum === valNum : cellStr === valStr;
                case "!=":
                    return bothNumeric ? cellNum !== valNum : cellStr !== valStr;
                case ">":
                    return bothNumeric ? cellNum > valNum : cellStr > valStr;
                case ">=":
                    return bothNumeric ? cellNum >= valNum : cellStr >= valStr;
                case "<":
                    return bothNumeric ? cellNum < valNum : cellStr < valStr;
                case "<=":
                    return bothNumeric ? cellNum <= valNum : cellStr <= valStr;
                case "contains":
                    return cellStr.includes(valStr);
                default:
                    return true;
            }
        })
    );
}

function aggregateValues(values: number[], fn: string): number {
    if (values.length === 0) return 0;
    switch (fn) {
        case "sum": return values.reduce((a, b) => a + b, 0);
        case "avg": return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
        case "count": return values.length;
        case "min": return Math.min(...values);
        case "max": return Math.max(...values);
        default: return 0;
    }
}

function autoAggregate(data: Row[], xKey: string, yKey: string): Row[] {
    // Check if yKey is numeric in the data
    const isNumericY = data.some(r => typeof r[yKey] === "number" && !isNaN(r[yKey] as number));
    const groups = new Map<string, number>();
    data.forEach((row) => {
        const key = String(row[xKey] ?? "Unknown");
        // If yKey is numeric, sum it; otherwise count rows
        const val = isNumericY ? Number(row[yKey] ?? 0) : 1;
        groups.set(key, (groups.get(key) ?? 0) + (isNaN(val) ? 1 : val));
    });
    const outYKey = isNumericY ? yKey : "Count";
    return Array.from(groups.entries())
        .map(([k, v]) => ({ [xKey]: k, [outYKey]: Math.round(v * 100) / 100 }))
        .sort((a, b) => (b[outYKey] as number) - (a[outYKey] as number));
}

export function executeQuery(dataset: Row[], query: StructuredQuery): QueryResult {
    if (dataset.length === 0) {
        return { data: [], chartType: query.chartType, xKey: "label", yKey: "value", summary: "" };
    }

    const available = Object.keys(dataset[0]);

    // Validate columns — skip missing ones gracefully
    const validColumns = query.columns.filter((c) => available.includes(c));
    if (validColumns.length === 0) {
        throw new Error(`None of the requested columns found. Available: ${available.join(", ")}`);
    }

    const validGroupBy = query.groupBy && available.includes(query.groupBy) ? query.groupBy : undefined;

    // Apply filters
    const filtered = applyFilters(dataset, query.filters);

    let resultData: Row[] = [];
    let xKey: string;
    let yKey: string;

    if (validGroupBy && query.aggregation) {
        // GROUP BY + aggregate
        xKey = validGroupBy;
        // For count, always use "Count" as yKey — never a column name
        const aggFn = query.aggregation.function;
        yKey = aggFn === "count" ? "Count" : (available.includes(query.aggregation.column) ? query.aggregation.column : "Count");

        const groups = new Map<string, number[]>();
        filtered.forEach((row) => {
            const key = String(row[validGroupBy] ?? "Unknown");
            const val = aggFn === "count" ? 1 : Number(row[query.aggregation!.column] ?? 0);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(isNaN(val) ? 0 : val);
        });

        resultData = Array.from(groups.entries()).map(([k, vals]) => ({
            [xKey]: k,
            [yKey]: aggregateValues(vals, aggFn),
        }));

        resultData.sort((a, b) => Number(b[yKey] ?? 0) - Number(a[yKey] ?? 0));

    } else if (query.aggregation && !validGroupBy) {
        // Single aggregate — e.g. "average age", "how many GT3"
        xKey = "Metric";
        yKey = "Value";

        const aggFn = query.aggregation.function;
        const aggColName = query.aggregation.column;
        const aggCol = available.includes(aggColName) ? aggColName : null;

        let aggValue: number;
        if (aggFn === "count") {
            aggValue = filtered.length;
            yKey = "Count";
        } else if (aggCol) {
            const vals = filtered.map((r) => Number(r[aggCol] ?? 0)).filter((v) => !isNaN(v));
            aggValue = aggregateValues(vals, aggFn);
            yKey = aggFn === "avg" ? `Avg ${aggColName}` : aggFn === "sum" ? `Total ${aggColName}` : `${aggFn} ${aggColName}`;
        } else {
            aggValue = filtered.length;
            yKey = "Count";
        }

        // Label: use filter values if present, else the metric name
        const filterLabel = query.filters && query.filters.length > 0
            ? query.filters.map(f => `${f.column}="${f.value}"`).join(" & ")
            : aggFn === "count" ? "Total" : aggColName;
        resultData = [{ [xKey]: filterLabel, [yKey]: aggValue }];
    } else {
        // Raw filtered rows
        const cols = validColumns.length >= 2 ? validColumns : available.slice(0, 2);
        xKey = cols[0];
        yKey = cols[1] || cols[0];

        const rawData = filtered.map((row) => {
            const out: Row = {};
            cols.forEach((c) => { out[c] = row[c]; });
            return out;
        });

        if (rawData.length > 20) {
            const aggregated = autoAggregate(rawData, xKey, yKey);
            // autoAggregate may rename yKey to "Count" for non-numeric
            if (aggregated.length > 0) {
                const aggKeys = Object.keys(aggregated[0]);
                yKey = aggKeys.find(k => k !== xKey) ?? yKey;
            }
            resultData = aggregated;
        } else {
            resultData = rawData;
        }
    }

    // Apply orderBy
    if (query.orderBy && available.includes(query.orderBy.column)) {
        const { column, direction } = query.orderBy;
        resultData.sort((a, b) => {
            const av = a[column] ?? 0;
            const bv = b[column] ?? 0;
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return direction === "desc" ? -cmp : cmp;
        });
    }

    // Apply limit
    if (query.limit) {
        resultData = resultData.slice(0, query.limit);
    }

    return {
        data: resultData as Record<string, string | number | null>[],
        chartType: query.chartType,
        xKey,
        yKey,
        summary: "",
    };
}
