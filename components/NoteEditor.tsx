"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useEditor, EditorContent, useEditorState } from "@tiptap/react";
import { createPortal } from "react-dom";
import StarterKit from "@tiptap/starter-kit";
import UnderlineExtension from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import LinkExtension from "@tiptap/extension-link";
import ImageExtension from "@tiptap/extension-image";
import HighlightExtension from "@tiptap/extension-highlight";
import { Share2, Check, Home, FileText, Pencil, MoreHorizontal, ChevronRight, Trash2, RefreshCw, CheckCircle2, AlertCircle, WifiOff, Download } from "lucide-react";
import Image from "next/image";
import { supabase } from "@/lib/supabase-browser";
import { uploadImage } from "@/lib/upload";
import Toolbar from "./Toolbar";
import PasswordSetup from "./PasswordSetup";
import IconPicker, { DynamicIcon } from "./IconPicker";
import type { JSONContent, Editor } from "@tiptap/react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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

function CharCount({ editor, syncStatus }: { editor: Editor; syncStatus: SyncStatus }) {
  const { text, fullText } = useEditorState({
    editor,
    selector: (ctx) => {
      const doc = ctx.editor.state.doc;
      return {
        text: doc.textContent,
        fullText: doc.textBetween(0, doc.content.size, "\n"),
      };
    },
  });

  const chars = useMemo(() => (text || "").length, [text]);
  const words = useMemo(() => {
    const t = (fullText || "").trim();
    return t ? t.split(/\s+/).length : 0;
  }, [fullText]);
  const [showSyncTip, setShowSyncTip] = useState(false);

  const syncConfig = {
    syncing: { icon: <RefreshCw size={12} className="animate-spin text-[var(--accent)]" />, text: "Kaydediliyor..." },
    synced: { icon: <CheckCircle2 size={12} className="text-[var(--accent)]/50" />, text: "Kaydedildi" },
    error: { icon: <AlertCircle size={12} className="text-red-400 animate-pulse" />, text: "Kaydetme başarısız" },
    offline: { icon: <WifiOff size={12} className="text-amber-400/70 animate-pulse" />, text: "Çevrimdışı" },
  };
  const config = syncConfig[syncStatus];

  return (
    <div className="flex items-center justify-between border-t border-white/[0.04] px-4 py-2 text-[11px] tabular-nums text-white/30">
      <div
        className="relative flex items-center"
        onMouseEnter={() => setShowSyncTip(true)}
        onMouseLeave={() => setShowSyncTip(false)}
      >
        {config.icon}
        {showSyncTip && (
          <div className="pointer-events-none absolute bottom-full left-0 z-50 mb-1.5 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] text-white/85 shadow-xl shadow-black/20">
            {config.text}
          </div>
        )}
      </div>
      <span className="transition-all duration-300">{chars} karakter · {words} kelime</span>
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
  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [moreMenuPos, setMoreMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

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

  const handleRename = async () => {
    const slug = newName
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(
        /[^a-z0-9\u00C0-\u024F\u0100-\u017F\u011E\u011F\u0130\u0131\u015E\u015F\u00D6\u00F6\u00DC\u00FC\u00C7\u00E7-]+/g,
        ""
      )
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (!slug || slug === noteId) {
      setRenameError(slug === noteId ? "Aynı isim." : "Geçerli bir isim girin.");
      return;
    }

    setRenameLoading(true);
    setRenameError("");

    // Check if target name already exists
    const { data: existing } = await supabase
      .from("notes")
      .select("id")
      .eq("id", slug)
      .single();

    if (existing) {
      setRenameError("Bu isimle bir not zaten var.");
      setRenameLoading(false);
      return;
    }

    // Get current note data
    const { data: current } = await supabase
      .from("notes")
      .select("*")
      .eq("id", noteId)
      .single();

    if (!current) {
      setRenameError("Not bulunamadı.");
      setRenameLoading(false);
      return;
    }

    // Create new note with new id
    const { id: _oldId, ...rest } = current;
    const { error: insertError } = await supabase
      .from("notes")
      .insert({ id: slug, ...rest });

    if (insertError) {
      setRenameError("Yeniden adlandırılamadı.");
      setRenameLoading(false);
      return;
    }

    // Delete old note
    await supabase.from("notes").delete().eq("id", noteId);

    // Navigate to new URL
    router.replace(`/note/${encodeURIComponent(slug)}`);
  };

  const handleDelete = async () => {
    await supabase.from("notes").delete().eq("id", noteId);
    router.replace("/");
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
      HighlightExtension.configure({
        multicolor: true,
      }).extend({
        addKeyboardShortcuts() {
          return {
            "Mod-Shift-h": () =>
              this.editor.commands.toggleHighlight({
                color: "rgba(212, 228, 165, 0.30)",
              }),
          };
        },
      }),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class:
          "prose prose-invert max-w-none px-6 py-5 min-h-[60vh] outline-none text-white/85 leading-relaxed text-[15px]",
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



  // Close more menu on scroll
  useEffect(() => {
    const close = () => setMoreMenuOpen(false);
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, []);

  return (
    <div className="animate-fade-in-scale mx-auto w-full max-w-[52rem]">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0 pl-2">
          <Link
            href="/"
            className="flex-shrink-0 transition-opacity duration-200 hover:opacity-80"
          >
            <Image src="/ablam-1.webp" alt="Ablam Notepad" width={140} height={32} className="h-5 w-auto" />
          </Link>
          <ChevronRight size={12} className="hidden flex-shrink-0 text-white/40 sm:block" />
          <span className="hidden truncate text-xs text-white/70 sm:inline sm:max-w-[200px]" title={noteId}>
            {noteId}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-lg border border-transparent px-3 py-1.5 text-xs font-medium text-white/50 transition-all duration-200 hover:border-[var(--border)] hover:bg-white/[0.10] hover:text-white/85"
          >
            <Home size={13} />
            <span className="hidden sm:inline">Ana Sayfa</span>
          </Link>
          <button
            type="button"
            onClick={handleShare}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-200 ${copied
              ? "border-[var(--accent)]/20 bg-[var(--accent)]/10 text-[var(--accent-light)]"
              : "border-transparent text-white/50 hover:border-[var(--border)] hover:bg-white/[0.10] hover:text-white/85"
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

          {/* Separator */}
          <div className="mx-0.5 h-4 w-px bg-white/[0.08]" />

          {/* Password */}
          <PasswordSetup
            noteId={noteId}
            hasPassword={hasPassword}
            onPasswordChange={setHasPassword}
          />

          {/* More dropdown */}
          <div className="relative" ref={moreMenuRef}>
            <button
              type="button"
              onClick={(e) => {
                if (!moreMenuOpen) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setMoreMenuPos({ top: rect.bottom + 6, left: rect.right });
                }
                setMoreMenuOpen(!moreMenuOpen);
              }}
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-200 ${moreMenuOpen
                ? "bg-white/[0.08] text-white/85"
                : "text-white/50 hover:bg-white/[0.08] hover:text-white/85"
                }`}
            >
              <MoreHorizontal size={15} />
            </button>

            {moreMenuOpen && typeof window !== "undefined" &&
              createPortal(
                <div className="fixed inset-0 z-[55]" onClick={() => setMoreMenuOpen(false)}>
                  <div
                    className="fixed w-44 overflow-hidden rounded-xl border border-[var(--border)] bg-black/25 backdrop-blur-xl py-1 shadow-xl shadow-black/30"
                    style={{ top: moreMenuPos.top, left: moreMenuPos.left, transform: "translateX(-100%)" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                <button
                  type="button"
                  onClick={() => { setMoreMenuOpen(false); setNewName(noteId); setRenameError(""); setRenameOpen(true); }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-white/70 transition-all duration-100 hover:bg-white/[0.08] hover:text-white/95"
                >
                  <Pencil size={13} />
                  <span>Yeniden Adlandır</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setMoreMenuOpen(false); setIconPickerOpen(true); }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-white/70 transition-all duration-100 hover:bg-white/[0.08] hover:text-white/95"
                >
                  {noteIcon ? (
                    <DynamicIcon name={noteIcon} size={13} />
                  ) : (
                    <FileText size={13} />
                  )}
                  <span>İkon Değiştir</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    if (!editor) return;
                    const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n");
                    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${noteId}.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-white/70 transition-all duration-100 hover:bg-white/[0.08] hover:text-white/95"
                >
                  <Download size={13} />
                  <span>Dışa Aktar (.txt)</span>
                </button>
                <div className="my-1 h-px bg-white/[0.10]" />
                <button
                  type="button"
                  onClick={() => { setMoreMenuOpen(false); setDeleteConfirmOpen(true); }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-red-400/80 transition-all duration-100 hover:bg-red-500/[0.06] hover:text-red-300"
                >
                  <Trash2 size={13} />
                  <span>Notu Sil</span>
                </button>
                  </div>
                </div>,
                document.body
              )
            }
          </div>
        </div>
      </div>

      {/* Editor Card */}
      <div
        className="relative rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-2xl shadow-black/30"
        style={{
          boxShadow:
            "0 0 60px -12px rgba(212,228,165,0.08), 0 0 30px -8px rgba(212,228,165,0.05), 0 25px 50px -12px rgba(0,0,0,0.4)",
        }}
      >
        <Toolbar editor={editor} syncStatus={syncStatus} noteId={noteId} />
        <EditorContent editor={editor} />
        {/* Word/character counter */}
        {editor && <CharCount editor={editor} syncStatus={syncStatus} />}
      </div>

      {iconPickerOpen && (
        <IconPicker
          currentIcon={noteIcon}
          onSelect={handleIconSelect}
          onClose={() => setIconPickerOpen(false)}
        />
      )}

      {/* Rename popup */}
      {renameOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[60]">
            <div
              className="absolute inset-0 bg-black/40 animate-backdrop-blur"
              onClick={() => { setRenameOpen(false); setRenameError(""); }}
            />
            <div className="pointer-events-none relative flex h-full items-center justify-center">
              <div
                className="pointer-events-auto animate-fade-in-scale mx-4 w-full max-w-xs rounded-2xl border border-white/[0.12] bg-black/20 backdrop-blur-2xl p-6 shadow-2xl shadow-black/40"
                onClick={(e) => e.stopPropagation()}
              >
              <div className="mb-1 flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10">
                  <Pencil size={16} className="text-[var(--accent)]" />
                </div>
                <h3 className="text-sm font-semibold text-white/95">
                  Notu Yeniden Adlandır
                </h3>
              </div>

              <p className="mb-4 mt-3 text-[13px] leading-relaxed text-white/50">
                Notun yeni adını girin. Bu işlem notu yeni bir URL&apos;ye taşıyacak.
              </p>

              <form
                onSubmit={(e) => { e.preventDefault(); handleRename(); }}
                className="space-y-3"
              >
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => { setNewName(e.target.value); setRenameError(""); }}
                  placeholder="Yeni not adı"
                  autoFocus
                  className="focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 px-3 text-sm text-white/95 placeholder-white/30 transition-all"
                />
                {renameError && (
                  <p className="text-xs text-red-400">{renameError}</p>
                )}
                <div className="flex gap-2.5">
                  <button
                    type="button"
                    onClick={() => { setRenameOpen(false); setRenameError(""); }}
                    className="flex-1 rounded-xl border border-[var(--border)] bg-white/[0.10] px-4 py-2.5 text-xs font-medium text-white/70 transition-all hover:bg-white/[0.10] hover:text-white/85"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    disabled={renameLoading || !newName.trim()}
                    className="flex-1 rounded-xl bg-[var(--accent)]/15 px-4 py-2.5 text-xs font-medium text-[var(--accent-light)] transition-all hover:bg-[var(--accent)]/25 disabled:opacity-30"
                  >
                    {renameLoading ? "Taşınıyor..." : "Değiştir"}
                  </button>
                </div>
              </form>
            </div>
            </div>
          </div>,
          document.body
        )}

      {/* Delete confirmation popup */}
      {deleteConfirmOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[60]">
            <div
              className="absolute inset-0 bg-black/40 animate-backdrop-blur"
              onClick={() => setDeleteConfirmOpen(false)}
            />
            <div className="pointer-events-none relative flex h-full items-center justify-center">
              <div
                className="pointer-events-auto animate-fade-in-scale mx-4 w-full max-w-xs rounded-2xl border border-white/[0.12] bg-black/20 backdrop-blur-2xl p-6 shadow-2xl shadow-black/40"
                onClick={(e) => e.stopPropagation()}
              >
              <div className="mb-1 flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/10">
                  <Trash2 size={16} className="text-red-400" />
                </div>
                <h3 className="text-sm font-semibold text-white/95">
                  Notu Sil
                </h3>
              </div>

              <p className="mb-4 mt-3 text-[13px] leading-relaxed text-white/50">
                <strong className="text-white/85">{noteId}</strong> notunu silmek istediğinize emin misiniz? Bu işlem geri alınamaz.
              </p>

              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmOpen(false)}
                  className="flex-1 rounded-xl border border-[var(--border)] bg-white/[0.10] px-4 py-2.5 text-xs font-medium text-white/70 transition-all hover:bg-white/[0.10] hover:text-white/85"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="flex-1 rounded-xl bg-red-500/15 px-4 py-2.5 text-xs font-medium text-red-400 transition-all hover:bg-red-500/25"
                >
                  Sil
                </button>
              </div>
            </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
