"use client";
import { XCircle, X } from "lucide-react";

interface Props {
    message: string;
    onDismiss: () => void;
}

export default function ErrorNotification({ message, onDismiss }: Props) {
    return (
        <div className="flex flex-col gap-3 rounded-3xl border border-red-500/20 bg-red-950/90 p-4 text-sm shadow-lg shadow-red-950/20 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
                <XCircle className="w-5 h-5 text-red-400 shrink-0" />
                <div>
                    <p className="text-sm font-semibold text-red-200">Action needed</p>
                    <p className="text-sm text-red-300">{message}</p>
                </div>
            </div>
            <button onClick={onDismiss} className="self-start rounded-full border border-red-500/20 bg-red-950/80 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-900 hover:text-white transition sm:self-center">
                Dismiss
            </button>
        </div>
    );
}
