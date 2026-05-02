"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import type { Session, Insight, AppError } from "./types";
import { validateFileSize, parseCSV } from "./lib/csvProcessor";
import { processQuestion } from "./lib/aiQueryEngine";
import FileUpload from "./components/FileUpload";
import DataPreview from "./components/DataPreview";
import QuestionInput from "./components/QuestionInput";
import InsightCard from "./components/InsightCard";
import ErrorNotification from "./components/ErrorNotification";
import {
  BarChart2, RefreshCw, Sparkles, Database, Zap,
  ChevronRight, ChevronDown, ChevronUp, Menu, X, Mail, MapPin,
} from "lucide-react";

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [queryLoading, setQueryLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer
  const insightsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (insights.length > 0) {
      insightsEndRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [insights.length]);

  useEffect(() => {
    if (session) setPreviewOpen(true);
  }, [session]);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setUploadLoading(true);
    try {
      validateFileSize(file);
      const { dataset, schema } = await parseCSV(file);
      setSession({ dataset, schema, fileName: file.name });
      setInsights([]);
      setSidebarOpen(false);
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : "Failed to process file.", type: "parse" });
    } finally {
      setUploadLoading(false);
    }
  }, []);

  const handleQuestion = useCallback(async (question: string) => {
    if (!session) return;
    setError(null);
    setQueryLoading(true);
    setSidebarOpen(false);
    try {
      const result = await processQuestion(question, session.schema, session.dataset);
      const insight: Insight = { id: crypto.randomUUID(), question, result, timestamp: new Date() };
      setInsights((prev) => [...prev, insight]);
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : "Failed to process question.", type: "ai" });
    } finally {
      setQueryLoading(false);
    }
  }, [session]);

  const handleNewSession = useCallback(() => {
    if (insights.length > 0 || session) {
      if (!confirm("Start a new session? This will clear your current data and insights.")) return;
    }
    setSession(null);
    setInsights([]);
    setError(null);
    setPreviewOpen(false);
    setSidebarOpen(false);
  }, [insights.length, session]);

  const SUGGESTIONS = [
    "Monthly revenue trend",
    "Top 10 products by revenue",
    "Profit region wise",
    "Revenue by state top 10",
  ];

  const SidebarContent = () => (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Stats */}
      <div className="shrink-0 grid grid-cols-3 divide-x divide-gray-800 border-b border-gray-800">
        {[
          { label: "Rows", value: session ? session.schema.rowCount.toLocaleString() : "—" },
          { label: "Cols", value: session ? session.schema.columns.length : "—" },
          { label: "Insights", value: insights.length || "—" },
        ].map(({ label, value }) => (
          <div key={label} className="px-3 py-2.5 text-center">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>
            <p className="text-sm font-semibold text-white mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Upload */}
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center gap-2 mb-3">
            <Database className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-xs font-semibold text-gray-300">Data Source</span>
          </div>
          <FileUpload onFile={handleFile} loading={uploadLoading} fileName={session?.fileName} />
        </div>

        {/* Quick questions */}
        <div className="p-4 border-b border-gray-800">
          <p className="text-xs font-semibold text-gray-400 mb-2">Quick Questions</p>
          <div className="space-y-1">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => handleQuestion(s)}
                disabled={!session || queryLoading}
                className="w-full flex items-center justify-between text-left px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <span>{s}</span>
                <ChevronRight className="w-3 h-3 shrink-0 opacity-50" />
              </button>
            ))}
          </div>
        </div>

        {/* Dataset preview — collapsible */}
        {session && (
          <div className="border-b border-gray-800">
            <button
              onClick={() => setPreviewOpen(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-gray-300 hover:text-white hover:bg-gray-900/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-indigo-400" />
                <span>Dataset Preview</span>
                <span className="text-gray-600 font-normal">({session.schema.rowCount.toLocaleString()} rows)</span>
              </div>
              {previewOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {previewOpen && (
              <div className="px-4 pb-4">
                <DataPreview schema={session.schema} />
              </div>
            )}
          </div>
        )}

        {/* How it works */}
        {!session && (
          <div className="p-4">
            <p className="text-xs font-medium text-gray-500 mb-3">How it works</p>
            <ol className="space-y-3">
              {["Upload a CSV file", "Ask questions in plain English", "Get instant charts & insights"].map((step, i) => (
                <li key={i} className="flex items-start gap-2.5 text-xs text-gray-500">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-indigo-600/20 text-indigo-400 text-[10px] font-bold shrink-0 mt-0.5">{i + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="h-screen flex flex-col bg-gray-950 overflow-hidden">

      {/* ── Header ── */}
      <header className="shrink-0 h-12 border-b border-gray-800 bg-gray-950/90 backdrop-blur-sm z-30 flex items-center px-4 justify-between">
        <div className="flex items-center gap-2.5">
          {/* Mobile menu toggle */}
          <button
            className="lg:hidden p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors mr-1"
            onClick={() => setSidebarOpen(v => !v)}
            aria-label="Toggle sidebar"
          >
            {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-600">
            <BarChart2 className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white leading-none">AI Data Analyst</h1>
            <p className="text-[10px] text-gray-500 hidden sm:block">Powered by AI</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {session && (
            <span className="hidden md:flex items-center gap-1.5 text-xs text-green-400 bg-green-950/40 border border-green-800/50 px-2.5 py-1 rounded-full max-w-[180px]">
              <Database className="w-3 h-3 shrink-0" />
              <span className="truncate">{session.fileName}</span>
            </span>
          )}
          <button
            onClick={handleNewSession}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            <span className="hidden sm:inline">New Session</span>
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="lg:hidden fixed inset-0 bg-black/60 z-20 top-12"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* ── Sidebar ── */}
        <aside className={`
          fixed lg:relative top-12 lg:top-0 left-0 h-[calc(100vh-3rem)] lg:h-full
          w-80 shrink-0 border-r border-gray-800 bg-gray-950 z-20
          transition-transform duration-200 ease-in-out
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}>
          <SidebarContent />
        </aside>

        {/* ── Main Panel ── */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Question input */}
          <div className="shrink-0 border-b border-gray-800 bg-gray-950/95 backdrop-blur-sm px-4 sm:px-6 py-3">
            {error && (
              <div className="mb-3">
                <ErrorNotification message={error.message} onDismiss={() => setError(null)} />
              </div>
            )}
            <QuestionInput onSubmit={handleQuestion} loading={queryLoading} disabled={!session} />
          </div>

          {/* Insights */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
            {insights.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-3 py-16">
                <div className="w-14 h-14 rounded-2xl bg-indigo-600/10 flex items-center justify-center">
                  {session
                    ? <Sparkles className="w-7 h-7 text-indigo-400" />
                    : <BarChart2 className="w-7 h-7 text-gray-600" />}
                </div>
                <p className="text-sm font-medium text-gray-400">
                  {session ? "Ready to analyze" : "No data loaded"}
                </p>
                <p className="text-xs text-gray-600 max-w-xs">
                  {session
                    ? "Ask a question above or pick one from the sidebar."
                    : "Tap the menu icon or use the sidebar to upload a CSV file."}
                </p>
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-600">{insights.length} insight{insights.length !== 1 ? "s" : ""}</p>
                {insights.map((insight, i) => (
                  <InsightCard key={insight.id} insight={insight} index={i + 1} />
                ))}
                <div ref={insightsEndRef} />
              </>
            )}
          </div>
        </main>
      </div>

      {/* ── Footer ── */}
      <footer className="shrink-0 border-t border-gray-800 bg-gray-950/95 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-2">
          {/* Left — branding */}
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-5 h-5 rounded bg-indigo-600">
              <BarChart2 className="w-3 h-3 text-white" />
            </div>
            <span className="text-xs text-gray-400 font-medium">AI Data Analyst Dashboard</span>
            <span className="text-gray-700 text-xs hidden sm:inline">·</span>
            <span className="text-xs text-gray-600 hidden sm:inline">
              © {new Date().getFullYear()} Ahmad Raza Khan
            </span>
          </div>

          {/* Center — location */}
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <MapPin className="w-3 h-3 shrink-0" />
            <span>Begusarai, Bihar</span>
          </div>

          {/* Right — contact */}
          <a
            href="mailto:razakhanahmad68@gmail.com"
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-indigo-400 transition-colors"
          >
            <Mail className="w-3 h-3 shrink-0" />
            <span>razakhanahmad68@gmail.com</span>
          </a>
        </div>

        {/* Mobile copyright line */}
        <div className="sm:hidden text-center pb-2">
          <span className="text-[10px] text-gray-700">© {new Date().getFullYear()} Ahmad Raza Khan. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
