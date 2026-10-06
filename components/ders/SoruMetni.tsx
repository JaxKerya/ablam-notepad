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
 * 3. ALTI ÇİZİLİ SÖZ. ÖSYM'nin çıkmış sorularında ("altı çizili sözle anlatılmak
 *    istenen…") çizgi sorunun parçası; metinde __böyle__ işaretli geliyor ve
 *    burada altı çizili basılıyor. Model üretimi sorularda bu işaret yok.
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
      {metin.split(/__(.+?)__/).map((bolum, j) =>
        // split'in tek indisleri yakalanan grup: altı çizili söz
        j % 2 === 1 ? (
          <span key={j} className="underline decoration-white/70 underline-offset-[3px]">
            {bolum}
          </span>
        ) : (
          soruParcalari(bolum).map((p, i) =>
            p.vurgulu ? (
              <strong
                key={`${j}-${i}`}
                className="font-semibold text-white underline decoration-white/40 underline-offset-2"
              >
                {p.metin}
              </strong>
            ) : (
              <span key={`${j}-${i}`}>{p.metin}</span>
            )
          )
        )
      )}
    </p>
  );
}
