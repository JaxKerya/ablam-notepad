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
        className={`rounded-md p-2 transition-colors duration-150 ${
          disabled
            ? "cursor-not-allowed text-gray-700"
            : isActive
              ? "bg-[#8B9D5A]/20 text-[#b5c87a]"
              : "text-gray-500 hover:bg-white/5 hover:text-gray-300"
        }`}
      >
        {icon}
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#2a2f22] px-2.5 py-1.5 text-xs shadow-lg ring-1 ring-[#8B9D5A]/15">
          <span className="text-gray-300">{label}</span>
          {shortcut && (
            <span className="ml-1.5 text-gray-500">{shortcut}</span>
          )}
        </div>
      )}
    </div>
  );
}

function Separator() {
  return <div className="mx-1 h-5 w-px bg-[#8B9D5A]/15" />;
}

function SyncIndicator({ status }: { status: "synced" | "syncing" }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const isSyncing = status === "syncing";

  return (
    <div
      className="relative ml-auto"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="rounded-md p-2">
        {isSyncing ? (
          <RefreshCw size={16} className="animate-spin text-[#8B9D5A]" />
        ) : (
          <CheckCircle2 size={16} className="text-[#8B9D5A]/70" />
        )}
      </div>

      {showTooltip && (
        <div className="pointer-events-none absolute right-0 top-full z-50 mt-1.5 whitespace-nowrap rounded-md bg-[#2a2f22] px-2.5 py-1.5 text-xs shadow-lg ring-1 ring-[#8B9D5A]/15">
          <span className="text-gray-300">
            {isSyncing ? "Kaydediliyor..." : "Kaydedildi"}
          </span>
        </div>
      )}
    </div>
  );
}

export default function Toolbar({ editor, syncStatus }: ToolbarProps) {
  if (!editor) return null;

  return (
    <div className="flex items-center gap-0.5 border-b border-[#8B9D5A]/15 px-3 py-1.5">
      {/* Undo / Redo */}
      <ToolbarButton
        label="Geri Al"
        shortcut="Ctrl+Z"
        icon={<Undo2 size={18} />}
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
      />
      <ToolbarButton
        label="Yeniden Yap"
        shortcut="Ctrl+Y"
        icon={<Redo2 size={18} />}
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
      />

      <Separator />

      {/* Formatting */}
      <ToolbarButton
        label="Kalın"
        shortcut="Ctrl+B"
        icon={<Bold size={18} />}
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive("bold")}
      />
      <ToolbarButton
        label="İtalik"
        shortcut="Ctrl+I"
        icon={<Italic size={18} />}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive("italic")}
      />
      <ToolbarButton
        label="Altı Çizili"
        shortcut="Ctrl+U"
        icon={<Underline size={18} />}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor.isActive("underline")}
      />

      <Separator />

      {/* Lists */}
      <ToolbarButton
        label="Madde İşareti"
        icon={<List size={18} />}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive("bulletList")}
      />
      <ToolbarButton
        label="Numaralı Liste"
        icon={<ListOrdered size={18} />}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive("orderedList")}
      />
      <ToolbarButton
        label="Yapılacaklar"
        icon={<CheckSquare size={18} />}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        isActive={editor.isActive("taskList")}
      />

      {/* Sync status - right side */}
      <SyncIndicator status={syncStatus} />
    </div>
  );
}
