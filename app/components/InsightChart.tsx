"use client";
import { useState } from "react";
import {
    BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { QueryResult, ChartType } from "../types";
import { BarChart2, TrendingUp, PieChart as PieIcon, Table } from "lucide-react";

const COLORS = ["#6366f1", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#84cc16"];
const MAX_PIE_SLICES = 7;
const MAX_CHART = 20;
const PAGE_SIZE = 15;

type ViewType = ChartType | "table";

interface Props { result: QueryResult; }

function fmt(v: string | number | null | undefined): string {
    if (v === null || v === undefined) return "—";
    if (typeof v === "number") {
        if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
        if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
        return v.toLocaleString();
    }
    return String(v);
}

function trunc(v: unknown, max = 14): string {
    const s = String(v ?? "");
    return s.length > max ? s.slice(0, max) + "…" : s;
}

function buildPieData(data: Record<string, string | number | null>[], xKey: string, yKey: string) {
    const sorted = [...data].sort((a, b) => Number(b[yKey] ?? 0) - Number(a[yKey] ?? 0));
    if (sorted.length <= MAX_PIE_SLICES) return sorted;
    const top = sorted.slice(0, MAX_PIE_SLICES - 1);
    const rest = sorted.slice(MAX_PIE_SLICES - 1).reduce((s, r) => s + Number(r[yKey] ?? 0), 0);
    return [...top, { [xKey]: "Others", [yKey]: Math.round(rest * 100) / 100 }];
}

export default function InsightChart({ result }: Props) {
    const [view, setView] = useState<ViewType>(result.chartType);
    const [page, setPage] = useState(0);

    if (result.data.length === 0) {
        return <div className="flex items-center justify-center h-40 text-gray-500 text-sm">No results found.</div>;
    }

    const chartData = result.data.slice(0, MAX_CHART);
    const pieData = buildPieData(result.data, result.xKey, result.yKey);
    const totalPages = Math.ceil(result.data.length / PAGE_SIZE);
    const tableRows = result.data.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const columns = Object.keys(result.data[0] ?? {});

    const tt = {
        contentStyle: { background: "#111827", border: "1px solid #374151", borderRadius: 8, fontSize: 12 },
        labelStyle: { color: "#e5e7eb" },
        itemStyle: { color: "#a5b4fc" },
    };

    const views: { type: ViewType; icon: React.ReactNode; label: string }[] = [
        { type: "bar", icon: <BarChart2 className="w-3.5 h-3.5" />, label: "Bar" },
        { type: "line", icon: <TrendingUp className="w-3.5 h-3.5" />, label: "Line" },
        { type: "pie", icon: <PieIcon className="w-3.5 h-3.5" />, label: "Pie" },
        { type: "table", icon: <Table className="w-3.5 h-3.5" />, label: "Table" },
    ];

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex gap-1">
                    {views.map(({ type, icon, label }) => (
                        <button key={type} onClick={() => { setView(type); setPage(0); }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${view === type ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"}`}>
                            {icon} {label}
                        </button>
                    ))}
                </div>
                <span className="text-xs text-gray-500">
                    {result.data.length.toLocaleString()} results
                    {(view === "bar" || view === "line") && result.data.length > MAX_CHART ? ` · top ${MAX_CHART} shown` : ""}
                    {view === "pie" ? ` · top ${MAX_PIE_SLICES - 1} + others` : ""}
                </span>
            </div>

            {view === "table" ? (
                <div className="space-y-2">
                    <div className="overflow-x-auto rounded-xl border border-gray-800">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="bg-gray-900 border-b border-gray-800">
                                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-8">#</th>
                                    {columns.map((c) => (
                                        <th key={c} className="px-3 py-2 text-left text-gray-400 font-medium whitespace-nowrap">{c}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {tableRows.map((row, i) => (
                                    <tr key={i} className={i % 2 === 0 ? "bg-gray-950" : "bg-gray-900/40"}>
                                        <td className="px-3 py-2 text-gray-600">{page * PAGE_SIZE + i + 1}</td>
                                        {columns.map((c) => (
                                            <td key={c} className="px-3 py-2 text-gray-300 whitespace-nowrap">
                                                {row[c] === null || row[c] === undefined
                                                    ? <span className="text-gray-600 italic">null</span>
                                                    : typeof row[c] === "number"
                                                        ? (row[c] as number).toLocaleString()
                                                        : String(row[c])}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between text-xs text-gray-500">
                            <span>Page {page + 1} / {totalPages} · {result.data.length.toLocaleString()} rows</span>
                            <div className="flex gap-1">
                                {[["«", 0], ["‹", page - 1], ["›", page + 1], ["»", totalPages - 1]].map(([label, target]) => (
                                    <button key={label as string}
                                        onClick={() => setPage(Number(target))}
                                        disabled={Number(target) < 0 || Number(target) >= totalPages || Number(target) === page}
                                        className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30">
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="h-80 w-full" style={{ minWidth: 0 }}>
                    <ResponsiveContainer width="100%" height={320} minWidth={0}>
                        {view === "bar" ? (
                            <BarChart data={chartData} margin={{ top: 8, right: 20, bottom: 72, left: 10 }} barCategoryGap="35%">
                                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                                <XAxis dataKey={result.xKey} tick={{ fill: "#9ca3af", fontSize: 11 }}
                                    tickFormatter={(v) => trunc(v, 12)} angle={-40} textAnchor="end" interval={0} height={72} />
                                <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} tickFormatter={fmt} width={60} axisLine={false} tickLine={false} />
                                <Tooltip {...tt} formatter={(v) => [fmt(v as number), result.yKey]} labelFormatter={String} />
                                <Bar dataKey={result.yKey} radius={[6, 6, 0, 0]} maxBarSize={56}>
                                    {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                                </Bar>
                            </BarChart>
                        ) : view === "line" ? (
                            <LineChart data={chartData} margin={{ top: 8, right: 20, bottom: 72, left: 10 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                                <XAxis dataKey={result.xKey} tick={{ fill: "#9ca3af", fontSize: 11 }}
                                    tickFormatter={(v) => trunc(v, 12)} angle={-40} textAnchor="end" interval={0} height={72} />
                                <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} tickFormatter={fmt} width={60} axisLine={false} tickLine={false} />
                                <Tooltip {...tt} formatter={(v) => [fmt(v as number), result.yKey]} labelFormatter={String} />
                                <Line type="monotone" dataKey={result.yKey} stroke="#6366f1" strokeWidth={2.5}
                                    dot={{ fill: "#6366f1", r: 4, strokeWidth: 0 }} activeDot={{ r: 6, fill: "#a5b4fc" }} />
                            </LineChart>
                        ) : (
                            <PieChart>
                                <Pie data={pieData} dataKey={result.yKey} nameKey={result.xKey}
                                    cx="50%" cy="46%" outerRadius={110} innerRadius={52} paddingAngle={3}
                                    label={({ name, percent }) => {
                                        const pct = percent ?? 0;
                                        return pct >= 0.06 ? `${trunc(name, 10)} ${(pct * 100).toFixed(0)}%` : "";
                                    }}
                                    labelLine={{ stroke: "#4b5563", strokeWidth: 1 }}>
                                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="transparent" />)}
                                </Pie>
                                <Tooltip {...tt} formatter={(v, name) => [fmt(v as number), name]} />
                                <Legend wrapperStyle={{ fontSize: 11, color: "#9ca3af", paddingTop: 4 }}
                                    formatter={(v) => trunc(v, 22)} />
                            </PieChart>
                        )}
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}
