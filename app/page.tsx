"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileText, Trash2, FileStack, ChevronRight, X } from "lucide-react";
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
    const { data } = await supabase
      .from("notes")
      .select("id, updated_at")
      .order("updated_at", { ascending: false });
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
      await supabase.from("notes").delete().eq("id", id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    },
    []
  );

  const hasNotes = notes.length > 0;

  return (
    <main className="relative flex min-h-screen bg-[#12140e]">
      {/* Backdrop overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 z-50 flex h-screen w-72 flex-col border-r border-[#8B9D5A]/10 bg-[#161a12] p-5 shadow-2xl transition-transform duration-300 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-gray-500">
            <FileStack size={13} />
            Tüm Notlar
            <span className="ml-1 rounded-full bg-[#8B9D5A]/15 px-1.5 py-0.5 text-[10px] text-[#8B9D5A]">
              {notes.length}
            </span>
          </h2>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded p-1 text-gray-600 transition-colors hover:bg-white/5 hover:text-gray-300"
          >
            <X size={16} />
          </button>
        </div>

        <div className="-mx-2 flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-8 text-xs text-gray-600">
              Yükleniyor...
            </div>
          )}
          {!loading && notes.length === 0 && (
            <div className="flex items-center justify-center py-8 text-xs text-gray-600">
              Henüz not yok.
            </div>
          )}
          {notes.map((item) => (
            <div
              key={item.id}
              className="group flex items-center gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-[#8B9D5A]/8"
            >
              <FileText
                size={15}
                className="flex-shrink-0 text-[#8B9D5A]/50"
              />

              <Link
                href={`/note/${item.id}`}
                className="flex-1 truncate text-sm text-gray-400 transition-colors hover:text-gray-200"
              >
                {item.id}
              </Link>

              <span className="flex-shrink-0 text-[10px] text-gray-600">
                {timeAgo(item.updated_at)}
              </span>

              <button
                type="button"
                onClick={() => handleDelete(item.id)}
                className="flex-shrink-0 rounded p-1 text-gray-700 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                aria-label="Notu sil"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Center content */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-12">
        <h1 className="mb-2 text-sm font-medium uppercase tracking-[0.25em] text-gray-500">
          Ablam NotePad
        </h1>
        <p className="mb-10 text-center text-sm text-gray-600">
          Ablam yeni bir not oluşturmak veya mevcut bir notu açmak için ismini
          girebilirsin.
        </p>

        <form
          onSubmit={handleSubmit}
          className="flex w-full max-w-md flex-col gap-4"
        >
          <input
            type="text"
            value={noteId}
            onChange={(e) => setNoteId(e.target.value)}
            placeholder="örn. ablam da ablam"
            autoFocus
            className="w-full rounded-xl border border-[#8B9D5A]/15 bg-[#1e2318] px-5 py-3.5 text-gray-200 placeholder-[#5a6050] outline-none ring-1 ring-transparent transition-all focus:border-[#8B9D5A]/40 focus:ring-[#8B9D5A]/20"
          />
          <button
            type="submit"
            disabled={!noteId.trim()}
            className="rounded-xl bg-[#8B9D5A] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-[#9AAD69] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Notu Aç
          </button>
        </form>

        {/* Notes link */}
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="mt-6 flex items-center gap-1.5 text-sm text-[#8B9D5A]/70 transition-colors hover:text-[#8B9D5A]"
        >
          <FileStack size={15} />
          <span className="underline underline-offset-2">Mevcut notları görüntüle</span>
        </button>
      </div>
    </main>
  );
}
