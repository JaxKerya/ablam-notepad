"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import UnderlineExtension from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Share2, Check, Home } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import Toolbar from "./Toolbar";
import type { JSONContent } from "@tiptap/react";
import Link from "next/link";

type SyncStatus = "synced" | "syncing";

interface NoteEditorProps {
  noteId: string;
  initialContent: JSONContent;
}

export default function NoteEditor({ noteId, initialContent }: NoteEditorProps) {
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedJSONRef = useRef<string>("");
  const [copied, setCopied] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("synced");

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
          "prose prose-invert max-w-none px-6 py-4 min-h-[60vh] outline-none text-gray-200 leading-relaxed",
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
      },
    },
    onUpdate: ({ editor }) => {
      setSyncStatus("syncing");

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(async () => {
        const json = editor.getJSON();
        const jsonStr = JSON.stringify(json);

        if (jsonStr === lastSavedJSONRef.current) {
          setSyncStatus("synced");
          return;
        }

        try {
          lastSavedJSONRef.current = jsonStr;
          const { error } = await supabase
            .from("notes")
            .update({ content: json })
            .eq("id", noteId);

          if (error) {
            console.error("Kaydetme hatası:", error.message);
            lastSavedJSONRef.current = "";
          }
        } catch (err) {
          console.error("Kaydetme hatası:", err);
          lastSavedJSONRef.current = "";
        }
        setSyncStatus("synced");
      }, 500);
    },
  });

  // Store initial content hash
  useEffect(() => {
    lastSavedJSONRef.current = JSON.stringify(initialContent);
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
          if (incomingJSON === lastSavedJSONRef.current) return;

          // Skip if editor already has this content
          const currentJSON = JSON.stringify(editor.getJSON());
          if (currentJSON === incomingJSON) return;

          // Store cursor position
          const { from, to } = editor.state.selection;

          // Apply remote content
          lastSavedJSONRef.current = incomingJSON;
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

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex w-28 items-center">
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-400 transition-all hover:bg-white/10 hover:text-gray-200"
          >
            <Home size={14} />
            <span>Ana Sayfa</span>
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
        <Toolbar editor={editor} syncStatus={syncStatus} />
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
