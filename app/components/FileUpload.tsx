"use client";
import { useRef, useState, useCallback } from "react";
import { Upload, FileText, Loader2 } from "lucide-react";

interface Props {
    onFile: (file: File) => void;
    loading: boolean;
    fileName?: string;
}

export default function FileUpload({ onFile, loading, fileName }: Props) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);

    const handleFile = useCallback(
        (file: File) => {
            if (!file.name.endsWith(".csv")) {
                alert("Please upload a .csv file.");
                return;
            }
            onFile(file);
        },
        [onFile]
    );

    const onDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
        },
        [handleFile]
    );

    return (
        <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => !loading && inputRef.current?.click()}
            className={`relative flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed cursor-pointer p-8 text-center transition-all duration-200
        ${dragging ? "border-indigo-400 bg-slate-950/90 shadow-[0_0_0_1px_rgba(99,102,241,0.35)]" : "border-slate-700 bg-slate-950/80 hover:border-indigo-500 hover:bg-slate-950/95"}
        ${loading ? "pointer-events-none opacity-70" : ""}`}
        >
            <input
                ref={inputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />

            {loading ? (
                <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" />
            ) : fileName ? (
                <FileText className="w-10 h-10 text-indigo-400" />
            ) : (
                <Upload className="w-10 h-10 text-gray-500" />
            )}

            <div>
                {loading ? (
                    <p className="text-sm text-gray-400">Processing file...</p>
                ) : fileName ? (
                    <>
                        <p className="text-sm font-medium text-indigo-300">{fileName}</p>
                        <p className="text-xs text-gray-500 mt-1">Click or drag to replace</p>
                    </>
                ) : (
                    <>
                        <p className="text-sm font-medium text-gray-300">
                            Drop your CSV here or <span className="text-indigo-400">browse</span>
                        </p>
                        <p className="text-xs text-gray-500 mt-1">Max 50 MB · .csv files only</p>
                    </>
                )}
            </div>
        </div>
    );
}
