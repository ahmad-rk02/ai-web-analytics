"use client";
import type { DatasetSchema } from "../types";
import { Table, Hash, Calendar, Type } from "lucide-react";

interface Props {
    schema: DatasetSchema;
}

const typeIcon = {
    number: <Hash className="w-3 h-3" />,
    date: <Calendar className="w-3 h-3" />,
    string: <Type className="w-3 h-3" />,
    boolean: <Type className="w-3 h-3" />,
};

const typeColor = {
    number: "text-blue-400 bg-blue-950/50",
    date: "text-green-400 bg-green-950/50",
    string: "text-purple-400 bg-purple-950/50",
    boolean: "text-yellow-400 bg-yellow-950/50",
};

export default function DataPreview({ schema }: Props) {
    return (
        <div className="space-y-4 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-sm text-slate-400">
                <div className="flex items-center gap-2">
                    <Table className="w-4 h-4" />
                    <span>{schema.rowCount.toLocaleString()} rows · {schema.columns.length} columns</span>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1 text-xs text-slate-300">
                    <Hash className="w-3 h-3" />
                    Previewing first {schema.previewRows.length.toLocaleString()} rows
                </div>
            </div>

            {/* Column chips */}
            <div className="flex flex-wrap gap-2">
                {schema.columns.map((col) => (
                    <span
                        key={col.name}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${typeColor[col.type]}`}
                    >
                        {typeIcon[col.type]}
                        {col.name}
                    </span>
                ))}
            </div>

            {/* Preview table */}
            <div className="overflow-hidden rounded-xl border border-gray-800 min-w-0">
                <div className="max-h-[340px] overflow-y-auto overflow-x-auto">
                    <table className="min-w-full text-xs">
                        <thead className="sticky top-0 z-10 bg-gray-950">
                            <tr className="bg-gray-900 border-b border-gray-800">
                                {schema.columns.map((col) => (
                                    <th key={col.name} className="px-3 py-2 text-left text-gray-400 font-medium whitespace-nowrap">
                                        {col.name}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {schema.previewRows.map((row, i) => (
                                <tr key={i} className={i % 2 === 0 ? "bg-gray-950" : "bg-gray-900/40"}>
                                    {schema.columns.map((col) => (
                                        <td key={col.name} className="px-3 py-2 text-gray-300 whitespace-nowrap max-w-[160px] truncate">
                                            {row[col.name] === null || row[col.name] === undefined ? (
                                                <span className="text-gray-600 italic">null</span>
                                            ) : (
                                                String(row[col.name])
                                            )}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
