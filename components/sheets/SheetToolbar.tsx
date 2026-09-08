"use client";

import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { createPortal } from "react-dom";
import { Search, Users, Tag, ChevronDown, X, ArrowDownUp, Check } from "lucide-react";
import {
  type SheetAnimator,
  type SheetStatus,
  type SortState,
  type SortKey,
} from "@/lib/sheets";

interface Props {
  search: string;
  onSearch: (v: string) => void;
  animators: SheetAnimator[];
  statuses: SheetStatus[];
  filterAnimators: Set<string>;
  filterStatuses: Set<string>;
  onToggleAnimator: (id: string) => void;
  onToggleStatus: (id: string) => void;
  onClear: () => void;
  sort: SortState | null;
  onClearSort: () => void;
  visibleCount: number;
  totalCount: number;
}

const SORT_LABELS: Record<SortKey, string> = {
  position: "Manuel sıra",
  shot_code: "Shot kodu",
  frame_count: "Kare",
  animator: "Animatör",
  status: "Durum",
};

export default function SheetToolbar({
  search,
  onSearch,
  animators,
  statuses,
  filterAnimators,
  filterStatuses,
  onToggleAnimator,
  onToggleStatus,
  onClear,
  sort,
  onClearSort,
  visibleCount,
  totalCount,
}: Props) {
  const hasFilter =
    search.trim() !== "" || filterAnimators.size > 0 || filterStatuses.size > 0;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative min-w-[180px] flex-1">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Shot kodu veya notlarda ara..."
          className="focus-ring w-full rounded-xl border border-[var(--border)] bg-black/20 py-2 pl-9 pr-8 text-[13px] text-white placeholder:text-white/30"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <MultiFilter
        icon={<Users size={14} />}
        label="Animatör"
        options={animators.map((a) => ({ id: a.id, label: a.name, color: a.color }))}
        selected={filterAnimators}
        onToggle={onToggleAnimator}
      />
      <MultiFilter
        icon={<Tag size={14} />}
        label="Durum"
        options={statuses.map((s) => ({ id: s.id, label: s.name, color: s.color }))}
        selected={filterStatuses}
        onToggle={onToggleStatus}
      />

      {sort && sort.key !== "position" && (
        <button
          type="button"
          onClick={onClearSort}
          className="flex items-center gap-1.5 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-2 text-[12.5px] text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/15"
          title="Sıralamayı temizle"
        >
          <ArrowDownUp size={13} />
          {SORT_LABELS[sort.key]} {sort.dir === "asc" ? "↑" : "↓"}
          <X size={13} />
        </button>
      )}

      {hasFilter && (
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-[12.5px] text-white/55 transition-colors hover:bg-white/5 hover:text-white/85"
        >
          <X size={13} /> Filtreyi temizle
        </button>
      )}

      <span className="ml-auto whitespace-nowrap text-[12px] text-white/35">
        {hasFilter ? `${visibleCount} / ${totalCount}` : `${totalCount}`} shot
      </span>
    </div>
  );
}

interface FilterOption {
  id: string;
  label: string;
  color: string;
}

function MultiFilter({
  icon,
  label,
  options,
  selected,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  options: FilterOption[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setCoords({ top: r.bottom + 4, left: r.left });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const count = selected.size;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[12.5px] transition-colors ${
          count > 0
            ? "border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]"
            : "border-[var(--border)] text-white/55 hover:bg-white/5 hover:text-white/85"
        }`}
      >
        {icon}
        {label}
        {count > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-semibold text-[#2a3329]">
            {count}
          </span>
        )}
        <ChevronDown size={13} className="opacity-50" />
      </button>

      {open &&
        coords &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[var(--z-modal)]" onClick={() => setOpen(false)} />
            <div
              className="animate-fade-in-scale fixed z-[var(--z-menu)] max-h-72 min-w-[180px] overflow-y-auto rounded-xl border border-[var(--border)] glass-strong p-1 shadow-xl shadow-black/30"
              style={{ top: coords.top, left: coords.left }}
            >
              {options.length === 0 ? (
                <p className="px-2.5 py-2 text-[12px] text-white/35">Seçenek yok</p>
              ) : (
                options.map((o) => {
                  const on = selected.has(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => onToggle(o.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-white/85 transition-colors hover:bg-white/8"
                    >
                      <span
                        className={`flex h-[15px] w-[15px] items-center justify-center rounded border transition-all ${
                          on ? "border-[var(--accent)] bg-[var(--accent)] text-[#2a3329]" : "border-white/25"
                        }`}
                      >
                        {on && <Check size={10} strokeWidth={3} />}
                      </span>
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: o.color }} />
                      <span className="truncate">{o.label}</span>
                    </button>
                  );
                })
              )}
            </div>
          </>,
          document.body
        )}
    </>
  );
}
