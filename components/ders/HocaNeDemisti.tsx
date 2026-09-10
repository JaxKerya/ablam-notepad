"use client";

import { useState } from "react";
import { Loader2, PlayCircle, Quote } from "lucide-react";
import { formatSure, videoLinki } from "@/lib/ders";
import type { Kanit } from "@/lib/kanit";

/**
 * "Hoca ne demişti?" — cevabın dersteki dayanağını gösterir.
 *
 * Neden var: sistemin en büyük riski yanlış cevap anahtarı ve ablamın onu
 * doğrulamanın hiçbir yolu yok — cevaba inanmak zorunda. Burası dersin kendi
 * cümlesini önüne koyuyor, yani "bize güven" yerine "bak, hoca şöyle demiş".
 *
 * İSTEK ÜZERİNE yükleniyor: her soruda kendiliğinden açılsaydı ekranı şişirir,
 * ayrıca çoğu zaman bakılmayacak bir şey için her soruda bir istek giderdi.
 *
 * Kanıt bulunamayabilir (ölçüm: sorularin ~yarısında bulunuyor). O durumda
 * dürüst bir cümle yazıyor; uydurma bir alıntı göstermek, hiçbir şey
 * göstermemekten kötü olurdu.
 */
export default function HocaNeDemisti({
  questionId,
  videoId,
  className = "",
}: {
  questionId: string;
  videoId: string | null;
  className?: string;
}) {
  const [durum, setDurum] = useState<"kapali" | "yukleniyor" | "acik">("kapali");
  const [kanit, setKanit] = useState<Kanit | null>(null);
  const [hata, setHata] = useState(false);

  const ac = async () => {
    if (durum !== "kapali") {
      setDurum("kapali");
      return;
    }
    if (kanit || hata) {
      setDurum("acik");
      return;
    }
    setDurum("yukleniyor");
    try {
      const res = await fetch("/api/ders/kanit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId }),
      });
      const veri = await res.json();
      if (!res.ok) throw new Error(veri?.hata ?? "Kanıt alınamadı.");
      setKanit(veri.kanit ?? null);
    } catch {
      setHata(true);
    } finally {
      setDurum("acik");
    }
  };

  /** Eşleşen kelimeleri vurgulayarak basar */
  const parcalar = () => {
    if (!kanit) return null;
    const cikti: React.ReactNode[] = [];
    let son = 0;
    kanit.vurgular.forEach((v, i) => {
      if (v.bas > son) cikti.push(<span key={`d${i}`}>{kanit.metin.slice(son, v.bas)}</span>);
      cikti.push(
        <mark key={`v${i}`} className="rounded bg-[var(--accent)]/20 px-0.5 text-[var(--accent-light)]">
          {kanit.metin.slice(v.bas, v.bas + v.uzunluk)}
        </mark>
      );
      son = v.bas + v.uzunluk;
    });
    if (son < kanit.metin.length) cikti.push(<span key="son">{kanit.metin.slice(son)}</span>);
    return cikti;
  };

  return (
    <div className={className}>
      <button
        onClick={ac}
        className="flex items-center gap-1.5 text-[11.5px] text-white/35 transition-colors hover:text-white/70"
      >
        {durum === "yukleniyor" ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Quote size={12} />
        )}
        Hoca ne demişti?
      </button>

      {durum === "acik" && (
        <div className="animate-fade-in mt-2 rounded-xl border border-[var(--border)] bg-black/15 p-3">
          {kanit ? (
            <>
              <p className="text-[12px] leading-relaxed text-white/60">“{parcalar()}”</p>
              {videoId && (
                <a
                  href={videoLinki(videoId, kanit.saniye)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-[var(--accent)]/70 transition-colors hover:text-[var(--accent)]"
                >
                  <PlayCircle size={11} />
                  {formatSure(kanit.saniye)} — burayı dinle
                </a>
              )}
            </>
          ) : (
            <p className="text-[11.5px] leading-relaxed text-white/35">
              {hata
                ? "Şu an bakılamadı, birazdan tekrar dener misin?"
                : "Bu cevabın dersteki karşılığını bulamadım. Altyazı bozuk olabilir ya da hoca " +
                  "bunu başka bir yerde anlatmış olabilir — videoyu o andan açıp kendin bakabilirsin."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
