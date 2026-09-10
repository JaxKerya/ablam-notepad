"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  PlayCircle,
  Timer,
  TriangleAlert,
} from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { useToast } from "@/components/Toast";
import SoruMetni from "@/components/ders/SoruMetni";
import HocaNeDemisti from "@/components/ders/HocaNeDemisti";
import {
  DENEME_VARSAYILAN_TEMPO,
  formatSure,
  netHesapla,
  sayacMetni,
  videoLinki,
  type DersAnswer,
  type DersQuestion,
  type DersSession,
} from "@/lib/ders";

// DENEME SINAVI EKRANI.
//
// Pratikten üç yerde ayrılıyor ve üçü de bilinçli:
//
//   1. GERİ BİLDİRİM SONA SAKLANIYOR. Her sorudan sonra doğruyu göstermek
//      pratiktir, sınav değildir. Sunucu da denemede cevabı döndürmüyor
//      (bkz. /api/ders/grade) — arayüzün "göstermemesi"ne güvenilmiyor.
//   2. SÜRE İŞLİYOR ve durdurulamıyor. Sayaç oturumun created_at'inden
//      hesaplanıyor, yani sunucu saatinden: sekme kapanıp açılsa da, sayfa
//      yenilense de kaldığı yerden devam ediyor. Yerel bir sayaç olsaydı
//      yenileyerek süre kazanılırdı ve deneme ölçmek istediği şeyi ölçmezdi.
//   3. SORULAR ARASINDA GEZİLEBİLİYOR. Gerçek sınavda da boş bırakıp dönülür;
//      alttaki kutucuk ızgarası hangi soruların boş kaldığını gösteriyor.

interface Props {
  oturum: DersSession;
  sorular: DersQuestion[];
  ilkCevaplar: DersAnswer[];
}

type Ekran = "sinav" | "sonuc";

const HARF = ["A", "B", "C", "D", "E"];

export default function DenemeView({ oturum, sorular, ilkCevaplar }: Props) {
  const { addToast } = useToast();

  /**
   * Denemenin süresi oturumla birlikte saklanıyor (kurulurken seçiliyor).
   * Kolon eklenmemişse ya da eski bir oturumsa varsayılan tempoya düşüyor —
   * sınav yine çalışır, sadece süresi seçilen değil hesaplanan olur.
   */
  const toplamSureSn = oturum.deneme_sure_sn ?? sorular.length * DENEME_VARSAYILAN_TEMPO;
  const soruBasiSn = sorular.length ? Math.round(toplamSureSn / sorular.length) : DENEME_VARSAYILAN_TEMPO;
  const baslangic = useMemo(() => new Date(oturum.created_at).getTime(), [oturum.created_at]);
  const kalanHesapla = useCallback(
    () => Math.max(0, Math.round((baslangic + toplamSureSn * 1000 - Date.now()) / 1000)),
    [baslangic, toplamSureSn]
  );

  const [kalan, setKalan] = useState(kalanHesapla);
  const [index, setIndex] = useState(0);
  /** question_id -> seçilen şık indeksi (yerel; sunucuya da yazılıyor) */
  const [secimler, setSecimler] = useState<Map<string, number>>(
    () => new Map(ilkCevaplar.filter((c) => c.user_answer !== null).map((c) => [c.question_id, Number(c.user_answer)]))
  );
  const [gonderilenler, setGonderilenler] = useState<Set<string>>(new Set());
  const [ekran, setEkran] = useState<Ekran>(() =>
    // Bitirilmiş ya da süresi dolmuş deneme doğrudan sonuç ekranını açar
    oturum.deneme_bitti_at
      ? "sonuc"
      : Math.max(
      0,
      Math.round(
        (new Date(oturum.created_at).getTime() +
          (oturum.deneme_sure_sn ?? sorular.length * DENEME_VARSAYILAN_TEMPO) * 1000 -
          Date.now()) /
          1000
      )
        ) === 0
        ? "sonuc"
        : "sinav"
  );
  const [sonuclar, setSonuclar] = useState<DersAnswer[] | null>(null);
  const [bitiriliyor, setBitiriliyor] = useState(false);
  const [onay, setOnay] = useState(false);

  const soru = sorular[index];
  /** Soru ekrana geldiği an — süre ölçümü buradan */
  const soruAcilis = useRef(Date.now());
  useEffect(() => {
    soruAcilis.current = Date.now();
  }, [index]);

  // --- Sayaç ---------------------------------------------------------------
  useEffect(() => {
    if (ekran !== "sinav") return;
    const z = setInterval(() => setKalan(kalanHesapla()), 1000);
    return () => clearInterval(z);
  }, [ekran, kalanHesapla]);

  const sonuclariGetir = useCallback(async () => {
    const { data } = await supabase
      .from("ders_answers")
      .select("*")
      .eq("session_id", oturum.id);
    setSonuclar((data ?? []) as DersAnswer[]);
  }, [oturum.id]);

  const bitir = useCallback(async () => {
    setBitiriliyor(true);
    await sonuclariGetir();
    // Bitiş anı kaydediliyor: bitmiş deneme "sürüyor" şeridinde görünmesin ve
    // sonuçlardan geri dönen ablam sınava geri sokulmasın. Kolon yoksa hata
    // yutuluyor — deneme yine biter, sadece süre dolana kadar açık sayılır.
    const { error } = await supabase
      .from("ders_sessions")
      .update({ deneme_bitti_at: new Date().toISOString() })
      .eq("id", oturum.id);
    if (error) console.warn("[ders] deneme bitiş anı yazılamadı:", error.message);
    setEkran("sonuc");
    setBitiriliyor(false);
  }, [sonuclariGetir, oturum.id]);

  // Süre dolunca sınav kendiliğinden biter. Boş kalan sorular BOŞ sayılır;
  // KPSS'de de boşun cezası yok, yalnızca yanlış götürüyor.
  useEffect(() => {
    if (ekran === "sinav" && kalan === 0) void bitir();
  }, [kalan, ekran, bitir]);

  useEffect(() => {
    if (ekran === "sonuc" && sonuclar === null) void sonuclariGetir();
  }, [ekran, sonuclar, sonuclariGetir]);

  // --- Cevaplama -----------------------------------------------------------
  const cevapla = async (secim: number) => {
    if (!soru || ekran !== "sinav") return;
    const sureMs = Date.now() - soruAcilis.current;
    setSecimler((m) => new Map(m).set(soru.id, secim));

    try {
      const res = await fetch("/api/ders/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: soru.id,
          secim,
          sureMs,
          deneme: true,
        }),
      });
      if (!res.ok) throw new Error((await res.json())?.hata ?? "Cevap kaydedilemedi.");
      setGonderilenler((s) => new Set(s).add(soru.id));
    } catch (err) {
      // Kaydedilemeyen cevap sessizce kaybolmasın: ızgarada da işaretli kalmıyor
      setSecimler((m) => {
        const y = new Map(m);
        y.delete(soru.id);
        return y;
      });
      addToast((err as Error).message, "error");
    }
  };

  const git = (yeni: number) => {
    if (yeni < 0 || yeni >= sorular.length) return;
    setIndex(yeni);
  };

  // Klavye: 1-5 şık seçer, ok tuşları gezer
  useEffect(() => {
    if (ekran !== "sinav") return;
    const tus = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key >= "1" && e.key <= "5") {
        const i = Number(e.key) - 1;
        if (soru?.choices && i < soru.choices.length) void cevapla(i);
      } else if (e.key === "ArrowRight") git(index + 1);
      else if (e.key === "ArrowLeft") git(index - 1);
    };
    window.addEventListener("keydown", tus);
    return () => window.removeEventListener("keydown", tus);
  });

  // --- Sonuç hesabı --------------------------------------------------------
  const rapor = useMemo(() => {
    if (!sonuclar) return null;
    const harita = new Map(sonuclar.map((c) => [c.question_id, c]));
    let dogru = 0;
    let yanlis = 0;
    let bos = 0;
    const konular = new Map<string, { toplam: number; dogru: number }>();
    const sureler: { soru: DersQuestion; sn: number }[] = [];

    for (const s of sorular) {
      const c = harita.get(s.id);
      const konu = s.topic ?? "Diğer";
      const k = konular.get(konu) ?? { toplam: 0, dogru: 0 };
      k.toplam++;
      if (!c || c.user_answer === null) {
        bos++;
      } else if (c.verdict === "dogru") {
        dogru++;
        k.dogru++;
      } else {
        yanlis++;
      }
      konular.set(konu, k);
      if (c?.sure_ms) sureler.push({ soru: s, sn: Math.round(c.sure_ms / 1000) });
    }

    const harcanan = sureler.reduce((t, s) => t + s.sn, 0);
    return {
      harita,
      dogru,
      yanlis,
      bos,
      net: netHesapla(dogru, yanlis),
      konular: [...konular.entries()].sort((a, b) => a[1].dogru / a[1].toplam - b[1].dogru / b[1].toplam),
      harcanan,
      ortalama: sureler.length ? Math.round(harcanan / sureler.length) : 0,
      enUzunlar: [...sureler].sort((a, b) => b.sn - a.sn).slice(0, 3),
    };
  }, [sonuclar, sorular]);

  const cevaplanan = secimler.size;
  const soruVideosu = (s: DersQuestion) => s.video_id ?? oturum.video_id;

  const kabuk = (icerik: React.ReactNode) => (
    <main className="relative min-h-screen overflow-x-hidden">
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% 0%, rgb(var(--accent-rgb) / 0.07) 0%, transparent 60%)",
        }}
      />
      <div className="relative z-10 mx-auto max-w-2xl px-5 pb-24 pt-20 sm:pt-24">{icerik}</div>
    </main>
  );

  // ------------------------------------------------------------------ sonuç
  if (ekran === "sonuc") {
    if (!rapor) {
      return kabuk(
        <p className="py-20 text-center text-[13px] text-white/40">Sonuçlar hesaplanıyor…</p>
      );
    }
    const yuzde = sorular.length ? Math.round((rapor.net / sorular.length) * 100) : 0;
    return kabuk(
      <div className="animate-fade-in">
        <Link
          href="/ders"
          className="glass fixed top-5 left-5 z-20 flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-[13px] text-white/55 transition-all hover:border-[var(--border-hover)] hover:text-white/85 sm:top-6 sm:left-7"
        >
          <ArrowLeft size={14} />
          Dersler
        </Link>

        <div className="mb-8 text-center">
          <p className="text-[12px] uppercase tracking-wider text-white/35">{oturum.title}</p>
          <p className="mt-3 text-[44px] font-semibold leading-none text-white/95">
            {rapor.net.toFixed(2).replace(".", ",")}
          </p>
          <p className="mt-1.5 text-[13px] text-white/45">
            net · {sorular.length} soruda %{yuzde}
          </p>
        </div>

        <div className="mb-5 grid grid-cols-3 gap-2">
          {[
            ["Doğru", rapor.dogru, "text-[var(--accent-light)]"],
            ["Yanlış", rapor.yanlis, "text-red-300"],
            ["Boş", rapor.bos, "text-white/50"],
          ].map(([ad, sayi, renk]) => (
            <div
              key={ad as string}
              className="glass rounded-xl border border-[var(--border)] px-3 py-3 text-center"
            >
              <p className={`text-[20px] font-semibold ${renk}`}>{sayi as number}</p>
              <p className="mt-0.5 text-[11.5px] text-white/40">{ad as string}</p>
            </div>
          ))}
        </div>

        {/* Süre kartı yalnızca veri varsa. sure_ms kolonu eklenmemişse bütün
            süreler 0 geliyor ve kart "Toplam 0:00" yazıyordu — bilgi vermeyen
            ama bilgi veriyormuş gibi duran bir kutu. */}
        {rapor.harcanan > 0 && (
        <div className="glass mb-5 rounded-2xl border border-[var(--border)] p-4">
          <p className="mb-2.5 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider text-white/45">
            <Timer size={13} />
            Süre
          </p>
          <p className="text-[12.5px] leading-relaxed text-white/60">
            Toplam {sayacMetni(rapor.harcanan)} · soru başına ortalama {rapor.ortalama} saniye
            <span className="text-white/30"> (bu denemede soru başına {soruBasiSn} saniyen vardı)</span>
          </p>
          {rapor.enUzunlar.length > 0 && (
            <div className="mt-2 space-y-1">
              {rapor.enUzunlar.map((u) => (
                <p key={u.soru.id} className="truncate text-[11.5px] text-white/35">
                  {u.sn} sn · {u.soru.question.split("\n")[0]}
                </p>
              ))}
            </div>
          )}
        </div>
        )}

        {rapor.konular.length > 1 && (
          <div className="glass mb-5 rounded-2xl border border-[var(--border)] p-4">
            <p className="mb-2.5 text-[12px] font-medium uppercase tracking-wider text-white/45">
              Konulara göre
            </p>
            <div className="space-y-1.5">
              {rapor.konular.map(([ad, k]) => (
                <div key={ad} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-[12px] text-white/60">{ad}</span>
                  <span
                    className={`text-[11.5px] ${
                      k.dogru === k.toplam ? "text-[var(--accent)]/70" : "text-white/40"
                    }`}
                  >
                    {k.dogru}/{k.toplam}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="mb-2.5 px-1 text-[12px] font-medium uppercase tracking-wider text-white/35">
          Sorular
        </p>
        <div className="space-y-2">
          {sorular.map((s, i) => {
            const c = rapor.harita.get(s.id);
            const secim = c?.user_answer !== null && c?.user_answer !== undefined ? Number(c.user_answer) : null;
            const durum = !c || secim === null ? "bos" : c.verdict === "dogru" ? "dogru" : "yanlis";
            return (
              <div
                key={s.id}
                className={`glass rounded-xl border p-3.5 ${
                  durum === "dogru"
                    ? "border-[var(--accent)]/25"
                    : durum === "yanlis"
                      ? "border-red-400/25"
                      : "border-[var(--border)]"
                }`}
              >
                <div className="mb-1.5 flex items-center gap-2 text-[11px]">
                  <span className="text-white/30">{i + 1}.</span>
                  <span
                    className={
                      durum === "dogru"
                        ? "text-[var(--accent)]/70"
                        : durum === "yanlis"
                          ? "text-red-300/80"
                          : "text-white/35"
                    }
                  >
                    {durum === "dogru" ? "doğru" : durum === "yanlis" ? "yanlış" : "boş"}
                  </span>
                  {c?.sure_ms ? (
                    <span className="text-white/25">· {Math.round(c.sure_ms / 1000)} sn</span>
                  ) : null}
                </div>
                <SoruMetni metin={s.question} className="text-[13px] leading-relaxed text-white/85" />
                <div className="mt-2 space-y-1">
                  {(s.choices ?? []).map((o, j) => (
                    <p
                      key={j}
                      className={`text-[11.5px] leading-relaxed ${
                        j === s.correct_index
                          ? "text-[var(--accent-light)]"
                          : j === secim
                            ? "text-red-300/80 line-through decoration-red-300/30"
                            : "text-white/35"
                      }`}
                    >
                      <span className="font-mono opacity-60">{HARF[j]})</span> {o}
                      {j === s.correct_index && (
                        <span className="ml-1.5 text-[10px] opacity-70">← doğru</span>
                      )}
                    </p>
                  ))}
                </div>
                {s.explanation && (
                  <p className="mt-2 text-[11.5px] leading-relaxed text-white/45">{s.explanation}</p>
                )}
                <a
                  href={videoLinki(soruVideosu(s), s.start_seconds)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] text-[var(--accent)]/70 transition-colors hover:text-[var(--accent)]"
                >
                  <PlayCircle size={12} />
                  Videoda {formatSure(s.start_seconds)}
                </a>
                <HocaNeDemisti questionId={s.id} videoId={soruVideosu(s)} className="mt-1.5" />
              </div>
            );
          })}
        </div>

        <Link
          href="/ders"
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-[13px] font-medium text-[var(--background)] transition-colors hover:bg-[var(--accent-light)]"
        >
          Derslere dön
          <ArrowRight size={14} />
        </Link>
      </div>
    );
  }

  // ------------------------------------------------------------------ sınav
  if (!soru) return kabuk(<p className="py-20 text-center text-white/40">Soru bulunamadı.</p>);

  const secim = secimler.get(soru.id) ?? null;
  const azKaldi = kalan <= 60;

  return kabuk(
    <div>
      {/* Üst şerit: sayaç + ilerleme. Sabit, çünkü sınavda en çok bakılan yer. */}
      <div className="glass-strong fixed inset-x-0 top-0 z-20 border-b border-[var(--border)]">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-5 py-3">
          <span className="text-[12.5px] text-white/50">
            Soru {index + 1} / {sorular.length}
            <span className="ml-2 text-white/30">{cevaplanan} cevaplandı</span>
          </span>
          <span
            className={`flex items-center gap-1.5 font-mono text-[15px] tabular-nums ${
              azKaldi ? "animate-pulse text-red-300" : "text-white/80"
            }`}
          >
            <Clock size={14} />
            {sayacMetni(kalan)}
          </span>
        </div>
      </div>

      <div className="glass animate-fade-in rounded-2xl border border-[var(--border)] p-5">
        {soru.topic && (
          <p className="mb-3 text-[11.5px] text-[var(--accent)]/60">{soru.topic}</p>
        )}

        <SoruMetni
          metin={soru.question}
          className="text-[15px] font-medium leading-relaxed text-white/95"
        />

        <div className="mt-4 space-y-2">
          {(soru.choices ?? []).map((o, i) => (
            <button
              key={i}
              onClick={() => cevapla(i)}
              className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left text-[13.5px] leading-relaxed transition-all ${
                secim === i
                  ? "border-[var(--accent)]/50 bg-[var(--accent)]/[0.10] text-white/95"
                  : "border-[var(--border)] bg-[var(--surface)] text-white/75 hover:border-[var(--border-hover)]"
              }`}
            >
              <span
                className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md font-mono text-[11px] ${
                  secim === i ? "bg-[var(--accent)]/25 text-[var(--accent-light)]" : "bg-white/[0.06] text-white/40"
                }`}
              >
                {HARF[i]}
              </span>
              {o}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => git(index - 1)}
            disabled={index === 0}
            className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2.5 text-[12.5px] text-white/55 transition-colors hover:border-[var(--border-hover)] hover:text-white/85 disabled:opacity-30"
          >
            <ArrowLeft size={14} />
            Önceki
          </button>
          <button
            onClick={() => git(index + 1)}
            disabled={index >= sorular.length - 1}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 py-2.5 text-[12.5px] font-medium text-[var(--background)] transition-colors hover:bg-[var(--accent-light)] disabled:opacity-30"
          >
            Sonraki
            <ArrowRight size={14} />
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-white/25">
          1-5 tuşlarıyla işaretleyebilir, ok tuşlarıyla gezebilirsin
        </p>
      </div>

      {/* Soru ızgarası: hangi soru boş, hangisi işaretli, hangisinden emin değil */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {sorular.map((s, i) => {
          const cevaplandi = secimler.has(s.id);
          return (
            <button
              key={s.id}
              onClick={() => git(i)}
              title={`Soru ${i + 1}${cevaplandi ? " — işaretli" : " — boş"}`}
              className={`h-8 w-8 rounded-lg border text-[11.5px] font-mono transition-all ${
                i === index ? "ring-1 ring-[var(--accent)]/60" : ""
              } ${
                cevaplandi
                  ? "border-[var(--accent)]/35 bg-[var(--accent)]/[0.10] text-[var(--accent-light)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-white/35"
              }`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      {/* Bitirme: onay isteniyor çünkü geri dönüşü yok */}
      <div className="mt-5">
        {onay ? (
          <div className="glass animate-fade-in rounded-xl border border-amber-400/25 bg-amber-400/[0.04] p-4">
            <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-amber-100/85">
              <TriangleAlert size={14} className="mt-0.5 flex-shrink-0" />
              {sorular.length - cevaplanan > 0
                ? `${sorular.length - cevaplanan} soru boş kalacak. Boş sorular neti düşürmez ama puan da getirmez.`
                : "Bütün soruları işaretledin."}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={bitir}
                disabled={bitiriliyor}
                className="flex flex-1 items-center justify-center rounded-lg bg-amber-400/20 px-4 py-2.5 text-[12.5px] font-medium text-amber-100 transition-colors hover:bg-amber-400/30 disabled:opacity-50"
              >
                {bitiriliyor ? "Hesaplanıyor…" : "Sınavı bitir"}
              </button>
              <button
                onClick={() => setOnay(false)}
                className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-[12.5px] text-white/55 transition-colors hover:text-white/85"
              >
                Devam et
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setOnay(true)}
            className="w-full rounded-xl border border-[var(--border)] px-4 py-3 text-[12.5px] text-white/50 transition-colors hover:border-[var(--border-hover)] hover:text-white/80"
          >
            Sınavı bitir ve sonuçları gör
          </button>
        )}
      </div>

      {gonderilenler.size < secimler.size && (
        <p className="mt-3 text-center text-[11px] text-amber-200/60">
          Bazı cevaplar kaydedilemedi; bağlantını kontrol et.
        </p>
      )}
    </div>
  );
}
