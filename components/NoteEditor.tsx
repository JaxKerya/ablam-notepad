"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import UnderlineExtension from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Share2, Check, FilePlus, CloudUpload, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { addToNoteHistory } from "@/lib/note-history";
import Toolbar from "./Toolbar";
import type { JSONContent } from "@tiptap/react";
import Link from "next/link";

type SaveStatus = "idle" | "saving" | "saved";

interface NoteEditorProps {
  noteId: string;
  initialContent: JSONContent;
}

export default function NoteEditor({ noteId, initialContent }: NoteEditorProps) {
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRemoteUpdateRef = useRef(false);
  const isSavingRef = useRef(false);
  const [copied, setCopied] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

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

  const saveContent = useCallback(
    async (content: JSONContent) => {
      isSavingRef.current = true;
      setSaveStatus("saving");
      await supabase
        .from("notes")
        .update({ content })
        .eq("id", noteId);
      isSavingRef.current = false;
      setSaveStatus("saved");

      // Clear any existing "saved" timeout
      if (savedTimeoutRef.current) {
        clearTimeout(savedTimeoutRef.current);
      }
      savedTimeoutRef.current = setTimeout(() => {
        setSaveStatus("idle");
      }, 2000);
    },
    [noteId]
  );

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
          "prose prose-invert max-w-none px-6 py-4 min-h-[60vh] outline-none text-gray-200 leading-relaxed",
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
      },
    },
    onUpdate: ({ editor }) => {
      if (isRemoteUpdateRef.current) {
        isRemoteUpdateRef.current = false;
        return;
      }

      setSaveStatus("saving");

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        saveContent(editor.getJSON());
      }, 500);
    },
  });

  // Real-time subscription
  useEffect(() => {
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
          if (isSavingRef.current) return;

          const newContent = payload.new.content as JSONContent;
          if (!editor || !newContent) return;

          const currentJSON = JSON.stringify(editor.getJSON());
          const incomingJSON = JSON.stringify(newContent);
          if (currentJSON === incomingJSON) return;

          isRemoteUpdateRef.current = true;
          editor.commands.setContent(newContent, { emitUpdate: false });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [noteId, editor]);

  // Save to local history on mount
  useEffect(() => {
    addToNoteHistory(noteId);
  }, [noteId]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Save Status - Fixed top right */}
      <div
        className={`fixed right-5 top-5 z-50 flex items-center gap-1.5 rounded-lg bg-[#1e2318] px-3 py-1.5 text-xs shadow-lg ring-1 ring-[#8B9D5A]/15 transition-all duration-300 ${
          saveStatus === "idle"
            ? "pointer-events-none translate-y-1 opacity-0"
            : "opacity-100"
        }`}
      >
        {saveStatus === "saving" && (
          <>
            <CloudUpload size={13} className="animate-pulse text-[#8B9D5A]" />
            <span className="text-gray-400">Kaydediliyor...</span>
          </>
        )}
        {saveStatus === "saved" && (
          <>
            <CheckCircle2 size={13} className="text-[#8B9D5A]" />
            <span className="text-gray-400">Kaydedildi</span>
          </>
        )}
      </div>

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex w-28 items-center">
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-400 transition-all hover:bg-white/10 hover:text-gray-200"
          >
            <FilePlus size={14} />
            <span>Yeni Not</span>
          </Link>
        </div>

        <h1 className="text-center text-sm font-medium uppercase tracking-[0.25em] text-gray-500">
          Ablam NotePad
        </h1>

        <div className="flex w-28 justify-end">
          <button
            type="button"
            onClick={handleShare}
            className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-400 transition-all hover:bg-white/10 hover:text-gray-200"
          >
            {copied ? (
              <>
                <Check size={14} />
                <span>Kopyalandı</span>
              </>
            ) : (
              <>
                <Share2 size={14} />
                <span>Paylaş</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Editor Card */}
      <div className="overflow-hidden rounded-xl bg-[#1e2318] shadow-2xl shadow-black/40 ring-1 ring-[#8B9D5A]/10">
        <Toolbar editor={editor} />
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
