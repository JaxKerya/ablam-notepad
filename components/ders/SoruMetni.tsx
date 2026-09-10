"use client";

import { soruParcalari } from "@/lib/ders";

/**
 * Soru kökü. İki iş yapıyor:
 *
 * 1. OLUMSUZLUK VURGUSU. "değildir", "söylenemez", "yer almaz" gibi kelimeler
 *    koyu ve altı çizili basılıyor — ÖSYM'nin basılı kitapçıkta yaptığının
 *    aynısı. Sebebi ölçme hatasını azaltmak: soruyu bilen ama "değildir"i
 *    atlayan öğrenci, bildiği soruyu kaybediyor.
 *
 * 2. SATIR SONLARI. Öncüllü sorularda kök üç yargıyı alt alta sıralıyor
 *    (I. … II. … III. …). whitespace-pre-line olmadan hepsi tek paragrafa
 *    yapışıyor ve soru okunamaz hâle geliyor.
 *
 * Hem ders ekranı hem deneme ekranı aynı bileşeni kullanıyor; kural iki yere
 * kopyalanmasın diye ayrı dosyada.
 */
export default function SoruMetni({
  metin,
  className,
}: {
  metin: string;
  className?: string;
}) {
  return (
    <p className={`whitespace-pre-line ${className ?? ""}`}>
      {soruParcalari(metin).map((p, i) =>
        p.vurgulu ? (
          <strong
            key={i}
            className="font-semibold text-white underline decoration-white/40 underline-offset-2"
          >
            {p.metin}
          </strong>
        ) : (
          <span key={i}>{p.metin}</span>
        )
      )}
    </p>
  );
}
