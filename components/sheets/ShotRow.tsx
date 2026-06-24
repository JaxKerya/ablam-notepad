"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2, Copy, Check } from "lucide-react";
import CellSelect, { type SelectOption } from "@/components/sheets/CellSelect";
import ShotCodeGenerator from "@/components/sheets/ShotCodeGenerator";
import type { SheetPipelineColumn, SheetShot } from "@/lib/sheets";

interface Props {
  shot: SheetShot;
  index: number;
  columns: SheetPipelineColumn[];
  animatorOptions: SelectOption[];
  statusOptions: SelectOption[];
  namingPattern: string;
  selected: boolean;
  dragEnabled: boolean;
  onToggleSelect: (id: string, e: React.MouseEvent) => void;
  updateShot: (id: string, patch: Partial<SheetShot>, immediate?: boolean) => void;
  flush: (id: string) => void;
  togglePipeline: (shot: SheetShot, columnId: string) => void;
  duplicateShot: (id: string) => void;
  deleteShot: (id: string) => void;
}

export default function ShotRow({
  shot,
  index,
  columns,
  animatorOptions,
  statusOptions,
  namingPattern,
  selected,
  dragEnabled,
  onToggleSelect,
  updateShot,
  flush,
  togglePipeline,
  duplicateShot,
  deleteShot,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: shot.id,
    disabled: !dragEnabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    position: isDragging ? "relative" : undefined,
    zIndex: isDragging ? 20 : undefined,
  };

  const inputCls =
    "w-full rounded-md bg-transparent px-1.5 py-1 text-[12.5px] text-white/85 outline-none transition-colors placeholder:text-white/20 focus:bg-white/5";

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`group border-t border-[var(--border)] transition-colors ${
        selected ? "bg-[var(--accent)]/[0.07]" : "hover:bg-white/[0.025]"
      }`}
    >
      {/* select */}
      <td className="px-1 py-1 text-center">
        <button
          type="button"
          onClick={(e) => onToggleSelect(shot.id, e)}
          className={`mx-auto flex h-[16px] w-[16px] items-center justify-center rounded border transition-all ${
            selected
              ? "border-[var(--accent)] bg-[var(--accent)] text-[#2a3329]"
              : "border-white/25 hover:border-[var(--accent)]/60"
          }`}
        >
          {selected && <Check size={11} strokeWidth={3} />}
        </button>
      </td>

      {/* grip + index */}
      <td className="px-1 py-1">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            {...attributes}
            {...listeners}
            tabIndex={-1}
            className={`rounded p-0.5 text-white/15 transition-colors ${
              dragEnabled
                ? "cursor-grab hover:text-white/50 active:cursor-grabbing group-hover:text-white/30"
                : "cursor-not-allowed opacity-30"
            }`}
            title={dragEnabled ? "Sürükle" : "Sıralama/filtre açıkken sürüklenemez"}
          >
            <GripVertical size={13} />
          </button>
          <span className="w-5 text-center text-[11px] tabular-nums text-white/30">{index + 1}</span>
        </div>
      </td>

      {/* animator */}
      <td className="px-1 py-1">
        <CellSelect
          value={shot.animator_id}
          options={animatorOptions}
          placeholder="Animatör"
          onChange={(id) => updateShot(shot.id, { animator_id: id }, true)}
        />
      </td>

      {/* shot code + generator */}
      <td className="px-1 py-1">
        <div className="flex items-center gap-0.5">
          <input
            data-row={index}
            data-col="shot_code"
            value={shot.shot_code}
            onChange={(e) => updateShot(shot.id, { shot_code: e.target.value })}
            onBlur={() => flush(shot.id)}
            placeholder="Shot kodu..."
            className="w-full rounded-md bg-transparent px-1.5 py-1 font-mono text-[12px] text-white/90 outline-none transition-colors focus:bg-white/5"
          />
          <ShotCodeGenerator
            pattern={namingPattern}
            onApply={(code, frames) =>
              updateShot(
                shot.id,
                frames !== null && !shot.frame_count
                  ? { shot_code: code, frame_count: frames }
                  : { shot_code: code },
                true
              )
            }
          />
        </div>
      </td>

      {/* frame count */}
      <td className="px-1 py-1">
        <input
          data-row={index}
          data-col="frame_count"
          type="number"
          value={shot.frame_count || ""}
          onChange={(e) => updateShot(shot.id, { frame_count: parseInt(e.target.value) || 0 })}
          onBlur={() => flush(shot.id)}
          placeholder="0"
          className="w-full rounded-md bg-transparent px-1.5 py-1 text-center text-[12px] tabular-nums text-white/90 outline-none transition-colors focus:bg-white/5 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
      </td>

      {/* notes */}
      <td className="px-1 py-1">
        <input
          data-row={index}
          data-col="notes"
          value={shot.notes}
          onChange={(e) => updateShot(shot.id, { notes: e.target.value })}
          onBlur={() => flush(shot.id)}
          placeholder="Not ekle..."
          className={inputCls}
        />
      </td>

      {/* status */}
      <td className="px-1 py-1">
        <CellSelect
          value={shot.status_id}
          options={statusOptions}
          placeholder="Durum"
          variant="badge"
          onChange={(id) => updateShot(shot.id, { status_id: id }, true)}
        />
      </td>

      {/* pipeline columns */}
      {columns.map((c) => {
        const checked = !!shot.pipeline?.[c.id];
        return (
          <td key={c.id} className="px-1 py-1 text-center">
            <button
              type="button"
              onClick={() => togglePipeline(shot, c.id)}
              className={`mx-auto flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border transition-all ${
                checked
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[#2a3329]"
                  : "border-white/25 hover:border-[var(--accent)]/60 hover:bg-[var(--accent)]/10"
              }`}
            >
              {checked && <Check size={12} strokeWidth={3} />}
            </button>
          </td>
        );
      })}

      {/* revision */}
      <td className="px-1 py-1">
        <input
          data-row={index}
          data-col="revision_note"
          value={shot.revision_note}
          onChange={(e) => updateShot(shot.id, { revision_note: e.target.value })}
          onBlur={() => flush(shot.id)}
          placeholder="—"
          className="w-full rounded-md bg-transparent px-1.5 py-1 text-[12.5px] text-amber-200/80 outline-none transition-colors placeholder:text-white/20 focus:bg-white/5"
        />
      </td>

      {/* row actions */}
      <td className="px-1 py-1">
        <div className="flex items-center justify-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => duplicateShot(shot.id)}
            className="rounded-md p-1.5 text-white/20 transition-all hover:bg-white/10 hover:text-white/70"
            title="Çoğalt"
            tabIndex={-1}
          >
            <Copy size={13} />
          </button>
          <button
            type="button"
            onClick={() => deleteShot(shot.id)}
            className="rounded-md p-1.5 text-white/20 transition-all hover:bg-red-500/15 hover:text-red-400"
            title="Satırı sil"
            tabIndex={-1}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
}
