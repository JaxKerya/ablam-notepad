"use client";

import { useState, useRef, useEffect } from "react";
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { createPortal } from "react-dom";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  CheckSquare,
  Undo2,
  Redo2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Heading1,
  Heading2,
  Heading3,
  Pilcrow,
  Type,
  Link2,
  Unlink,
  ImagePlus,
  ImageUpscale,
  WifiOff,
  Highlighter,
  Quote,
  Code,
  Minus,
} from "lucide-react";
import { uploadImage } from "@/lib/upload";

interface ToolbarProps {
  editor: Editor | null;
  syncStatus: "synced" | "syncing" | "error" | "offline";
  noteId: string;
}

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
}

function ToolbarButton({
  onClick,
  isActive = false,
  disabled = false,
  icon,
  label,
  shortcut,
}: ToolbarButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        disabled={disabled}
        className={`relative rounded-lg p-[7px] transition-all duration-150 ${disabled
          ? "cursor-not-allowed text-white/20"
          : isActive
            ? "text-[var(--accent-light)]"
            : "text-white/50 hover:bg-white/[0.08] hover:text-white/85"
          }`}
      >
        {icon}
        <span
          className={`absolute bottom-0.5 left-1/2 h-[2px] -translate-x-1/2 rounded-full bg-[var(--accent)] transition-all duration-200 ${isActive && !disabled ? "w-3/5 opacity-100" : "w-0 opacity-0"
            }`}
        />
      </button>

      {showTooltip && (
        <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs shadow-xl shadow-black/20">
          <span className="text-white/85">{label}</span>
          {shortcut && (
            <span className="ml-2 rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-white/50">
              {shortcut}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Separator() {
  return <div className="mx-1.5 h-4 w-px flex-shrink-0 bg-white/[0.10]" />;
}

function NoteBadge({
  noteId,
  syncStatus,
}: {
  noteId: string;
  syncStatus: "synced" | "syncing" | "error" | "offline";
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  const syncIcon = {
    syncing: <RefreshCw size={15} className="animate-spin text-[var(--accent)]" />,
    synced: <CheckCircle2 size={15} className="text-[var(--accent)]/50 transition-colors" />,
    error: <AlertCircle size={15} className="text-red-400 animate-pulse" />,
    offline: <WifiOff size={15} className="text-amber-400/70 animate-pulse" />,
  }[syncStatus];

  const tooltipText = {
    syncing: "Kaydediliyor...",
    synced: "Kaydedildi",
    error: "Kaydetme başarısız!",
    offline: "Çevrimdışı — bağlantı bekleniyor",
  }[syncStatus];

  return (
    <div
      className={`relative ml-auto flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${syncStatus === "error" ? "bg-red-500/[0.06]" : syncStatus === "offline" ? "bg-amber-500/[0.06]" : "bg-white/[0.03]"
        }`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {syncIcon}

      {showTooltip && (
        <div className={`pointer-events-none absolute right-0 top-full z-50 mt-2 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs shadow-xl shadow-black/20 ${syncStatus === "error"
          ? "border-red-500/15 bg-red-950/80 text-red-300"
          : syncStatus === "offline"
            ? "border-amber-500/15 bg-amber-950/80 text-amber-300"
            : "border-[var(--border)] bg-[var(--surface)] text-white/85"
          }`}>
          {tooltipText}
        </div>
      )}
    </div>
  );
}

function LinkPopup({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(
    editor.getAttributes("link").href || ""
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    const href = url.startsWith("http") ? url : `https://${url}`;
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href })
      .run();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 animate-backdrop-blur"
      onClick={onClose}
    >
      <div
        className="animate-fade-in-scale mx-4 w-full max-w-xs rounded-2xl border border-[var(--border)] bg-[var(--surface-popup)] p-5 shadow-2xl shadow-black/40"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/95">
          <Link2 size={15} className="text-[var(--accent)]" />
          Link Ekle
        </h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            autoFocus
            className="focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 px-3 text-sm text-white/95 placeholder-white/30 transition-all"
          />
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-[var(--border)] bg-white/[0.03] px-4 py-2.5 text-xs font-medium text-white/70 transition-all hover:bg-white/[0.10] hover:text-white/85"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={!url.trim()}
              className="flex-1 rounded-xl bg-[var(--accent)]/15 px-4 py-2.5 text-xs font-medium text-[var(--accent-light)] transition-all hover:bg-[var(--accent)]/25 disabled:opacity-30"
            >
              Ekle
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const IMAGE_SIZES = [
  { label: "S", width: "25%" },
  { label: "M", width: "50%" },
  { label: "L", width: "75%" },
  { label: "Full", width: "100%" },
];

const HIGHLIGHT_COLORS = [
  { name: "Yeşil", color: "rgba(212, 228, 165, 0.30)" },
  { name: "Sarı", color: "rgba(234, 179, 8, 0.25)" },
  { name: "Mavi", color: "rgba(56, 189, 248, 0.20)" },
  { name: "Mor", color: "rgba(168, 85, 247, 0.25)" },
  { name: "Kırmızı", color: "rgba(248, 113, 113, 0.25)" },
  { name: "Turuncu", color: "rgba(251, 146, 60, 0.25)" },
];

export default function Toolbar({ editor, syncStatus, noteId }: ToolbarProps) {
  if (!editor) return null;
  return <ToolbarInner editor={editor} syncStatus={syncStatus} noteId={noteId} />;
}

function ToolbarInner({ editor, syncStatus, noteId }: { editor: Editor; syncStatus: ToolbarProps["syncStatus"]; noteId: string }) {
  const [linkPopupOpen, setLinkPopupOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageSizeOpen, setImageSizeOpen] = useState(false);
  const [headingOpen, setHeadingOpen] = useState(false);
  const [highlightOpen, setHighlightOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Close portaled dropdowns on scroll
  useEffect(() => {
    const close = () => { setHeadingOpen(false); setImageSizeOpen(false); setHighlightOpen(false); };
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, []);

  // Reactive editor state — ensures toolbar re-renders on selection/format changes
  const es = useEditorState({
    editor,
    selector: (ctx) => {
      const e = ctx.editor;
      return {
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        isH1: e.isActive("heading", { level: 1 }),
        isH2: e.isActive("heading", { level: 2 }),
        isH3: e.isActive("heading", { level: 3 }),
        isBold: e.isActive("bold"),
        isItalic: e.isActive("italic"),
        isUnderline: e.isActive("underline"),
        isStrike: e.isActive("strike"),
        isHighlight: e.isActive("highlight"),
        highlightColor: e.isActive("highlight")
          ? (e.getAttributes("highlight").color as string) || HIGHLIGHT_COLORS[0].color
          : null,
        isCode: e.isActive("code"),
        isBlockquote: e.isActive("blockquote"),
        isBulletList: e.isActive("bulletList"),
        isOrderedList: e.isActive("orderedList"),
        isTaskList: e.isActive("taskList"),
        isLink: e.isActive("link"),
        isImage: e.isActive("image"),
        selectionEmpty: e.state.selection.empty,
        imageWidth: e.isActive("image")
          ? (e.getAttributes("image").width as string) || "100%"
          : null,
      };
    },
  });

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const url = await uploadImage(file, noteId);
      editor.chain().focus().setImage({ src: url }).run();
    } catch (err) {
      console.error("Görsel yükleme hatası:", err);
      alert("Görsel yüklenemedi. Supabase Storage bucket'ını kontrol edin.");
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleLinkClick = () => {
    if (es.isLink) {
      editor.chain().focus().unsetLink().run();
    } else {
      setLinkPopupOpen(true);
    }
  };

  return (
    <>
      <div className="flex items-center gap-0 overflow-x-auto border-b border-white/[0.04] px-3 py-1.5 sm:overflow-x-visible scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* Undo / Redo */}
        <ToolbarButton
          label="Geri Al"
          shortcut="Ctrl+Z"
          icon={<Undo2 size={15} />}
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!es.canUndo}
        />
        <ToolbarButton
          label="Yeniden Yap"
          shortcut="Ctrl+Y"
          icon={<Redo2 size={15} />}
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!es.canRedo}
        />

        <Separator />

        {/* Block type dropdown trigger */}
        <div>
          <button
            type="button"
            onClick={(e) => {
              if (headingOpen) { setHeadingOpen(false); return; }
              const rect = e.currentTarget.getBoundingClientRect();
              setDropdownPos({ top: rect.bottom + 6, left: rect.left });
              setImageSizeOpen(false);
              setHeadingOpen(true);
            }}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-[7px] text-xs font-medium text-white/70 transition-all duration-150 hover:bg-white/[0.08] hover:text-white/95"
          >
            {es.isH1 ? <Heading1 size={15} className="text-[var(--accent-light)]" /> :
              es.isH2 ? <Heading2 size={15} className="text-[var(--accent-light)]" /> :
                es.isH3 ? <Heading3 size={15} className="text-[var(--accent-light)]" /> :
                  <Pilcrow size={15} />}
            <span className={es.isH1 || es.isH2 || es.isH3 ? "text-[var(--accent-light)]" : ""}>
              {es.isH1 ? "Başlık 1" : es.isH2 ? "Başlık 2" : es.isH3 ? "Başlık 3" : "Paragraf"}
            </span>
            <svg width="10" height="10" viewBox="0 0 10 10" className={`transition-transform duration-150 ${headingOpen ? "rotate-180" : ""}`}>
              <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>

        <Separator />

        {/* Formatting */}
        <ToolbarButton
          label="Kalın"
          shortcut="Ctrl+B"
          icon={<Bold size={15} />}
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={es.isBold}
        />
        <ToolbarButton
          label="İtalik"
          shortcut="Ctrl+I"
          icon={<Italic size={15} />}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={es.isItalic}
        />
        <ToolbarButton
          label="Altı Çizili"
          shortcut="Ctrl+U"
          icon={<Underline size={15} />}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={es.isUnderline}
        />
        <ToolbarButton
          label="Üstü Çizili"
          shortcut="Ctrl+Shift+S"
          icon={<Strikethrough size={15} />}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={es.isStrike}
        />

        <Separator />

        {/* Highlight color picker */}
        <div className="relative">
          <button
            type="button"
            onMouseEnter={() => setHighlightOpen(false)}
            onClick={(e) => {
              if (highlightOpen) { setHighlightOpen(false); return; }
              const rect = e.currentTarget.getBoundingClientRect();
              setDropdownPos({ top: rect.bottom + 6, left: rect.left });
              setHeadingOpen(false);
              setImageSizeOpen(false);
              setHighlightOpen(true);
            }}
            className={`peer relative rounded-lg p-[7px] transition-all duration-150 ${es.isHighlight ? "text-[var(--accent-light)]" : "text-white/50 hover:bg-white/[0.08] hover:text-white/85"}`}
          >
            <Highlighter size={15} />
            <span
              className={`absolute bottom-0.5 left-1/2 h-[2px] -translate-x-1/2 rounded-full transition-all duration-200 ${es.isHighlight ? "w-3/5 opacity-100" : "w-0 opacity-0"}`}
              style={{ backgroundColor: es.highlightColor || HIGHLIGHT_COLORS[0].color }}
            />
          </button>
          <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs opacity-0 shadow-xl shadow-black/20 transition-opacity peer-hover:opacity-100">
            <span className="text-white/85">Vurgula</span>
            <span className="ml-2 rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-white/50">Ctrl+Shift+H</span>
          </div>
        </div>
        <ToolbarButton
          label="Satır içi Kod"
          shortcut="Ctrl+E"
          icon={<Code size={15} />}
          onClick={() => editor.chain().focus().toggleCode().run()}
          isActive={es.isCode}
        />

        <Separator />

        {/* Lists */}
        <ToolbarButton
          label="Madde İşareti"
          icon={<List size={15} />}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={es.isBulletList}
        />
        <ToolbarButton
          label="Numaralı Liste"
          icon={<ListOrdered size={15} />}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={es.isOrderedList}
        />
        <ToolbarButton
          label="Yapılacaklar"
          icon={<CheckSquare size={15} />}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          isActive={es.isTaskList}
        />
        <ToolbarButton
          label="Alıntı"
          shortcut="Ctrl+Shift+B"
          icon={<Quote size={15} />}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={es.isBlockquote}
        />
        <ToolbarButton
          label="Yatay Çizgi"
          icon={<Minus size={15} />}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        />

        <Separator />

        {/* Link */}
        <ToolbarButton
          label={es.isLink ? "Linki Kaldır" : "Link Ekle"}
          icon={es.isLink ? <Unlink size={15} /> : <Link2 size={15} />}
          onClick={handleLinkClick}
          isActive={es.isLink}
          disabled={!es.isLink && es.selectionEmpty}
        />

        {/* Image */}
        <ToolbarButton
          label={uploading ? "Yükleniyor..." : "Görsel Ekle"}
          icon={<ImagePlus size={15} />}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          className="hidden"
        />

        {/* Image resize dropdown trigger — always visible, disabled when no image selected */}
        <div className="relative">
          <button
            type="button"
            disabled={!es.isImage}
            onClick={(e) => {
              if (!es.isImage) return;
              if (imageSizeOpen) { setImageSizeOpen(false); return; }
              const rect = e.currentTarget.getBoundingClientRect();
              setDropdownPos({ top: rect.bottom + 6, left: rect.left });
              setHeadingOpen(false);
              setImageSizeOpen(true);
            }}
            className={`peer flex items-center gap-1.5 rounded-lg px-2 py-[7px] text-xs font-semibold transition-all duration-150 ${!es.isImage
              ? "cursor-not-allowed text-white/20"
              : "text-[var(--accent-light)] hover:bg-white/[0.08]"
              }`}
          >
            <ImageUpscale size={15} />
            <span>{es.isImage ? es.imageWidth : "0%"}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" className={`transition-transform duration-150 ${imageSizeOpen ? "rotate-180" : ""}`}>
              <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
          </button>
          <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs opacity-0 shadow-xl shadow-black/20 transition-opacity peer-hover:opacity-100">
            <span className="text-white/85">Görsel Boyutu</span>
          </div>
        </div>



      </div>

      {/* Heading dropdown — portaled to body */}
      {headingOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[55]" onClick={() => setHeadingOpen(false)}>
            <div
              className="fixed w-36 overflow-hidden rounded-xl border border-[var(--border)] bg-black/25 backdrop-blur-xl py-1 shadow-xl shadow-black/30"
              style={{ top: dropdownPos.top, left: dropdownPos.left }}
              onClick={(e) => e.stopPropagation()}
            >
              {[
                { label: "Paragraf", icon: <Pilcrow size={14} />, active: !es.isH1 && !es.isH2 && !es.isH3, action: () => editor.chain().focus().setParagraph().run() },
                { label: "Başlık 1", icon: <Heading1 size={14} />, active: es.isH1, action: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
                { label: "Başlık 2", icon: <Heading2 size={14} />, active: es.isH2, action: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
                { label: "Başlık 3", icon: <Heading3 size={14} />, active: es.isH3, action: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    item.action();
                    setHeadingOpen(false);
                  }}
                  className={`flex w-full items-center gap-2.5 whitespace-nowrap px-3 py-2 text-xs transition-all duration-100 ${item.active
                    ? "bg-[var(--accent)]/10 text-[var(--accent-light)]"
                    : "text-white/70 hover:bg-white/[0.08] hover:text-white/95"
                    }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}

      {/* Image size dropdown — portaled to body */}
      {imageSizeOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[55]" onClick={() => setImageSizeOpen(false)}>
            <div
              className="fixed w-28 overflow-hidden rounded-xl border border-[var(--border)] bg-black/25 backdrop-blur-xl py-1 shadow-xl shadow-black/30"
              style={{ top: dropdownPos.top, left: dropdownPos.left }}
              onClick={(e) => e.stopPropagation()}
            >
              {IMAGE_SIZES.map((opt) => (
                <button
                  key={opt.width}
                  type="button"
                  onClick={() => {
                    editor
                      .chain()
                      .focus()
                      .updateAttributes("image", { width: opt.width })
                      .run();
                    setImageSizeOpen(false);
                  }}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-xs transition-all duration-100 ${es.imageWidth === opt.width
                    ? "bg-[var(--accent)]/10 text-[var(--accent-light)]"
                    : "text-white/70 hover:bg-white/[0.08] hover:text-white/95"
                    }`}
                >
                  <span>{opt.label}</span>
                  <span className="text-[10px] tabular-nums text-white/30">{opt.width}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}

      {/* Link popup — portaled to body to escape transform/overflow */}
      {linkPopupOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <LinkPopup editor={editor} onClose={() => setLinkPopupOpen(false)} />,
          document.body
        )}

      {/* Highlight color picker — portaled to body */}
      {highlightOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[55]" onClick={() => setHighlightOpen(false)}>
            <div
              className="fixed overflow-hidden rounded-xl border border-[var(--border)] bg-black/25 backdrop-blur-xl p-2 shadow-xl shadow-black/30"
              style={{ top: dropdownPos.top, left: dropdownPos.left }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex gap-1.5">
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c.color}
                    type="button"
                    title={c.name}
                    onClick={() => {
                      if (es.highlightColor === c.color) {
                        editor.chain().focus().unsetHighlight().run();
                      } else {
                        editor.chain().focus().toggleHighlight({ color: c.color }).run();
                      }
                      setHighlightOpen(false);
                    }}
                    className={`h-5 w-5 rounded-full border-2 transition-all duration-100 hover:scale-125 ${es.highlightColor === c.color ? "border-white/50 shadow-sm shadow-white/10" : "border-transparent"}`}
                    style={{ backgroundColor: c.color }}
                  />
                ))}
                <button
                  type="button"
                  title="Vurguyu Kaldır"
                  onClick={() => {
                    editor.chain().focus().unsetHighlight().run();
                    setHighlightOpen(false);
                  }}
                  className={`flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px] transition-all duration-100 hover:scale-125 ${!es.isHighlight ? "border-transparent text-white/20" : "border-transparent text-white/70 hover:text-white/95"}`}
                >
                  ✕
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
