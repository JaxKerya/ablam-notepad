"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  GraduationCap,
  Youtube,
  ArrowLeft,
  ArrowRight,
  Loader2,
  ClipboardPaste,
  X,
  Trash2,
  CornerDownLeft,
  CircleCheck,
  CircleAlert,
  Clock,
  NotebookPen,
  FileText,
} from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { useToast } from "@/components/Toast";
import { DERS_NOTLARI_KLASORU, formatSure, tarihMetni } from "@/lib/ders";

interface OturumOzeti {
  id: string;
  title: string | null;
  created_at: string;
  video_id: string;
  sure: number;
  soruSayisi: number;
  cevapSayisi: number;
  dogruSayisi: number;
  yarim: boolean;
}

type Asama = "bos" | "transkript" | "acik" | "coktan";

const ASAMA_METNI: Record<Exclude<Asama, "bos">, string> = {
  transkript: "Dersin altyazısı alınıyor...",
  acik: "Ders çözümleniyor, açık uçlu sorular hazırlanıyor...",
  coktan: "Çoktan seçmeli sorular hazırlanıyor...",
};

export default function DersAnaSayfa() {
  const [link, setLink] = useState("");
  const [asama, setAsama] = useState<Asama>("bos");
  const [oturumlar, setOturumlar] = useState<OturumOzeti[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [elleAcik, setElleAcik] = useState(false);
  const [elleMetin, setElleMetin] = useState("");
  const [silinecek, setSilinecek] = useState<string | null>(null);
  const [tamamlanan, setTamamlanan] = useState<string | null>(null);
  const [notlarAcik, setNotlarAcik] = useState(false);
  const [dersNotlari, setDersNotlari] = useState<{ id: string; updated_at: string }[] | null>(null);
  // Transkript ~4 sn'de geliyor ve içinde başlık var. Soru üretimi beklenirken
  // dönen bir çark yerine videonun kendisini göstermek çok daha iyi hissettiriyor.
  const [video, setVideo] = useState<{ id: string; baslik: string | null; sure: number } | null>(
    null
  );

  const router = useRouter();
  const { addToast } = useToast();

  const oturumlariGetir = useCallback(async () => {
    const { data, error } = await supabase
      .from("ders_sessions")
      // ders_answers kırılımı ayrı sorguda alınıyor: PostgREST'te aynı gömülü
      // seçimde count ile sütun birlikte istenemiyor.
      .select(
        "id, title, created_at, video_id, status, ders_videos(duration_seconds), ders_questions(count)"
      )
      // Yarım kalanlar da listeleniyor: ikinci adım düşerse ya da sekme
      // kapanırsa oturum "hazirlaniyor"da kalıyordu ve tamamen görünmez
      // oluyordu — üretilen özet ve açık uçlu sorular boşa gidiyordu.
      .in("status", ["hazir", "hazirlaniyor"])
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Dersler yüklenemedi:", error.message);
      setYukleniyor(false);
      return;
    }

    // Doğru sayısı için ayrı, hafif bir sorgu (verdict kırılımı gerekiyor).
    // YALNIZCA listelenen oturumlar için: filtresiz çekilince PostgREST'in satır
    // tavanına takılıp sessizce eksik veri dönüyordu ve eski derslerin kartında
    // "0 doğru" yazıyordu — hata değil, yanlış sayı.
    const kimlikler = (data ?? []).map((o) => o.id);
    const { data: cevaplar } = kimlikler.length
      ? await supabase
          .from("ders_answers")
          .select("session_id, verdict")
          .in("session_id", kimlikler)
      : { data: [] as { session_id: string; verdict: string | null }[] };

    const dogrular = new Map<string, number>();
    const toplamlar = new Map<string, number>();
    for (const c of cevaplar ?? []) {
      toplamlar.set(c.session_id, (toplamlar.get(c.session_id) ?? 0) + 1);
      if (c.verdict === "dogru") {
        dogrular.set(c.session_id, (dogrular.get(c.session_id) ?? 0) + 1);
      }
    }

    setOturumlar(
      (data ?? []).map((o) => {
        // İlişki tekil de dizi de dönebiliyor; ikisini de karşıla
        const ham = o.ders_videos as unknown;
        const video = (Array.isArray(ham) ? ham[0] : ham) as
          | { duration_seconds: number }
          | null
          | undefined;
        const soruSayisi = (o.ders_questions as unknown as { count: number }[])?.[0]?.count ?? 0;
        return {
          id: o.id,
          title: o.title,
          created_at: o.created_at,
          video_id: o.video_id,
          sure: video?.duration_seconds ?? 0,
          soruSayisi,
          cevapSayisi: toplamlar.get(o.id) ?? 0,
          dogruSayisi: dogrular.get(o.id) ?? 0,
          yarim: o.status !== "hazir",
        };
      })
    );
    setYukleniyor(false);
  }, []);

  useEffect(() => {
    oturumlariGetir();
  }, [oturumlariGetir]);

  /** Ders notları panelini ilk açılışta doldurur */
  const dersNotlariniGetir = useCallback(async () => {
    const { data: klasor } = await supabase
      .from("folders")
      .select("id")
      .eq("name", DERS_NOTLARI_KLASORU)
      .maybeSingle();

    if (!klasor) {
      setDersNotlari([]);
      return;
    }
    const { data } = await supabase
      .from("notes")
      .select("id, updated_at")
      .eq("folder_id", klasor.id)
      .order("updated_at", { ascending: false });
    setDersNotlari(data ?? []);
  }, []);

  const basla = async (elleTranskript?: string) => {
    const url = link.trim();
    if (!url || asama !== "bos") return;

    setAsama("transkript");
    try {
      const trRes = await fetch("/api/ders/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, elleTranskript }),
      });
      const tr = await trRes.json();

      if (!trRes.ok) {
        if (tr?.kod === "elle_gerekli") {
          setElleAcik(true);
          setAsama("bos");
          addToast(tr.hata, "info");
          return;
        }
        throw new Error(tr?.hata ?? "Transkript alınamadı.");
      }

      setVideo({ id: tr.videoId, baslik: tr.baslik, sure: tr.sure });

      // Üretim iki ayrı istek: uzun derslerde tek istek sunucu süre tavanına
      // dayanıyordu. Her adımın kendi bütçesi var.
      setAsama("acik");
      const acikRes = await fetch("/api/ders/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: tr.videoId, adim: "acik" }),
      });
      const acik = await acikRes.json();
      if (!acikRes.ok) throw new Error(acik?.hata ?? "Sorular hazırlanamadı.");

      setAsama("coktan");
      const coktanRes = await fetch("/api/ders/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: tr.videoId,
          adim: "coktan",
          sessionId: acik.sessionId,
        }),
      });
      const coktan = await coktanRes.json();
      if (!coktanRes.ok) throw new Error(coktan?.hata ?? "Sorular hazırlanamadı.");

      setElleAcik(false);
      setElleMetin("");
      router.push(`/ders/${acik.sessionId}`);
    } catch (err) {
      addToast((err as Error).message, "error");
      setAsama("bos");
      setVideo(null);
    }
  };

  /**
   * Yarım kalan oturumu tamamlar: yalnızca ikinci adımı çağırır, birinci adım
   * (özet + açık uçlular) zaten kayıtlı olduğu için tekrar üretilmez.
   */
  const notlariAc = () => {
    setNotlarAcik(true);
    if (dersNotlari === null) dersNotlariniGetir();
  };

  const tamamla = async (o: OturumOzeti) => {
    if (tamamlanan) return;
    setTamamlanan(o.id);
    try {
      const res = await fetch("/api/ders/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: o.video_id, adim: "coktan", sessionId: o.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.hata ?? "Tamamlanamadı.");
      router.push(`/ders/${o.id}`);
    } catch (err) {
      addToast((err as Error).message, "error");
      setTamamlanan(null);
    }
  };

  const oturumSil = async (id: string) => {
    const { error } = await supabase.from("ders_sessions").delete().eq("id", id);
    if (error) {
      addToast("Silinemedi: " + error.message, "error");
      return;
    }
    setOturumlar((o) => o.filter((x) => x.id !== id));
    setSilinecek(null);
    addToast("Ders silindi", "delete");
  };

  const calisiyor = asama !== "bos";

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      {/* Arka plan derinliği */}
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
        href="/"
        className="glass fixed top-5 left-5 z-20 animate-fade-in flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-[13px] text-white/55 transition-all duration-200 hover:border-[var(--border-hover)] hover:text-white/85 sm:top-6 sm:left-7"
      >
        <ArrowLeft size={14} />
        <span>Ana sayfa</span>
      </Link>

      {/* Ders notları burada, kendi panelinde açılır. Önceden ana sayfaya
          yönlendirip oradaki kenar çubuğunu açıyordu — sayfadan koparıyordu. */}
      {/* Panel açıkken gizleniyor: aynı köşede panelin kapatma düğmesiyle
          üst üste biniyordu ve zaten gereksiz kalıyor. */}
      {!notlarAcik && (
        <button
          type="button"
          onClick={notlariAc}
          aria-label="Ders notlarım"
          title="Ders notlarım"
          className="glass fixed top-5 right-5 z-20 animate-fade-in flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-[13px] text-white/55 transition-all duration-200 hover:border-[var(--border-hover)] hover:text-white/85 sm:top-6 sm:right-7"
        >
          <NotebookPen size={14} className="text-[var(--accent)]/80" />
          <span className="hidden sm:inline">Ders notlarım</span>
        </button>
      )}

      <div className="relative z-10 mx-auto max-w-3xl px-5 pb-20 pt-24 sm:pt-28">
        {/* Başlık */}
        <div className="animate-fade-in mb-10 flex flex-col items-center text-center">
          <div className="glow-sm mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)]/10">
            <GraduationCap size={26} className="text-[var(--accent)]" />
          </div>
          <h1 className="text-2xl font-semibold text-white/95">Ablam Ders</h1>
          <p className="mt-2 max-w-md text-[13px] leading-relaxed text-white/45">
            İzlediğin ders videosunun linkini yapıştır, dersten ne anladığını
            birlikte ölçelim.
          </p>
        </div>

        {/* Link girişi */}
        <div
          className="animate-slide-up glass rounded-2xl border border-[var(--border)] p-5"
          style={{ animationDelay: "80ms" }}
        >
          <div className="relative">
            <Youtube
              size={16}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30"
            />
            <input
              type="url"
              inputMode="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !elleAcik) basla();
              }}
              disabled={calisiyor}
              placeholder="https://www.youtube.com/watch?v=..."
              className="focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-3.5 pl-10 pr-4 text-sm text-white/95 placeholder-white/25 transition-all disabled:opacity-50"
            />
          </div>

          {!elleAcik && (
            <button
              onClick={() => basla()}
              disabled={!link.trim() || calisiyor}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3.5 text-sm font-medium text-[var(--background)] shadow-lg shadow-[var(--accent)]/10 transition-all hover:bg-[var(--accent-light)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
            >
              {calisiyor ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  {ASAMA_METNI[asama as Exclude<Asama, "bos">]}
                </>
              ) : (
                <>
                  Derse başla
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          )}

          {/* Transkript geldiyse videoyu göster — beklerken somut bir şey görsün */}
          {calisiyor && asama !== "transkript" && video && (
            <div className="animate-fade-in mt-3 flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://img.youtube.com/vi/${video.id}/mqdefault.jpg`}
                alt=""
                className="h-11 w-[74px] flex-shrink-0 rounded-lg border border-white/[0.06] object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium text-white/85">
                  {video.baslik ?? "Ders"}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--accent)]/60">
                  <CircleCheck size={10} />
                  Altyazı alındı{video.sure > 0 ? ` · ${formatSure(video.sure)}` : ""}
                </p>
              </div>
            </div>
          )}

          {calisiyor && (
            <p className="mt-3 text-center text-[11.5px] leading-relaxed text-white/35">
              {asama === "transkript"
                ? "Birkaç saniye sürer."
                : "Ders ne kadar uzunsa o kadar çok soru çıkar; bu adım birkaç dakika sürebilir."}
            </p>
          )}

          {/* Elle yapıştırma paneli */}
          {elleAcik && (
            <div className="animate-fade-in mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 text-[13px] font-medium text-white/85">
                  <ClipboardPaste size={14} className="text-[var(--accent)]/80" />
                  Transkripti elle yapıştır
                </div>
                <button
                  onClick={() => {
                    setElleAcik(false);
                    setElleMetin("");
                  }}
                  className="text-white/30 transition-colors hover:text-white/70"
                >
                  <X size={15} />
                </button>
              </div>

              <ol className="mb-3 space-y-1 text-[12px] leading-relaxed text-white/45">
                <li>1. YouTube&apos;da videonun altındaki <b className="text-white/70">⋯ Diğer</b> menüsüne bas.</li>
                <li>2. <b className="text-white/70">Transkripti göster</b>&apos;i seç.</li>
                <li>3. Açılan panelde metnin tamamını seçip kopyala ve buraya yapıştır.</li>
              </ol>

              <textarea
                value={elleMetin}
                onChange={(e) => setElleMetin(e.target.value)}
                rows={7}
                placeholder={"0:12\nEvet arkadaşlar bugün...\n0:18\nkonumuz..."}
                className="focus-ring w-full resize-y rounded-lg border border-[var(--border)] bg-black/20 p-3 font-mono text-[12px] leading-relaxed text-white/85 placeholder-white/20"
              />

              <button
                onClick={() => basla(elleMetin)}
                disabled={!elleMetin.trim() || calisiyor}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-medium text-[var(--background)] transition-all hover:bg-[var(--accent-light)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-30"
              >
                {calisiyor ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    {ASAMA_METNI[asama as Exclude<Asama, "bos">]}
                  </>
                ) : (
                  <>
                    Bu transkriptle devam et
                    <CornerDownLeft size={14} />
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Geçmiş dersler */}
        <div className="mt-10">
          <h2 className="mb-3 px-1 text-[12px] font-medium uppercase tracking-wider text-white/30">
            Geçmiş dersler
          </h2>

          {yukleniyor ? (
            <div className="flex justify-center py-10">
              <Loader2 size={18} className="animate-spin text-[var(--accent)]/50" />
            </div>
          ) : oturumlar.length === 0 ? (
            <div className="glass rounded-2xl border border-[var(--border)] px-5 py-10 text-center">
              <p className="text-[13px] text-white/35">
                Henüz ders yok. Yukarıya bir video linki yapıştırarak başla.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {oturumlar.map((o, i) => (
                <div
                  key={o.id}
                  className="animate-fade-in group glass relative flex items-center gap-3 rounded-xl border border-[var(--border)] p-2.5 transition-all hover:border-[var(--border-hover)]"
                  style={{ animationDelay: `${Math.min(i * 35, 300)}ms` }}
                >
                  <Link
                    href={o.yarim ? "#" : `/ders/${o.id}`}
                    onClick={(e) => {
                      if (o.yarim) {
                        e.preventDefault();
                        tamamla(o);
                      }
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://img.youtube.com/vi/${o.video_id}/mqdefault.jpg`}
                      alt=""
                      className="h-12 w-20 flex-shrink-0 rounded-lg border border-white/[0.06] object-cover"
                      loading="lazy"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-white/90">
                        {o.title ?? "Ders"}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-white/35">
                        <span>{tarihMetni(o.created_at)}</span>
                        {o.sure > 0 && (
                          <span className="flex items-center gap-1">
                            <Clock size={10} />
                            {formatSure(o.sure)}
                          </span>
                        )}
                        {o.yarim ? (
                          <span className="flex items-center gap-1 text-amber-300/80">
                            <CircleAlert size={10} />
                            {tamamlanan === o.id ? "Tamamlanıyor…" : "Tamamlanmadı — devam et"}
                          </span>
                        ) : o.cevapSayisi > 0 ? (
                          <span className="flex items-center gap-1 text-[var(--accent)]/70">
                            <CircleCheck size={10} />
                            {o.dogruSayisi}/{o.cevapSayisi} doğru
                          </span>
                        ) : (
                          <span>{o.soruSayisi} soru bekliyor</span>
                        )}
                      </div>
                    </div>
                  </Link>

                  <button
                    onClick={() => setSilinecek(o.id)}
                    aria-label="Dersi sil"
                    className="flex-shrink-0 rounded-lg p-2 text-white/20 opacity-0 transition-all hover:bg-red-400/10 hover:text-red-400 group-hover:opacity-100"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Ders notları paneli — sayfadan çıkmadan, soldan.
          Ana sayfadaki notlar kenar çubuğuyla aynı desen: left-0, w-72,
          border-r ve aynı yatay kaydırma geçişi. */}
      {notlarAcik && (
        <div
          className="animate-overlay fixed inset-0 z-[var(--z-overlay)] bg-black/50"
          onClick={() => setNotlarAcik(false)}
        />
      )}

      <aside
        className={`glass-strong fixed left-0 top-0 z-[var(--z-panel)] flex h-screen w-72 flex-col border-r border-[var(--border)] shadow-2xl shadow-black/40 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          notlarAcik ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!notlarAcik}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent)]/10">
              <NotebookPen size={13} className="text-[var(--accent)]" />
            </div>
            <h2 className="text-[13.5px] font-medium text-white/90">Ders notlarım</h2>
          </div>
          <button
            type="button"
            onClick={() => setNotlarAcik(false)}
            aria-label="Kapat"
            tabIndex={notlarAcik ? 0 : -1}
            className="-mr-1.5 flex h-9 w-9 items-center justify-center rounded-lg text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/70"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {dersNotlari === null ? (
            <div className="flex justify-center py-12">
              <Loader2 size={18} className="animate-spin text-[var(--accent)]/50" />
            </div>
          ) : dersNotlari.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-3 py-14 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06]">
                <NotebookPen size={18} className="text-white/20" />
              </div>
              <p className="text-[12.5px] leading-relaxed text-white/30">
                Henüz ders notun yok. Bir dersin özet ekranında &quot;Özeti ders notlarına
                kaydet&quot; dediğinde burada görünecek.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {dersNotlari.map((n) => (
                <Link
                  key={n.id}
                  href={`/note/${n.id}`}
                  tabIndex={notlarAcik ? 0 : -1}
                  className="group flex items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-[var(--accent)]/[0.06]"
                >
                  <FileText size={14} className="flex-shrink-0 text-white/25" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-white/85">
                      {n.id.replace(/^ders-/, "").replace(/-/g, " ")}
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/30">{tarihMetni(n.updated_at)}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Silme onayı */}
      {silinecek && (
        <div
          className="animate-overlay fixed inset-0 z-[var(--z-panel)] flex items-center justify-center bg-black/40 px-5"
          onClick={() => setSilinecek(null)}
        >
          <div
            className="animate-fade-in-scale w-full max-w-xs rounded-2xl border border-[var(--border)] bg-[var(--surface-popup)] p-6 shadow-2xl shadow-black/40"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[14px] font-medium text-white/90">Bu ders silinsin mi?</p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/45">
              Sorular ve verdiğin cevaplar da silinir. Geri alınamaz.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setSilinecek(null)}
                className="flex-1 rounded-xl border border-[var(--border)] px-4 py-2.5 text-[13px] text-white/60 transition-colors hover:text-white/90"
              >
                Vazgeç
              </button>
              <button
                onClick={() => oturumSil(silinecek)}
                className="flex-1 rounded-xl bg-red-500/85 px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-red-500"
              >
                Sil
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
