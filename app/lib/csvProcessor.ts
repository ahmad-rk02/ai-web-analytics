import Papa from "papaparse";
import type { ColumnSchema, ColumnType, DatasetSchema } from "../types";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

function normalizeNumberString(value: string): string {
    return value
        .trim()
        .replace(/\$/g, "")
        .replace(/,/g, "")
        .replace(/%/g, "")
        .replace(/\((.*)\)/, "-$1");
}

function detectType(values: (string | null | undefined)[]): ColumnType {
    const nonEmpty = values.filter((v) => v !== null && v !== undefined && v !== "");
    if (nonEmpty.length === 0) return "string";

    const dateRe = /^\d{4}-\d{2}-\d{2}|^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/;
    const numericCount = nonEmpty.filter((v) => {
        const normalized = normalizeNumberString(String(v));
        return normalized !== "" && !isNaN(Number(normalized));
    }).length;
    const dateCount = nonEmpty.filter((v) => dateRe.test(v as string)).length;

    if (numericCount / nonEmpty.length > 0.9) return "number";
    if (dateCount / nonEmpty.length > 0.8) return "date";
    return "string";
}

export function validateFileSize(file: File): void {
    if (file.size > MAX_FILE_SIZE) {
        throw new Error("File exceeds the 50 MB size limit. Please upload a smaller file.");
    }
}

export function parseCSV(file: File): Promise<{
    dataset: Record<string, string | number | boolean | null>[];
    schema: DatasetSchema;
}> {
    return new Promise((resolve, reject) => {
        Papa.parse(file as any, {
            header: true,
            skipEmptyLines: true,
            complete(results) {
                // Only fail on Delimiter errors; ignore quote/field mismatch warnings
                const criticalErrors = results.errors.filter(
                    (e) => e.type === "Delimiter"
                );
                if (criticalErrors.length > 0) {
                    reject(new Error(`CSV parsing failed: ${criticalErrors[0].message}`));
                    return;
                }

                const raw = results.data as Record<string, string>[];
                if (raw.length === 0) {
                    reject(new Error("The CSV file is empty or has no data rows."));
                    return;
                }

                const columnNames = Object.keys(raw[0]);
                const columns: ColumnSchema[] = columnNames.map((name) => ({
                    name,
                    type: detectType(raw.map((row) => row[name])),
                }));

                // Cast values to detected types
                const dataset = raw.map((row) => {
                    const typed: Record<string, string | number | boolean | null> = {};
                    columns.forEach(({ name, type }) => {
                        const val = row[name];
                        if (val === "" || val === undefined || val === null) {
                            typed[name] = null;
                        } else if (type === "number") {
                            const cleaned = normalizeNumberString(String(val));
                            typed[name] = Number(cleaned);
                        } else {
                            typed[name] = val;
                        }
                    });
                    return typed;
                });

                const schema: DatasetSchema = {
                    columns,
                    rowCount: dataset.length,
                    previewRows: dataset.slice(0, 100),
                };

                resolve({ dataset, schema });
            },
            error(err) {
                reject(new Error(`Failed to read file: ${err.message}`));
            },
        });
    });
}
