"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useEditor, EditorContent, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import UnderlineExtension from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Share2, Check, Home } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import Toolbar from "./Toolbar";
import type { JSONContent, Editor } from "@tiptap/react";
import Link from "next/link";

type SyncStatus = "synced" | "syncing" | "error";

function CharCount({ editor }: { editor: Editor }) {
  const text = useEditorState({
    editor,
    selector: (ctx) => ctx.editor.state.doc.textContent,
  });

  const chars = useMemo(() => (text || "").length, [text]);

  return (
    <div className="flex items-center justify-end border-t border-white/[0.04] px-4 py-2 text-[11px] tabular-nums text-gray-600">
      <span>{chars} karakter</span>
    </div>
  );
}

interface NoteEditorProps {
  noteId: string;
  initialContent: JSONContent;
}

export default function NoteEditor({ noteId, initialContent }: NoteEditorProps) {
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentSavesRef = useRef<Set<string>>(new Set());
  const pendingSaveRef = useRef<{ json: JSONContent; jsonStr: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("synced");

  const attemptSave = async (json: JSONContent, jsonStr: string, retries = 0) => {
    try {
      recentSavesRef.current.add(jsonStr);
      const { error } = await supabase
        .from("notes")
        .update({ content: json })
        .eq("id", noteId);

      if (error) {
        recentSavesRef.current.delete(jsonStr);
        throw new Error(error.message);
      }

      pendingSaveRef.current = null;
      setTimeout(() => recentSavesRef.current.delete(jsonStr), 5000);
      setSyncStatus("synced");
    } catch (err) {
      console.error("Kaydetme hatası:", err);
      recentSavesRef.current.delete(jsonStr);
      pendingSaveRef.current = { json, jsonStr };

      if (retries < 3) {
        setSyncStatus("syncing");
        const delay = Math.pow(2, retries) * 1000;
        retryTimeoutRef.current = setTimeout(
          () => attemptSave(json, jsonStr, retries + 1),
          delay
        );
      } else {
        setSyncStatus("error");
      }
    }
  };

  const handleShare = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      UnderlineExtension,
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class:
          "prose prose-invert max-w-none px-6 py-5 min-h-[60vh] outline-none text-gray-300 leading-relaxed text-[15px]",
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
      },
    },
    onUpdate: ({ editor }) => {
      setSyncStatus("syncing");

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);

      saveTimeoutRef.current = setTimeout(() => {
        const json = editor.getJSON();
        const jsonStr = JSON.stringify(json);

        if (recentSavesRef.current.has(jsonStr)) {
          setSyncStatus("synced");
          return;
        }

        attemptSave(json, jsonStr);
      }, 500);
    },
  });

  // Store initial content hash
  useEffect(() => {
    recentSavesRef.current.add(JSON.stringify(initialContent));
  }, [initialContent]);

  // Real-time subscription
  useEffect(() => {
    if (!editor) return;

    const channel = supabase
      .channel(`note-${noteId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notes",
          filter: `id=eq.${noteId}`,
        },
        (payload) => {
          const newContent = payload.new.content as JSONContent;
          if (!newContent) return;

          const incomingJSON = JSON.stringify(newContent);

          // Skip if this is our own save echoing back
          if (recentSavesRef.current.has(incomingJSON)) return;

          // Skip if editor already has this content
          const currentJSON = JSON.stringify(editor.getJSON());
          if (currentJSON === incomingJSON) return;

          // Store cursor position
          const { from, to } = editor.state.selection;

          // Apply remote content
          recentSavesRef.current.add(incomingJSON);
          setTimeout(() => recentSavesRef.current.delete(incomingJSON), 5000);
          editor.commands.setContent(newContent, { emitUpdate: false });

          // Restore cursor position (clamp to new doc length)
          const maxPos = editor.state.doc.content.size;
          const safeFrom = Math.min(from, maxPos);
          const safeTo = Math.min(to, maxPos);
          editor.commands.setTextSelection({ from: safeFrom, to: safeTo });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [noteId, editor]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, []);

  return (
    <div className="animate-fade-in-scale mx-auto w-full max-w-3xl">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-1.5 rounded-lg border border-transparent px-3 py-1.5 text-xs font-medium text-gray-500 transition-all duration-200 hover:border-[var(--border)] hover:bg-white/[0.03] hover:text-gray-300"
        >
          <Home size={13} />
          <span>Ana Sayfa</span>
        </Link>

        <Link
          href="/"
          className="text-sm font-semibold tracking-wide text-[var(--accent-light)] transition-opacity duration-200 hover:opacity-80"
        >
          Ablam NotePad
        </Link>

        <button
          type="button"
          onClick={handleShare}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
            copied
              ? "border-[var(--accent)]/20 bg-[var(--accent)]/10 text-[var(--accent-light)]"
              : "border-transparent text-gray-500 hover:border-[var(--border)] hover:bg-white/[0.03] hover:text-gray-300"
          }`}
        >
          {copied ? (
            <>
              <Check size={13} />
              <span>Kopyalandı</span>
            </>
          ) : (
            <>
              <Share2 size={13} />
              <span>Paylaş</span>
            </>
          )}
        </button>
      </div>

      {/* Editor Card */}
      <div
        className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-2xl shadow-black/30"
        style={{
          boxShadow:
            "0 0 60px -12px rgba(139,157,90,0.08), 0 0 30px -8px rgba(139,157,90,0.05), 0 25px 50px -12px rgba(0,0,0,0.4)",
        }}
      >
        <Toolbar editor={editor} syncStatus={syncStatus} noteId={noteId} />
        <EditorContent editor={editor} />
        {/* Word/character counter */}
        {editor && <CharCount editor={editor} />}
      </div>
    </div>
  );
}
