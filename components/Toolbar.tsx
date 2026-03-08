"use client";

import { useState, useRef } from "react";
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { createPortal } from "react-dom";
import {
  Bold,
  Italic,
  Underline,
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
  WifiOff,
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
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        disabled={disabled}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`relative rounded-lg p-2 transition-all duration-150 ${disabled
          ? "cursor-not-allowed text-gray-700"
          : isActive
            ? "text-[var(--accent-light)]"
            : "text-gray-500 hover:bg-white/[0.04] hover:text-gray-300"
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
          <span className="text-gray-300">{label}</span>
          {shortcut && (
            <span className="ml-2 rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-gray-500">
              {shortcut}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Separator() {
  return <div className="mx-1.5 h-5 w-px flex-shrink-0 bg-white/[0.06]" />;
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
      className={`relative ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors ${syncStatus === "error" ? "bg-red-500/[0.06]" : syncStatus === "offline" ? "bg-amber-500/[0.06]" : "bg-white/[0.03]"
        }`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {syncIcon}
      <span className={`max-w-[110px] truncate text-xs sm:max-w-[170px] ${syncStatus === "error" ? "text-red-400/80" : syncStatus === "offline" ? "text-amber-400/80" : "text-gray-400"
        }`}>
        {noteId}
      </span>

      {showTooltip && (
        <div className={`pointer-events-none absolute right-0 top-full z-50 mt-2 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs shadow-xl shadow-black/20 ${syncStatus === "error"
          ? "border-red-500/15 bg-red-950/80 text-red-300"
          : syncStatus === "offline"
            ? "border-amber-500/15 bg-amber-950/80 text-amber-300"
            : "border-[var(--border)] bg-[var(--surface)] text-gray-300"
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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="animate-fade-in-scale mx-4 w-full max-w-xs rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5 shadow-2xl shadow-black/40"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-200">
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
            className="focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 px-3 text-sm text-gray-200 placeholder-gray-600 transition-all"
          />
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-[var(--border)] bg-white/[0.03] px-4 py-2.5 text-xs font-medium text-gray-400 transition-all hover:bg-white/[0.06] hover:text-gray-300"
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

export default function Toolbar({ editor, syncStatus, noteId }: ToolbarProps) {
  if (!editor) return null;
  return <ToolbarInner editor={editor} syncStatus={syncStatus} noteId={noteId} />;
}

function ToolbarInner({ editor, syncStatus, noteId }: { editor: Editor; syncStatus: ToolbarProps["syncStatus"]; noteId: string }) {
  const [linkPopupOpen, setLinkPopupOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageSizeOpen, setImageSizeOpen] = useState(false);
  const [headingOpen, setHeadingOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-white/[0.04] px-3 py-2 sm:overflow-x-visible scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* Undo / Redo */}
        <ToolbarButton
          label="Geri Al"
          shortcut="Ctrl+Z"
          icon={<Undo2 size={16} />}
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!es.canUndo}
        />
        <ToolbarButton
          label="Yeniden Yap"
          shortcut="Ctrl+Y"
          icon={<Redo2 size={16} />}
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
            className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-400 transition-all duration-150 hover:bg-white/[0.04] hover:text-gray-200"
          >
            {es.isH1 ? <Heading1 size={14} className="text-[var(--accent-light)]" /> :
              es.isH2 ? <Heading2 size={14} className="text-[var(--accent-light)]" /> :
                es.isH3 ? <Heading3 size={14} className="text-[var(--accent-light)]" /> :
                  <Pilcrow size={14} />}
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
          icon={<Bold size={16} />}
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={es.isBold}
        />
        <ToolbarButton
          label="İtalik"
          shortcut="Ctrl+I"
          icon={<Italic size={16} />}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={es.isItalic}
        />
        <ToolbarButton
          label="Altı Çizili"
          shortcut="Ctrl+U"
          icon={<Underline size={16} />}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={es.isUnderline}
        />

        <Separator />

        {/* Lists */}
        <ToolbarButton
          label="Madde İşareti"
          icon={<List size={16} />}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={es.isBulletList}
        />
        <ToolbarButton
          label="Numaralı Liste"
          icon={<ListOrdered size={16} />}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={es.isOrderedList}
        />
        <ToolbarButton
          label="Yapılacaklar"
          icon={<CheckSquare size={16} />}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          isActive={es.isTaskList}
        />

        <Separator />

        {/* Link */}
        <ToolbarButton
          label={es.isLink ? "Linki Kaldır" : "Link Ekle"}
          icon={es.isLink ? <Unlink size={16} /> : <Link2 size={16} />}
          onClick={handleLinkClick}
          isActive={es.isLink}
          disabled={!es.isLink && es.selectionEmpty}
        />

        {/* Image */}
        <ToolbarButton
          label={uploading ? "Yükleniyor..." : "Görsel Ekle"}
          icon={<ImagePlus size={16} />}
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

        {/* Image resize dropdown trigger — shown when an image is selected */}
        {es.isImage && (
          <>
            <Separator />
            <div>
              <button
                type="button"
                onClick={(e) => {
                  if (imageSizeOpen) { setImageSizeOpen(false); return; }
                  const rect = e.currentTarget.getBoundingClientRect();
                  setDropdownPos({ top: rect.bottom + 6, left: rect.left });
                  setHeadingOpen(false);
                  setImageSizeOpen(true);
                }}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-[var(--accent-light)] transition-all duration-150 hover:bg-white/[0.04]"
              >
                <span>{es.imageWidth}</span>
                <svg width="10" height="10" viewBox="0 0 10 10" className={`transition-transform duration-150 ${imageSizeOpen ? "rotate-180" : ""}`}>
                  <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
                </svg>
              </button>
            </div>
          </>
        )}

        {/* Note badge */}
        <NoteBadge noteId={noteId} syncStatus={syncStatus} />
      </div>

      {/* Heading dropdown — portaled to body */}
      {headingOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[55]" onClick={() => setHeadingOpen(false)}>
            <div
              className="fixed w-36 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-xl shadow-black/30"
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
                    : "text-gray-400 hover:bg-white/[0.04] hover:text-gray-200"
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
              className="fixed w-28 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-xl shadow-black/30"
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
                    : "text-gray-400 hover:bg-white/[0.04] hover:text-gray-200"
                    }`}
                >
                  <span>{opt.label}</span>
                  <span className="text-[10px] tabular-nums text-gray-600">{opt.width}</span>
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
    </>
  );
}
