"use client";

import { useState } from "react";
import Link from "next/link";
import { FilePlus2, ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import NoteEditor from "@/components/NoteEditor";
import type { JSONContent } from "@tiptap/react";

const DEFAULT_CONTENT: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

interface CreateNotePromptProps {
    noteId: string;
}

export default function CreateNotePrompt({ noteId }: CreateNotePromptProps) {
    const [creating, setCreating] = useState(false);
    const [created, setCreated] = useState(false);
    const [error, setError] = useState("");

    const handleCreate = async () => {
        setCreating(true);
        setError("");

        const { error: insertError } = await supabase
            .from("notes")
            .insert({ id: noteId, content: DEFAULT_CONTENT });

        if (insertError) {
            // 23505: not bu sırada başka bir yerden oluşturulmuş — sayfayı
            // yenileyerek mevcut hali (şifre durumu dahil) sunucudan al
            if (insertError.code === "23505") {
                window.location.reload();
                return;
            }
            setError("Not oluşturulamadı. Lütfen tekrar deneyin.");
            setCreating(false);
            return;
        }

        setCreated(true);
    };

    if (created) {
        return (
            <NoteEditor
                noteId={noteId}
                initialContent={DEFAULT_CONTENT}
                hasPassword={false}
                initialIcon={null}
            />
        );
    }

    return (
        <div className="animate-fade-in-scale mx-auto w-full max-w-sm">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-popup)] p-8 shadow-2xl shadow-black/30">
                <div className="mb-6 flex flex-col items-center gap-3">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)]/10">
                        <FilePlus2 size={24} className="text-[var(--accent)]" />
                    </div>
                    <h2 className="text-base font-semibold text-white/95">
                        Bu not mevcut değil
                    </h2>
                    <p className="text-center text-[13px] leading-relaxed text-white/50">
                        <span className="font-medium text-white/80">&ldquo;{noteId}&rdquo;</span> adında
                        bir not bulunamadı. Yeni bir not olarak oluşturmak ister misin?
                    </p>
                </div>

                {error && (
                    <p className="mb-3 text-center text-xs text-red-400">{error}</p>
                )}

                <button
                    type="button"
                    onClick={handleCreate}
                    disabled={creating}
                    className="w-full rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-medium text-[var(--background)] shadow-lg shadow-[var(--accent)]/10 transition-all hover:bg-[var(--accent-light)] hover:shadow-[var(--accent)]/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
                >
                    {creating ? "Oluşturuluyor..." : "Notu Oluştur"}
                </button>

                <Link
                    href="/"
                    className="mt-3 flex items-center justify-center gap-1.5 rounded-xl py-2 text-[13px] text-white/40 transition-colors hover:text-white/70"
                >
                    <ArrowLeft size={14} /> Ana sayfaya dön
                </Link>
            </div>
        </div>
    );
}
