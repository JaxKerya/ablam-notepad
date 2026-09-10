"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  PlayCircle,
  ThumbsDown,
  TriangleAlert,
} from "lucide-react";
import {
  formatSure,
  tarihMetni,
  videoLinki,
  SUPADATA_AYLIK_KOTA,
  VERDICT_LABEL,
  VERDICT_STYLE,
  type DenetimAdimi,
  type DenetimKaydi,
  type DenetimOzeti,
  type Verdict,
} from "@/lib/ders";

export interface AiViewOturum {
  id: string;
  title: string | null;
  created_at: string;
  status: string;
  video_id: string;
  /** 'tekrar' oturumları üretilmedi, kopyalandı — denetim sekmesine girmezler */
  tur?: string;
  denetim: DenetimOzeti | null;
}

export interface AiViewCevap {
  session_id: string;
  video_id: string;
  verdict: string | null;
  feedback: string | null;
  user_answer: string | null;
  missing: string[];
  created_at: string;
  soru: string;
  kind: string;
  answer_key: string | null;
  start_seconds: number;
}

export interface AiViewIsaretli {
  id: string;
  session_id: string;
  oturumAdi: string;
  video_id: string;
  question: string;
  kind: string;
  choices: string[] | null;
  correct_index: number | null;
  explanation: string | null;
  answer_key: string | null;
  start_seconds: number;
  /** Ablamın kendi cümlesiyle itirazı — prompt'u düzeltmek için en iyi malzeme */
  geri_bildirim: string | null;
  /** hakli | haksiz | yazilamadi | gerekcesiz */
  geri_bildirim_karari: string | null;
  geri_bildirim_gerekce: string | null;
}

interface Props {
  oturumlar: AiViewOturum[];
  cevaplar: AiViewCevap[];
  isaretliler: AiViewIsaretli[];
  /** Bu ayın başı (ISO) — harcama şeridi bu tarihten sonrasını topluyor */
  ayBasi: string;
  buAyCekilen: number;
  buAyElle: number;
}

const ADIM_ADI: Record<string, string> = {
  acik: "Açık uçlu üretimi",
  coktan: "Çoktan seçmeli üretimi",
  not: "Ders notu çıkarma",
};

/**
 * İşlem etiketleri. "anahtar" ayrı renkte, çünkü sistemin en yüksek sonuçlu
 * müdahalesi o: denetim cevap anahtarını değiştirmiş demektir.
 */
const ISLEM: Record<string, { ad: string; sinif: string }> = {
  anahtar: { ad: "cevap anahtarı değişti", sinif: "border-amber-400/40 bg-amber-400/10 text-amber-200" },
  "anahtar-duzeltildi": { ad: "beklenen cevap düzeltildi", sinif: "border-amber-400/30 bg-amber-400/[0.07] text-amber-200/90" },
  sik: { ad: "şık metni düzeltildi", sinif: "border-sky-400/30 bg-sky-400/[0.07] text-sky-200" },
  aciklama: { ad: "açıklama düzeltildi", sinif: "border-sky-400/25 bg-sky-400/[0.05] text-sky-200/80" },
  "aciklama-dusuruldu": { ad: "açıklama kaldırıldı", sinif: "border-white/15 bg-white/[0.04] text-white/55" },
  elendi: { ad: "soru elendi", sinif: "border-red-400/40 bg-red-400/10 text-red-300" },
  "bicim-elendi": { ad: "biçimden elendi", sinif: "border-red-400/25 bg-red-400/[0.06] text-red-300/80" },
};

const KATMAN: Record<string, string> = {
  transkript: "transkript denetimi",
  olgu: "olgu denetimi",
  bicim: "biçim doğrulaması",
};

const sayi = (n: number) => n.toLocaleString("tr");

/** Uzun ham metinleri açılır kapanır gösteren ortak blok */
function HamBlok({ baslik, metin }: { baslik: string; metin: string }) {
  const [acik, setAcik] = useState(false);
  return (
    <div className="mt-2">
      <button
        onClick={() => setAcik((a) => !a)}
        className="flex items-center gap-1 text-[11px] text-white/35 transition-colors hover:text-white/65"
      >
        {acik ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {baslik} ({sayi(metin.length)} karakter)
      </button>
      {acik && (
        <pre className="mt-1.5 max-h-80 overflow-auto rounded-lg border border-[var(--border)] bg-black/25 p-2.5 text-[10.5px] leading-relaxed whitespace-pre-wrap break-words text-white/55">
          {metin}
        </pre>
      )}
    </div>
  );
}

function KayitSatiri({ k }: { k: DenetimKaydi }) {
  const e = ISLEM[k.islem] ?? { ad: k.islem, sinif: "border-white/15 bg-white/[0.04] text-white/55" };
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className={`rounded-md border px-1.5 py-0.5 text-[10.5px] ${e.sinif}`}>{e.ad}</span>
        {k.sebep && <span className="text-[11px] text-white/40">{k.sebep}</span>}
        <span className="text-[11px] text-white/25">· {KATMAN[k.katman] ?? k.katman}</span>
      </div>
      <p className="text-[12.5px] leading-relaxed text-white/75">{k.soru}</p>
      {(k.eski || k.yeni) && (
        <div className="mt-1.5 space-y-1 border-l-2 border-white/10 pl-2.5">
          {k.eski && (
            <p className="text-[11.5px] leading-relaxed text-red-300/60 line-through decoration-red-300/30">
              {k.eski}
            </p>
          )}
          {k.yeni && (
            <p className="text-[11.5px] leading-relaxed text-[var(--accent-light)]/85">{k.yeni}</p>
          )}
        </div>
      )}
      {k.gerekce && (
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-white/40">
          <span className="text-white/25">gerekçe: </span>
          {k.gerekce}
        </p>
      )}
      {/* Elenen sorunun tam hâli: "bu eleme doğru muydu?" ancak böyle bakılır */}
      {k.tamMetin && <HamBlok baslik="elenen sorunun tam hâli" metin={k.tamMetin} />}
    </div>
  );
}

function AdimBlogu({ a }: { a: DenetimAdimi }) {
  const token = (a.uretimGirdiToken ?? 0) + (a.uretimCiktiToken ?? 0);
  const denetimToken = a.gecisler.reduce((t, g) => t + g.girdiToken + g.ciktiToken, 0);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/[0.015] p-3.5">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[12.5px] font-medium text-white/85">{ADIM_ADI[a.adim] ?? a.adim}</span>
        <span className="text-[11.5px] text-white/45">
          {sayi(a.uretilen)} üretildi → {sayi(a.nihai)} kaldı
          <span className="text-white/25"> (hedef {sayi(a.hedef)})</span>
        </span>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5 text-[11px]">
        {a.uretimSn !== undefined && (
          <span className="rounded-md border border-[var(--border)] px-1.5 py-0.5 text-white/45">
            üretim {a.uretimSn.toFixed(1)} sn · {sayi(token)} token
            {a.uretimModeli && <span className="text-white/30"> · {a.uretimModeli}</span>}
          </span>
        )}
        {a.gecisler.map((g, i) => (
          <span
            key={i}
            className={`rounded-md border px-1.5 py-0.5 ${
              g.valf
                ? "border-red-400/45 bg-red-400/10 text-red-300"
                : "border-[var(--border)] text-white/45"
            }`}
          >
            {g.valf && <TriangleAlert size={10} className="mr-1 inline align-[-1px]" />}
            {KATMAN[g.katman]}: {g.bulgu} bulgu
            {g.valf && " — VALF DEVREDE, hiçbiri uygulanmadı"}
            {!g.valf && ` · ${g.sn.toFixed(1)} sn`}
            {g.model && <span className="text-white/25"> · {g.model}</span>}
          </span>
        ))}
        {denetimToken > 0 && (
          <span className="rounded-md border border-[var(--border)] px-1.5 py-0.5 text-white/35">
            denetim {sayi(denetimToken)} token
          </span>
        )}
      </div>

      {a.bicimElenen && Object.keys(a.bicimElenen).length > 0 && (
        <p className="mb-2 text-[11.5px] text-white/40">
          biçimden elenen:{" "}
          {Object.entries(a.bicimElenen)
            .map(([s, n]) => `${s} (${n})`)
            .join(", ")}
        </p>
      )}

      {/* Valfe takılan geçişin ham cevabı: atılan bulguların tek kaydı */}
      {a.gecisler
        .filter((g) => g.hamCevap)
        .map((g, i) => (
          <HamBlok
            key={i}
            baslik={`atılan bulgular — ${KATMAN[g.katman]} ham cevabı`}
            metin={g.hamCevap!}
          />
        ))}

      {a.kayitlar.length > 0 ? (
        <div className="space-y-1.5">
          {a.kayitlar.map((k, i) => (
            <KayitSatiri key={i} k={k} />
          ))}
        </div>
      ) : (
        <p className="text-[11.5px] text-white/25">Bu adımda hiçbir müdahale olmadı.</p>
      )}

      {a.hamUretim && <HamBlok baslik="üretim modelinin ham çıktısı" metin={a.hamUretim} />}
    </div>
  );
}

type Sekme = "denetim" | "degerlendirme" | "isaretli";

export default function AiView({
  oturumlar,
  cevaplar,
  isaretliler,
  ayBasi,
  buAyCekilen,
  buAyElle,
}: Props) {
  const [sekme, setSekme] = useState<Sekme>("denetim");
  const [acik, setAcik] = useState<Set<string>>(new Set());
  const [hepsi, setHepsi] = useState(false);

  const toplam = useMemo(() => {
    let duzeltilen = 0, elenen = 0, valf = 0, token = 0;
    for (const o of oturumlar) {
      const d = o.denetim;
      if (!d) continue;
      duzeltilen += d.duzeltilen ?? 0;
      elenen += d.elenen ?? 0;
      for (const a of d.adimlar ?? []) {
        token += (a.uretimGirdiToken ?? 0) + (a.uretimCiktiToken ?? 0);
        for (const g of a.gecisler) {
          token += g.girdiToken + g.ciktiToken;
          if (g.valf) valf++;
        }
      }
    }
    return { duzeltilen, elenen, valf, token };
  }, [oturumlar]);

  /**
   * Bu ayın harcaması. Token sayıları zaten her adımın kaydında duruyor ama
   * hiçbir yerde toplanmıyordu — ders başına bakılabiliyor, aya bakılamıyordu.
   *
   * PARA GÖSTERİLMİYOR, bilerek: fiyat tablosu tutmak gerekir, sağlayıcı
   * fiyatı değişince tablo bayatlar ve ekranda yanlış bir sayı durur. Token
   * dürüst; oran değişmediği sürece karşılaştırma yapmaya da yeter.
   */
  const buAy = useMemo(() => {
    const esik = new Date(ayBasi).getTime();
    let ders = 0, uretim = 0, denetim = 0;
    for (const o of oturumlar) {
      if (o.tur === "tekrar") continue; // pratik model çağırmıyor
      if (new Date(o.created_at).getTime() < esik) continue;
      ders++;
      for (const a of o.denetim?.adimlar ?? []) {
        uretim += (a.uretimGirdiToken ?? 0) + (a.uretimCiktiToken ?? 0);
        for (const g of a.gecisler) denetim += g.girdiToken + g.ciktiToken;
      }
    }
    return { ders, uretim, denetim, toplam: uretim + denetim };
  }, [oturumlar, ayBasi]);

  const gosterilen = useMemo(
    () =>
      // Pratik oturumları denetim sekmesinde yok: onlarda üretim de denetim de
      // olmadı, sorular mevcut derslerden kopyalandı. Listede görünselerdi
      // "ayrıntılı kayıt eklenmeden önce üretilmiş" diye yanlış bir şey derlerdi.
      (hepsi
        ? oturumlar
        : oturumlar.filter((o) =>
            (o.denetim?.adimlar ?? []).some(
              (a) => a.kayitlar.length > 0 || a.gecisler.some((g) => g.valf)
            )
          )
      ).filter((o) => o.tur !== "tekrar"),
    [oturumlar, hepsi]
  );

  const acikUclular = useMemo(() => cevaplar.filter((c) => c.kind === "acik"), [cevaplar]);

  /**
   * İşaretli soru ile denetim kaydını eşleştirir. Kayıtlarda soru metni 120
   * karaktere kırpılı olduğu için önek karşılaştırması yapılıyor — kesin değil,
   * o yüzden sonuç "denetim bu soruya dokunmuştu" ipucu olarak sunuluyor.
   */
  const denetimIzi = useMemo(() => {
    const harita = new Map<string, DenetimKaydi[]>();
    for (const o of oturumlar) {
      const kayitlar = (o.denetim?.adimlar ?? []).flatMap((a) => a.kayitlar);
      if (kayitlar.length) harita.set(o.id, kayitlar);
    }
    return (q: AiViewIsaretli) =>
      (harita.get(q.session_id) ?? []).filter((k) => {
        const onek = k.soru.replace(/…$/, "");
        return onek.length > 20 && q.question.startsWith(onek);
      });
  }, [oturumlar]);

  const cevir = (id: string) =>
    setAcik((s) => {
      const y = new Set(s);
      if (y.has(id)) y.delete(id);
      else y.add(id);
      return y;
    });

  const damgaBaglantisi = (videoId: string, saniye: number, etiket: string) =>
    videoId ? (
      <a
        href={videoLinki(videoId, saniye)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[11px] text-[var(--accent)]/70 transition-colors hover:text-[var(--accent)]"
      >
        <PlayCircle size={11} />
        {etiket} {formatSure(saniye)}
      </a>
    ) : (
      <span className="text-[11px] text-white/30">
        {etiket} {formatSure(saniye)}
      </span>
    );

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% 0%, rgb(var(--accent-rgb) / 0.05) 0%, transparent 60%)",
        }}
      />

      <Link
        href="/ders"
        className="glass fixed top-5 left-5 z-20 flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-[13px] text-white/55 transition-all hover:border-[var(--border-hover)] hover:text-white/85 sm:top-6 sm:left-7"
      >
        <ArrowLeft size={14} />
        <span>Dersler</span>
      </Link>

      <div className="relative z-10 mx-auto max-w-3xl px-5 pb-20 pt-24 sm:pt-28">
        <h1 className="text-xl font-semibold text-white/95">AI görünümü</h1>
        <p className="mt-1.5 max-w-xl text-[12.5px] leading-relaxed text-white/40">
          Denetimin ne yaptığının kaydı: hangi soruya ne yapıldı, hangi gerekçeyle, hangi katman
          buldu. Denetimin <span className="text-white/60">kaçırdığı</span> hata burada da
          görünmez — bu bir doğruluk garantisi değil, denetimin karar defteri.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Düzeltme", toplam.duzeltilen, "text-[var(--accent-light)]"],
            ["Eleme", toplam.elenen, "text-red-300"],
            ["Valf devrede", toplam.valf, toplam.valf > 0 ? "text-red-300" : "text-white/70"],
            ["Token", toplam.token, "text-white/70"],
          ].map(([ad, n, sinif]) => (
            <div
              key={ad as string}
              className="glass rounded-xl border border-[var(--border)] px-3 py-3 text-center"
            >
              <div className={`text-lg font-semibold ${sinif as string}`}>{sayi(n as number)}</div>
              <div className="mt-0.5 text-[11px] text-white/35">{ad as string}</div>
            </div>
          ))}
        </div>

        {/* Bu ay: harcama ve kota tek satırda */}
        <div className="glass mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-[var(--border)] px-3.5 py-2.5 text-[11.5px] text-white/40">
          <span className="text-white/25">bu ay</span>
          <span>
            <span className="text-white/70">{buAy.ders}</span> ders
          </span>
          <span>
            <span className="text-white/70">{sayi(buAy.toplam)}</span> token
            <span className="text-white/25">
              {" "}
              (üretim {sayi(buAy.uretim)} · denetim {sayi(buAy.denetim)})
            </span>
          </span>
          <span
            className={
              buAyCekilen >= SUPADATA_AYLIK_KOTA * 0.8 ? "text-amber-300/80" : undefined
            }
          >
            Supadata{" "}
            <span className={buAyCekilen >= SUPADATA_AYLIK_KOTA * 0.8 ? "" : "text-white/70"}>
              {buAyCekilen}/{SUPADATA_AYLIK_KOTA}
            </span>
            {buAyElle > 0 && <span className="text-white/25"> · {buAyElle} elle</span>}
          </span>
        </div>

        {toplam.valf > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/[0.06] p-3.5">
            <TriangleAlert size={15} className="mt-0.5 flex-shrink-0 text-red-300" />
            <p className="text-[12.5px] leading-relaxed text-red-200/85">
              Emniyet valfi {toplam.valf} kez devreye girdi. Bu, denetimin soruların yarısından
              fazlasını işaretlediği ve bu yüzden <b>hiçbir bulgusunun uygulanmadığı</b> anlamına
              gelir — o derste denetim fiilen çalışmamıştır. Atılan bulguları ilgili adımın altında
              ham cevap olarak görebilirsin.
            </p>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-1.5">
          {(
            [
              ["denetim", `Üretim ve denetim (${gosterilen.length})`],
              ["degerlendirme", `Değerlendirme (${acikUclular.length})`],
              ["isaretli", `Ablamın işaretledikleri (${isaretliler.length})`],
            ] as const
          ).map(([k, ad]) => (
            <button
              key={k}
              onClick={() => setSekme(k)}
              className={`rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors ${
                sekme === k
                  ? "border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent-light)]"
                  : "border-[var(--border)] text-white/45 hover:text-white/75"
              }`}
            >
              {ad}
            </button>
          ))}
        </div>

        {sekme === "denetim" && (
          <>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-[11.5px] text-white/35">
              <input
                type="checkbox"
                checked={hepsi}
                onChange={(e) => setHepsi(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              Hiçbir müdahale olmayan dersleri de göster
            </label>

            <div className="mt-3 space-y-2">
              {gosterilen.length === 0 && (
                <div className="glass rounded-2xl border border-[var(--border)] px-5 py-10 text-center">
                  <p className="text-[13px] text-white/35">
                    Kayıt yok. Kayıtlar yalnızca bu özellik eklendikten sonra üretilen derslerde
                    tutuluyor.
                  </p>
                </div>
              )}

              {gosterilen.map((o) => {
                const adimlar = o.denetim?.adimlar ?? [];
                const kayitSayisi = adimlar.reduce((t, a) => t + a.kayitlar.length, 0);
                const valfli = adimlar.some((a) => a.gecisler.some((g) => g.valf));
                const buAcik = acik.has(o.id);
                return (
                  <div key={o.id} className="glass rounded-xl border border-[var(--border)]">
                    <button
                      onClick={() => cevir(o.id)}
                      className="flex w-full items-start gap-2.5 p-4 text-left"
                    >
                      {buAcik ? (
                        <ChevronDown size={15} className="mt-0.5 flex-shrink-0 text-white/35" />
                      ) : (
                        <ChevronRight size={15} className="mt-0.5 flex-shrink-0 text-white/35" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] text-white/90">{o.title ?? "Ders"}</p>
                        <p className="mt-1 text-[11.5px] text-white/35">
                          {tarihMetni(o.created_at)} · {kayitSayisi} kayıt
                          {o.status !== "hazir" && " · yarım"}
                        </p>
                      </div>
                      {valfli && (
                        <span className="flex-shrink-0 rounded-md border border-red-400/40 bg-red-400/10 px-1.5 py-0.5 text-[10.5px] text-red-300">
                          valf
                        </span>
                      )}
                    </button>

                    {buAcik && (
                      <div className="space-y-2 border-t border-[var(--border)] p-4">
                        {adimlar.length === 0 ? (
                          <p className="text-[12px] text-white/30">
                            Bu ders ayrıntılı kayıt eklenmeden önce üretilmiş; yalnızca sayılar var
                            ({o.denetim?.duzeltilen ?? 0} düzeltme, {o.denetim?.elenen ?? 0} eleme).
                          </p>
                        ) : (
                          adimlar.map((a, i) => <AdimBlogu key={i} a={a} />)
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {sekme === "degerlendirme" && (
          <div className="mt-3 space-y-2">
            <p className="text-[11.5px] leading-relaxed text-white/30">
              &quot;Modelin baktığı yer&quot;, değerlendiriciye gönderilen transkript diliminin
              ortasıdır (±90 sn). Cevap videoda başka bir yerde anlatılıyorsa model yanlış bölümü
              okumuş demektir — hüküm de ona göre çıkar.
            </p>
            {acikUclular.length === 0 && (
              <div className="glass rounded-2xl border border-[var(--border)] px-5 py-10 text-center">
                <p className="text-[13px] text-white/35">Henüz açık uçlu cevap yok.</p>
              </div>
            )}
            {acikUclular.map((c, i) => {
              const v = (c.verdict ?? "pas") as Verdict;
              return (
                <div key={i} className="glass rounded-xl border border-[var(--border)] p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className={`rounded-md border px-1.5 py-0.5 text-[10.5px] ${VERDICT_STYLE[v]}`}>
                      {VERDICT_LABEL[v]}
                    </span>
                    <span className="text-[11px] text-white/30">{tarihMetni(c.created_at)}</span>
                    <span className="text-white/15">·</span>
                    {damgaBaglantisi(c.video_id, c.start_seconds, "modelin baktığı yer")}
                  </div>
                  <p className="text-[12.5px] leading-relaxed text-white/80">{c.soru}</p>
                  <div className="mt-2 space-y-1.5 border-l-2 border-white/10 pl-2.5">
                    <p className="text-[11.5px] leading-relaxed text-white/55">
                      <span className="text-white/25">ablamın cevabı: </span>
                      {c.user_answer || "—"}
                    </p>
                    {c.answer_key && (
                      <p className="text-[11.5px] leading-relaxed text-white/40">
                        <span className="text-white/25">beklenen: </span>
                        {c.answer_key}
                      </p>
                    )}
                    {c.feedback && (
                      <p className="text-[11.5px] leading-relaxed text-[var(--accent-light)]/75">
                        <span className="text-white/25">modelin geri bildirimi: </span>
                        {c.feedback}
                      </p>
                    )}
                    {c.missing.length > 0 && (
                      <p className="text-[11.5px] text-amber-200/60">
                        eksik: {c.missing.join(", ")}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {sekme === "isaretli" && (
          <div className="mt-3 space-y-2">
            <p className="text-[11.5px] leading-relaxed text-white/30">
              Ablamın itiraz ettiği ve DÜZELTİLEMEYEN sorular. Bunlar artık ne pratik
              havuzuna giriyor ne de ders ekranında görünüyor; burada duruyorlar çünkü
              prompt&apos;u düzeltmek için gereken tek gerçek örnek bunlar. Düzeltilebilen
              itirazlar listede yok — o sorular yerinde düzeltildi. Denetimin o soruya
              dokunup dokunmadığı da gösteriliyor.
            </p>
            {isaretliler.length === 0 && (
              <div className="glass rounded-2xl border border-[var(--border)] px-5 py-10 text-center">
                <p className="text-[13px] text-white/35">
                  Ablam henüz hiçbir soruyu işaretlememiş.
                </p>
              </div>
            )}
            {isaretliler.map((q) => {
              const izler = denetimIzi(q);
              return (
                <div key={q.id} className="glass rounded-xl border border-[var(--border)] p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1 rounded-md border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10.5px] text-amber-200">
                      <ThumbsDown size={10} />
                      işaretli
                    </span>
                    <span className="text-[11px] text-white/35">{q.oturumAdi}</span>
                    <span className="text-white/15">·</span>
                    {damgaBaglantisi(q.video_id, q.start_seconds, "videoda")}
                  </div>
                  <p className="text-[12.5px] leading-relaxed text-white/85">{q.question}</p>

                  {/* Ablamın kendi cümlesi ve denetimin kararı. Prompt'u
                      düzeltmek için en değerli iki satır burası: soru nesiyle
                      bozuktu ve denetim buna ne dedi. */}
                  {(q.geri_bildirim || q.geri_bildirim_gerekce) && (
                    <div className="mt-2.5 rounded-lg border border-amber-400/20 bg-amber-400/[0.04] p-2.5">
                      {q.geri_bildirim && (
                        <p className="text-[11.5px] leading-relaxed text-amber-100/80">
                          <span className="text-amber-200/50">ablam: </span>
                          {q.geri_bildirim}
                        </p>
                      )}
                      {q.geri_bildirim_gerekce && (
                        <p className="mt-1.5 text-[11.5px] leading-relaxed text-white/45">
                          <span className="text-white/25">
                            denetim ({q.geri_bildirim_karari ?? "?"}):{" "}
                          </span>
                          {q.geri_bildirim_gerekce}
                        </p>
                      )}
                    </div>
                  )}

                  {q.choices?.length ? (
                    <div className="mt-2 space-y-1">
                      {q.choices.map((o, j) => (
                        <p
                          key={j}
                          className={`text-[11.5px] leading-relaxed ${
                            j === q.correct_index
                              ? "text-[var(--accent-light)]"
                              : "text-white/45"
                          }`}
                        >
                          <span className="font-mono opacity-60">{"ABCDE"[j]})</span> {o}
                          {j === q.correct_index && (
                            <span className="ml-1.5 text-[10px] opacity-70">← doğru</span>
                          )}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {q.answer_key && (
                    <p className="mt-2 text-[11.5px] leading-relaxed text-white/40">
                      <span className="text-white/25">beklenen cevap: </span>
                      {q.answer_key}
                    </p>
                  )}
                  {q.explanation && (
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-white/40">
                      <span className="text-white/25">açıklama: </span>
                      {q.explanation}
                    </p>
                  )}
                  <div className="mt-2.5 border-t border-[var(--border)] pt-2.5">
                    {izler.length ? (
                      <div className="space-y-1.5">
                        <p className="text-[11px] text-amber-200/70">
                          Denetim bu soruya dokunmuştu:
                        </p>
                        {izler.map((k, i) => (
                          <KayitSatiri key={i} k={k} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-white/30">
                        Denetim bu soruya dokunmamıştı — yani hata denetimin gözünden kaçmış.
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-8 text-center text-[11px] text-white/20">
          Bu sayfa yalnızca okur; hiçbir şeyi değiştirmez.
        </p>
      </div>
    </main>
  );
}
