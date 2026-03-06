"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  FileText,
  Trash2,
  X,
  ArrowRight,
  Layers,
  PenLine,
  Pin,
  PinOff,
  Lock,
  Eye,
  EyeOff,
  Search,
} from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { verifyPassword } from "@/lib/crypto";
import { DynamicIcon } from "@/components/IconPicker";
import { useToast } from "@/components/Toast";

interface NoteItem {
  id: string;
  updated_at: string;
  pinned: boolean;
  has_password: boolean;
  icon: string | null;
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
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteShowPw, setDeleteShowPw] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const router = useRouter();
  const { addToast } = useToast();

  const resetDeleteState = () => {
    setDeleteConfirm(null);
    setDeletePassword("");
    setDeleteError("");
    setDeleteShowPw(false);
    setDeleteLoading(false);
  };

  const fetchNotes = useCallback(async () => {
    const { data, error } = await supabase
      .from("notes")
      .select("id, updated_at, pinned, password_hash, icon")
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Notlar yüklenemedi:", error.message);
    }
    setNotes(
      (data ?? []).map((n) => ({ ...n, pinned: n.pinned ?? false, has_password: !!n.password_hash, icon: n.icon ?? null }))
    );
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
        addToast("Not silinemedi.", "error");
      } else {
        addToast(`"${id}" silindi.`, "delete");
      }
    },
    [notes, addToast]
  );

  const handleTogglePin = useCallback(
    async (id: string, currentPinned: boolean) => {
      // Optimistic update
      setNotes((current) => {
        const updated = current.map((n) =>
          n.id === id ? { ...n, pinned: !currentPinned } : n
        );
        // Sort: pinned first, then by updated_at
        return updated.sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        });
      });

      const { error } = await supabase
        .from("notes")
        .update({ pinned: !currentPinned })
        .eq("id", id);

      if (error) {
        console.error("Pin güncellenemedi:", error.message);
        // Revert
        setNotes((current) => {
          const reverted = current.map((n) =>
            n.id === id ? { ...n, pinned: currentPinned } : n
          );
          return reverted.sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
          });
        });
        addToast("Pin güncellenemedi.", "error");
      } else {
        addToast(!currentPinned ? "Not sabitlendi." : "Sabitleme kaldırıldı.", "success");
      }
    },
    [addToast]
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
        className={`glass-strong fixed left-0 top-0 z-50 flex h-screen w-72 flex-col border-r border-[var(--border)] shadow-2xl shadow-black/40 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
      >
        {/* Subtle top glow */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[var(--accent)]/[0.03] to-transparent" />

        {/* Header */}
        <div className="relative flex items-center justify-between px-5 pt-5 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent)]/10">
              <Layers size={13} className="text-[var(--accent)]" />
            </div>
            <div>
              <h2 className="text-[13px] font-semibold text-gray-300">Tüm Notlar</h2>
              <p className="text-[10px] text-gray-600">{notes.length} not</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-1.5 text-gray-600 transition-all hover:bg-white/5 hover:text-gray-300"
          >
            <X size={15} />
          </button>
        </div>

        <div className="mx-5 h-px bg-gradient-to-r from-transparent via-[var(--border)] to-transparent" />

        {/* Search */}
        <div className="px-4 pt-3">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
            <input
              type="text"
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value.replace(/\s+/g, "-"))}
              placeholder="Notlarda ara…"
              className="w-full rounded-lg border border-[var(--border)] bg-white/[0.02] py-1.5 pl-8 pr-3 text-xs text-gray-300 placeholder-gray-600 transition-all focus:border-[var(--accent)]/30 focus:bg-white/[0.04] focus:outline-none"
            />
          </div>
        </div>

        {/* Notes list */}
        <div className="flex-1 overflow-y-auto px-3 pt-2 pb-5">
          {loading && (
            <div className="flex items-center justify-center py-10 text-xs text-gray-600">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)]/20 border-t-[var(--accent)]/60" />
            </div>
          )}
          {!loading && notes.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-xs text-gray-600">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.03]">
                <FileText size={18} className="text-gray-700" />
              </div>
              <span>Henüz not yok.</span>
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            {notes
              .filter((item) => !sidebarSearch.trim() || item.id.toLowerCase().includes(sidebarSearch.toLowerCase()))
              .map((item) => (
                <div
                  key={item.id}
                  className={`group relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 transition-all duration-200 hover:bg-[var(--accent)]/[0.05] ${item.pinned ? "bg-[var(--accent)]/[0.03]" : ""
                    }`}
                >
                  {/* Pinned indicator */}
                  {item.pinned && (
                    <div className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-[var(--accent)]/40" />
                  )}

                  <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors duration-200 ${item.pinned ? "bg-[var(--accent)]/10" : "bg-white/[0.03] group-hover:bg-[var(--accent)]/[0.07]"
                    }`}>
                    {item.pinned ? (
                      <Pin size={15} className="text-[var(--accent)]" />
                    ) : item.icon ? (
                      <DynamicIcon name={item.icon} size={15} className="text-[var(--accent)]/60" />
                    ) : (
                      <FileText size={15} className="text-[var(--accent)]/60 group-hover:text-[var(--accent)]" />
                    )}
                  </div>

                  <Link
                    href={`/note/${item.id}`}
                    className="flex-1 min-w-0 flex flex-col transition-colors hover:text-gray-200"
                  >
                    <span className="truncate text-[13px] text-gray-400 group-hover:text-gray-200 transition-colors flex items-center gap-1.5">
                      {item.id}
                      {item.has_password && <Lock size={10} className="shrink-0 text-[var(--accent)]/40" />}
                    </span>
                    <span className="text-[10px] tabular-nums text-gray-700 group-hover:text-gray-600">
                      {timeAgo(item.updated_at)}
                    </span>
                  </Link>

                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => handleTogglePin(item.id, item.pinned)}
                      className={`flex-shrink-0 rounded-md p-1.5 transition-all duration-150 ${item.pinned
                        ? "text-[var(--accent)] hover:bg-[var(--accent)]/10 hover:text-[var(--accent-light)]"
                        : "text-gray-700 opacity-0 hover:bg-[var(--accent)]/10 hover:text-[var(--accent)] group-hover:opacity-100"
                        }`}
                      aria-label={item.pinned ? "Sabitlemeyi kaldır" : "Sabitle"}
                    >
                      {item.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(item.id)}
                      className="flex-shrink-0 rounded-md p-1.5 text-gray-700 opacity-0 transition-all duration-150 hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                      aria-label="Notu sil"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </aside>

      {/* Center content */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 pb-12">
        {/* Title area */}
        <div className="animate-fade-in mb-12 flex flex-col items-center">
          <Image src="/ablam.png" alt="Ablam Notepad" width={180} height={40} className="mb-3 h-6.5 w-auto" />
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

      {/* Delete confirmation popup */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={resetDeleteState}
        >
          <div
            className="animate-fade-in-scale mx-4 w-full max-w-xs rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-6 shadow-2xl shadow-black/40"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/10">
                <Trash2 size={16} className="text-red-400" />
              </div>
              <h3 className="text-sm font-semibold text-gray-200">
                Notu Sil
              </h3>
            </div>

            <p className="mb-4 mt-3 text-[13px] leading-relaxed text-gray-500">
              <span className="font-medium text-gray-400">{deleteConfirm}</span> notunu silmek istediğine emin misin? Bu işlem geri alınamaz.
            </p>

            {notes.find((n) => n.id === deleteConfirm)?.has_password && (
              <div className="mb-4">
                <div className="relative">
                  <input
                    type={deleteShowPw ? "text" : "password"}
                    value={deletePassword}
                    onChange={(e) => { setDeletePassword(e.target.value); setDeleteError(""); }}
                    placeholder="Not şifresini girin"
                    autoFocus
                    className="focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-3 pr-10 text-sm text-gray-200 placeholder-gray-600 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setDeleteShowPw(!deleteShowPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400"
                  >
                    {deleteShowPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {deleteError && (
                  <p className="mt-2 text-xs text-red-400">{deleteError}</p>
                )}
              </div>
            )}

            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={resetDeleteState}
                className="flex-1 rounded-xl border border-[var(--border)] bg-white/[0.03] px-4 py-2.5 text-xs font-medium text-gray-400 transition-all hover:bg-white/[0.06] hover:text-gray-300"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={deleteLoading}
                onClick={async () => {
                  const note = notes.find((n) => n.id === deleteConfirm);
                  if (note?.has_password) {
                    if (!deletePassword.trim()) {
                      setDeleteError("Şifreyi girin.");
                      return;
                    }
                    setDeleteLoading(true);
                    const { data } = await supabase
                      .from("notes")
                      .select("password_hash")
                      .eq("id", deleteConfirm)
                      .single();
                    if (!data) {
                      setDeleteError("Not bulunamadı.");
                      setDeleteLoading(false);
                      return;
                    }
                    const valid = await verifyPassword(deletePassword, data.password_hash);
                    if (!valid) {
                      setDeleteError("Şifre yanlış.");
                      setDeleteLoading(false);
                      return;
                    }
                  }
                  handleDelete(deleteConfirm!);
                  resetDeleteState();
                }}
                className="flex-1 rounded-xl bg-red-500/15 px-4 py-2.5 text-xs font-medium text-red-400 transition-all hover:bg-red-500/25 disabled:opacity-50"
              >
                {deleteLoading ? "Doğrulanıyor..." : "Evet, Sil"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
