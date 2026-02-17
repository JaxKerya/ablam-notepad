"use client";

import { useState } from "react";
import type { Editor } from "@tiptap/react";
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
} from "lucide-react";

interface ToolbarProps {
  editor: Editor | null;
  syncStatus: "synced" | "syncing";
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
        className={`relative rounded-lg p-2 transition-all duration-150 ${
          disabled
            ? "cursor-not-allowed text-gray-700"
            : isActive
              ? "text-[var(--accent-light)]"
              : "text-gray-500 hover:bg-white/[0.04] hover:text-gray-300"
        }`}
      >
        {icon}
        {/* Active underline */}
        <span
          className={`absolute bottom-0.5 left-1/2 h-[2px] -translate-x-1/2 rounded-full bg-[var(--accent)] transition-all duration-200 ${
            isActive && !disabled ? "w-3/5 opacity-100" : "w-0 opacity-0"
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
  return <div className="mx-1.5 h-5 w-px bg-white/[0.06]" />;
}

function NoteBadge({
  noteId,
  syncStatus,
}: {
  noteId: string;
  syncStatus: "synced" | "syncing";
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const isSyncing = syncStatus === "syncing";

  return (
    <div
      className="relative ml-auto flex items-center gap-1.5 rounded-lg bg-white/[0.03] px-2.5 py-1.5"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {isSyncing ? (
        <RefreshCw size={15} className="animate-spin text-[var(--accent)]" />
      ) : (
        <CheckCircle2 size={15} className="text-[var(--accent)]/50 transition-colors" />
      )}
      <span className="max-w-[110px] truncate text-xs text-gray-400 sm:max-w-[170px]">
        {noteId}
      </span>

      {showTooltip && (
        <div className="pointer-events-none absolute right-0 top-full z-50 mt-2 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs shadow-xl shadow-black/20">
          <span className="text-gray-300">
            {isSyncing ? "Kaydediliyor..." : "Kaydedildi"}
          </span>
        </div>
      )}
    </div>
  );
}

export default function Toolbar({ editor, syncStatus, noteId }: ToolbarProps) {
  if (!editor) return null;

  return (
    <div className="flex items-center gap-0.5 border-b border-white/[0.04] px-3 py-2">
      {/* Undo / Redo */}
      <ToolbarButton
        label="Geri Al"
        shortcut="Ctrl+Z"
        icon={<Undo2 size={16} />}
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
      />
      <ToolbarButton
        label="Yeniden Yap"
        shortcut="Ctrl+Y"
        icon={<Redo2 size={16} />}
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
      />

      <Separator />

      {/* Formatting */}
      <ToolbarButton
        label="Kalın"
        shortcut="Ctrl+B"
        icon={<Bold size={16} />}
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive("bold")}
      />
      <ToolbarButton
        label="İtalik"
        shortcut="Ctrl+I"
        icon={<Italic size={16} />}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive("italic")}
      />
      <ToolbarButton
        label="Altı Çizili"
        shortcut="Ctrl+U"
        icon={<Underline size={16} />}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor.isActive("underline")}
      />

      <Separator />

      {/* Lists */}
      <ToolbarButton
        label="Madde İşareti"
        icon={<List size={16} />}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive("bulletList")}
      />
      <ToolbarButton
        label="Numaralı Liste"
        icon={<ListOrdered size={16} />}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive("orderedList")}
      />
      <ToolbarButton
        label="Yapılacaklar"
        icon={<CheckSquare size={16} />}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        isActive={editor.isActive("taskList")}
      />

      {/* Note badge with integrated sync icon */}
      <NoteBadge noteId={noteId} syncStatus={syncStatus} />
    </div>
  );
}
