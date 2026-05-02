"use client";
import type { Insight } from "../types";
import InsightChart from "./InsightChart";
import { MessageSquare, Clock } from "lucide-react";

interface Props {
    insight: Insight;
    index: number;
}

export default function InsightCard({ insight, index }: Props) {
    const time = new Date(insight.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    return (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
            {/* Question header */}
            <div className="flex items-start gap-3">
                <div className="flex items-center justify-center w-7 h-7 rounded-full bg-indigo-600/20 text-indigo-400 text-xs font-bold shrink-0 mt-0.5">
                    {index}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <MessageSquare className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                        <p className="text-sm font-medium text-gray-200">{insight.question}</p>
                    </div>
                    <div className="flex items-center gap-1 mt-1 text-xs text-gray-600">
                        <Clock className="w-3 h-3" />
                        <span>{time}</span>
                    </div>
                </div>
            </div>

            {/* Chart */}
            <InsightChart result={insight.result} />

            {/* Summary */}
            {insight.result.summary && (
                <div className="bg-gray-950/60 border border-gray-800 rounded-xl px-4 py-3">
                    <p className="text-xs text-gray-400 leading-relaxed">{insight.result.summary}</p>
                </div>
            )}
        </div>
    );
}
