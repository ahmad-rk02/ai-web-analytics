export type ColumnType = "string" | "number" | "date" | "boolean";

export interface ColumnSchema {
    name: string;
    type: ColumnType;
}

export interface DatasetSchema {
    columns: ColumnSchema[];
    rowCount: number;
    previewRows: Record<string, string | number | boolean | null>[];
}

export type ChartType = "bar" | "line" | "pie";

export interface StructuredQuery {
    type: "aggregation" | "filter" | "ranking" | "trend" | "raw";
    columns: string[];
    aggregation?: { function: "sum" | "avg" | "count" | "min" | "max"; column: string };
    filters?: { column: string; operator: string; value: string | number }[];
    groupBy?: string;
    orderBy?: { column: string; direction: "asc" | "desc" };
    limit?: number;
    chartType: ChartType;
}

export interface QueryResult {
    data: Record<string, string | number | null>[];
    chartType: ChartType;
    xKey: string;
    yKey: string;
    summary: string;
}

export interface Insight {
    id: string;
    question: string;
    result: QueryResult;
    timestamp: Date;
}

export interface Session {
    dataset: Record<string, string | number | boolean | null>[];
    schema: DatasetSchema;
    fileName: string;
}

export interface AppError {
    message: string;
    type: "upload" | "parse" | "ai" | "query" | "network";
}
