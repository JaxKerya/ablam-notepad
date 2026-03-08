"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useEditor, EditorContent, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import UnderlineExtension from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import LinkExtension from "@tiptap/extension-link";
import ImageExtension from "@tiptap/extension-image";
import { Share2, Check, Home, FileText } from "lucide-react";
import Image from "next/image";
import { supabase } from "@/lib/supabase-browser";
import { uploadImage } from "@/lib/upload";
import Toolbar from "./Toolbar";
import PasswordSetup from "./PasswordSetup";
import IconPicker, { DynamicIcon } from "./IconPicker";
import type { JSONContent, Editor } from "@tiptap/react";
import Link from "next/link";

// Image extension with resizable width attribute
const CustomImage = ImageExtension.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: "100%",
        parseHTML: (element: HTMLElement) =>
          element.style.width || element.getAttribute("width") || "100%",
        renderHTML: (attributes: Record<string, string>) => ({
          style: `width: ${attributes.width}`,
        }),
      },
    };
  },
});

type SyncStatus = "synced" | "syncing" | "error" | "offline";

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
  hasPassword: boolean;
  initialIcon?: string | null;
}

export default function NoteEditor({ noteId, initialContent, hasPassword: initialHasPassword, initialIcon }: NoteEditorProps) {
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentSavesRef = useRef<Set<string>>(new Set());
  const pendingSaveRef = useRef<{ json: JSONContent; jsonStr: string } | null>(null);
  const isSavingRef = useRef(false);
  const lastSaveTimestampRef = useRef(0);
  const [copied, setCopied] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("synced");
  const [hasPassword, setHasPassword] = useState(initialHasPassword);
  const [noteIcon, setNoteIcon] = useState<string | null>(initialIcon ?? null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  const handleIconSelect = async (iconName: string) => {
    setNoteIcon(iconName);
    await supabase.from("notes").update({ icon: iconName }).eq("id", noteId);
  };

  const attemptSave = useCallback(async (json: JSONContent, jsonStr: string, retries = 0) => {
    // Don't attempt save if offline — store as pending
    if (!navigator.onLine) {
      pendingSaveRef.current = { json, jsonStr };
      setSyncStatus("offline");
      return;
    }

    try {
      isSavingRef.current = true;
      lastSaveTimestampRef.current = Date.now();
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
      // Keep isSaving flag up long enough for the echo to arrive and be ignored
      setTimeout(() => { isSavingRef.current = false; }, 2000);
    } catch (err) {
      console.error("Kaydetme hatası:", err);
      isSavingRef.current = false;
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
  }, [noteId]);

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
      LinkExtension.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "tiptap-link",
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      CustomImage.configure({
        HTMLAttributes: {
          class: "tiptap-image",
        },
      }),
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
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !event.dataTransfer?.files.length) return false;
        const file = Array.from(event.dataTransfer.files).find((f) =>
          f.type.startsWith("image/")
        );
        if (!file) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        uploadImage(file, noteId)
          .then((url) => {
            const node = view.state.schema.nodes.image.create({ src: url });
            if (pos != null) {
              const tr = view.state.tr.insert(pos, node);
              view.dispatch(tr);
            } else {
              view.dispatch(view.state.tr.replaceSelectionWith(node));
            }
          })
          .catch((err) => console.error("Görsel yükleme hatası:", err));
        return true;
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        const imageItem = Array.from(items).find((item) =>
          item.type.startsWith("image/")
        );
        if (!imageItem) return false;
        const file = imageItem.getAsFile();
        if (!file) return false;
        event.preventDefault();
        uploadImage(file, noteId)
          .then((url) => {
            const node = view.state.schema.nodes.image.create({ src: url });
            view.dispatch(view.state.tr.replaceSelectionWith(node));
          })
          .catch((err) => console.error("Görsel yapıştırma hatası:", err));
        return true;
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
        saveTimeoutRef.current = null;
      }, 800);
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

          // Skip if we are actively saving or just saved recently (echo suppression)
          if (isSavingRef.current) return;
          if (Date.now() - lastSaveTimestampRef.current < 2000) return;

          // Skip if there is a pending local save (user is still typing)
          if (saveTimeoutRef.current) return;

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

  // Online/offline detection — auto-retry pending saves on reconnect
  useEffect(() => {
    const goOffline = () => setSyncStatus("offline");
    const goOnline = () => {
      if (pendingSaveRef.current) {
        const { json, jsonStr } = pendingSaveRef.current;
        setSyncStatus("syncing");
        attemptSave(json, jsonStr);
      } else {
        setSyncStatus("synced");
      }
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    if (!navigator.onLine) setSyncStatus("offline");
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [attemptSave]);

  // Visibility API — flush pending save when tab hidden, retry when visible
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        // Flush pending debounced save immediately before tab goes to background
        if (saveTimeoutRef.current && editor) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
          const json = editor.getJSON();
          const jsonStr = JSON.stringify(json);
          if (!recentSavesRef.current.has(jsonStr)) {
            attemptSave(json, jsonStr);
          }
        }
      } else {
        // Tab came back — retry any pending save
        if (pendingSaveRef.current) {
          const { json, jsonStr } = pendingSaveRef.current;
          setSyncStatus("syncing");
          attemptSave(json, jsonStr);
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [editor, attemptSave]);

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
          className="pl-2 transition-opacity duration-200 hover:opacity-80"
        >
          <Image src="/ablam.png" alt="Ablam Notepad" width={140} height={32} className="h-5 w-auto" />
        </Link>

        <div className="flex items-center gap-1.5">
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-all duration-200 hover:border-[var(--border)] hover:bg-white/[0.03] hover:text-gray-300"
          >
            <Home size={13} />
            <span className="hidden sm:inline">Ana Sayfa</span>
          </Link>
          <PasswordSetup
            noteId={noteId}
            hasPassword={hasPassword}
            onPasswordChange={setHasPassword}
          />
          <button
            type="button"
            onClick={handleShare}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all duration-200 ${copied
              ? "border-[var(--accent)]/20 bg-[var(--accent)]/10 text-[var(--accent-light)]"
              : "border-transparent text-gray-500 hover:border-[var(--border)] hover:bg-white/[0.03] hover:text-gray-300"
              }`}
          >
            {copied ? (
              <>
                <Check size={13} />
                <span className="hidden sm:inline">Kopyalandı</span>
              </>
            ) : (
              <>
                <Share2 size={13} />
                <span className="hidden sm:inline">Paylaş</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setIconPickerOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-gray-500 transition-all duration-200 hover:border-[var(--border)] hover:bg-white/[0.03] hover:text-gray-300"
            title="İkon değiştir"
          >
            {noteIcon ? (
              <DynamicIcon name={noteIcon} size={15} />
            ) : (
              <FileText size={15} />
            )}
          </button>
        </div>
      </div>

      {/* Editor Card */}
      <div
        className="relative rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-2xl shadow-black/30"
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

      {iconPickerOpen && (
        <IconPicker
          currentIcon={noteIcon}
          onSelect={handleIconSelect}
          onClose={() => setIconPickerOpen(false)}
        />
      )}
    </div>
  );
}
