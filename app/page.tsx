"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FileText,
  Trash2,
  X,
  ArrowRight,
  Layers,
  PenLine,
} from "lucide-react";
import { supabase } from "@/lib/supabase-browser";

interface NoteItem {
  id: string;
  updated_at: string;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000
  );
  if (seconds < 60) return "az önce";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} saat önce`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} gün önce`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks} hafta önce`;
  const months = Math.floor(days / 30);
  return `${months} ay önce`;
}

export default function Home() {
  const [noteId, setNoteId] = useState("");
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();

  const fetchNotes = useCallback(async () => {
    const { data, error } = await supabase
      .from("notes")
      .select("id, updated_at")
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Notlar yüklenemedi:", error.message);
    }
    setNotes(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const slug = noteId
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(
        /[^a-z0-9\u00C0-\u024F\u0100-\u017F\u011E\u011F\u0130\u0131\u015E\u015F\u00D6\u00F6\u00DC\u00FC\u00C7\u00E7-]+/g,
        ""
      )
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (!slug) return;
    router.push(`/note/${slug}`);
  };

  const handleDelete = useCallback(
    async (id: string) => {
      const prev = notes;
      setNotes((current) => current.filter((n) => n.id !== id));

      const { error } = await supabase.from("notes").delete().eq("id", id);
      if (error) {
        console.error("Not silinemedi:", error.message);
        setNotes(prev);
      }
    },
    [notes]
  );

  return (
    <main className="relative flex min-h-screen bg-[var(--background)]">
      {/* Background glow — radial gradient to avoid banding */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(139,157,90,0.04) 0%, rgba(139,157,90,0.015) 40%, transparent 70%)",
        }}
      />

      {/* Backdrop overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`glass-strong fixed left-0 top-0 z-50 flex h-screen w-72 flex-col border-r border-[var(--border)] p-5 shadow-2xl shadow-black/30 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gray-500">
            <Layers size={13} className="text-[var(--accent)]/60" />
            Tüm Notlar
            <span className="rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]">
              {notes.length}
            </span>
          </h2>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-1.5 text-gray-600 transition-all hover:bg-white/5 hover:text-gray-300"
          >
            <X size={15} />
          </button>
        </div>

        <div className="-mx-1 flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-10 text-xs text-gray-600">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)]/20 border-t-[var(--accent)]/60" />
            </div>
          )}
          {!loading && notes.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-xs text-gray-600">
              <FileText size={20} className="text-gray-700" />
              <span>Henüz not yok.</span>
            </div>
          )}
          {notes.map((item) => (
            <div
              key={item.id}
              className="group flex items-center gap-2.5 rounded-lg px-3 py-2.5 transition-all duration-200 hover:translate-x-1 hover:bg-[var(--accent)]/[0.06]"
            >
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-[var(--accent)]/[0.07]">
                <FileText size={13} className="text-[var(--accent)]/60" />
              </div>

              <Link
                href={`/note/${item.id}`}
                className="flex-1 truncate text-[13px] text-gray-400 transition-colors hover:text-gray-200"
              >
                {item.id}
              </Link>

              <span className="flex-shrink-0 text-[10px] tabular-nums text-gray-700">
                {timeAgo(item.updated_at)}
              </span>

              <button
                type="button"
                onClick={() => handleDelete(item.id)}
                className="flex-shrink-0 rounded-md p-1.5 text-gray-700 opacity-0 transition-all duration-150 hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                aria-label="Notu sil"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Center content */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 pb-12">
        {/* Title area */}
        <div className="animate-fade-in mb-12 flex flex-col items-center">
          <h1 className="mb-2 text-lg font-semibold tracking-wide text-[var(--accent-light)]">
            Ablam NotePad
          </h1>
          <p className="max-w-xs text-center text-[13px] leading-relaxed text-gray-600">
            Ablam yeni bir not oluşturmak veya mevcut bir notu açmak için ismini girebilirsin.
          </p>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="animate-slide-up flex w-full max-w-sm flex-col gap-3"
          style={{ animationDelay: "100ms" }}
        >
          <div className="group relative">
            <PenLine size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600 transition-colors group-focus-within:text-[var(--accent)]/70" />
            <input
              type="text"
              value={noteId}
              onChange={(e) => setNoteId(e.target.value)}
              placeholder="örn. ablam da ablam"
              autoFocus
              className="focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] py-3 pl-10 pr-4 text-sm text-gray-200 placeholder-gray-500 transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={!noteId.trim()}
            className="group flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-medium text-white shadow-lg shadow-[var(--accent)]/10 transition-all hover:bg-[#9AAD69] hover:shadow-[var(--accent)]/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
          >
            <span>Notu Aç</span>
            <ArrowRight
              size={15}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </button>
        </form>

        {/* Notes link */}
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="animate-slide-up mt-8 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-gray-600 transition-all duration-200 hover:bg-white/[0.03] hover:text-gray-400"
          style={{ animationDelay: "200ms" }}
        >
          <Layers size={14} />
          <span>Mevcut notları görüntüle</span>
        </button>
      </div>
    </main>
  );
}
