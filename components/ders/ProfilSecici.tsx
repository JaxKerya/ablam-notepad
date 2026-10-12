"use client";

import { useSyncExternalStore } from "react";
import { UserRound } from "lucide-react";
import { aktifProfil, PROFIL_ADI, PROFILLER, profilSec, type Profil } from "@/lib/profil";

/**
 * Ders sayfalarının sağ üst köşesindeki "Ablam | Ozi" seçicisi (bkz. lib/profil.ts).
 * Dersler ortak, cevaplar kişiye özel; seçim çerezde, her cihazda bir kez.
 *
 * Profil değişince sayfa yenileniyor: liste, ders kartlarındaki sayılar,
 * Yanlışlarım ve açık ders ekranı hepsi profile göre okunuyor — tek tek
 * tazelemek yerine baştan yüklemek hem basit hem eksiksiz.
 *
 * Sunucu çizimi boş (çerezi tarayıcıda okuyoruz): sunucu "ablam" çizip tarayıcı
 * "ozi" bulsaydı sayfa yüklenirken uyuşmazlık uyarısı çıkardı.
 */
const abone = () => () => {};
export default function ProfilSecici() {
  const profil = useSyncExternalStore<Profil | null>(abone, aktifProfil, () => null);
  if (!profil) return null;
  const sec = (p: Profil) => {
    if (p === profil) return;
    profilSec(p);
    window.location.reload();
  };
  return (
    <div
      role="group"
      aria-label="Kim çalışıyor"
      className="glass fixed top-5 right-5 z-20 flex items-center gap-0.5 rounded-xl border border-[var(--border)] p-1 sm:top-6 sm:right-7"
    >
      <UserRound size={13} className="ml-1.5 mr-0.5 text-white/40" aria-hidden />
      {PROFILLER.map((p) => (
        <button
          key={p}
          onClick={() => sec(p)}
          aria-pressed={p === profil}
          className={`rounded-lg px-2.5 py-1 text-[12.5px] transition-colors ${
            p === profil
              ? "bg-[var(--accent)]/15 font-medium text-[var(--accent-light)]"
              : "text-white/45 hover:bg-white/[0.06] hover:text-white/80"
          }`}
        >
          {PROFIL_ADI[p]}
        </button>
      ))}
    </div>
  );
}
