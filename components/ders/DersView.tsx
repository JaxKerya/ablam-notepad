"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  PlayCircle,
  SkipForward,
  Send,
  RotateCcw,
  BookOpen,
  Sparkles,
  CircleCheck,
  CircleAlert,
  CircleX,
  MinusCircle,
  ThumbsDown,
  NotebookPen,
  Undo2,
} from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { useToast } from "@/components/Toast";
import {
  DERS_NOTLARI_KLASORU,
  formatSure,
  ozetiNotBelgesine,
  skorHesapla,
  slugla,
  videoLinki,
  VERDICT_LABEL,
  VERDICT_STYLE,
  type DersAnswer,
  type DersQuestion,
  type DersSession,
  type Verdict,
} from "@/lib/ders";

interface Props {
  oturum: DersSession;
  sorular: DersQuestion[];
  ilkCevaplar: DersAnswer[];
}

type Mod = "ozet" | "soru" | "sonuc";

const VERDICT_ICON: Record<Verdict, typeof CircleCheck> = {
  dogru: CircleCheck,
  eksik: CircleAlert,
  yanlis: CircleX,
  pas: MinusCircle,
};

export default function DersView({ oturum, sorular, ilkCevaplar }: Props) {
  const { addToast } = useToast();

  const [cevaplar, setCevaplar] = useState<Map<string, DersAnswer>>(
    () => new Map(ilkCevaplar.map((c) => [c.question_id, c]))
  );
  const [mod, setMod] = useState<Mod>(() => {
    if (ilkCevaplar.length === 0) return "ozet";
    return ilkCevaplar.length >= sorular.length ? "sonuc" : "soru";
  });
  const [index, setIndex] = useState(() => {
    const cevaplananlar = new Set(ilkCevaplar.map((c) => c.question_id));
    const i = sorular.findIndex((s) => !cevaplananlar.has(s.id));
    return i === -1 ? 0 : i;
  });

  const [metin, setMetin] = useState("");
  const [secim, setSecim] = useState<number | null>(null);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [isaretliler, setIsaretliler] = useState<Set<string>>(
    () => new Set(sorular.filter((s) => s.flagged).map((s) => s.id))
  );
  const [notKaydediliyor, setNotKaydediliyor] = useState(false);
  const [kaydedilenNot, setKaydedilenNot] = useState<string | null>(null);

  const soru = sorular[index];
  const mevcutCevap = soru ? cevaplar.get(soru.id) : undefined;
  const cevaplananSayisi = cevaplar.size;

  const skor = useMemo(() => skorHesapla([...cevaplar.values()]), [cevaplar]);

  const zayifKonular = useMemo(() => {
    const konular = new Map<string, { toplam: number; kotu: number }>();
    for (const s of sorular) {
      const c = cevaplar.get(s.id);
      if (!c || !s.topic) continue;
      const k = konular.get(s.topic) ?? { toplam: 0, kotu: 0 };
      k.toplam += 1;
      if (c.verdict === "yanlis" || c.verdict === "eksik" || c.verdict === "pas") k.kotu += 1;
      konular.set(s.topic, k);
    }
    return [...konular.entries()]
      .filter(([, v]) => v.kotu > 0)
      .sort((a, b) => b[1].kotu - a[1].kotu)
      .map(([ad, v]) => ({ ad, ...v }));
  }, [sorular, cevaplar]);

  const gonder = async (pas = false) => {
    if (!soru || gonderiliyor) return;
    if (!pas && soru.kind === "acik" && !metin.trim()) return;
    if (!pas && soru.kind === "coktan" && secim === null) return;

    setGonderiliyor(true);
    try {
      const res = await fetch("/api/ders/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: soru.id,
          cevap: soru.kind === "acik" ? metin.trim() : undefined,
          secim: soru.kind === "coktan" ? secim : undefined,
          pas,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.hata ?? "Değerlendirilemedi.");

      const yeni: DersAnswer = {
        id: soru.id,
        session_id: oturum.id,
        question_id: soru.id,
        user_answer: soru.kind === "acik" ? metin.trim() : secim !== null ? String(secim) : null,
        verdict: data.verdict as Verdict,
        feedback: data.feedback ?? null,
        missing: Array.isArray(data.missing) ? data.missing : [],
        created_at: new Date().toISOString(),
      };
      setCevaplar((m) => new Map(m).set(soru.id, yeni));
    } catch (err) {
      addToast((err as Error).message, "error");
    } finally {
      setGonderiliyor(false);
    }
  };

  const sonraki = () => {
    setMetin("");
    setSecim(null);
    if (index + 1 >= sorular.length) {
      setMod("sonuc");
    } else {
      setIndex(index + 1);
    }
  };

  /** "Bu soru saçma" — prompt'u gerçek örneklerle iyileştirmek için toplanıyor */
  const soruIsaretle = async (soruId: string) => {
    const zatenIsaretli = isaretliler.has(soruId);
    setIsaretliler((s) => {
      const yeni = new Set(s);
      if (zatenIsaretli) yeni.delete(soruId);
      else yeni.add(soruId);
      return yeni;
    });

    const { error } = await supabase
      .from("ders_questions")
      .update({ flagged: !zatenIsaretli })
      .eq("id", soruId);

    if (error) {
      addToast("İşaretlenemedi: " + error.message, "error");
      setIsaretliler((s) => {
        const yeni = new Set(s);
        if (zatenIsaretli) yeni.add(soruId);
        else yeni.delete(soruId);
        return yeni;
      });
      return;
    }

    addToast(zatenIsaretli ? "İşaret kaldırıldı" : "Teşekkürler, bu soru işaretlendi", "info");
  };

  /**
   * Ders özetini not defterine kaydeder — yönlendirme yapmadan, ablam soruların
   * başındayken akışından kopmasın diye. Kaydettikten sonra düğme geri alma
   * düğmesine dönüşür. Notlar mevcut klasör sistemindeki "Ders Notları"
   * klasörüne düşer, böylece ana not listesini doldurmaz.
   */
  const notaKaydet = async () => {
    if (notKaydediliyor) return;
    setNotKaydediliyor(true);

    const baslik = oturum.title ?? "Ders";
    const notId = `ders-${slugla(baslik)}`;

    try {
      // Klasör yoksa oluştur, varsa onu kullan
      const { data: mevcut } = await supabase
        .from("folders")
        .select("id")
        .eq("name", DERS_NOTLARI_KLASORU)
        .maybeSingle();

      let klasorId: string | null = mevcut?.id ?? null;
      if (!klasorId) {
        const { data: yeni, error } = await supabase
          .from("folders")
          .insert({ name: DERS_NOTLARI_KLASORU })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        klasorId = yeni.id;
      }

      const { error: notHatasi } = await supabase.from("notes").upsert(
        {
          id: notId,
          folder_id: klasorId,
          content: ozetiNotBelgesine(
            baslik,
            oturum.summary,
            oturum.topics ?? [],
            videoLinki(oturum.video_id, 0)
          ),
        },
        { onConflict: "id" }
      );
      if (notHatasi) throw new Error(notHatasi.message);

      setKaydedilenNot(notId);
      addToast("Özet ders notlarına kaydedildi", "success");
    } catch (err) {
      addToast("Nota kaydedilemedi: " + (err as Error).message, "error");
    } finally {
      setNotKaydediliyor(false);
    }
  };

  /** Kaydetmeyi geri alır — oluşturulan notu siler */
  const kaydetmeyiGeriAl = async () => {
    if (!kaydedilenNot || notKaydediliyor) return;
    setNotKaydediliyor(true);

    const { error } = await supabase.from("notes").delete().eq("id", kaydedilenNot);
    setNotKaydediliyor(false);

    if (error) {
      addToast("Geri alınamadı: " + error.message, "error");
      return;
    }
    setKaydedilenNot(null);
    addToast("Kaydetme geri alındı", "delete");
  };

  const bastanBasla = () => {
    const ilkCevapsiz = sorular.findIndex((s) => !cevaplar.has(s.id));
    setIndex(ilkCevapsiz === -1 ? 0 : ilkCevapsiz);
    setMetin("");
    setSecim(null);
    setMod("soru");
  };

  // ---------------------------------------------------------------- kabuk
  const kabuk = (icerik: React.ReactNode) => (
    <main className="relative min-h-screen overflow-x-hidden">
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background: [
            "radial-gradient(ellipse 80% 50% at 50% 0%, rgb(var(--accent-rgb) / 0.07) 0%, transparent 60%)",
            "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.15) 100%)",
          ].join(", "),
        }}
      />

      <Link
        href="/ders"
        className="glass fixed top-5 left-5 z-20 flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-[13px] text-white/55 transition-all duration-200 hover:border-[var(--border-hover)] hover:text-white/85 sm:top-6 sm:left-7"
      >
        <ArrowLeft size={14} />
        <span>Dersler</span>
      </Link>

      <div className="relative z-10 mx-auto max-w-2xl px-5 pb-20 pt-24 sm:pt-28">{icerik}</div>
    </main>
  );

  // ---------------------------------------------------------------- özet
  if (mod === "ozet") {
    return kabuk(
      <div className="animate-fade-in">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="glow-sm mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)]/10">
            <BookOpen size={24} className="text-[var(--accent)]" />
          </div>
          <h1 className="text-xl font-semibold leading-snug text-white/95">
            {oturum.title ?? "Ders"}
          </h1>
        </div>

        {oturum.summary && (
          <div className="glass rounded-2xl border border-[var(--border)] p-5">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider text-white/35">
              <Sparkles size={12} className="text-[var(--accent)]/70" />
              Bu derste ne anlatıldı
            </h2>
            <p className="text-[13.5px] leading-relaxed text-white/75">{oturum.summary}</p>
          </div>
        )}

        {oturum.topics?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {oturum.topics.map((k) => (
              <span
                key={k}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[12px] text-white/60"
              >
                {k}
              </span>
            ))}
          </div>
        )}

        <button
          onClick={() => setMod("soru")}
          className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3.5 text-sm font-medium text-[var(--background)] shadow-lg shadow-[var(--accent)]/10 transition-all hover:bg-[var(--accent-light)] active:scale-[0.99]"
        >
          Kendini sına
          <ArrowRight size={15} />
        </button>

        <button
          onClick={kaydedilenNot ? kaydetmeyiGeriAl : notaKaydet}
          disabled={notKaydediliyor}
          className={`mt-2 flex w-full items-center justify-center gap-2 rounded-xl border px-5 py-3 text-[13px] transition-colors disabled:opacity-40 ${
            kaydedilenNot
              ? "border-[var(--accent)]/35 bg-[var(--accent)]/[0.07] text-[var(--accent-light)] hover:border-[var(--accent)]/55"
              : "border-[var(--border)] text-white/55 hover:border-[var(--border-hover)] hover:text-white/85"
          }`}
        >
          {notKaydediliyor ? (
            <Loader2 size={14} className="animate-spin" />
          ) : kaydedilenNot ? (
            <Undo2 size={14} />
          ) : (
            <NotebookPen size={14} />
          )}
          {kaydedilenNot ? "Kaydedildi — geri al" : "Özeti ders notlarına kaydet"}
        </button>

        <p className="mt-3 text-center text-[11.5px] text-white/30">
          {sorular.length} soru · her cevaptan sonra hemen geri bildirim alacaksın
        </p>
      </div>
    );
  }

  // ---------------------------------------------------------------- sonuç
  if (mod === "sonuc") {
    return kabuk(
      <div className="animate-fade-in">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="glow-md mb-4 flex h-20 w-20 items-center justify-center rounded-full border-2 border-[var(--accent)]/30 bg-[var(--accent)]/10">
            <span className="text-2xl font-semibold text-[var(--accent-light)]">
              %{skor.yuzde}
            </span>
          </div>
          <h1 className="text-xl font-semibold text-white/95">Ders tamamlandı</h1>
          <p className="mt-1.5 text-[13px] text-white/45">{oturum.title ?? "Ders"}</p>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {(
            [
              ["dogru", skor.dogru],
              ["eksik", skor.eksik],
              ["yanlis", skor.yanlis],
              ["pas", skor.pas],
            ] as [Verdict, number][]
          ).map(([v, sayi]) => (
            <div
              key={v}
              className={`rounded-xl border px-2 py-3 text-center ${VERDICT_STYLE[v]}`}
            >
              <div className="text-lg font-semibold">{sayi}</div>
              <div className="mt-0.5 text-[11px] opacity-80">{VERDICT_LABEL[v]}</div>
            </div>
          ))}
        </div>

        {(oturum.denetim?.duzeltilen > 0 || oturum.denetim?.elenen > 0) && (
          <p className="mt-4 text-center text-[11.5px] leading-relaxed text-white/30">
            Bu derste denetim
            {oturum.denetim.duzeltilen > 0 && ` ${oturum.denetim.duzeltilen} cevabı düzeltti`}
            {oturum.denetim.duzeltilen > 0 && oturum.denetim.elenen > 0 && ","}
            {oturum.denetim.elenen > 0 && ` ${oturum.denetim.elenen} soruyu eledi`}.
          </p>
        )}

        {zayifKonular.length > 0 && (
          <div className="glass mt-4 rounded-2xl border border-[var(--border)] p-5">
            <h2 className="mb-3 text-[12px] font-medium uppercase tracking-wider text-white/35">
              Tekrar etmen iyi olur
            </h2>
            <div className="space-y-2">
              {zayifKonular.map((k) => (
                <div key={k.ad} className="flex items-center justify-between gap-3">
                  <span className="text-[13px] text-white/75">{k.ad}</span>
                  <span className="flex-shrink-0 text-[11.5px] text-amber-200/70">
                    {k.kotu}/{k.toplam} soruda takıldın
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Soruların dökümü */}
        <div className="mt-4 space-y-2">
          {sorular.map((s, i) => {
            const c = cevaplar.get(s.id);
            const v = (c?.verdict ?? "pas") as Verdict;
            const Ikon = VERDICT_ICON[v];
            return (
              <div
                key={s.id}
                className="glass rounded-xl border border-[var(--border)] p-3.5"
              >
                <div className="flex items-start gap-2.5">
                  <Ikon
                    size={15}
                    className={`mt-0.5 flex-shrink-0 ${
                      v === "dogru"
                        ? "text-[var(--accent)]"
                        : v === "eksik"
                          ? "text-amber-300"
                          : v === "yanlis"
                            ? "text-red-400"
                            : "text-white/30"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-relaxed text-white/80">
                      <span className="text-white/30">{i + 1}.</span> {s.question}
                    </p>
                    {c?.feedback && (
                      <p className="mt-1.5 text-[12px] leading-relaxed text-white/45">
                        {c.feedback}
                      </p>
                    )}
                    <a
                      href={videoLinki(oturum.video_id, s.start_seconds)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] text-[var(--accent)]/70 transition-colors hover:text-[var(--accent)]"
                    >
                      <PlayCircle size={12} />
                      Videoda {formatSure(s.start_seconds)}
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex gap-2">
          <button
            onClick={bastanBasla}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-3 text-[13px] text-white/65 transition-colors hover:border-[var(--border-hover)] hover:text-white/90"
          >
            <RotateCcw size={14} />
            Sorulara dön
          </button>
          <Link
            href="/ders"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-[13px] font-medium text-[var(--background)] transition-colors hover:bg-[var(--accent-light)]"
          >
            Yeni ders
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- soru
  if (!soru) return kabuk(<p className="text-center text-white/40">Soru bulunamadı.</p>);

  const verdict = mevcutCevap?.verdict as Verdict | undefined;
  const VerdictIkon = verdict ? VERDICT_ICON[verdict] : null;

  return kabuk(
    <div>
      {/* İlerleme */}
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-[11.5px] text-white/35">
          <span>
            Soru {index + 1} / {sorular.length}
          </span>
          <span>{cevaplananSayisi} cevaplandı</span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className="h-full rounded-full bg-[var(--accent)]/70 transition-all duration-500"
            style={{ width: `${((index + 1) / sorular.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Soru kartı */}
      <div key={soru.id} className="animate-fade-in glass rounded-2xl border border-[var(--border)] p-5">
        <div className="mb-3 flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[11px] text-white/45">
              {soru.kind === "acik" ? "Açık uçlu" : "Çoktan seçmeli"}
            </span>
            {soru.topic && (
              <span className="text-[11.5px] text-[var(--accent)]/60">{soru.topic}</span>
            )}
          </div>

          <button
            onClick={() => soruIsaretle(soru.id)}
            title={
              isaretliler.has(soru.id)
                ? "İşareti kaldır"
                : "Bu soru saçma / hatalı — işaretle"
            }
            aria-label="Bu soruyu hatalı olarak işaretle"
            // h-9/w-9: telefonda parmakla basılabilir bir hedef (26px çok küçüktü)
            className={`-mr-1 -mt-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-colors ${
              isaretliler.has(soru.id)
                ? "bg-amber-400/15 text-amber-300"
                : "text-white/20 hover:bg-white/[0.06] hover:text-white/50"
            }`}
          >
            <ThumbsDown size={14} />
          </button>
        </div>

        <p className="text-[15px] font-medium leading-relaxed text-white/95">{soru.question}</p>

        {/* Cevap alanı */}
        {soru.kind === "acik" ? (
          <textarea
            value={mevcutCevap ? (mevcutCevap.user_answer ?? "") : metin}
            onChange={(e) => setMetin(e.target.value)}
            onKeyDown={(e) => {
              // Uzun metin yazılan bir ekran; fareye uzanmadan gönderebilsin
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                gonder(false);
              }
            }}
            disabled={!!mevcutCevap || gonderiliyor}
            rows={5}
            placeholder="Cevabını kendi cümlelerinle yaz..."
            className="focus-ring mt-4 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 text-[13.5px] leading-relaxed text-white/90 placeholder-white/25 transition-all disabled:opacity-70"
          />
        ) : (
          <div className="mt-4 space-y-2">
            {(soru.choices ?? []).map((sik, i) => {
              const secili = mevcutCevap
                ? Number(mevcutCevap.user_answer) === i
                : secim === i;
              const dogruSik = !!mevcutCevap && soru.correct_index === i;
              return (
                <button
                  key={i}
                  onClick={() => !mevcutCevap && setSecim(i)}
                  disabled={!!mevcutCevap || gonderiliyor}
                  className={`flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-3 text-left text-[13.5px] leading-relaxed transition-all ${
                    dogruSik
                      ? "border-[var(--accent)]/50 bg-[var(--accent)]/12 text-[var(--accent-light)]"
                      : secili
                        ? mevcutCevap
                          ? "border-red-400/45 bg-red-400/10 text-red-200"
                          : "border-[var(--accent)]/45 bg-[var(--accent)]/10 text-white/95"
                        : "border-[var(--border)] bg-[var(--surface)] text-white/70 hover:border-[var(--border-hover)]"
                  } disabled:cursor-default`}
                >
                  <span className="mt-px flex-shrink-0 font-mono text-[12px] opacity-50">
                    {"ABCDE"[i]})
                  </span>
                  <span>{sik}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Eylemler */}
        {!mevcutCevap ? (
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => gonder(true)}
              disabled={gonderiliyor}
              className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-3 text-[13px] text-white/50 transition-colors hover:border-[var(--border-hover)] hover:text-white/80 disabled:opacity-40"
            >
              <SkipForward size={14} />
              Pas geç
            </button>
            <button
              onClick={() => gonder(false)}
              disabled={
                gonderiliyor ||
                (soru.kind === "acik" ? !metin.trim() : secim === null)
              }
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3 text-[13px] font-medium text-[var(--background)] transition-all hover:bg-[var(--accent-light)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-30"
            >
              {gonderiliyor ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Değerlendiriliyor...
                </>
              ) : (
                <>
                  <Send size={14} />
                  Cevabı gönder
                </>
              )}
            </button>
          </div>
        ) : null}

        {!mevcutCevap && soru.kind === "acik" && (
          <p className="mt-2.5 text-center text-[11px] text-white/25">
            <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px]">
              Ctrl
            </kbd>
            {" + "}
            <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px]">
              Enter
            </kbd>
            {" ile de gönderebilirsin"}
          </p>
        )}
      </div>

      {/* Geri bildirim */}
      {mevcutCevap && verdict && VerdictIkon && (
        <div
          className={`animate-slide-up mt-3 rounded-2xl border p-5 ${VERDICT_STYLE[verdict]}`}
        >
          <div className="flex items-center gap-2">
            <VerdictIkon size={17} />
            <span className="text-[14px] font-semibold">{VERDICT_LABEL[verdict]}</span>
          </div>

          {mevcutCevap.feedback && (
            <p className="mt-2.5 text-[13.5px] leading-relaxed opacity-90">
              {mevcutCevap.feedback}
            </p>
          )}

          {mevcutCevap.missing.length > 0 && (
            <p className="mt-2.5 text-[12.5px] leading-relaxed opacity-75">
              Eksik kalanlar: {mevcutCevap.missing.join(", ")}
            </p>
          )}

          {soru.kind === "acik" && verdict !== "dogru" && soru.answer_key && (
            <div className="mt-3 rounded-xl border border-white/10 bg-[var(--surface)] p-3.5">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wider opacity-60">
                Beklenen cevap
              </p>
              <p className="text-[13px] leading-relaxed opacity-90">{soru.answer_key}</p>
            </div>
          )}

          <a
            href={videoLinki(oturum.video_id, soru.start_seconds)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[var(--surface)] px-3 py-2 text-[12px] transition-colors hover:border-white/30"
          >
            <PlayCircle size={13} />
            Bu konu videonun {formatSure(soru.start_seconds)} anında anlatılıyor
          </a>

          <button
            onClick={sonraki}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-black/20 px-5 py-3 text-[13px] font-medium transition-colors hover:bg-[var(--surface-elevated)]"
          >
            {index + 1 >= sorular.length ? "Sonuçları gör" : "Sonraki soru"}
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
