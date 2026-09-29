"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import {
  DONEM_ETIKETI,
  SISTEM_ETIKETI,
  SISTEM_RENGI,
  SISTEM_YOLU,
  aylikTempo,
  dolar,
  dolarInce,
  donemBaslangici,
  grupla,
  gunlukSeri,
  kalemEtiketi,
  topla,
  type Donem,
  type Harcama,
  type MaliyetCevabi,
  type Sistem,
} from "@/lib/maliyet";

const SISTEMLER: Sistem[] = ["ders", "kariyer", "youtube"];

export default function MaliyetEkrani() {
  const [veri, setVeri] = useState<MaliyetCevabi | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [donem, setDonem] = useState<Donem>("30");
  /** Açık sistem kartı — ayrıntı (kalemler + işler) altında gösterilir */
  const [acik, setAcik] = useState<Sistem | null>(null);
  /** "şimdi": render içinde Date.now() çağrılmasın */
  const [simdi, setSimdi] = useState(0);

  useEffect(() => {
    queueMicrotask(async () => {
      try {
        const cevap = await fetch("/api/maliyet");
        if (!cevap.ok) throw new Error((await cevap.json().catch(() => ({}))).hata ?? `HTTP ${cevap.status}`);
        setVeri((await cevap.json()) as MaliyetCevabi);
      } catch (e) {
        setHata((e as Error).message);
      } finally {
        setSimdi(Date.now());
      }
    });
  }, []);

  const hesap = useMemo(() => {
    const tum = veri?.harcamalar ?? [];
    const baslangic = donemBaslangici(donem, simdi);
    const secili = tum.filter((h) => new Date(h.zaman).getTime() >= baslangic);
    const toplam = topla(secili);
    const sistemler = SISTEMLER.map((s) => {
      const liste = secili.filter((h) => h.sistem === s);
      return { sistem: s, liste, tutar: topla(liste), pay: toplam ? topla(liste) / toplam : 0 };
    }).sort((a, b) => b.tutar - a.tutar);
    return {
      secili,
      toplam,
      sistemler,
      tempo: aylikTempo(tum, simdi),
      seri: gunlukSeri(secili, donem === "7" ? 7 : 30, simdi),
      ilk: tum.length ? tum.reduce((e, h) => (h.zaman < e ? h.zaman : e), tum[0].zaman) : null,
    };
  }, [veri, donem, simdi]);

  const enBuyukGun = Math.max(...hesap.seri.map((g) => g.tutar), 0.0001);

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <Link
        href="/"
        className="glass fixed top-5 left-5 z-20 flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-[13px] text-white/55 transition-all hover:border-[var(--border-hover)] hover:text-white/85 sm:top-6 sm:left-7"
      >
        <ArrowLeft size={14} />
        <span>Ana sayfa</span>
      </Link>

      <div className="relative z-10 mx-auto w-full max-w-2xl px-4 pb-24 pt-24 sm:px-5 sm:pt-28">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-white/95">Maliyet</h1>
          <p className="mt-1 text-[13px] text-white/45">Üç sistemin yapay zekâ ve üretim harcaması, tek yerde.</p>
        </div>

        <div className="glass mb-6 flex rounded-xl border border-[var(--border)] p-1">
          {(Object.keys(DONEM_ETIKETI) as Donem[]).map((d) => (
            <button
              key={d}
              onClick={() => setDonem(d)}
              className={`flex-1 rounded-lg px-2 py-2 text-[12.5px] transition-colors sm:px-3 sm:text-[13px] ${
                donem === d ? "bg-[var(--accent)]/15 text-[var(--accent-light)]" : "text-white/45 hover:text-white/75"
              }`}
            >
              {DONEM_ETIKETI[d]}
            </button>
          ))}
        </div>

        {hata ? (
          <p className="rounded-xl border border-red-300/20 bg-red-400/[0.06] p-4 text-[13px] text-red-100/80">
            Maliyet okunamadı: {hata}
          </p>
        ) : veri === null ? (
          <div className="flex justify-center py-16 text-white/30">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : (
          <div className="space-y-6">
            {veri.hatalar.length > 0 && (
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-[12.5px] text-amber-100/85">
                Eksik veri: {veri.hatalar.map((h) => `${SISTEM_ETIKETI[h.sistem]} (${h.mesaj})`).join(", ")}. Aşağıdaki toplam bu sistemi içermiyor.
              </div>
            )}

            {/* Özet */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                [DONEM_ETIKETI[donem], dolar(hesap.toplam), "toplam harcama"],
                ["Aylık tempo", hesap.tempo != null ? dolar(hesap.tempo) : "—", "son 30 günün hızıyla"],
                ["Kayıt sayısı", String(hesap.secili.length), "harcama satırı"],
              ].map(([ad, deger, alt]) => (
                <div key={ad} className="glass rounded-xl border border-[var(--border)] px-4 py-3">
                  <p className="text-[11px] uppercase tracking-wider text-white/35">{ad}</p>
                  <p className="mt-1 text-[22px] font-semibold tabular-nums text-white/90">{deger}</p>
                  <p className="text-[11.5px] text-white/35">{alt}</p>
                </div>
              ))}
            </div>

            {/* Günlük seyir */}
            <section className="glass rounded-xl border border-[var(--border)] p-4">
              <h2 className="mb-3 text-[12px] font-medium uppercase tracking-wider text-white/40">
                Günlük seyir ({donem === "7" ? "7" : "30"} gün)
              </h2>
              <div className="flex h-20 items-end gap-[3px]">
                {hesap.seri.map((g) => (
                  <div
                    key={g.gun}
                    title={`${g.gun.split("-").slice(1).reverse().join(".")} · ${dolarInce(g.tutar)}`}
                    className="flex-1 rounded-sm bg-[var(--accent)]/45 transition-colors hover:bg-[var(--accent)]/80"
                    style={{ height: `${Math.max(2, (g.tutar / enBuyukGun) * 100)}%` }}
                  />
                ))}
              </div>
            </section>

            {/* Sistemler */}
            <section className="space-y-2">
              <h2 className="px-1 text-[12px] font-medium uppercase tracking-wider text-white/40">Sistemlere göre</h2>
              {hesap.toplam === 0 ? (
                <p className="px-1 text-[13px] text-white/35">Bu dönemde kayıt yok.</p>
              ) : (
                hesap.sistemler.map(({ sistem, liste, tutar, pay }) => (
                  <div key={sistem} className="glass overflow-hidden rounded-xl border border-[var(--border)]">
                    <button
                      onClick={() => setAcik(acik === sistem ? null : sistem)}
                      className="w-full px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[14px] text-white/85">{SISTEM_ETIKETI[sistem]}</span>
                        <span className="tabular-nums text-[14px] font-medium text-white/90">
                          {dolar(tutar)} <span className="text-[11.5px] font-normal text-white/35">· %{Math.round(pay * 100)}</span>
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                        <div className={`h-full rounded-full ${SISTEM_RENGI[sistem]}`} style={{ width: `${Math.max(1.5, pay * 100)}%` }} />
                      </div>
                    </button>

                    {acik === sistem && (
                      <div className="border-t border-[var(--border)] px-4 py-3">
                        {liste.length === 0 ? (
                          <p className="text-[12.5px] text-white/35">Bu dönemde kayıt yok.</p>
                        ) : (
                          <>
                            <ul className="space-y-1.5">
                              {grupla(liste, (h) => h.kalem).map((k) => (
                                <li key={k.ad} className="flex items-baseline justify-between text-[12.5px]">
                                  <span className="text-white/60">{kalemEtiketi(k.ad)}</span>
                                  <span className="tabular-nums text-white/75">
                                    {dolarInce(k.tutar)} <span className="text-[11px] text-white/30">· %{Math.round((k.tutar / tutar) * 100)}</span>
                                  </span>
                                </li>
                              ))}
                            </ul>
                            <IsListesi liste={liste} />
                            <Link
                              href={SISTEM_YOLU[sistem]}
                              className="mt-3 inline-block text-[11.5px] text-white/35 transition-colors hover:text-white/70"
                            >
                              {SISTEM_ETIKETI[sistem]}&apos;e git →
                            </Link>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </section>

            <p className="px-1 text-[11.5px] leading-relaxed text-white/30">
              Dil modeli ücretleri sağlayıcının (OpenRouter) bildirdiği gerçek tutar; seslendirme, sahne ve kapak
              stüdyo fiyat listesiyle hesaplanır. Sayılmayanlar: {veri.kapsamDisi.join("; ")}.
              {hesap.ilk && ` İlk kayıt ${new Date(hesap.ilk).toLocaleDateString("tr-TR", { day: "numeric", month: "long" })}.`}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

/** Sistemin en pahalı işleri — aynı ders/bölüm/gün tek satırda toplanır */
function IsListesi({ liste }: { liste: Harcama[] }) {
  const [hepsi, setHepsi] = useState(false);
  const isler = useMemo(() => {
    const m = new Map<string, { ad: string; tutar: number; zaman: string }>();
    for (const h of liste) {
      const g = m.get(h.grup) ?? { ad: h.ad, tutar: 0, zaman: h.zaman };
      g.tutar += h.tutar;
      if (h.zaman > g.zaman) g.zaman = h.zaman;
      m.set(h.grup, g);
    }
    return [...m.values()].sort((a, b) => b.tutar - a.tutar);
  }, [liste]);
  const gosterilen = hepsi ? isler : isler.slice(0, 5);

  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      <ul className="space-y-1">
        {gosterilen.map((i) => (
          <li key={i.ad + i.zaman} className="flex items-baseline gap-3 text-[12.5px]">
            <span className="min-w-0 flex-1 truncate text-white/70">{i.ad}</span>
            <span className="shrink-0 tabular-nums text-white/85">{dolarInce(i.tutar)}</span>
          </li>
        ))}
      </ul>
      {isler.length > 5 && (
        <button onClick={() => setHepsi((h) => !h)} className="mt-2 text-[11.5px] text-white/35 transition-colors hover:text-white/70">
          {hepsi ? "daha az" : `${isler.length - 5} tane daha`}
        </button>
      )}
    </div>
  );
}
