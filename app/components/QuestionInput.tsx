"use client";
import { useState } from "react";
import { Send, Loader2, Sparkles } from "lucide-react";

const SUGGESTIONS = [
    "Show monthly sales trend",
    "Top 5 products by revenue",
    "Average order value by region",
    "Count of orders per category",
];

interface Props {
    onSubmit: (question: string) => void;
    loading: boolean;
    disabled: boolean;
}

export default function QuestionInput({ onSubmit, loading, disabled }: Props) {
    const [value, setValue] = useState("");

    const submit = () => {
        const q = value.trim();
        if (!q || loading || disabled) return;
        onSubmit(q);
        setValue("");
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                    <input
                        type="text"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && submit()}
                        placeholder={disabled ? "Upload a CSV file first..." : "Ask a question about your data..."}
                        disabled={disabled || loading}
                        className="w-full rounded-2xl border border-slate-700 bg-slate-950/95 px-4 py-3 pr-12 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 selection:bg-indigo-500 selection:text-white disabled:opacity-70 disabled:cursor-not-allowed"
                        autoComplete="off"
                    />
                    <Sparkles className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                </div>
                <button
                    onClick={submit}
                    disabled={!value.trim() || loading || disabled}
                    className="inline-flex min-w-[88px] items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-indigo-500/20 transition hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:shadow-none disabled:cursor-not-allowed"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    <span className="hidden sm:inline">{loading ? "Analyzing..." : "Ask"}</span>
                </button>
            </div>

            {!disabled && (
                <div className="flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s) => (
                        <button
                            key={s}
                            onClick={() => {
                                if (loading || disabled) return;
                                onSubmit(s);
                                setValue("");
                            }}
                            disabled={loading || disabled}
                            className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-indigo-500 hover:bg-slate-800 hover:text-white disabled:opacity-50"
                        >
                            {s}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
