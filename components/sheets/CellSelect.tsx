"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { readableTextColor } from "@/lib/sheets";

export interface SelectOption {
  id: string;
  label: string;
  color?: string;
}

interface Props {
  value: string | null;
  options: SelectOption[];
  placeholder?: string;
  onChange: (id: string | null) => void;
  variant?: "badge" | "chip";
  allowClear?: boolean;
}

export default function CellSelect({
  value,
  options,
  placeholder = "—",
  onChange,
  variant = "chip",
  allowClear = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((o) => o.id === value) ?? null;

  useLayoutEffect(() => {
    if (open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setCoords({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 160) });
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

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-1 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-white/5"
      >
        {selected ? (
          variant === "badge" && selected.color ? (
            <span
              className="truncate rounded-md px-2 py-0.5 text-[11.5px] font-medium"
              style={{ background: selected.color, color: readableTextColor(selected.color) }}
            >
              {selected.label}
            </span>
          ) : (
            <span className="flex min-w-0 items-center gap-1.5">
              {selected.color && (
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: selected.color }}
                />
              )}
              <span className="truncate text-[12.5px] text-white/85">{selected.label}</span>
            </span>
          )
        ) : (
          <span className="text-[12.5px] text-white/25">{placeholder}</span>
        )}
        <ChevronDown size={13} className="shrink-0 text-white/30" />
      </button>

      {open &&
        coords &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
            <div
              className="animate-fade-in-scale fixed z-[61] max-h-64 overflow-y-auto rounded-xl border border-[var(--border)] bg-black/25 backdrop-blur-xl p-1 shadow-xl shadow-black/30"
              style={{ top: coords.top, left: coords.left, minWidth: coords.width }}
            >
              {allowClear && (
                <button
                  type="button"
                  onClick={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-white/45 transition-colors hover:bg-white/8"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/20" />
                  Boş
                  {value === null && <Check size={13} className="ml-auto text-[var(--accent)]" />}
                </button>
              )}
              {options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    onChange(o.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-white/85 transition-colors hover:bg-white/8"
                >
                  {o.color && (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: o.color }}
                    />
                  )}
                  <span className="truncate">{o.label}</span>
                  {value === o.id && <Check size={13} className="ml-auto text-[var(--accent)]" />}
                </button>
              ))}
            </div>
          </>,
          document.body
        )}
    </>
  );
}
