"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { KALEM_ETIKETI, dolar, type Bolum, type MaliyetKalemi, type MaliyetKaydi } from "@/lib/ablam-youtube";

type Donem = "30" | "ay" | "tum";
const DONEM_ETIKETI: Record<Donem, string> = { "30": "Son 30 gün", ay: "Bu ay", tum: "Tümü" };
const KALEMLER = Object.keys(KALEM_ETIKETI) as MaliyetKalemi[];
const GUN_MS = 86_400_000;

type BolumOzet = Pick<Bolum, "id" | "konu" | "baslik" | "yt_baslik" | "yayin_zamani" | "created_at">;

export default function MaliyetEkrani() {
  const [kayitlar, setKayitlar] = useState<MaliyetKaydi[] | null>(null);
  const [bolumler, setBolumler] = useState<BolumOzet[]>([]);
  const [hata, setHata] = useState<string | null>(null);
  const [donem, setDonem] = useState<Donem>("30");
  /** "şimdi": render içinde Date.now() çağrılmasın */
  const [simdi, setSimdi] = useState(0);

  useEffect(() => {
    queueMicrotask(async () => {
      const [m, b] = await Promise.all([
        supabase.from("youtube_maliyet").select("*").order("zaman", { ascending: false }).limit(10000),
        supabase.from("youtube_bolumler").select("id,konu,baslik,yt_baslik,yayin_zamani,created_at"),
      ]);
      if (m.error) setHata(m.error.message);
      setKayitlar(((m.data ?? []) as MaliyetKaydi[]).map((k) => ({ ...k, tutar: Number(k.tutar) })));
      setBolumler((b.data ?? []) as BolumOzet[]);
      setSimdi(Date.now());
    });
  }, []);

  const hesap = useMemo(() => {
    const tum = kayitlar ?? [];
    const ayBasi = new Date(simdi);
    ayBasi.setDate(1);
    ayBasi.setHours(0, 0, 0, 0);
    const baslangic = donem === "30" ? simdi - 30 * GUN_MS : donem === "ay" ? ayBasi.getTime() : 0;
    const secili = tum.filter((k) => new Date(k.zaman).getTime() >= baslangic);
    const toplam = secili.reduce((t, k) => t + k.tutar, 0);
    const son30 = tum.filter((k) => new Date(k.zaman).getTime() >= simdi - 30 * GUN_MS).reduce((t, k) => t + k.tutar, 0);

    const kalemToplam = Object.fromEntries(KALEMLER.map((k) => [k, 0])) as Record<MaliyetKalemi, number>;
    for (const k of secili) kalemToplam[k.kalem] += k.tutar;

    // Bölüm başına: dönemde kaydı olan bölümler; senaryosu olanlar "tam bölüm" sayılır (ortalama için)
    const grup = new Map<string, { kalem: Record<MaliyetKalemi, number>; toplam: number; son: string; tahmini: boolean }>();
    const bagsiz = { toplam: 0, adet: 0 };
    for (const k of secili) {
      if (!k.bolum_id) {
        bagsiz.toplam += k.tutar;
        bagsiz.adet += 1;
        continue;
      }
      const g = grup.get(k.bolum_id) ?? {
        kalem: Object.fromEntries(KALEMLER.map((x) => [x, 0])) as Record<MaliyetKalemi, number>,
        toplam: 0,
        son: k.zaman,
        tahmini: false,
      };
      g.kalem[k.kalem] += k.tutar;
      g.toplam += k.tutar;
      if (k.zaman > g.son) g.son = k.zaman;
      g.tahmini ||= k.tahmini;
      grup.set(k.bolum_id, g);
    }
    const tam = [...grup.values()].filter((g) => g.kalem.senaryo > 0 && g.kalem.ses > 0);
    const ortalama = tam.length ? tam.reduce((t, g) => t + g.toplam, 0) / tam.length : null;
    const satirlar = [...grup.entries()].sort((a, b) => b[1].son.localeCompare(a[1].son));
    const tahminiVar = secili.some((k) => k.tahmini);
    const ilkKayit = tum.filter((k) => !k.tahmini).at(-1)?.zaman ?? null;
    return { toplam, son30, kalemToplam, ortalama, tamAdet: tam.length, satirlar, bagsiz, tahminiVar, ilkKayit };
  }, [kayitlar, donem, simdi]);

  const bolumAdi = (id: string) => {
    const b = bolumler.find((x) => x.id === id);
    return b ? (b.yt_baslik ?? b.baslik ?? b.konu).split(" | ")[0] : "Silinmiş bölüm";
  };
  const enBuyukKalem = Math.max(...KALEMLER.map((k) => hesap.kalemToplam[k]), 0.0001);

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <Link
        href="/youtube"
        className="glass fixed top-5 left-5 z-20 flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-[13px] text-white/55 transition-all hover:border-[var(--border-hover)] hover:text-white/85 sm:top-6 sm:left-7"
      >
        <ArrowLeft size={14} />
        <span>YouTube</span>
      </Link>

      <div className="relative z-10 mx-auto w-full max-w-2xl px-4 pb-24 pt-24 sm:px-5 sm:pt-28">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-white/95">Maliyet</h1>
          <p className="mt-1 text-[13px] text-white/45">Stüdyonun ücretli işleri: dil modelleri, seslendirme, sahne ve kapak üretimi.</p>
        </div>

        <div className="glass mb-6 flex rounded-xl border border-[var(--border)] p-1">
          {(Object.keys(DONEM_ETIKETI) as Donem[]).map((d) => (
            <button
              key={d}
              onClick={() => setDonem(d)}
              className={`flex-1 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                donem === d ? "bg-[var(--accent)]/15 text-[var(--accent-light)]" : "text-white/45 hover:text-white/75"
              }`}
            >
              {DONEM_ETIKETI[d]}
            </button>
          ))}
        </div>

        {hata ? (
          <p className="rounded-xl border border-red-300/20 p-4 text-[13px] text-red-100/80">
            Kayıtlar okunamadı: {hata}. <code>db/youtube-maliyet.sql</code> çalıştırıldı mı?
          </p>
        ) : kayitlar === null ? (
          <div className="flex justify-center py-16 text-white/30">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Özet */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                [DONEM_ETIKETI[donem], dolar(hesap.toplam), "toplam harcama"],
                ["Bölüm başına", hesap.ortalama != null ? dolar(hesap.ortalama) : "—", `${hesap.tamAdet} tam bölümün ortalaması`],
                ["Son 30 günde", dolar(hesap.son30), "aylık tempo"],
              ].map(([ad, deger, alt]) => (
                <div key={ad} className="glass rounded-xl border border-[var(--border)] px-4 py-3">
                  <p className="text-[11px] uppercase tracking-wider text-white/35">{ad}</p>
                  <p className="mt-1 text-[22px] font-semibold tabular-nums text-white/90">{deger}</p>
                  <p className="text-[11.5px] text-white/35">{alt}</p>
                </div>
              ))}
            </div>

            {/* Kalemler */}
            <section className="glass rounded-xl border border-[var(--border)] p-4">
              <h2 className="mb-3 text-[12px] font-medium uppercase tracking-wider text-white/40">Kalemlere göre</h2>
              {hesap.toplam === 0 ? (
                <p className="text-[13px] text-white/35">Bu dönemde kayıt yok.</p>
              ) : (
                <ul className="space-y-2.5">
                  {KALEMLER.filter((k) => hesap.kalemToplam[k] > 0)
                    .sort((a, b) => hesap.kalemToplam[b] - hesap.kalemToplam[a])
                    .map((k) => {
                      const t = hesap.kalemToplam[k];
                      return (
                        <li key={k} title={`${KALEM_ETIKETI[k]}: ${dolar(t)} (%${Math.round((t / hesap.toplam) * 100)})`}>
                          <div className="flex items-baseline justify-between text-[13px]">
                            <span className="text-white/75">{KALEM_ETIKETI[k]}</span>
                            <span className="tabular-nums text-white/85">
                              {dolar(t)} <span className="text-[11.5px] text-white/35">· %{Math.round((t / hesap.toplam) * 100)}</span>
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                            <div className="h-full rounded-full bg-[var(--accent)]/70" style={{ width: `${Math.max(1.5, (t / enBuyukKalem) * 100)}%` }} />
                          </div>
                        </li>
                      );
                    })}
                </ul>
              )}
            </section>

            {/* Bölümler */}
            <section>
              <h2 className="mb-2 px-1 text-[12px] font-medium uppercase tracking-wider text-white/40">Bölümler</h2>
              <div className="space-y-1.5">
                {hesap.satirlar.map(([id, g]) => (
                  <div key={id} className="glass rounded-xl border border-[var(--border)] px-3.5 py-2.5">
                    <div className="flex items-baseline gap-3">
                      <p className="min-w-0 flex-1 truncate text-[13.5px] text-white/85">{bolumAdi(id)}</p>
                      <p className="shrink-0 tabular-nums text-[14px] font-medium text-white/90">
                        {g.tahmini ? "~" : ""}
                        {dolar(g.toplam)}
                      </p>
                    </div>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-white/40">
                      {KALEMLER.filter((k) => g.kalem[k] > 0)
                        .map((k) => `${KALEM_ETIKETI[k]} ${dolar(g.kalem[k])}`)
                        .join(" · ")}
                    </p>
                  </div>
                ))}
                {hesap.bagsiz.toplam > 0 && (
                  <div className="rounded-xl border border-dashed border-white/10 px-3.5 py-2.5">
                    <div className="flex items-baseline gap-3">
                      <p className="min-w-0 flex-1 text-[13px] text-white/60">Bölüme bağlı olmayanlar</p>
                      <p className="shrink-0 tabular-nums text-[14px] text-white/80">{dolar(hesap.bagsiz.toplam)}</p>
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-white/35">Genel sahneler, seri kapak kimlikleri ({hesap.bagsiz.adet} kayıt)</p>
                  </div>
                )}
                {hesap.satirlar.length === 0 && hesap.bagsiz.toplam === 0 && (
                  <p className="px-1 text-[13px] text-white/35">Bu dönemde kayıt yok.</p>
                )}
              </div>
            </section>

            <p className="px-1 text-[11.5px] leading-relaxed text-white/30">
              Dil modelleri OpenRouter&apos;ın bildirdiği gerçek tutarla kaydedilir; seslendirme, sahne ve kapak stüdyo
              ayarlarındaki fiyat listesiyle hesaplanır (config.toml [maliyet]).
              {hesap.ilkKayit && ` Düzenli kayıt ${new Date(hesap.ilkKayit).toLocaleDateString("tr-TR", { day: "numeric", month: "long" })} tarihinde başladı.`}
              {hesap.tahminiVar && " “~” işaretli tutarlar, kayıt başlamadan önceki bölümler için eski günlüklerden çıkarılmış tahminlerdir."}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
