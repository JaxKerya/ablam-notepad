"use client";

import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { createPortal } from "react-dom";
import { Wand2, Check } from "lucide-react";
import { buildShotName, framesFromRange } from "@/lib/sheets";

interface Props {
  pattern: string;
  onApply: (code: string, frames: number | null) => void;
}

export default function ShotCodeGenerator({ pattern, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [episode, setEpisode] = useState("");
  const [shot, setShot] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [version, setVersion] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);

  const preview = pattern.trim()
    ? buildShotName(pattern, { episode, shot, start, end, version })
    : [episode, shot, start, end, version].map((v) => v.trim()).filter(Boolean).join("_");
  const startN = parseInt(start);
  const endN = parseInt(end);
  const frames =
    Number.isFinite(startN) && Number.isFinite(endN) ? framesFromRange(startN, endN) : null;

  useLayoutEffect(() => {
    if (open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const width = 280;
      let left = r.left;
      if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
      setCoords({ top: r.bottom + 6, left: Math.max(12, left) });
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

  const apply = () => {
    onApply(preview, frames);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="shrink-0 rounded-md p-1 text-white/25 transition-colors hover:bg-[var(--accent)]/15 hover:text-[var(--accent)]"
        title="Shot kodu üret"
        tabIndex={-1}
      >
        <Wand2 size={13} />
      </button>

      {open &&
        coords &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
            <div
              className="animate-fade-in-scale fixed z-[61] w-[280px] rounded-xl border border-[var(--border)] bg-black/25 backdrop-blur-xl p-3.5 shadow-xl shadow-black/30"
              style={{ top: coords.top, left: coords.left }}
            >
              <p className="mb-2.5 text-[12px] font-medium text-white/70">Shot Kodu Üreteci</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Bölüm" value={episode} onChange={setEpisode} placeholder="E08" />
                <Field label="Shot" value={shot} onChange={setShot} placeholder="S01" />
                <Field label="Başlangıç" value={start} onChange={setStart} placeholder="101" />
                <Field label="Bitiş" value={end} onChange={setEnd} placeholder="168" />
                <Field label="Versiyon" value={version} onChange={setVersion} placeholder="V01" />
              </div>

              <div className="mt-3 rounded-lg border border-[var(--border)] bg-black/25 px-2.5 py-2">
                <p className="break-all font-mono text-[12px] text-[var(--accent-light)]">
                  {preview || "—"}
                </p>
                {frames !== null && (
                  <p className="mt-0.5 text-[10.5px] text-white/40">{frames} kare</p>
                )}
              </div>

              <button
                type="button"
                onClick={apply}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] py-2 text-[12.5px] font-medium text-[#2a3329] transition-colors hover:bg-[var(--accent-light)]"
              >
                <Check size={14} /> Uygula
              </button>
            </div>
          </>,
          document.body
        )}
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] text-white/45">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="focus-ring w-full rounded-md border border-[var(--border)] bg-black/20 px-2 py-1.5 font-mono text-[12px] text-white placeholder:text-white/25"
      />
    </label>
  );
}
