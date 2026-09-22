"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

/**
 * Giriş alanı gibi görünen seçici. Yerel <select>'in açılan listesi işletim
 * sisteminin beyaz kutusu — temaya boyanamıyor. Sheets'teki CellSelect ile
 * aynı yaklaşım: düğme + portal'da cam menü. Klavye: Esc kapatır, ok tuşları
 * gezer, Enter seçer.
 */
export interface SeciciSecenek<T extends string | number> {
  deger: T;
  etiket: string;
  aciklama?: string;
}

export default function Secici<T extends string | number>({
  deger,
  secenekler,
  onChange,
  disabled,
  className = "",
}: {
  deger: T;
  secenekler: SeciciSecenek<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [acik, setAcik] = useState(false);
  const [odak, setOdak] = useState(0);
  const [yer, setYer] = useState<{ top: number; left: number; width: number } | null>(null);
  const dugmeRef = useRef<HTMLButtonElement>(null);
  const secili = secenekler.find((s) => s.deger === deger);

  useLayoutEffect(() => {
    if (!acik || !dugmeRef.current) return;
    const r = dugmeRef.current.getBoundingClientRect();
    // Alta sığmazsa üste aç
    const yukseklik = Math.min(secenekler.length * 38 + 8, 280);
    const top = r.bottom + yukseklik + 8 > window.innerHeight ? r.top - yukseklik - 4 : r.bottom + 4;
    setYer({ top, left: r.left, width: r.width });
    setOdak(Math.max(0, secenekler.findIndex((s) => s.deger === deger)));
  }, [acik, secenekler, deger]);

  useEffect(() => {
    if (!acik) return;
    const kapat = () => setAcik(false);
    const tus = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setAcik(false);
        dugmeRef.current?.focus();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOdak((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + secenekler.length) % secenekler.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        onChange(secenekler[odak].deger);
        setAcik(false);
        dugmeRef.current?.focus();
      }
    };
    window.addEventListener("scroll", kapat, true);
    window.addEventListener("resize", kapat);
    window.addEventListener("keydown", tus);
    return () => {
      window.removeEventListener("scroll", kapat, true);
      window.removeEventListener("resize", kapat);
      window.removeEventListener("keydown", tus);
    };
  }, [acik, odak, secenekler, onChange]);

  return (
    <>
      <button
        ref={dugmeRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={acik}
        onClick={() => setAcik((v) => !v)}
        className={`focus-ring flex w-full items-center justify-between gap-2 rounded-xl border bg-[var(--surface)] px-3.5 py-2.5 text-left text-[13.5px] text-white/90 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          acik ? "border-[var(--border-hover)]" : "border-[var(--border)] hover:border-[var(--border-hover)]"
        } ${className}`}
      >
        <span className="truncate">{secili?.etiket ?? "—"}</span>
        <ChevronDown size={14} className={`shrink-0 text-white/35 transition-transform duration-200 ${acik ? "rotate-180" : ""}`} />
      </button>

      {acik &&
        yer &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[var(--z-catch)]" onClick={() => setAcik(false)} />
            <div
              role="listbox"
              className="animate-fade-in-scale glass-strong fixed z-[var(--z-menu)] max-h-72 overflow-y-auto rounded-xl border border-[var(--border)] p-1 shadow-xl shadow-black/30"
              style={{ top: yer.top, left: yer.left, width: yer.width }}
            >
              {secenekler.map((s, i) => {
                const seciliMi = s.deger === deger;
                return (
                  <button
                    key={String(s.deger)}
                    type="button"
                    role="option"
                    aria-selected={seciliMi}
                    onMouseEnter={() => setOdak(i)}
                    onClick={() => {
                      onChange(s.deger);
                      setAcik(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                      i === odak ? "bg-white/[0.08] text-white/95" : "text-white/75"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{s.etiket}</span>
                      {s.aciklama && <span className="block truncate text-[11.5px] text-white/40">{s.aciklama}</span>}
                    </span>
                    {seciliMi && <Check size={13} className="shrink-0 text-[var(--accent)]" />}
                  </button>
                );
              })}
            </div>
          </>,
          document.body
        )}
    </>
  );
}
