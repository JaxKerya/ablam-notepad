"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw, Home, TriangleAlert } from "lucide-react";

/**
 * Hata sınırı. Önceden bir React hatası bütün sayfayı beyaz ekrana çeviriyordu:
 * ablam ne olduğunu anlamıyor, geri dönecek bir bağlantı bile bulamıyordu.
 *
 * Burada bilerek iki şey var: "tekrar dene" (çoğu hata geçici — ağ, yarış
 * durumu) ve ana sayfaya dönüş. Hata metni gösteriliyor ama teknik ayrıntı
 * (yığın izi) gösterilmiyor; onun yeri sunucu kayıtları.
 */
export default function Hata({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sunucu tarafındaki hatalarda digest, kaydı bulmanın tek yolu
    console.error("[ablam] beklenmeyen hata:", error);
  }, [error]);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-x-hidden px-5">
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% 0%, rgb(var(--accent-rgb) / 0.05) 0%, transparent 60%)",
        }}
      />

      <div className="glass relative z-10 w-full max-w-sm rounded-2xl border border-[var(--border)] p-7 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/10">
          <TriangleAlert size={24} className="text-amber-300/80" />
        </div>

        <h1 className="text-[17px] font-semibold text-white/95">Bir şeyler ters gitti</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-white/45">
          Beklenmeyen bir hata oldu. Genelde geçicidir — tekrar denemek çoğu zaman yeterli.
        </p>

        {error.digest && (
          <p className="mt-3 font-mono text-[11px] text-white/25">kod: {error.digest}</p>
        )}

        <div className="mt-6 flex gap-2">
          <button
            onClick={reset}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-[13px] font-medium text-[var(--background)] transition-colors hover:bg-[var(--accent-light)]"
          >
            <RotateCcw size={14} />
            Tekrar dene
          </button>
          <Link
            href="/"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-3 text-[13px] text-white/65 transition-colors hover:border-[var(--border-hover)] hover:text-white/90"
          >
            <Home size={14} />
            Ana sayfa
          </Link>
        </div>
      </div>
    </main>
  );
}
