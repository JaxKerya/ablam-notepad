"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  Loader2,
  Minus,
  Plus,
  Printer,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import { useToast } from "@/components/Toast";
import BahceLogo, { MODUL_PALETLERI } from "@/components/BahceLogo";
import { KARIYER_ACIK, ONIZLEME_ANAHTARI, sadelestir } from "@/lib/kariyer";
import {
  BOS_DURUM,
  durumDogrula,
  kadroEnKucukPuan,
  kadroSonucu,
  isTanimiKoduMu,
  kodMetni,
  puanKarsilastir,
  sorulacakKodlar,
  type Cevap,
  type KadroDurumu,
  type KadroSonucu,
  type TercihDurumu,
  type TercihKadro,
  type TercihSorusu,
  type TercihVerisi,
} from "@/lib/kpss-tercih";

// KPSS preference guide helper. One scrolling page: a summary ("N of the posts
// are open to you"), the questions still unanswered, every post in one table
// (filter by verdict, province or text; a row opens its conditions), your ordered list,
// and the fine print folded away.
// Every verdict comes from lib/kpss-tercih.ts (kadroSonucu); this file only
// shows it. A post is called "Tercih edebilirsin" only when kadroSonucu says
// "uygun", and nothing is judged before program and gender are known.
// Placement scores (this round's results, or an earlier round's as a reference)
// are shown next to a post and order the open groups; they never move a post
// from one group to another.

/** Same soft-contrast tokens as /kariyer (kept local there too) */
const TOKENLAR = {
  "--k-t1": "var(--foreground)",
  "--k-t2": "rgba(255,255,255,.90)",
  "--k-t3": "rgba(255,255,255,.78)",
  "--k-card": "rgba(0,0,0,.14)",
  "--k-card-open": "rgba(0,0,0,.20)",
  "--k-hair": "rgba(255,255,255,.07)",
  "--k-chip": "rgba(0,0,0,.12)",
  "--k-chip-hover": "rgba(0,0,0,.20)",
  "--k-chip-on": "rgb(var(--accent-rgb) / .18)",
} as React.CSSProperties;

const ODAK =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-rgb)/0.7)]";
const GIRDI_ODAK =
  "transition-colors focus:border-[rgb(var(--accent-rgb)/0.5)] focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-[rgb(var(--accent-rgb)/0.7)]";
const GIRDI = `min-h-11 w-full rounded-xl border border-white/[0.08] bg-[var(--surface)] px-3.5 py-2.5 text-[13.5px] text-[var(--k-t1)] placeholder-[var(--k-t3)] ${GIRDI_ODAK}`;
const KART = "rounded-2xl bg-[var(--k-card)] p-4 ring-1 ring-[var(--k-hair)]";
const BASLIK = "text-[15px] font-semibold text-[var(--k-t1)]";
const ACIKLAMA = "mt-1 text-[13px] leading-5 text-[var(--k-t2)]";
const IKINCIL_DUGME = `flex h-10 items-center justify-center gap-1.5 rounded-xl bg-white/[0.08] px-3.5 text-[13px] text-[var(--k-t1)] transition-colors hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40 ${ODAK}`;

/** Paper has no sage background: black on white, and the page noise layer off */
const YAZDIR_CSS =
  "@media print { html, body { background: #fff !important; color: #000 !important; } body::before { display: none !important; } @page { margin: 14mm; } }";


/** Days after the end of its preference window that a round stays on the page by default */
const ARSIV_GUN = 45;

const dolu = (s: string | null | undefined): s is string => !!s && s.trim() !== "" && s.trim() !== "-";
const sayi = (n: number) => n.toLocaleString("tr-TR");
const donemAdi = (donem: string) => `KPSS-${donem}`;

// ---------------------------------------------------------------- scores

/** "84,95": two decimals, Turkish comma */
const puanYaz = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * A post's lowest placed score as text. Two decimals, unless that would print
 * it equal to the user's own score while the two differ (78 against 78,00412):
 * then with ÖSYM's five, so the two numbers never look equal when they are not.
 */
function tabanYaz(enKucuk: number, puan: number | undefined): string {
  if (puan === undefined || puan === enKucuk || puanYaz(puan) !== puanYaz(enKucuk)) return puanYaz(enKucuk);
  return enKucuk.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 5 });
}

/** What is typed into the score field: a number, nothing (undefined), or not a score yet ("hata") */
function puanCoz(metin: string): number | undefined | "hata" {
  const t = metin.trim().replace(",", ".");
  if (!t) return undefined;
  if (!/^\d{1,3}(\.\d{0,5})?$/.test(t)) return "hata";
  const n = Number(t);
  return n <= 100 ? n : "hata";
}

interface PuanBilgisi {
  /** Sentence for the post card */
  cumle: string;
  /** Where an earlier round's reference comes from; null for this round's own result */
  ayrinti: string | null;
  /** Short form for the preference list and the print-out */
  kisa: string;
  /** The user's score against it, when both are known */
  yeter: boolean | null;
  /** Lower-case marker text, present only when the score is enough; an earlier round only says what would have happened */
  isaret: string | null;
}

/** The score line of a post: this round's own result when it is in, otherwise the earlier round's reference */
function puanBilgisi(kadro: TercihKadro, puan: number | undefined): PuanBilgisi | null {
  const { taban, emsal } = kadro;
  if (taban) {
    if (taban.enKucuk === null) return { cumle: "Bu kadroya yerleşen olmadı", ayrinti: null, kisa: "Bu dönem yerleşen olmadı", yeter: null, isaret: null };
    const k = puanKarsilastir(puan, taban.enKucuk);
    const p = tabanYaz(taban.enKucuk, puan);
    return {
      cumle: `Bu dönem en düşük ${p} puanla kapandı`,
      ayrinti: null,
      kisa: `Bu dönem en düşük ${p}`,
      // Only the good news is spelled out: an earlier minimum above her score is shown as
      // a plain number, never as "not enough" (minimums move every round)
      yeter: k === "yeter" ? true : null,
      isaret: k === "yeter" ? "puanın yetiyor" : null,
    };
  }
  if (!emsal) return null;
  const k = puanKarsilastir(puan, emsal.enKucuk);
  const p = tabanYaz(emsal.enKucuk, puan);
  return {
    cumle: `Geçen dönem (${emsal.donem}) benzer kadro en düşük ${p} ile kapandı`,
    // Said outright when the reference had other requirements: those move the minimum by many points
    ayrinti: [emsal.ayniSart ? "aynı şartlar" : "şartları farklı", emsal.ayniIl ? "aynı il" : "başka illerde", emsal.kadro > 1 ? `${sayi(emsal.kadro)} kadronun en düşüğü` : null]
      .filter(Boolean)
      .join(", "),
    kisa: `Geçen dönem (${emsal.donem}) en düşük ${p}`,
    yeter: k === "yeter" ? true : null,
    isaret: k === "yeter" ? "puanın yeterdi" : null,
  };
}

/** Enough is the page's "fine" colour; not enough is a caution, not the red of a closed post */
const puanRengi = (yeter: boolean | null) => (yeter ? "text-[var(--accent-light)]" : "text-amber-200");

/** "3 Temmuz 2026"; a date-only value is read as that calendar day, not shifted by the time zone */
function gunMetni(iso: string): string | null {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const yalnizGun = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: yalnizGun ? "UTC" : "Europe/Istanbul" }).format(t);
}

/** Preference window line for the header; `simdi` is captured at load so render stays pure */
function tercihDonemi(veri: TercihVerisi, simdi: number): { metin: string; not: string | null; gecti: boolean } | null {
  const bas = veri.tercihBaslangic ? gunMetni(veri.tercihBaslangic) : null;
  const bit = veri.tercihBitis ? gunMetni(veri.tercihBitis) : null;
  if (!bas && !bit) return null;
  const metin = bas && bit ? `${bas} – ${bit}` : bas ? `${bas} tarihinden itibaren` : `${bit} tarihine kadar`;
  // A date-only end means "until the end of that day" in Turkey (UTC+3)
  const sonAn = veri.tercihBitis ? new Date(veri.tercihBitis).getTime() + (/^\d{4}-\d{2}-\d{2}$/.test(veri.tercihBitis) ? 21 * 3600_000 : 0) : null;
  const ilkAn = veri.tercihBaslangic ? new Date(veri.tercihBaslangic).getTime() - (/^\d{4}-\d{2}-\d{2}$/.test(veri.tercihBaslangic) ? 3 * 3600_000 : 0) : null;
  let not: string | null = null;
  const gecti = sonAn !== null && simdi > sonAn;
  if (gecti) not = "Bu dönemin tercih süresi doldu; tablolar artık yalnızca fikir verir.";
  else if (ilkAn !== null && simdi < ilkAn) not = "Tercihler henüz başlamadı.";
  else if (sonAn !== null) not = "Tercih süresi şu an açık.";
  return { metin, not, gecti };
}

// ---------------------------------------------------------------- saving

type KayitDurumu = "yok" | "bekliyor" | "kaydedildi" | "hata";

/**
 * Debounced, serialised PATCH of the `durum` column.
 *
 * - One request at a time, so an older state can never land after a newer one.
 * - The unsaved state is kept PER ROUND: a save of 2026/1 that failed is not
 *   thrown away because 2026/2 was edited in the meantime, and nothing is ever
 *   written to another round's row.
 * - An entry stays in the queue until the server has confirmed exactly that
 *   state, so a reload of the same round can show it instead of the older row.
 */
function kaydediciOlustur(bildir: (k: KayitDurumu) => void) {
  const bekleyen = new Map<string, TercihDurumu>();
  /** States already handed to a keepalive request (visibilitychange and pagehide both fire on unload) */
  const kapanistaGiden = new WeakSet<TercihDurumu>();
  let zamanlayici: ReturnType<typeof setTimeout> | null = null;
  let silici: ReturnType<typeof setTimeout> | null = null;
  let dongu: Promise<void> | null = null;
  let denemeler = 0;

  const yolla = async (donem: string, durum: TercihDurumu, keepalive: boolean): Promise<boolean> => {
    try {
      const yanit = await fetch("/api/kariyer/tercih", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ donem, durum }),
        keepalive,
      });
      return yanit.ok;
    } catch {
      return false;
    }
  };

  const zamanlayiciSil = () => {
    if (zamanlayici) clearTimeout(zamanlayici);
    zamanlayici = null;
  };
  const kur = (ms: number) => {
    zamanlayiciSil();
    zamanlayici = setTimeout(() => {
      zamanlayici = null;
      void baslat();
    }, ms);
  };
  const bitti = () => {
    if (silici) clearTimeout(silici);
    bildir("kaydedildi");
    silici = setTimeout(() => bildir("yok"), 2500);
  };

  const bosalt = async (): Promise<void> => {
    for (;;) {
      const siradaki = bekleyen.entries().next();
      if (siradaki.done) break;
      const [donem, durum] = siradaki.value;
      const tamam = await yolla(donem, durum, false);
      if (tamam) {
        denemeler = 0;
        // Forget it only if nothing newer was queued for this round while the request was out
        if (bekleyen.get(donem) === durum) bekleyen.delete(donem);
        continue;
      }
      // Move the round that failed to the back, so it cannot hold up another round's save
      const guncel = bekleyen.get(donem);
      if (guncel) {
        bekleyen.delete(donem);
        bekleyen.set(donem, guncel);
      }
      bildir("hata");
      // A few quiet retries for a flaky phone connection, then wait for "tekrar dene" or the next change.
      // A debounce timer set by a newer change fires sooner and is left alone.
      if (++denemeler <= 3 && !zamanlayici) kur(5000);
      return;
    }
    bitti();
  };

  function baslat(): Promise<void> {
    zamanlayiciSil();
    // The running loop picks up whatever was queued meanwhile
    if (dongu) return dongu;
    if (!bekleyen.size) return Promise.resolve();
    const p: Promise<void> = bosalt().finally(() => {
      if (dongu === p) dongu = null;
    });
    dongu = p;
    return p;
  }

  return {
    planla(donem: string, durum: TercihDurumu) {
      bekleyen.set(donem, durum);
      denemeler = 0;
      if (silici) clearTimeout(silici);
      bildir("bekliyor");
      kur(700);
    },
    /** Send now (round switch, leaving the page inside the app, "tekrar dene"); resolves when the queue is empty or a save failed */
    hemen(): Promise<void> {
      denemeler = 0;
      return baslat();
    },
    /**
     * The tab is being hidden or closed: there may be no "later", so every
     * unsaved state goes out right now with keepalive, even next to a request
     * that is still out. The queue is kept: if the page lives on, the normal
     * loop sends the same state again in order, so the newest one lands last.
     */
    kapanirken() {
      for (const [donem, durum] of bekleyen) {
        if (kapanistaGiden.has(durum)) continue;
        kapanistaGiden.add(durum);
        void yolla(donem, durum, true).then((tamam) => {
          if (!tamam) {
            kapanistaGiden.delete(durum);
            return;
          }
          // Still here (the tab was only hidden) and nothing newer or in flight: this state is saved
          if (dongu || bekleyen.get(donem) !== durum) return;
          bekleyen.delete(donem);
          if (!bekleyen.size) {
            zamanlayiciSil();
            bitti();
          }
        });
      }
    },
    /** Not yet confirmed by the server for this round, if anything */
    bekleyenDurum(donem: string): TercihDurumu | undefined {
      return bekleyen.get(donem);
    },
  };
}

/**
 * State used for judging posts. An answer only counts for a code whose official
 * text is on file in this round: if the tables were reloaded and a code's text
 * went missing, an old "Karşılıyorum" must not keep a post under "Tercih
 * edebilirsin". The stored state itself is left untouched.
 */
function gecerliDurum(veri: TercihVerisi, durum: TercihDurumu): TercihDurumu {
  const metinsiz = Object.keys(durum.cevaplar).filter((kod) => typeof veri.ozel[kod] !== "string");
  if (!metinsiz.length) return durum;
  const cevaplar = { ...durum.cevaplar };
  for (const kod of metinsiz) delete cevaplar[kod];
  return { ...durum, cevaplar };
}

/** Nothing is judged before the program (one this round's list knows) and the gender are set */
function bilgilerTamam(veri: TercihVerisi, durum: TercihDurumu): boolean {
  return !!durum.program && typeof veri.programlar[durum.program] === "string" && !!durum.cinsiyet;
}

// ---------------------------------------------------------------- page

export default function TercihSayfasi() {
  // Same gate as /kariyer: while the section is closed only someone who opened
  // it with ?onizleme=1 (remembered in localStorage) sees it.
  const [gorunum, setGorunum] = useState<"bilinmiyor" | "yakinda" | "acik">(KARIYER_ACIK ? "acik" : "bilinmiyor");
  useEffect(() => {
    if (KARIYER_ACIK) return;
    queueMicrotask(() => {
      let onizleme = false;
      try {
        if (new URLSearchParams(window.location.search).get("onizleme") === "1") {
          localStorage.setItem(ONIZLEME_ANAHTARI, "1");
        }
        onizleme = localStorage.getItem(ONIZLEME_ANAHTARI) === "1";
      } catch {
        // private window etc.: stays closed
      }
      setGorunum(onizleme ? "acik" : "yakinda");
    });
  }, []);

  if (gorunum !== "acik") {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-x-hidden px-5">
        <GeriDugmesi href="/" etiket="Ana sayfa" />
        <div className={`animate-fade-in motion-reduce:animate-none flex flex-col items-center text-center transition-opacity ${gorunum === "bilinmiyor" ? "opacity-0" : ""}`}>
          <h1 className="sr-only">Ablam Kariyer</h1>
          <BahceLogo metin="Ablam Kariyer" palet={MODUL_PALETLERI.kariyer} yukseklik={200} className="w-[min(36rem,90vw)]" />
          <span className="-mt-6 rounded-full border border-[var(--accent)]/25 bg-[var(--accent)]/10 px-3 py-1 text-[12px] font-medium text-[var(--accent-light)]/85">
            Yakında
          </span>
        </div>
      </main>
    );
  }
  return <TercihUygulamasi />;
}

/** Back link: a 40 px round icon on phones, labelled and fixed from sm up (same control as /kariyer's home button) */
function GeriDugmesi({ href, etiket }: { href: string; etiket: string }) {
  return (
    <Link
      href={href}
      aria-label={etiket}
      className={`glass absolute top-4 left-4 z-20 flex h-10 w-10 items-center justify-center gap-2 rounded-full border border-[var(--border)] text-[13px] text-[var(--k-t2)] transition-colors duration-200 hover:border-[var(--border-hover)] hover:text-[var(--k-t1)] sm:fixed sm:top-6 sm:left-7 sm:h-auto sm:w-auto sm:rounded-xl sm:px-3 sm:py-2 print:hidden ${ODAK}`}
    >
      <ArrowLeft size={16} aria-hidden />
      <span className="hidden sm:inline">{etiket}</span>
    </Link>
  );
}

interface Yuklenen {
  donemler: string[];
  donem: string;
  veri: TercihVerisi;
  kaynakUrl: string | null;
  /** Moment the data arrived; used for "is the preference window over?" */
  simdi: number;
}

type Yuk = { asama: "yukleniyor" } | { asama: "bos" } | { asama: "hata"; mesaj: string } | ({ asama: "hazir" } & Yuklenen);

function TercihUygulamasi() {
  const [yuk, setYuk] = useState<Yuk>({ asama: "yukleniyor" });
  const [durum, setDurum] = useState<TercihDurumu>(BOS_DURUM);
  const [kayit, setKayit] = useState<KayitDurumu>("yok");
  const [kaydedici] = useState(() => kaydediciOlustur(setKayit));
  /** Only the latest request may write to state (round switched while one was out) */
  const istek = useRef(0);

  const getir = useCallback(async (istenen?: string) => {
    const no = ++istek.current;
    const adres = istenen ? `/api/kariyer/tercih?donem=${encodeURIComponent(istenen)}` : "/api/kariyer/tercih";
    let yanit: Response;
    let govde: Record<string, unknown> | null;
    try {
      yanit = await fetch(adres, { cache: "no-store" });
      if (yanit.status === 401) {
        // ClientLayout sets the gate cookie right after mount; a first visit can get here before it
        await new Promise((r) => setTimeout(r, 1500));
        yanit = await fetch(adres, { cache: "no-store" });
      }
      govde = (await yanit.json().catch(() => null)) as Record<string, unknown> | null;
    } catch {
      if (no === istek.current) setYuk({ asama: "hata", mesaj: "Bağlantı kurulamadı. İnternetini kontrol edip tekrar dene." });
      return;
    }
    if (no !== istek.current) return;
    if (!yanit.ok) {
      const mesaj =
        yanit.status === 401
          ? "Girişin doğrulanamadı. Sayfayı yenileyip tekrar dene."
          : typeof govde?.hata === "string"
            ? govde.hata
            : "Kılavuz yüklenemedi.";
      setYuk({ asama: "hata", mesaj });
      return;
    }
    const veri = govde?.veri as TercihVerisi | null | undefined;
    if (!veri || typeof govde?.donem !== "string" || !Array.isArray(veri.kadrolar)) {
      setYuk({ asama: "bos" });
      return;
    }
    // A round whose preference window closed long ago is an archive, not something to act on.
    // The page then looks as if no guide were loaded (the user must not open it to a past
    // round's verdicts); "?gecmis" in the address shows the archive anyway.
    const bitis = veri.tercihBitis ? new Date(veri.tercihBitis).getTime() : NaN;
    const arsiv = Number.isFinite(bitis) && Date.now() - bitis > ARSIV_GUN * 86_400_000;
    if (arsiv && !new URLSearchParams(window.location.search).has("gecmis")) {
      setYuk({ asama: "bos" });
      return;
    }
    // A change of this round that the server has not confirmed yet is newer than the row just read
    setDurum(kaydedici.bekleyenDurum(govde.donem) ?? durumDogrula(govde.durum));
    setYuk({
      asama: "hazir",
      donemler: Array.isArray(govde.donemler) ? govde.donemler.filter((d): d is string => typeof d === "string") : [govde.donem],
      donem: govde.donem,
      veri,
      kaynakUrl: typeof govde.kaynakUrl === "string" ? govde.kaynakUrl : null,
      simdi: Date.now(),
    });
  }, [kaydedici]);

  useEffect(() => {
    // Deferred like /kariyer does: no setState in the synchronous body of the effect
    queueMicrotask(() => void getir());
  }, [getir]);

  // Leaving (tab hidden, phone locked, reload, tab closed): do not lose the last change to the debounce
  useEffect(() => {
    const gizlenince = () => {
      if (document.visibilityState === "hidden") kaydedici.kapanirken();
    };
    const ayrilirken = () => kaydedici.kapanirken();
    document.addEventListener("visibilitychange", gizlenince);
    window.addEventListener("pagehide", ayrilirken);
    return () => {
      document.removeEventListener("visibilitychange", gizlenince);
      window.removeEventListener("pagehide", ayrilirken);
      // Going to another page of the app: the script lives on, an ordinary request is enough
      void kaydedici.hemen();
    };
  }, [kaydedici]);

  const donem = yuk.asama === "hazir" ? yuk.donem : null;
  const durumYaz = useCallback(
    (yeni: TercihDurumu) => {
      if (!donem) return;
      setDurum(yeni);
      kaydedici.planla(donem, yeni);
    },
    [donem, kaydedici]
  );

  const donemDegistir = (yeni: string) => {
    setYuk({ asama: "yukleniyor" });
    setDurum(BOS_DURUM);
    // Invalidate a load that is still out, then let the save of the round being
    // left land first (bounded: a hanging save must not block the other round)
    istek.current++;
    const sinirli = Promise.race([kaydedici.hemen(), new Promise<void>((r) => setTimeout(r, 4000))]);
    void sinirli.then(() => getir(yeni));
  };

  const pencere = yuk.asama === "hazir" ? tercihDonemi(yuk.veri, yuk.simdi) : null;

  return (
    <main className="relative min-h-screen overflow-x-hidden print:min-h-0 print:overflow-visible" style={TOKENLAR}>
      <style>{YAZDIR_CSS}</style>
      <div
        className="pointer-events-none fixed inset-0 print:hidden"
        style={{
          background: [
            "radial-gradient(ellipse 80% 50% at 50% 0%, rgb(var(--accent-rgb) / 0.07) 0%, transparent 60%)",
            "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.15) 100%)",
          ].join(", "),
        }}
      />

      <GeriDugmesi href="/kariyer" etiket="Ablam Kariyer" />

      <div className="relative z-10 mx-auto w-full max-w-2xl px-4 pb-28 pt-16 sm:pt-20 print:hidden">
        <header className="mb-5 text-center">
          <h1 className="text-[26px] font-semibold leading-8 tracking-tight text-[var(--k-t1)]">Tercih Rehberi</h1>
          {yuk.asama === "hazir" ? (
            <>
              <p className="mt-1 text-[14px] text-[var(--accent-light)]">{donemAdi(yuk.donem)} · ön lisans kadroları</p>
              {pencere && (
                <p className="mt-1 text-[12.5px] leading-[18px] text-[var(--k-t2)]">
                  Tercih tarihleri: {pencere.metin}
                  {pencere.not && <span className="block">{pencere.not}</span>}
                </p>
              )}
              {yuk.donemler.length > 1 && (
                <div className="mt-3 flex justify-center">
                  <AcilirSecim etiket="Dönem" deger={yuk.donem} secenekler={yuk.donemler.map((d) => ({ deger: d, etiket: donemAdi(d) }))} onSec={donemDegistir} />
                </div>
              )}
            </>
          ) : (
            <p className="mt-1 text-[13px] text-[var(--k-t2)]">ÖSYM&apos;nin tercih tablolarından sana açık kadrolar</p>
          )}
        </header>

        {yuk.asama === "yukleniyor" && (
          <div aria-busy="true" className="space-y-2">
            <span className="sr-only">Yükleniyor</span>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 rounded-2xl bg-white/[0.05] motion-safe:animate-pulse" />
            ))}
          </div>
        )}

        {yuk.asama === "bos" && (
          <div className="rounded-2xl p-6 text-center text-[13.5px] leading-5 text-[var(--k-t2)] ring-1 ring-[var(--k-hair)]">
            Yeni tercih kılavuzu henüz yayımlanmadı.
            <span className="mt-1 block text-[12.5px]">ÖSYM yeni tercih kılavuzunu yayımlayınca tablolar burada görünecek.</span>
          </div>
        )}

        {yuk.asama === "hata" && (
          <div className="flex items-start gap-3 rounded-2xl bg-rose-300/[0.10] p-4">
            <TriangleAlert size={16} aria-hidden className="mt-0.5 flex-shrink-0 text-rose-200" />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] leading-5 text-rose-100/90">{yuk.mesaj}</p>
              <button
                type="button"
                onClick={() => {
                  setYuk({ asama: "yukleniyor" });
                  void getir();
                }}
                className={`mt-3 ${IKINCIL_DUGME}`}
              >
                Tekrar dene
              </button>
            </div>
          </div>
        )}

        {yuk.asama === "hazir" && (
          <Rehber key={yuk.donem} veri={yuk.veri} donem={yuk.donem} durum={durum} onDurum={durumYaz} kaynakUrl={yuk.kaynakUrl} gecmis={pencere?.gecti ?? false} />
        )}
      </div>

      {/* Print-only sheet: the ordered list and nothing else */}
      {yuk.asama === "hazir" && <YazdirmaSayfasi veri={yuk.veri} donem={yuk.donem} durum={durum} />}

      {/* Save hint. A direct child of <main>: an animated ancestor would break `fixed`. */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[var(--z-overlay)] flex justify-center px-4 print:hidden">
        {kayit === "bekliyor" && (
          <span className="glass-strong flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] text-[var(--k-t2)] ring-1 ring-[var(--k-hair)]">
            <Loader2 size={12} aria-hidden className="motion-safe:animate-spin" /> kaydediliyor
          </span>
        )}
        {kayit === "kaydedildi" && (
          <span className="glass-strong flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] text-[var(--accent-light)] ring-1 ring-[var(--k-hair)]">
            <Check size={12} aria-hidden /> kaydedildi
          </span>
        )}
        {kayit === "hata" && (
          <span className="glass-strong pointer-events-auto flex min-h-10 items-center gap-2 rounded-full py-1 pl-3.5 pr-1.5 text-[12.5px] text-rose-100 ring-1 ring-rose-300/30">
            <TriangleAlert size={13} aria-hidden /> kaydedilemedi
            <button type="button" onClick={() => void kaydedici.hemen()} className={`h-8 rounded-full bg-white/[0.12] px-3 text-[12.5px] text-[var(--k-t1)] hover:bg-white/[0.18] ${ODAK}`}>
              tekrar dene
            </button>
          </span>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- guide body

interface Satir {
  kadro: TercihKadro;
  sonuc: KadroSonucu;
}

/** The three verdicts, as filter labels of the table */
const SEKMELER: { tur: KadroDurumu; etiket: string }[] = [
  { tur: "uygun", etiket: "Açık" },
  { tur: "dogrula", etiket: "Cevap bekliyor" },
  { tur: "kapali", etiket: "Kapalı" },
];

const KUCUK_KALAN = new Set(["ve", "ile", "veya"]);

/**
 * ÖSYM prints every name in capitals; word-style casing reads faster on a
 * phone. Abbreviations written with a dot ("A.Ş.") are left alone. Display
 * only: the print-out and the official texts keep ÖSYM's spelling.
 */
function okunakli(metin: string): string {
  return metin
    .split(" ")
    .map((kelime, i) => {
      if (!kelime || kelime.includes(".")) return kelime;
      const kucuk = kelime.toLocaleLowerCase("tr-TR");
      if (i > 0 && KUCUK_KALAN.has(kucuk)) return kucuk;
      // First letter, and any letter right after "(", "-" or "/"
      return kucuk.replace(/(^|[(\-/])(\p{L})/gu, (_tam, on: string, harf: string) => on + harf.toLocaleUpperCase("tr-TR"));
    })
    .join(" ");
}

/** One plain line saying why a post is not open; null for an open post */
function kisaNeden(satir: Satir, veri: TercihVerisi): string | null {
  const { sonuc } = satir;
  if (sonuc.durum === "uygun") return null;
  if (sonuc.durum === "kapali") {
    const kod = sonuc.kapatan[0];
    if (!kod) return null;
    if (veri.ogrenim[kod]) return "Bölümün bu kadroya uymuyor";
    const metin = (veri.ozel[kod] ?? "").toLocaleLowerCase("tr-TR");
    if (metin.includes("cinsiyeti erkek")) return "Yalnızca erkek adaylara açık";
    if (metin.includes("cinsiyeti kadın")) return "Yalnızca kadın adaylara açık";
    return `Karşılamadığın şart: ${kodMetni(kod, veri)}`;
  }
  const [ilk, ...diger] = sonuc.bekleyen;
  if (!ilk) return null;
  return `Cevap bekliyor: ${kodMetni(ilk, veri)}${diger.length ? ` (+${diger.length} şart daha)` : ""}`;
}

function Rehber({
  veri,
  donem,
  durum,
  onDurum,
  kaynakUrl,
  gecmis,
}: {
  veri: TercihVerisi;
  donem: string;
  durum: TercihDurumu;
  onDurum: (yeni: TercihDurumu) => void;
  kaynakUrl: string | null;
  /** The preference window of this round is over: it is shown as an example, in the past tense */
  gecmis: boolean;
}) {
  const { addToast } = useToast();
  const [duzenle, setDuzenle] = useState(false);
  const [il, setIl] = useState("");
  /** Status filter of the table; everything by default */
  const [sekme, setSekme] = useState<KadroDurumu | "hepsi">("hepsi");
  const [ara, setAra] = useState("");

  // A stored program that this round's list does not know counts as "not chosen"
  const programAdi = durum.program ? veri.programlar[durum.program] : undefined;
  const hazir = bilgilerTamam(veri, durum);
  const sinir = veri.enFazlaTercih > 0 ? veri.enFazlaTercih : null;

  // `durum` is what gets saved; `etkin` is what the verdicts are read from
  const etkin = useMemo(() => gecerliDurum(veri, durum), [veri, durum]);
  const satirlar = useMemo<Satir[]>(() => veri.kadrolar.map((kadro) => ({ kadro, sonuc: kadroSonucu(kadro, veri, etkin) })), [veri, etkin]);
  const kodaGore = useMemo(() => {
    const m = new Map<string, Satir>();
    for (const s of satirlar) if (!m.has(s.kadro.kod)) m.set(s.kadro.kod, s);
    return m;
  }, [satirlar]);
  const sorular = useMemo(() => (hazir ? sorulacakKodlar(veri, etkin) : []), [veri, etkin, hazir]);
  const iller = useMemo(() => [...new Set(veri.kadrolar.map((k) => k.il).filter(dolu))].sort((a, b) => a.localeCompare(b, "tr")), [veri]);
  const puan = etkin.puan;
  const gruplar = useMemo(() => {
    const g: Record<KadroDurumu, Satir[]> = { uygun: [], dogrula: [], kapali: [] };
    const aranan = sadelestir(ara);
    for (const s of satirlar) {
      if (il && s.kadro.il !== il) continue;
      if (aranan && !sadelestir(`${s.kadro.unvan} ${s.kadro.kurum} ${s.kadro.il} ${s.kadro.ilce} ${s.kadro.kod}`).includes(aranan)) continue;
      g[s.sonuc.durum].push(s);
    }
    if (puan !== undefined) {
      // With a score: posts it reaches first, then those without a number, then those above it; table order within each
      const sira = (s: Satir) => {
        const k = puanKarsilastir(puan, kadroEnKucukPuan(s.kadro));
        return k === "yeter" ? 0 : k === null ? 1 : 2;
      };
      g.uygun.sort((a, b) => sira(a) - sira(b));
      g.dogrula.sort((a, b) => sira(a) - sira(b));
    }
    return g;
  }, [satirlar, il, ara, puan]);
  const puanliKadroVar = useMemo(() => veri.kadrolar.some((k) => k.taban || k.emsal), [veri]);

  const puanDegistir = (yeni: number | undefined) => {
    const sonraki = { ...durum };
    if (yeni === undefined) delete sonraki.puan;
    else sonraki.puan = yeni;
    onDurum(sonraki);
  };

  const cevapla = (kod: string, cevap: Cevap) => {
    const cevaplar = { ...durum.cevaplar };
    // Tapping the chosen answer again clears it
    if (cevaplar[kod] === cevap) delete cevaplar[kod];
    else cevaplar[kod] = cevap;
    onDurum({ ...durum, cevaplar });
  };

  const listeDegistir = (kod: string) => {
    if (durum.secilenler.includes(kod)) {
      onDurum({ ...durum, secilenler: durum.secilenler.filter((k) => k !== kod) });
      return;
    }
    if (sinir && durum.secilenler.length >= sinir) {
      addToast(`ÖSYM en fazla ${sinir} tercih kabul ediyor. Eklemek için önce listenden birini çıkar.`, "info");
      return;
    }
    onDurum({ ...durum, secilenler: [...durum.secilenler, kod] });
  };

  const tasi = (sira: number, yon: -1 | 1) => {
    const hedef = sira + yon;
    if (hedef < 0 || hedef >= durum.secilenler.length) return;
    const secilenler = [...durum.secilenler];
    [secilenler[sira], secilenler[hedef]] = [secilenler[hedef], secilenler[sira]];
    onDurum({ ...durum, secilenler });
  };

  // Totals for the summary card: every province, whatever the filter below says
  const ozet = useMemo(() => {
    const o = { uygun: 0, kontenjan: 0, bekleyen: 0, puanli: 0, yeten: 0 };
    for (const s of satirlar) {
      if (s.sonuc.durum === "dogrula") o.bekleyen++;
      if (s.sonuc.durum !== "uygun") continue;
      o.uygun++;
      o.kontenjan += s.kadro.adet;
      const k = puanKarsilastir(puan, kadroEnKucukPuan(s.kadro));
      if (k) o.puanli++;
      if (k === "yeter") o.yeten++;
    }
    return o;
  }, [satirlar, puan]);

  const acikSorular = sorular.filter((s) => !etkin.cevaplar[s.kod]);
  const cevapliSorular = sorular.filter((s) => etkin.cevaplar[s.kod]);
  // Open posts first, then the waiting ones, then the closed ones
  const gorunen = sekme === "hepsi" ? [...gruplar.uygun, ...gruplar.dogrula, ...gruplar.kapali] : gruplar[sekme];

  return (
    <div className="space-y-6">
      {/* 1 · Summary, with who she is on one line */}
      {hazir && !duzenle && (
        <section className="rounded-2xl bg-[var(--k-card)] p-5 ring-1 ring-[var(--k-hair)]">
          {gecmis && (
            <p className="mb-2 inline-block rounded-full bg-white/[0.10] px-2.5 text-[11.5px] leading-5 text-[var(--k-t2)]">Geçmiş dönem · örnek olarak</p>
          )}
          <p className="text-[13px] text-[var(--k-t2)]">Tablodaki {sayi(veri.kadrolar.length)} kadrodan</p>
          <p className="mt-1 text-[24px] font-semibold leading-8 text-[var(--k-t1)]">
            <span className="tabular-nums text-[var(--accent-light)]">{sayi(ozet.uygun)}</span> tanesini {gecmis ? "tercih edebilirdin" : "tercih edebilirsin"}
          </p>
          <ul className="mt-2 space-y-1 text-[13px] leading-5 text-[var(--k-t2)]">
            {ozet.uygun > 0 && <li className="tabular-nums">Toplam {sayi(ozet.kontenjan)} kontenjan.</li>}
            {ozet.bekleyen > 0 && (
              <li className="tabular-nums text-amber-200">
                {sayi(ozet.bekleyen)} kadro daha cevabını bekliyor; aşağıdaki {acikSorular.length > 1 ? "soruları" : "soruyu"} cevapla.
              </li>
            )}
            {/* Said only when it is good news; a score below earlier minimums is not commented on */}
            {ozet.yeten > 0 && (
              <li className="tabular-nums text-[var(--accent-light)]">
                Önceki kapanış puanlarına göre puanın bunların {sayi(ozet.yeten)} tanesine yetiyor.
              </li>
            )}
          </ul>
          <div className="mt-4 flex items-center gap-3 border-t border-white/[0.07] pt-3">
            <p className="min-w-0 flex-1 break-words text-[12.5px] leading-[18px] text-[var(--k-t2)]">
              {programAdi ? okunakli(programAdi) : ""} · {durum.cinsiyet === "kadin" ? "Kadın" : "Erkek"}
              {puan !== undefined && <span className="tabular-nums"> · {puanYaz(puan)} puan</span>}
            </p>
            <button type="button" onClick={() => setDuzenle(true)} className={`flex-shrink-0 ${IKINCIL_DUGME}`}>
              Değiştir
            </button>
          </div>
        </section>
      )}

      {/* Who she is: asked once, then folded into the summary above */}
      {(!hazir || duzenle) && (
        <section className={KART}>
          <h2 className={BASLIK}>Önce seni tanıyayım</h2>
          <p className={ACIKLAMA}>Kadroların çoğu belirli bölümlere açık; bölümünü bilmeden hiçbirine “açık” diyemem.</p>

          <div className="mt-4">
            <p className="mb-1.5 text-[13px] font-medium text-[var(--k-t1)]">Mezun olduğun ön lisans programı</p>
            {Object.keys(veri.programlar).length === 0 ? (
              <p className="rounded-xl bg-amber-300/[0.10] p-3 text-[13px] leading-5 text-amber-100">
                Bu dönemin program listesi tablolardan okunamadı. Program seçilemediği için kadrolar gösterilemiyor.
              </p>
            ) : (
              <ProgramSecici programlar={veri.programlar} secili={programAdi ? durum.program : undefined} onSec={(kod) => onDurum({ ...durum, program: kod })} />
            )}
            {durum.program && !programAdi && Object.keys(veri.programlar).length > 0 && (
              <p className="mt-2 text-[12.5px] leading-[18px] text-amber-200">Daha önce seçtiğin program bu dönemin listesinde yok. Lütfen yeniden seç.</p>
            )}
          </div>

          <div className="mt-4">
            <p className="mb-1.5 text-[13px] font-medium text-[var(--k-t1)]">Cinsiyet</p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["kadin", "Kadın"],
                  ["erkek", "Erkek"],
                ] as const
              ).map(([deger, etiket]) => {
                const secili = durum.cinsiyet === deger;
                return (
                  <button
                    key={deger}
                    type="button"
                    aria-pressed={secili}
                    onClick={() => onDurum({ ...durum, cinsiyet: deger })}
                    className={`flex h-11 items-center justify-center gap-1.5 rounded-xl text-[13.5px] transition-colors ${ODAK} ${
                      secili ? "bg-[var(--k-chip-on)] font-medium text-[var(--accent-light)]" : "bg-[var(--k-chip)] text-[var(--k-t2)] hover:bg-[var(--k-chip-hover)] hover:text-[var(--k-t1)]"
                    }`}
                  >
                    {secili && <Check size={14} aria-hidden />}
                    {etiket}
                  </button>
                );
              })}
            </div>
          </div>

          <PuanGirisi puan={durum.puan} onPuan={puanDegistir} />

          {hazir && (
            <button
              type="button"
              onClick={() => setDuzenle(false)}
              className={`mt-4 flex h-11 w-full items-center justify-center rounded-xl bg-[var(--accent)] px-5 text-[13.5px] font-medium text-[var(--background)] transition-colors hover:bg-[var(--accent-light)] ${ODAK}`}
            >
              Tamam
            </button>
          )}
        </section>
      )}

      {/* 2 · Questions: only what is still open; answered ones fold away */}
      {hazir && sorular.length > 0 && (
        <section>
          {acikSorular.length > 0 && (
            <>
              <h2 className={BASLIK}>{acikSorular.length === 1 ? "Bir sorum var" : `${acikSorular.length} sorum var`}</h2>
              <p className={ACIKLAMA}>Cevabına göre kadrolar açılır ya da kapanır. Emin değilsen boş bırak.</p>
              <div className="mt-3 space-y-2">
                {acikSorular.map((s) => (
                  <SoruKarti key={s.kod} soru={s} veri={veri} cevap={undefined} onCevap={(c) => cevapla(s.kod, c)} />
                ))}
              </div>
            </>
          )}
          {cevapliSorular.length > 0 && (
            <details className={`group rounded-2xl ring-1 ring-[var(--k-hair)] ${acikSorular.length > 0 ? "mt-3" : ""}`}>
              <summary
                className={`flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-2xl px-4 text-[13.5px] text-[var(--k-t2)] transition-colors hover:text-[var(--k-t1)] [&::-webkit-details-marker]:hidden ${ODAK}`}
              >
                <Check size={15} aria-hidden className="flex-shrink-0 text-[var(--accent-light)]" />
                <span className="min-w-0 flex-1">
                  Cevapladığın {cevapliSorular.length} soru <span className="text-[var(--k-t3)]">· değiştirmek için aç</span>
                </span>
                <ChevronDown size={15} aria-hidden className="flex-shrink-0 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
              </summary>
              <div className="space-y-2 px-2 pb-2">
                {cevapliSorular.map((s) => (
                  <SoruKarti key={s.kod} soru={s} veri={veri} cevap={etkin.cevaplar[s.kod]} onCevap={(c) => cevapla(s.kod, c)} />
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      {/* 3 · Posts: the whole table at once, wider than the reading column */}
      {hazir && (
        <section className="relative left-1/2 w-screen max-w-6xl -translate-x-1/2 px-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={`${BASLIK} mr-auto`}>Kadrolar</h2>
            <label className="relative block w-full sm:w-64">
              <span className="sr-only">Kadrolarda ara</span>
              <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--k-t3)]" />
              <input
                type="search"
                value={ara}
                onChange={(e) => setAra(e.target.value)}
                placeholder="Ara: unvan, kurum, kod"
                autoComplete="off"
                className={`h-10 w-full rounded-xl border border-white/[0.08] bg-[var(--surface)] pl-9 pr-3 text-[13.5px] text-[var(--k-t1)] placeholder-[var(--k-t3)] ${GIRDI_ODAK}`}
              />
            </label>
            {iller.length > 1 && (
              <AcilirSecim
                etiket="İl"
                deger={il}
                secenekler={[{ deger: "", etiket: "Bütün iller" }, ...iller.map((i) => ({ deger: i, etiket: okunakli(i) }))]}
                onSec={setIl}
              />
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Duruma göre süz">
            {(
              [
                ["hepsi", "Hepsi", gruplar.uygun.length + gruplar.dogrula.length + gruplar.kapali.length],
                ...SEKMELER.map((s) => [s.tur, s.etiket, gruplar[s.tur].length] as const),
              ] as readonly (readonly [KadroDurumu | "hepsi", string, number])[]
            ).map(([tur, etiket, adet]) => {
              const secili = sekme === tur;
              return (
                <button
                  key={tur}
                  type="button"
                  aria-pressed={secili}
                  onClick={() => setSekme(tur)}
                  className={`flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] transition-colors ${ODAK} ${
                    secili ? "bg-[var(--k-chip-on)] font-medium text-[var(--accent-light)]" : "bg-[var(--k-chip)] text-[var(--k-t2)] hover:bg-[var(--k-chip-hover)] hover:text-[var(--k-t1)]"
                  }`}
                >
                  {etiket}
                  <span className="tabular-nums opacity-80">{sayi(adet)}</span>
                </button>
              );
            })}
          </div>

          <KadroTablosu liste={gorunen} veri={veri} durum={etkin} onListe={listeDegistir} />

          <p className="mt-2 text-[12px] leading-[17px] text-[var(--k-t3)]">
            Bir satıra basınca şartları açılır.
            {puanliKadroVar && " Puanlar önceki yerleştirmelerden; her dönem değişir, yalnızca fikir verir."}
            {puanliKadroVar && puan === undefined && " Kendi puanını yazarsan yetip yetmediğini de gösteririm."}
          </p>
        </section>
      )}

      {/* 4 · Preference list */}
      {hazir && (
        <section id="tercih-listem" className="scroll-mt-4">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <h2 className={BASLIK}>Tercih listem</h2>
              <p className="mt-0.5 text-[12.5px] tabular-nums text-[var(--k-t2)]">
                {sinir ? `${durum.secilenler.length} / ${sinir} tercih` : `${durum.secilenler.length} tercih`}
              </p>
            </div>
            <button type="button" onClick={() => window.print()} disabled={!durum.secilenler.length} className={`flex-shrink-0 ${IKINCIL_DUGME}`}>
              <Printer size={14} aria-hidden /> Yazdır
            </button>
          </div>

          {sinir !== null && durum.secilenler.length > sinir && (
            <p className="mt-2 rounded-xl bg-amber-300/[0.10] p-3 text-[13px] leading-5 text-amber-100">
              Listende {durum.secilenler.length} kadro var; ÖSYM en fazla {sinir} tercih kabul ediyor. Fazlasını çıkar.
            </p>
          )}

          {durum.secilenler.length === 0 ? (
            <div className="mt-2 rounded-2xl p-5 text-center text-[13px] leading-5 text-[var(--k-t2)] ring-1 ring-[var(--k-hair)]">
              Listen boş. Bir kadronun yanındaki “Ekle”ye basınca buraya gelir.
            </div>
          ) : (
            <>
              <p className="mt-1 text-[12.5px] leading-[18px] text-[var(--k-t3)]">En çok istediğin en üstte olsun: ÖSYM puanının yettiği ilk tercihine yerleştirir.</p>
              <ol className="mt-2 divide-y divide-white/[0.06] overflow-hidden rounded-2xl bg-[var(--k-card)] ring-1 ring-[var(--k-hair)]">
                {durum.secilenler.map((kod, sira) => {
                  const satir = kodaGore.get(kod);
                  const d = satir?.sonuc.durum;
                  return (
                    <li key={kod} className="flex items-start gap-2 px-3 py-2.5">
                      <span className="mt-0.5 w-6 flex-shrink-0 text-right text-[13px] tabular-nums text-[var(--k-t3)]">{sira + 1}.</span>
                      <div className="min-w-0 flex-1">
                        {satir ? (
                          <>
                            <p className="break-words text-[14px] font-semibold leading-5 text-[var(--k-t1)]">{okunakli(satir.kadro.unvan)}</p>
                            <p className="break-words text-[12.5px] leading-[18px] text-[var(--k-t2)]">
                              {[satir.kadro.kurum, satir.kadro.il].filter(dolu).map(okunakli).join(" · ")}
                            </p>
                          </>
                        ) : (
                          <p className="text-[12.5px] leading-[18px] text-rose-200">Bu kod güncel tabloda yok. Listenden çıkar.</p>
                        )}
                        <p className="text-[12.5px] leading-[18px] text-[var(--k-t3)]">
                          ÖSYM kodu <span className="select-all font-semibold tabular-nums tracking-wide text-[var(--accent-light)]">{kod}</span>
                        </p>
                        {satir && <PuanOzeti kadro={satir.kadro} puan={puan} />}
                        {d === "kapali" && (
                          <p className="mt-1 flex items-start gap-1.5 text-[12.5px] leading-[18px] text-rose-200">
                            <TriangleAlert size={13} aria-hidden className="mt-0.5 flex-shrink-0" />
                            Bu kadro sana kapalı. Listenden çıkar.
                          </p>
                        )}
                        {d === "dogrula" && (
                          <p className="mt-1 flex items-start gap-1.5 text-[12.5px] leading-[18px] text-amber-200">
                            <CircleHelp size={13} aria-hidden className="mt-0.5 flex-shrink-0" />
                            Cevap bekleyen şartı var; emin olmadan tercih etme.
                          </p>
                        )}
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1">
                        <KucukDugme etiket={`${kod} yukarı taşı`} onClick={() => tasi(sira, -1)} disabled={sira === 0}>
                          <ArrowUp size={15} aria-hidden />
                        </KucukDugme>
                        <KucukDugme etiket={`${kod} aşağı taşı`} onClick={() => tasi(sira, 1)} disabled={sira === durum.secilenler.length - 1}>
                          <ArrowDown size={15} aria-hidden />
                        </KucukDugme>
                        <KucukDugme etiket={`${kod} listeden çıkar`} onClick={() => listeDegistir(kod)}>
                          <X size={15} aria-hidden />
                        </KucukDugme>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </section>
      )}

      {/* 5 · Fine print and sources, folded */}
      <details className="group rounded-2xl bg-[var(--k-card-open)] ring-1 ring-[var(--k-hair)]">
        <summary
          className={`flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-2xl px-4 text-[13.5px] font-medium text-[var(--k-t1)] [&::-webkit-details-marker]:hidden ${ODAK}`}
        >
          <span className="min-w-0 flex-1">Tercih etmeden önce bilmen gerekenler</span>
          <ChevronDown size={15} aria-hidden className="flex-shrink-0 text-[var(--k-t2)] transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="px-4 pb-4">
          <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-5 text-[var(--k-t2)]">
            <li>Bu sayfa ÖSYM&apos;nin resmî tablolarını okur; yine de bağlayıcı olan ÖSYM&apos;nin kılavuzudur. Listene aldığın kadrolara kılavuzdan da bak.</li>
            <li>Tek bir şartı bile karşılamıyorsan o kadro sana kapalıdır; yerleşsen bile ataman yapılmaz.</li>
            <li>Bir kadroya yerleşen aday, aynı puanla sonraki yerleştirmelere başvuramaz.</li>
            <li>
              Tablodaki şartların dışında herkes için geçerli genel şartlar da var: Türk vatandaşı olmak, 18 yaşını doldurmuş olmak, belirli suçlardan
              hüküm giymemiş olmak, görevi yapmaya engel bir sağlık sorunu bulunmamak. Bu sayfa bunları sormuyor; kılavuzun “Başvurma Genel Şartları”
              bölümünde yazıyor.
            </li>
            <li>
              Tercihlerini kendin girersin:{" "}
              <a href="https://ais.osym.gov.tr" target="_blank" rel="noopener noreferrer" className={`rounded-sm text-[var(--accent-light)] underline underline-offset-2 ${ODAK}`}>
                ais.osym.gov.tr
                <span className="sr-only"> (yeni sekmede açılır)</span>
              </a>
            </li>
          </ul>

          {(veri.belgeler.length > 0 || kaynakUrl) && (
            <div className="mt-4 border-t border-white/[0.07] pt-3">
              <p className="text-[12.5px] font-medium text-[var(--k-t1)]">Kaynak belgeler ({donemAdi(donem)})</p>
              <ul className="mt-1 space-y-0.5">
                {kaynakUrl && <BelgeBaglantisi ad="ÖSYM duyurusu" url={kaynakUrl} />}
                {veri.belgeler.map((b) => (
                  <BelgeBaglantisi key={b.url} ad={b.ad} url={b.url} />
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

function BelgeBaglantisi({ ad, url }: { ad: string; url: string }) {
  return (
    <li>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`-mx-1.5 flex min-h-10 items-center gap-2 rounded-lg px-1.5 text-[13px] text-[var(--k-t2)] transition-colors hover:bg-white/[0.04] hover:text-[var(--k-t1)] ${ODAK}`}
      >
        <ExternalLink size={13} aria-hidden className="flex-shrink-0" />
        <span className="min-w-0 break-words">{ad}</span>
        <span className="sr-only"> (yeni sekmede açılır)</span>
      </a>
    </li>
  );
}

/** Optional score field of "Sen". What is typed stays; only a complete score (or clearing the field) is saved. */
function PuanGirisi({ puan, onPuan }: { puan: number | undefined; onPuan: (yeni: number | undefined) => void }) {
  const [metin, setMetin] = useState(() => (puan === undefined ? "" : String(puan).replace(".", ",")));
  const hatali = puanCoz(metin) === "hata";
  return (
    <div className="mt-4">
      <label htmlFor="tercih-puan" className="mb-0.5 block text-[13px] font-medium text-[var(--k-t1)]">
        KPSS puanın (P93)
      </label>
      <p id="tercih-puan-aciklama" className="mb-1.5 text-[12px] leading-[17px] text-[var(--k-t3)]">
        İsteğe bağlı. Sonuç belgendeki KPSSP93 puanını yazarsan kadroların en düşük yerleşme puanlarıyla karşılaştırırım.
      </p>
      <input
        id="tercih-puan"
        value={metin}
        onChange={(e) => {
          setMetin(e.target.value);
          const yeni = puanCoz(e.target.value);
          if (yeni !== "hata") onPuan(yeni);
        }}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        maxLength={9}
        placeholder="örn. 78,45"
        aria-describedby="tercih-puan-aciklama"
        aria-invalid={hatali}
        className={`${GIRDI} max-w-[11rem] tabular-nums`}
      />
      {hatali && <p className="mt-1.5 text-[12.5px] leading-[18px] text-amber-200">0 ile 100 arasında bir puan yaz (örn. 78,45). Bu hâliyle kaydedilmedi.</p>}
    </div>
  );
}

/** One compact score line for the preference list; nothing when the post has no number */
function PuanOzeti({ kadro, puan }: { kadro: TercihKadro; puan: number | undefined }) {
  const b = puanBilgisi(kadro, puan);
  if (!b) return null;
  return (
    <p className="break-words text-[12.5px] leading-[18px] tabular-nums text-[var(--k-t3)]">
      {b.kisa}
      {b.isaret && <span className={puanRengi(b.yeter)}> · {b.isaret}</span>}
    </p>
  );
}

/** 40 px icon button for the list rows */
function KucukDugme({ etiket, onClick, disabled, children }: { etiket: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={etiket}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-10 w-9 place-items-center rounded-lg text-[var(--k-t2)] transition-colors enabled:hover:bg-white/[0.08] enabled:hover:text-[var(--k-t1)] disabled:opacity-30 ${ODAK}`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- dropdown

/**
 * The page's own dropdown instead of a native <select>, whose arrow and list
 * are drawn by the operating system and look foreign on the sage background.
 * A button that opens a list; Escape or a press elsewhere closes it, the arrow
 * keys walk the options.
 */
function AcilirSecim({
  etiket,
  deger,
  secenekler,
  onSec,
}: {
  /** Accessible name; not drawn */
  etiket: string;
  deger: string;
  secenekler: { deger: string; etiket: string }[];
  onSec: (deger: string) => void;
}) {
  const [acik, setAcik] = useState(false);
  const kok = useRef<HTMLDivElement>(null);
  const liste = useRef<HTMLDivElement>(null);
  const secili = secenekler.find((s) => s.deger === deger);

  useEffect(() => {
    if (!acik) return;
    const disari = (e: PointerEvent) => {
      if (kok.current && !kok.current.contains(e.target as Node)) setAcik(false);
    };
    document.addEventListener("pointerdown", disari);
    // Open towards the side that has room: left-aligned, unless that would leave the screen
    if (kok.current && liste.current) {
      const tasar = kok.current.getBoundingClientRect().left + liste.current.offsetWidth > window.innerWidth - 8;
      liste.current.style.left = tasar ? "auto" : "0";
      liste.current.style.right = tasar ? "0" : "auto";
    }
    // Start on the chosen option so the keyboard continues from there
    const hedef = liste.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? liste.current?.querySelector<HTMLButtonElement>("button");
    hedef?.focus({ preventScroll: true });
    hedef?.scrollIntoView({ block: "nearest" });
    return () => document.removeEventListener("pointerdown", disari);
  }, [acik]);

  const tus = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && acik) {
      e.preventDefault();
      setAcik(false);
      kok.current?.querySelector<HTMLButtonElement>("button")?.focus();
      return;
    }
    if (!acik || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    const dugmeler = [...(liste.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const simdi = dugmeler.indexOf(document.activeElement as HTMLButtonElement);
    dugmeler[Math.max(0, Math.min(dugmeler.length - 1, simdi + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };

  return (
    <div ref={kok} className="relative inline-block text-left" onKeyDown={tus}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={acik}
        aria-label={`${etiket}: ${secili?.etiket ?? ""}`}
        onClick={() => setAcik((a) => !a)}
        className={`flex h-10 items-center gap-2 rounded-xl bg-white/[0.08] pl-3.5 pr-3 text-[13.5px] text-[var(--k-t1)] transition-colors hover:bg-white/[0.12] ${ODAK}`}
      >
        <span className="max-w-[11rem] truncate">{secili?.etiket ?? etiket}</span>
        <ChevronDown size={15} aria-hidden className={`flex-shrink-0 text-[var(--k-t2)] transition-transform duration-150 motion-reduce:transition-none ${acik ? "rotate-180" : ""}`} />
      </button>
      {acik && (
        <div
          ref={liste}
          role="listbox"
          aria-label={etiket}
          className="absolute left-0 z-30 mt-1.5 max-h-72 min-w-full overflow-y-auto overscroll-contain rounded-xl [scrollbar-color:rgba(255,255,255,.28)_transparent] [scrollbar-width:thin] bg-[var(--surface-popup)] p-1 shadow-xl shadow-black/25 ring-1 ring-white/[0.10]"
        >
          {secenekler.map((s) => {
            const buSecili = s.deger === deger;
            return (
              <button
                key={s.deger}
                type="button"
                role="option"
                aria-selected={buSecili}
                onClick={() => {
                  onSec(s.deger);
                  setAcik(false);
                }}
                className={`flex min-h-9 w-full items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-[13.5px] transition-colors focus:outline-none focus-visible:bg-white/[0.10] ${
                  buSecili ? "font-medium text-[var(--accent-light)]" : "text-[var(--k-t1)] hover:bg-white/[0.08]"
                }`}
              >
                <Check size={14} aria-hidden className={`flex-shrink-0 ${buSecili ? "" : "invisible"}`} />
                {s.etiket}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- program picker

/** Type a word, tap the program. ÖSYM's own names and codes; nothing is guessed. */
function ProgramSecici({ programlar, secili, onSec }: { programlar: Record<string, string>; secili: string | undefined; onSec: (kod: string) => void }) {
  const [ara, setAra] = useState("");
  const liste = useMemo(
    () =>
      Object.entries(programlar)
        .map(([kod, ad]) => ({ kod, ad, anahtar: sadelestir(ad) }))
        .sort((a, b) => a.ad.localeCompare(b.ad, "tr")),
    [programlar]
  );
  const kelimeler = sadelestir(ara).split(" ").filter(Boolean);
  const yeterli = kelimeler.join("").length >= 2;
  const bulunan = yeterli ? liste.filter((p) => kelimeler.every((k) => p.anahtar.includes(k) || p.kod === k)) : [];
  const gosterilen = bulunan.slice(0, 12);

  return (
    <div>
      {secili && (
        <p className="mb-2 flex items-start gap-2 rounded-xl bg-[var(--k-chip-on)] px-3 py-2.5 text-[13.5px] leading-5 text-[var(--accent-light)]">
          <Check size={15} aria-hidden className="mt-0.5 flex-shrink-0" />
          <span className="min-w-0 break-words">
            {programlar[secili]} <span className="tabular-nums opacity-80">({secili})</span>
          </span>
        </p>
      )}
      <div className="relative">
        <Search size={15} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--k-t3)]" />
        <input
          value={ara}
          onChange={(e) => setAra(e.target.value)}
          type="search"
          aria-label="Program ara"
          placeholder={secili ? "Başka bir program ara" : "Program ara (örn. bilgisayar)"}
          className={`${GIRDI} pl-10`}
        />
      </div>
      {yeterli && (
        <div className="mt-2 space-y-1">
          {gosterilen.map((p) => (
            <button
              key={p.kod}
              type="button"
              onClick={() => {
                onSec(p.kod);
                setAra("");
              }}
              className={`flex min-h-11 w-full items-center gap-2 rounded-xl bg-[var(--k-chip)] px-3 py-2 text-left text-[13.5px] leading-5 text-[var(--k-t1)] transition-colors hover:bg-[var(--k-chip-hover)] ${ODAK}`}
            >
              <span className="min-w-0 flex-1 break-words">{p.ad}</span>
              <span className="flex-shrink-0 text-[12px] tabular-nums text-[var(--k-t3)]">{p.kod}</span>
            </button>
          ))}
          {bulunan.length === 0 && (
            <p className="px-1 text-[12.5px] leading-[18px] text-[var(--k-t2)]">Bulunamadı. Diplomandaki program adından başka bir kelime dene.</p>
          )}
          {bulunan.length > gosterilen.length && (
            <p className="px-1 text-[12.5px] leading-[18px] text-[var(--k-t3)]">{bulunan.length - gosterilen.length} program daha var; biraz daha yaz.</p>
          )}
        </div>
      )}
      {!secili && !yeterli && <p className="mt-1.5 text-[12px] text-[var(--k-t3)]">Diplomanda yazan program adını ara ve listeden seç.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- questions

function SoruKarti({ soru, veri, cevap, onCevap }: { soru: TercihSorusu; veri: TercihVerisi; cevap: Cevap | undefined; onCevap: (c: Cevap) => void }) {
  const aciklama = veri.aciklamalar[soru.kod];
  // A code in neither dictionary has no official text to answer against: it stays open
  const metinYok = veri.ozel[soru.kod] === undefined;
  // "Bakınız: ..." points to a section of the guide instead of naming one document
  const bakiniz = soru.metin.trim().toLocaleLowerCase("tr-TR").startsWith("bakınız");

  return (
    <div className={KART}>
      <p className="break-words text-[14.5px] font-medium leading-[21px] text-[var(--k-t1)]">
        {bakiniz ? (aciklama && dolu(aciklama.baslik) ? `${okunakli(aciklama.baslik.replace(/^[\d.\s]+/, "").replace(/\s*\(\d{4}\).*$/, ""))} şartları sana uyuyor mu?` : soru.metin) : soru.metin}
      </p>
      <p className="mt-1 text-[12.5px] tabular-nums text-[var(--k-t2)]">
        {sayi(soru.kadro)} kadro · {sayi(soru.kontenjan)} kontenjan buna bağlı <span className="text-[var(--k-t3)]">· kod {soru.kod}</span>
      </p>

      {bakiniz && !aciklama && (
        <p className="mt-2 text-[12.5px] leading-[18px] text-amber-200">
          Bu şartın ayrıntısı ÖSYM kılavuzunda ayrı bir bölümde yazıyor; cevaplamadan önce oradan oku (kaynak belgeler sayfanın sonunda).
        </p>
      )}

      {aciklama && (
        <details className="group mt-2 rounded-xl bg-[var(--k-card-open)] px-3">
          <summary className={`flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg text-[13px] text-[var(--k-t2)] transition-colors hover:text-[var(--k-t1)] [&::-webkit-details-marker]:hidden ${ODAK}`}>
            <span className="min-w-0 flex-1">{bakiniz ? "Şartları oku (kılavuzdaki bölüm)" : "Kılavuzdaki açıklama"}</span>
            <ChevronDown size={14} aria-hidden className="flex-shrink-0 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
          </summary>
          <div className="pb-3">
            {dolu(aciklama.baslik) && <p className="text-[13px] font-medium leading-5 text-[var(--k-t1)]">{aciklama.baslik}</p>}
            <p className="mt-1 whitespace-pre-line break-words text-[13px] leading-5 text-[var(--k-t2)]">{aciklama.metin}</p>
          </div>
        </details>
      )}

      {metinYok ? (
        <p className="mt-3 rounded-xl bg-amber-300/[0.10] p-3 text-[12.5px] leading-[18px] text-amber-100">
          Bu kodun metni tablolardan okunamadı, o yüzden burada cevaplanamıyor. Bu kodu isteyen kadrolar “Cevap bekliyor” altında kalır; kodu ÖSYM&apos;nin
          belgesinden kendin kontrol et.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <CevapDugmesi etiket={bakiniz ? "Uyuyor" : "Evet"} secili={cevap === "evet"} olumlu onClick={() => onCevap("evet")} />
          <CevapDugmesi etiket={bakiniz ? "Uymuyor" : "Hayır"} secili={cevap === "hayir"} onClick={() => onCevap("hayir")} />
        </div>
      )}
    </div>
  );
}

function CevapDugmesi({ etiket, secili, olumlu = false, onClick }: { etiket: string; secili: boolean; olumlu?: boolean; onClick: () => void }) {
  const seciliSinif = olumlu ? "bg-[var(--k-chip-on)] font-medium text-[var(--accent-light)]" : "bg-rose-300/[0.14] font-medium text-rose-100";
  return (
    <button
      type="button"
      aria-pressed={secili}
      onClick={onClick}
      className={`flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 text-[13.5px] transition-colors ${ODAK} ${
        secili ? seciliSinif : "bg-[var(--k-chip)] text-[var(--k-t2)] hover:bg-[var(--k-chip-hover)] hover:text-[var(--k-t1)]"
      }`}
    >
      {secili && (olumlu ? <Check size={14} aria-hidden className="flex-shrink-0" /> : <X size={14} aria-hidden className="flex-shrink-0" />)}
      <span className="truncate">{etiket}</span>
    </button>
  );
}

// ---------------------------------------------------------------- posts

const DURUM_ROZETI: Record<KadroDurumu, { etiket: string; kisa: string; sinif: string }> = {
  uygun: { etiket: "Açık", kisa: "Açık", sinif: "bg-[var(--k-chip-on)] text-[var(--accent-light)]" },
  dogrula: { etiket: "Cevap bekliyor", kisa: "Bekliyor", sinif: "bg-amber-300/[0.14] text-amber-100" },
  kapali: { etiket: "Kapalı", kisa: "Kapalı", sinif: "bg-rose-300/[0.10] text-rose-100" },
};

/** Columns a phone has no room for; what they hold is repeated in the row's details there */
const GENISTE = "hidden sm:table-cell";
const TH = "whitespace-nowrap px-2 py-2.5 sm:px-3 text-left text-[11.5px] font-medium uppercase tracking-wide text-[var(--k-t3)]";
const TD = "px-2 py-2.5 align-top sm:px-3";

/** Every post of the current filter in one table; a row opens its conditions underneath */
function KadroTablosu({
  liste,
  veri,
  durum,
  onListe,
}: {
  liste: Satir[];
  veri: TercihVerisi;
  durum: TercihDurumu;
  onListe: (kod: string) => void;
}) {
  if (liste.length === 0) {
    return <p className="mt-3 rounded-2xl p-5 text-center text-[13px] leading-5 text-[var(--k-t2)] ring-1 ring-[var(--k-hair)]">Bu süzgeçle eşleşen kadro yok.</p>;
  }
  return (
    <div className="mt-3 overflow-x-auto rounded-2xl bg-[var(--k-card)] ring-1 ring-[var(--k-hair)]">
      <table className="w-full border-collapse sm:min-w-[1040px] text-[12.5px] leading-[18px] text-[var(--k-t2)]">
        <thead>
          <tr className="bg-black/[0.10]">
            <th scope="col" className={TH}>Durum</th>
            <th scope="col" className={`${TH} w-full sm:w-auto`}>
              <span className="sm:hidden">Kadro</span>
              <span className="hidden sm:inline">Unvan</span>
            </th>
            <th scope="col" className={`${TH} ${GENISTE}`}>Kurum</th>
            <th scope="col" className={`${TH} ${GENISTE}`}>İl</th>
            <th scope="col" className={`${TH} ${GENISTE} text-right`}>Kontenjan</th>
            <th scope="col" className={`${TH} text-right`}>
              <span className="sm:hidden">Puan</span>
              <span className="hidden sm:inline">En düşük puan</span>
            </th>
            <th scope="col" className={`${TH} ${GENISTE}`}>Neden</th>
            <th scope="col" className={`${TH} ${GENISTE}`}>ÖSYM kodu</th>
            <th scope="col" className={TH}>
              <span className="sr-only">Listeye ekle</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {liste.map((s, i) => (
            <KadroTabloSatiri key={`${s.kadro.kod}-${i}`} satir={s} veri={veri} durum={durum} listede={durum.secilenler.includes(s.kadro.kod)} onListe={onListe} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Isaret = "tamam" | "bekliyor" | "olmaz" | "gereksiz";

/** What one qualification code on a row means for this user, in words */
function nitelikDurumu(kod: string, s: KadroSonucu, veri: TercihVerisi, durum: TercihDurumu): { isaret: Isaret; not: string } {
  if (veri.ogrenim[kod]) {
    if (s.ogrenimKarsilayan === kod) return { isaret: "tamam", not: "Karşılıyorsun: programın bu şarta uyuyor" };
    // Several education codes on a row: meeting one is enough (guide section 3.3)
    if (s.ogrenimKarsilayan) return { isaret: "gereksiz", not: `Gerekmiyor: öğrenim şartlarından biri yeterli, sen ${s.ogrenimKarsilayan} kodunu karşılıyorsun` };
    if (s.kapatan.includes(kod)) return { isaret: "olmaz", not: "Karşılamıyorsun: programın kabul edilenler arasında yok" };
    if (s.bekleyen.includes(kod)) {
      return {
        isaret: "bekliyor",
        not: durum.program
          ? "Doğrulanamadı: bu şartın kabul ettiği programlar tablodan okunamadı, kılavuzdan kendin kontrol et"
          : "Programını seçince belli olur",
      };
    }
    // Readable list without the user's program, while another education code on the row could not be read
    return { isaret: "olmaz", not: "Programın bu kodun kabul ettikleri arasında yok" };
  }
  if (isTanimiKoduMu(kod, veri)) return { isaret: "tamam", not: "İşin tanımı; ek belge ya da şart istemiyor" };
  if (s.kapatan.includes(kod)) return { isaret: "olmaz", not: durum.cevaplar[kod] === "hayir" ? "Karşılamıyorum dedin" : "Karşılamıyorsun" };
  if (s.bekleyen.includes(kod)) {
    // On a post that another code already closes, an open answer changes nothing (and is not asked above)
    if (s.durum === "kapali") return { isaret: "gereksiz", not: "Cevaplanmadı; kadro başka bir şart yüzünden zaten kapalı" };
    return { isaret: "bekliyor", not: veri.ozel[kod] === undefined ? "Bu kodun metni tablolardan okunamadı; kılavuzdan kendin kontrol et" : "Cevap bekliyor" };
  }
  return { isaret: "tamam", not: durum.cevaplar[kod] === "evet" ? "Karşılıyorum dedin" : "Karşılıyorsun" };
}

const ISARET_STIL: Record<Isaret, string> = {
  tamam: "text-[var(--accent-light)]",
  bekliyor: "text-amber-200",
  olmaz: "text-rose-200",
  gereksiz: "text-[var(--k-t3)]",
};

function IsaretIkonu({ isaret }: { isaret: Isaret }) {
  const sinif = `mt-[3px] flex-shrink-0 ${ISARET_STIL[isaret]}`;
  if (isaret === "tamam") return <Check size={14} aria-hidden className={sinif} />;
  if (isaret === "bekliyor") return <CircleHelp size={14} aria-hidden className={sinif} />;
  if (isaret === "olmaz") return <X size={14} aria-hidden className={sinif} />;
  return <Minus size={14} aria-hidden className={sinif} />;
}

/**
 * One post as a table row. The row (or the title button, for the keyboard)
 * opens a second row with the conditions and their official texts.
 */
function KadroTabloSatiri({
  satir,
  veri,
  durum,
  listede,
  onListe,
}: {
  satir: Satir;
  veri: TercihVerisi;
  durum: TercihDurumu;
  listede: boolean;
  onListe: (kod: string) => void;
}) {
  const [acik, setAcik] = useState(false);
  const { kadro, sonuc } = satir;
  const kunye = [
    kadro.istihdam ? okunakli(kadro.istihdam) : null,
    dolu(kadro.sinif) ? `Sınıf ${kadro.sinif}` : null,
    dolu(kadro.derece) ? `Derece ${kadro.derece}` : null,
    kadro.teskilat ? okunakli(kadro.teskilat) : null,
    dolu(kadro.birim) ? okunakli(kadro.birim) : null,
  ].filter(dolu);
  // Closed posts cannot be listed; the saved list only keeps codes that look like ÖSYM codes (durumDogrula)
  const listelenebilir = sonuc.durum !== "kapali" && /^\d{6,12}$/.test(kadro.kod);
  const puanSatiri = puanBilgisi(kadro, durum.puan);
  const enKucuk = kadroEnKucukPuan(kadro);
  const neden = kisaNeden(satir, veri);
  const rozet = DURUM_ROZETI[sonuc.durum];
  const ayrintiId = `kadro-ayrinti-${kadro.kod}`;

  return (
    <>
      <tr
        onClick={() => setAcik((a) => !a)}
        className={`cursor-pointer border-t border-white/[0.06] transition-colors hover:bg-white/[0.04] ${sonuc.durum === "kapali" ? "opacity-75" : ""} ${acik ? "bg-white/[0.04]" : ""}`}
      >
        <td className={TD}>
          <span className={`inline-block whitespace-nowrap rounded-full px-2 text-[11.5px] leading-5 ${rozet.sinif}`}>
            <span className="sm:hidden">{rozet.kisa}</span>
            <span className="hidden sm:inline">{rozet.etiket}</span>
          </span>
        </td>
        <td className={`${TD} w-full sm:w-auto sm:min-w-[150px]`}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setAcik((a) => !a);
            }}
            aria-expanded={acik}
            aria-controls={ayrintiId}
            className={`flex items-start gap-1 rounded text-left font-semibold text-[var(--k-t1)] ${ODAK}`}
          >
            <ChevronDown size={14} aria-hidden className={`mt-0.5 flex-shrink-0 text-[var(--k-t3)] transition-transform duration-150 motion-reduce:transition-none ${acik ? "rotate-180" : ""}`} />
            {kadro.unvan ? okunakli(kadro.unvan) : "Unvan belirtilmemiş"}
          </button>
          <span className="mt-0.5 block break-words pl-[18px] sm:hidden">
            {okunakli(kadro.kurum)}
            <span className="block text-[var(--k-t1)]">{[kadro.il, kadro.ilce].filter(dolu).map(okunakli).join(" / ")}</span>
          </span>
        </td>
        <td className={`${TD} ${GENISTE} min-w-[190px]`}>{okunakli(kadro.kurum)}</td>
        <td className={`${TD} ${GENISTE} whitespace-nowrap`}>
          <span className="text-[var(--k-t1)]">{dolu(kadro.il) ? okunakli(kadro.il) : "–"}</span>
          {dolu(kadro.ilce) && <span className="block text-[11.5px] leading-4 text-[var(--k-t3)]">{okunakli(kadro.ilce)}</span>}
        </td>
        <td className={`${TD} ${GENISTE} text-right tabular-nums`}>{sayi(kadro.adet)}</td>
        <td className={`${TD} whitespace-nowrap text-right tabular-nums`}>
          {enKucuk === null || enKucuk === undefined ? (
            <span className="text-[var(--k-t3)]">–</span>
          ) : (
            <>
              <span className={puanSatiri?.isaret ? puanRengi(puanSatiri.yeter) : "text-[var(--k-t1)]"}>{tabanYaz(enKucuk, durum.puan)}</span>
              {!kadro.taban && kadro.emsal && <span className="block text-[11.5px] leading-4 text-[var(--k-t3)]">geçen dönem</span>}
            </>
          )}
        </td>
        <td className={`${TD} ${GENISTE} max-w-[240px]`}>
          {neden ? (
            <span title={neden} className={`line-clamp-2 ${sonuc.durum === "kapali" ? "text-rose-200" : "text-amber-200"}`}>
              {neden}
            </span>
          ) : (
            <span className="text-[var(--k-t3)]">–</span>
          )}
        </td>
        <td className={`${TD} ${GENISTE} whitespace-nowrap tabular-nums tracking-wide ${sonuc.durum === "kapali" ? "" : "font-semibold text-[var(--accent-light)]"}`}>
          <span className="select-all" onClick={(e) => e.stopPropagation()}>
            {kadro.kod}
          </span>
        </td>
        <td className={`${TD} whitespace-nowrap text-right`}>
          {listelenebilir && (
            <button
              type="button"
              aria-pressed={listede}
              aria-label={listede ? `${kadro.kod} listemde, çıkar` : `${kadro.kod} listeme ekle`}
              onClick={(e) => {
                e.stopPropagation();
                onListe(kadro.kod);
              }}
              className={`inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[12px] transition-colors ${ODAK} ${
                listede ? "bg-[var(--k-chip-on)] font-medium text-[var(--accent-light)]" : "bg-white/[0.10] text-[var(--k-t1)] hover:bg-white/[0.16]"
              }`}
            >
              {listede ? <Check size={13} aria-hidden /> : <Plus size={13} aria-hidden />}
              {listede ? "Listemde" : "Ekle"}
            </button>
          )}
        </td>
      </tr>

      {acik && (
        <tr id={ayrintiId} className="bg-[var(--k-card-open)]">
          <td colSpan={9} className="px-4 py-3">
            {/* Stays in view while the table is scrolled sideways on a phone */}
            <div className="sticky left-4 max-w-[min(48rem,calc(100vw-4rem))] space-y-2.5">
              {/* What the hidden columns hold on a phone */}
              <div className="space-y-1 sm:hidden">
                <p className="text-[12.5px] leading-[18px] text-[var(--k-t2)]">
                  ÖSYM kodu <span className="select-all font-semibold tabular-nums tracking-wide text-[var(--accent-light)]">{kadro.kod}</span>
                  <span className="tabular-nums"> · {sayi(kadro.adet)} kontenjan</span>
                </p>
                {neden && <p className={`text-[12.5px] leading-[18px] ${sonuc.durum === "kapali" ? "text-rose-200" : "text-amber-200"}`}>{neden}</p>}
              </div>
              {kunye.length > 0 && <p className="break-words text-[12.5px] leading-[18px] text-[var(--k-t2)]">{kunye.join(" · ")}</p>}
              <div>
                <p className="text-[12.5px] font-medium text-[var(--k-t1)]">Şartlar</p>
                {kadro.nitelikler.length > 0 ? (
                  <ul className="mt-1.5 space-y-2">
                    {kadro.nitelikler.map((kod, i) => {
                      const n = nitelikDurumu(kod, sonuc, veri, durum);
                      return (
                        <li key={`${kod}-${i}`} className="flex items-start gap-2">
                          <IsaretIkonu isaret={n.isaret} />
                          <div className="min-w-0 flex-1">
                            <p className={`break-words text-[12.5px] leading-[18px] ${n.isaret === "gereksiz" ? "line-clamp-2 text-[var(--k-t3)]" : "text-[var(--k-t2)]"}`}>
                              {kodMetni(kod, veri)} <span className="tabular-nums text-[var(--k-t3)]">({kod})</span>
                            </p>
                            <p className={`text-[12px] leading-[18px] ${ISARET_STIL[n.isaret]}`}>{n.not}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-1 text-[12.5px] leading-[18px] text-[var(--k-t2)]">Tabloda bu kadro için nitelik kodu yazmıyor.</p>
                )}
              </div>
              {/* Information only: the verdict never depends on it */}
              {puanSatiri && (
                <p className="break-words text-[12.5px] leading-[18px] tabular-nums text-[var(--k-t2)]">
                  {puanSatiri.cumle}
                  {puanSatiri.ayrinti && <span className="text-[var(--k-t3)]"> ({puanSatiri.ayrinti})</span>}
                  {puanSatiri.isaret && <span className={`font-medium ${puanRengi(puanSatiri.yeter)}`}> · {puanSatiri.isaret}</span>}
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------- print

/** Hidden on screen; the only thing on paper. Order number, ÖSYM code, institution, title, province, and the lowest placed score when known. */
function YazdirmaSayfasi({ veri, donem, durum }: { veri: TercihVerisi; donem: string; durum: TercihDurumu }) {
  const kodaGore = useMemo(() => {
    const m = new Map<string, TercihKadro>();
    for (const k of veri.kadrolar) if (!m.has(k.kod)) m.set(k.kod, k);
    return m;
  }, [veri]);
  const hucre = "border border-black/40 px-2 py-1.5 align-top";
  // Same reading as on screen: no verdict before program and gender, no answer counted for a code without text
  const hazir = bilgilerTamam(veri, durum);
  const etkin = useMemo(() => gecerliDurum(veri, durum), [veri, durum]);
  // The score column is printed only when a listed post has something to put in it
  const puanlar = durum.secilenler.map((kod) => {
    const k = kodaGore.get(kod);
    return k ? puanBilgisi(k, durum.puan) : null;
  });
  const puanSutunu = puanlar.some(Boolean);

  return (
    <section className="hidden p-0 text-[11pt] leading-snug text-black print:block">
      <h1 className="text-[15pt] font-semibold">{donemAdi(donem)} · Tercih listem</h1>
      {durum.program && veri.programlar[durum.program] && (
        <p className="mt-1 text-[10pt]">
          Mezun olunan program: {veri.programlar[durum.program]} ({durum.program})
        </p>
      )}
      {puanSutunu && durum.puan !== undefined && <p className="mt-1 text-[10pt]">KPSS puanım (P93): {puanYaz(durum.puan)}</p>}
      <table className="mt-3 w-full border-collapse text-left text-[10.5pt]">
        <thead>
          <tr>
            <th className={`${hucre} w-[2.2em]`}>#</th>
            <th className={hucre}>ÖSYM kodu</th>
            <th className={hucre}>Kurum</th>
            <th className={hucre}>Unvan</th>
            <th className={hucre}>İl</th>
            {puanSutunu && <th className={hucre}>En düşük puan</th>}
          </tr>
        </thead>
        <tbody>
          {durum.secilenler.map((kod, sira) => {
            const k = kodaGore.get(kod);
            const d = k && hazir ? kadroSonucu(k, veri, etkin).durum : null;
            return (
              <tr key={kod} className="break-inside-avoid">
                <td className={hucre}>{sira + 1}</td>
                <td className={`${hucre} whitespace-nowrap font-semibold tabular-nums`}>{kod}</td>
                <td className={hucre}>{k?.kurum ?? "Güncel tabloda yok"}</td>
                <td className={hucre}>
                  {k?.unvan}
                  {k && !hazir && <span className="block text-[9pt]">(şartları kontrol edilmedi: program ya da cinsiyet seçili değil)</span>}
                  {d === "dogrula" && <span className="block text-[9pt]">(cevap bekleyen şartı var)</span>}
                  {d === "kapali" && <span className="block text-[9pt]">(sana kapalı: bir şartını karşılamıyorsun)</span>}
                </td>
                <td className={hucre}>{k ? [k.il, k.ilce].filter(dolu).join(" / ") : ""}</td>
                {puanSutunu && (
                  <td className={`${hucre} tabular-nums`}>
                    {puanlar[sira]?.kisa}
                    {puanlar[sira]?.isaret && <span className="block text-[9pt]">({puanlar[sira]?.isaret})</span>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-[9.5pt]">
        Tercihler ais.osym.gov.tr adresinden adayın kendisi tarafından girilir. Bağlayıcı olan ÖSYM&apos;nin kılavuzudur; tek bir şartı karşılamayan aday
        yerleşse bile atanmaz.
        {puanSutunu && " En düşük puanlar her dönem değişir ve dönemler farklı sınavların puanına dayanabilir; yalnızca fikir verir."}
      </p>
    </section>
  );
}
