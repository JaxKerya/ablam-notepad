"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  Dices,
  Search,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { useToast } from "@/components/Toast";
import { useModal } from "@/components/useModal";
import { useKuyruk } from "@/components/ders/DersKuyrugu";
import {
  DERS_NOTLARI_KLASORU,
  ES_ZAMANLI_URETIM,
  formatSure,
  IS_CALISIYOR,
  KATEGORI_DIGER,
  linkleriAyikla,
  tarihMetni,
  videoLinki,
  type IsDurumu,
} from "@/lib/ders";

interface OturumOzeti {
  id: string;
  title: string | null;
  created_at: string;
  video_id: string;
  kategori: string;
  /** 'tekrar' oturumları bir videodan üretilmedi, kategoriden karıştırıldı */
  tekrarMi: boolean;
  sure: number;
  soruSayisi: number;
  cevapSayisi: number;
  dogruSayisi: number;
  yarim: boolean;
}

interface AramaVurgusu {
  saniye: number;
  metin: string;
  bas: number;
  uzunluk: number;
}

interface AramaSonucu {
  videoId: string;
  baslik: string | null;
  toplam: number;
  vurgular: AramaVurgusu[];
}

/** Kuyruktaki bir işin ekranda görünen hâli */
const DURUM_METNI: Record<IsDurumu, string> = {
  bekliyor: "Sırada bekliyor",
  transkript: "Altyazı alınıyor…",
  acik: "Ders çözümleniyor, açık uçlu sorular hazırlanıyor…",
  coktan: "Çoktan seçmeli sorular hazırlanıyor…",
  hazir: "Hazır",
  elle: "Altyazı alınamadı — transkripti yapıştır",
  hata: "Hata",
};

/**
 * Listede en fazla kaç ders gösterilir. 50'ydi ve tavana çarpınca eski dersler
 * hiçbir uyarı olmadan kayboluyordu — günde birkaç ders çözüldüğünde bir ay
 * bile sürmüyor, ablam derslerinin silindiğini sanıyordu. Sayı yükseltildi ve
 * tavana çarpıldığı artık listenin altında yazıyor: sessiz kesme yok.
 */
const LISTE_TAVANI = 200;


export default function DersAnaSayfa() {
  const [link, setLink] = useState("");
  const [oturumlar, setOturumlar] = useState<OturumOzeti[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  /**
   * Liste yüklenemediğinde "hiç ders yok" ile "yükleyemedim" aynı boş ekrana
   * çıkıyordu; ablam derslerinin silindiğini sanabilirdi. Hata artık hem toast
   * hem de listenin yerinde ayrı bir kutu olarak görünüyor.
   */
  const [listeHatasi, setListeHatasi] = useState<string | null>(null);
  /** Transkripti elle yapıştırma paneli hangi işe ait — kapalıysa null */
  const [elleIsId, setElleIsId] = useState<string | null>(null);
  const [elleMetin, setElleMetin] = useState("");
  const [silinecek, setSilinecek] = useState<string | null>(null);
  const [tekrarKuruluyor, setTekrarKuruluyor] = useState<string | null>(null);

  /**
   * DERS İÇİ ARAMA. Transkriptler zaten veritabanında duruyor ve üretimden sonra
   * kullanılmıyordu; bu kutu "bunu nerede anlatmıştı?" sorusuna cevap veriyor.
   * Model çağrısı yok, arama sunucuda (/api/ders/ara) yapılıyor.
   */
  const [arama, setArama] = useState("");
  const [aramaSonucu, setAramaSonucu] = useState<AramaSonucu[] | null>(null);
  const [aramaToplam, setAramaToplam] = useState(0);
  const [araniyor, setAraniyor] = useState(false);
  const [notlarAcik, setNotlarAcik] = useState(false);
  const [dersNotlari, setDersNotlari] = useState<{ id: string; updated_at: string }[] | null>(null);
  const router = useRouter();
  const { addToast } = useToast();
  // Üretim kuyruğu layout'ta yaşıyor; sayfa yalnızca gösteriyor ve besliyor.
  const { isler, ekle, tamamlaEkle, kaldir, tekrarDene, elleGonder, tamamlananSayac } =
    useKuyruk();

  // Esc ile kapanma, odak tuzağı ve odağın geri verilmesi — bkz. useModal
  const silmeRef = useModal<HTMLDivElement>(!!silinecek, () => setSilinecek(null));
  const panelRef = useModal<HTMLElement>(notlarAcik, () => setNotlarAcik(false));

  const oturumlariGetir = useCallback(async () => {
    const { data, error } = await supabase
      .from("ders_sessions")
      // ders_answers kırılımı ayrı sorguda alınıyor: PostgREST'te aynı gömülü
      // seçimde count ile sütun birlikte istenemiyor.
      .select(
        "id, title, created_at, video_id, status, kategori, tur, ders_videos(duration_seconds), ders_questions(count)"
      )
      // Yarım kalanlar da listeleniyor: ikinci adım düşerse ya da sekme
      // kapanırsa oturum "hazirlaniyor"da kalıyordu ve tamamen görünmez
      // oluyordu — üretilen özet ve açık uçlu sorular boşa gidiyordu.
      .in("status", ["hazir", "hazirlaniyor"])
      .order("created_at", { ascending: false })
      .limit(LISTE_TAVANI);

    if (error) {
      console.error("Dersler yüklenemedi:", error.message);
      setListeHatasi(error.message);
      addToast("Dersler yüklenemedi.", "error");
      setYukleniyor(false);
      return;
    }
    setListeHatasi(null);

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
          // Kategori sütunu eklenmeden önce üretilmiş dersler null taşıyor
          kategori: (o.kategori as string | null)?.trim() || KATEGORI_DIGER,
          tekrarMi: o.tur === "tekrar",
          sure: video?.duration_seconds ?? 0,
          soruSayisi,
          cevapSayisi: toplamlar.get(o.id) ?? 0,
          dogruSayisi: dogrular.get(o.id) ?? 0,
          yarim: o.status !== "hazir",
        };
      })
    );
    setYukleniyor(false);
  }, [addToast]);

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

  /**
   * Kutudaki metni sıraya alır. Tek link de olabilir, alt alta beş link de —
   * üretim kuyrukta yürüdüğü için kutu kilitlenmiyor: ablam bir ders
   * hazırlanırken ikinci linki yapıştırabiliyor.
   */
  const siradanEkle = (metin: string) => {
    const eklenen = ekle(metin);
    if (!eklenen) return;
    setLink("");
    if (eklenen > 1) addToast(`${eklenen} ders sıraya alındı`, "success");
  };

  const notlariAc = () => {
    setNotlarAcik(true);
    if (dersNotlari === null) dersNotlariniGetir();
  };

  /**
   * Yarım kalan oturumu tamamlar: yalnızca ikinci adımı çağırır, birinci adım
   * (özet + açık uçlular) zaten kayıtlı olduğu için tekrar üretilmez.
   *
   * Bu da kuyruğa giriyor, doğrudan çağrılmıyor: yeni bir ders hazırlanırken
   * tıklanırsa hem eşzamanlılık sınırının dışına çıkardı hem de aynı videoyu
   * iki yerden işleme riski doğardı (bkz. lib/ders.ts baslatilacakIs).
   */
  const tamamla = (o: OturumOzeti) => tamamlaEkle(o.id, o.video_id, o.title);

  /** Kuyrukta o oturumu işleyen bir iş var mı — kartta "Tamamlanıyor…" için */
  const tamamlanmakta = (sessionId: string) =>
    isler.some(
      (i) => i.sessionId === sessionId && (i.durum === "bekliyor" || IS_CALISIYOR.includes(i.durum))
    );

  // Bir iş bittiğinde liste tazeleniyor: yeni ders, ablam sayfadan çıkmadan
  // aşağıdaki kategori listesinde belirsin.
  useEffect(() => {
    if (tamamlananSayac > 0) oturumlariGetir();
  }, [tamamlananSayac, oturumlariGetir]);

  /**
   * Dersleri kategoriye göre gruplar. Sıralama, kategorideki en yeni derse göre —
   * ablam en son hangi derse çalıştıysa o grup üstte olsun.
   *
   * Tekrar oturumları kendi kategorilerinin içinde listeleniyor ama DERS
   * SAYILMIYOR: "Soru Gönder" düğmesinin altındaki sayı gerçek ders sayısıdır,
   * yoksa tekrar ürettikçe sayı şişer ve havuzun büyüdüğü sanılır.
   */
  const gruplar = useMemo(() => {
    const harita = new Map<string, OturumOzeti[]>();
    for (const o of oturumlar) {
      const g = harita.get(o.kategori);
      if (g) g.push(o);
      else harita.set(o.kategori, [o]);
    }
    return [...harita.entries()].map(([kategori, liste]) => {
      // Pratik oturumu ders listesinden ayrılıyor: o bir ders değil, kategorinin
      // pratik durumu. Başlıkta gösterilince hem bir satır kazanıyoruz hem de
      // "kaç soru çözdüm" bilgisi kaydırmadan görünüyor.
      const dersler = liste.filter((o) => !o.tekrarMi);
      const pratik = liste.find((o) => o.tekrarMi) ?? null;
      return {
        kategori,
        dersler,
        pratik,
        dersSayisi: dersler.filter((o) => !o.yarim).length,
        yarimSayisi: dersler.filter((o) => o.yarim).length,
        soruSayisi: dersler.reduce((t, o) => t + o.soruSayisi, 0),
      };
    });
  }, [oturumlar]);

  /**
   * Katlanır kategoriler. Kategori sayısı arttıkça sayfa 150 satırlık düz bir
   * kaydırmaya dönüyordu ve "Soru Gönder" düğmeleri arada kayboluyordu.
   *
   * Varsayılan: en son ders eklenen kategori açık (gruplar zaten ona göre
   * sıralı), diğerleri kapalı. `null` = "hiç dokunulmadı, varsayılanı uygula" —
   * böylece açılışta setState eden bir effect'e gerek kalmıyor.
   */
  const [acikKategoriler, setAcikKategoriler] = useState<Set<string> | null>(null);
  const kategoriAcikMi = (k: string) =>
    acikKategoriler ? acikKategoriler.has(k) : k === gruplar[0]?.kategori;
  const kategoriCevir = (k: string) =>
    setAcikKategoriler((mevcut) => {
      const taban = mevcut ?? new Set(gruplar[0] ? [gruplar[0].kategori] : []);
      const yeni = new Set(taban);
      if (yeni.has(k)) yeni.delete(k);
      else yeni.add(k);
      return yeni;
    });

  /**
   * Kategoriden pratik. TEST HAZIRLAMIYOR: tek bir rastgele soru getirip soru
   * ekranına atıyor, orada "başka soru" düğmesiyle döngü sürüyor.
   *
   * Kategorinin açık bir pratik oturumu varsa ona devam ediliyor; her basışta
   * yeni oturum açsaydı liste şişer ve "kaç soru çözdüm" sayacı sıfırlanırdı.
   * Model çağrısı yok, bedava ve anında.
   */
  const tekrarBaslat = async (kategori: string) => {
    if (tekrarKuruluyor) return;
    setTekrarKuruluyor(kategori);
    try {
      const res = await fetch("/api/ders/tekrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kategori, adet: 1 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.hata ?? "Tekrar hazırlanamadı.");
      router.push(`/ders/${data.sessionId}`);
    } catch (err) {
      addToast((err as Error).message, "error");
      setTekrarKuruluyor(null);
    }
  };

  /**
   * Arama isteği. Her tuşta değil, yazma durunca (300 ms) gönderiliyor; ayrıca
   * her istek kendi sıra numarasını taşıyor ki geç dönen eski bir cevap yeni
   * sonucun üstüne yazmasın.
   */
  const aramaSirasi = useRef(0);
  const araYap = useCallback(async (q: string) => {
    const sira = ++aramaSirasi.current;
    if (q.trim().length < 3) {
      setAramaSonucu(null);
      setAraniyor(false);
      return;
    }
    setAraniyor(true);
    try {
      const res = await fetch("/api/ders/ara", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
      });
      const data = await res.json();
      if (sira !== aramaSirasi.current) return; // eski cevap, yoksay
      if (!res.ok) throw new Error(data?.hata ?? "Arama yapılamadı.");
      setAramaSonucu(data.sonuclar ?? []);
      setAramaToplam(data.toplam ?? 0);
    } catch (err) {
      if (sira !== aramaSirasi.current) return;
      setAramaSonucu([]);
      setAramaToplam(0);
      addToast((err as Error).message, "error");
    } finally {
      if (sira === aramaSirasi.current) setAraniyor(false);
    }
  }, [addToast]);

  useEffect(() => {
    const z = setTimeout(() => araYap(arama), 300);
    return () => clearTimeout(z);
  }, [arama, araYap]);

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

  const calisanIs = isler.filter((i) => IS_CALISIYOR.includes(i.durum)).length;
  const bekleyenIs = isler.filter((i) => i.durum === "bekliyor").length;

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
                if (e.key === "Enter") siradanEkle(link);
              }}
              // Tek satırlık kutuya çok satır yapıştırılınca tarayıcı satır
              // sonlarını siliyor ve linkler birbirine yapışıyor. O yüzden
              // yapıştırma burada yakalanıyor: birden çok link varsa hepsi
              // doğrudan sıraya giriyor, kutuya hiç yazılmıyor.
              onPaste={(e) => {
                const metin = e.clipboardData.getData("text");
                if (linkleriAyikla(metin).length > 1) {
                  e.preventDefault();
                  siradanEkle(metin);
                }
              }}
              placeholder="https://www.youtube.com/watch?v=..."
              className="focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-3.5 pl-10 pr-4 text-sm text-white/95 placeholder-white/25 transition-all"
            />
          </div>

          {elleIsId === null && (
            <button
              onClick={() => siradanEkle(link)}
              disabled={!link.trim()}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3.5 text-sm font-medium text-[var(--background)] shadow-lg shadow-[var(--accent)]/10 transition-all hover:bg-[var(--accent-light)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
            >
              {calisanIs + bekleyenIs > 0 ? "Sıraya ekle" : "Derse başla"}
              <ArrowRight size={15} />
            </button>
          )}

          {/* Kuyruk. Ablam birkaç dersi arka arkaya işleme koyabilsin diye
              üretim burada listeleniyor; her ders kendi satırında ilerliyor ve
              biten dersi hemen açabiliyor. */}
          {isler.length > 0 && (
            <div className="mt-3 space-y-2">
              {isler.map((is) => (
                <div
                  key={is.id}
                  className="animate-fade-in flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5"
                >
                  {is.videoId ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`https://img.youtube.com/vi/${is.videoId}/mqdefault.jpg`}
                      alt=""
                      className="h-11 w-[74px] flex-shrink-0 rounded-lg border border-white/[0.06] object-cover"
                    />
                  ) : (
                    <div className="flex h-11 w-[74px] flex-shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-black/20">
                      <Youtube size={16} className="text-white/20" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-white/85">
                      {is.baslik ?? is.url ?? "Ders"}
                    </p>
                    <p
                      className={`mt-0.5 flex items-center gap-1.5 text-[11px] ${
                        is.durum === "hata"
                          ? "text-red-300/80"
                          : is.durum === "elle"
                            ? "text-amber-300/80"
                            : is.durum === "hazir"
                              ? "text-[var(--accent)]/70"
                              : "text-white/40"
                      }`}
                    >
                      {IS_CALISIYOR.includes(is.durum) && (
                        <Loader2 size={10} className="animate-spin" />
                      )}
                      {is.durum === "hazir" && <CircleCheck size={10} />}
                      {(is.durum === "hata" || is.durum === "elle") && <CircleAlert size={10} />}
                      <span className="truncate">
                        {is.durum === "hata" ? (is.hata ?? "Hata") : DURUM_METNI[is.durum]}
                      </span>
                    </p>
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-1">
                    {is.durum === "hazir" && is.sessionId && (
                      <Link
                        href={`/ders/${is.sessionId}`}
                        className="rounded-lg bg-[var(--accent)]/15 px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--accent-light)] transition-colors hover:bg-[var(--accent)]/25"
                      >
                        Aç
                      </Link>
                    )}
                    {is.durum === "hata" && (
                      <button
                        onClick={() => tekrarDene(is.id)}
                        className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11.5px] text-white/60 transition-colors hover:border-[var(--border-hover)] hover:text-white/90"
                      >
                        Tekrar dene
                      </button>
                    )}
                    {is.durum === "elle" && (
                      <button
                        onClick={() => {
                          setElleIsId(is.id);
                          setElleMetin("");
                        }}
                        className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11.5px] text-white/60 transition-colors hover:border-[var(--border-hover)] hover:text-white/90"
                      >
                        Yapıştır
                      </button>
                    )}
                    {/* Çalışan iş kaldırılamıyor: sunucudaki üretim zaten
                        başladı, karttan silmek onu durdurmaz — durduruyormuş
                        gibi görünen bir düğme yanıltıcı olur. */}
                    {!IS_CALISIYOR.includes(is.durum) && (
                      <button
                        onClick={() => {
                          if (elleIsId === is.id) setElleIsId(null);
                          kaldir(is.id);
                        }}
                        aria-label="Sıradan çıkar"
                        className="rounded-lg p-1.5 text-white/20 transition-colors hover:bg-red-400/10 hover:text-red-400"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {calisanIs + bekleyenIs > 0 && (
            <p className="mt-3 text-center text-[11.5px] leading-relaxed text-white/35">
              Ders ne kadar uzunsa o kadar çok soru çıkar; her ders birkaç dakika sürebilir.
              {bekleyenIs > 0 && ` Aynı anda ${ES_ZAMANLI_URETIM} ders hazırlanıyor, kalanı sırada.`}{" "}
              Hazır olanı beklemeden açıp çözmeye başlayabilirsin.
            </p>
          )}

          {/* Elle yapıştırma paneli — kuyruktaki belirli bir işe ait */}
          {elleIsId !== null && (
            <div className="animate-fade-in mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 text-[13px] font-medium text-white/85">
                  <ClipboardPaste size={14} className="text-[var(--accent)]/80" />
                  Transkripti elle yapıştır
                </div>
                <button
                  onClick={() => {
                    setElleIsId(null);
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
                onClick={() => {
                  elleGonder(elleIsId, elleMetin);
                  setElleIsId(null);
                  setElleMetin("");
                }}
                disabled={!elleMetin.trim()}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-medium text-[var(--background)] transition-all hover:bg-[var(--accent-light)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-30"
              >
                Bu transkriptle devam et
                <CornerDownLeft size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Ders içi arama */}
        <div className="mt-6">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/25"
            />
            <input
              type="search"
              value={arama}
              onChange={(e) => setArama(e.target.value)}
              // Soru cümlesi değil TERİM aranıyor: transkriptte birebir metin
              // eşleşmesi yapılıyor, "iltizam nerede anlatıldı" hiçbir yerde
              // geçmez. Placeholder bunu örnekle anlatıyor.
              placeholder="Derslerde terim ara: iltizam, Lale Devri…"
              aria-label="İşlenen derslerin transkriptlerinde terim ara"
              className="focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-9 pr-9 text-[13px] text-white/90 placeholder-white/25 transition-all"
            />
            {araniyor && (
              <Loader2
                size={14}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-[var(--accent)]/60"
              />
            )}
          </div>

          {aramaSonucu !== null && (
            <div className="animate-fade-in mt-3">
              {aramaSonucu.length === 0 ? (
                <p className="px-1 text-[12px] text-white/30">
                  &quot;{arama.trim()}&quot; hiçbir derste geçmiyor.
                </p>
              ) : (
                <>
                  <p className="mb-2 px-1 text-[11.5px] text-white/30">
                    {aramaSonucu.length} derste, {aramaToplam} yerde geçiyor
                  </p>
                  <div className="space-y-2">
                    {aramaSonucu.map((d) => (
                      <div
                        key={d.videoId}
                        className="glass rounded-xl border border-[var(--border)] p-3.5"
                      >
                        <p className="mb-2 truncate text-[12.5px] font-medium text-white/80">
                          {d.baslik ?? "Ders"}
                          <span className="ml-2 text-[11px] font-normal text-white/30">
                            {d.toplam} kez
                          </span>
                        </p>
                        <div className="space-y-1.5">
                          {d.vurgular.map((v, i) => (
                            <a
                              key={i}
                              href={videoLinki(d.videoId, v.saniye)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.04]"
                            >
                              <span className="mt-px flex-shrink-0 font-mono text-[11px] text-[var(--accent)]/70">
                                {formatSure(v.saniye)}
                              </span>
                              <span className="text-[11.5px] leading-relaxed text-white/45">
                                …{v.metin.slice(Math.max(0, v.bas - 60), v.bas)}
                                <mark className="rounded bg-[var(--accent)]/25 px-0.5 text-[var(--accent-light)]">
                                  {v.metin.slice(v.bas, v.bas + v.uzunluk)}
                                </mark>
                                {v.metin.slice(v.bas + v.uzunluk, v.bas + v.uzunluk + 90)}…
                              </span>
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
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
          ) : listeHatasi ? (
            <div className="glass rounded-2xl border border-red-400/25 bg-red-400/[0.04] px-5 py-8 text-center">
              <p className="text-[13px] text-white/70">Dersler yüklenemedi.</p>
              <p className="mt-1 text-[11.5px] text-white/35">
                Bağlantı sorunu olabilir. Derslerin duruyor.
              </p>
              <button
                onClick={() => {
                  setYukleniyor(true);
                  oturumlariGetir();
                }}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-[13px] text-white/65 transition-colors hover:border-[var(--border-hover)] hover:text-white/90"
              >
                Tekrar dene
              </button>
            </div>
          ) : oturumlar.length === 0 ? (
            <div className="glass rounded-2xl border border-[var(--border)] px-5 py-10 text-center">
              <p className="text-[13px] text-white/35">
                Henüz ders yok. Yukarıya bir video linki yapıştırarak başla.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {gruplar.map((g) => {
                const acik = kategoriAcikMi(g.kategori);
                return (
                <div
                  key={g.kategori}
                  className="glass overflow-hidden rounded-2xl border border-[var(--border)]"
                >
                  {/* Kategori başlığı: sol yarısı katlama, sağı pratik düğmesi.
                      Düğme başlığın içinde olduğu için kategori kapalıyken de
                      erişilebilir — asıl çözülen sorun buydu. */}
                  <div className="flex items-center gap-3 p-3.5">
                    <button
                      onClick={() => kategoriCevir(g.kategori)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      {acik ? (
                        <ChevronDown size={15} className="flex-shrink-0 text-white/35" />
                      ) : (
                        <ChevronRight size={15} className="flex-shrink-0 text-white/35" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[12px] font-medium uppercase tracking-wider text-white/70">
                            {g.kategori}
                          </span>
                          <span className="text-[11.5px] text-white/30">
                            {g.dersSayisi} ders · {g.soruSayisi} soru
                          </span>
                          {g.yarimSayisi > 0 && (
                            <span className="flex items-center gap-1 text-[11px] text-amber-300/80">
                              <CircleAlert size={10} />
                              {g.yarimSayisi} yarım
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[11.5px] text-white/35">
                          {g.pratik && g.pratik.cevapSayisi > 0
                            ? `son pratik: ${g.pratik.cevapSayisi} soru · ${g.pratik.dogruSayisi} doğru`
                            : "henüz pratik yok"}
                        </p>
                      </div>
                    </button>

                    <div className="flex flex-shrink-0 items-center gap-1.5">
                      {/* Pratik için ayrı bir düğme yok: "Soru Gönder" zaten
                          eskisini silip yenisini başlatıyor. Ayrı bir silme
                          düğmesi yalnızca başlıktaki sayaç satırını temizlerdi,
                          yani gerçek bir işi yoktu. */}
                      {g.dersSayisi > 0 && (
                        <button
                          onClick={() => tekrarBaslat(g.kategori)}
                          disabled={!!tekrarKuruluyor}
                          title={`${g.kategori} derslerinden rastgele bir soru`}
                          className="flex items-center gap-1.5 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/[0.07] px-2.5 py-1.5 text-[11.5px] text-[var(--accent-light)] transition-colors hover:border-[var(--accent)]/55 hover:bg-[var(--accent)]/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {tekrarKuruluyor === g.kategori ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Dices size={12} />
                          )}
                          Soru Gönder
                        </button>
                      )}
                    </div>
                  </div>

                  {acik && (
                  <div className="space-y-2 border-t border-[var(--border)] p-2.5">
                    {g.dersler.map((o, i) => (
                    <div
                      key={o.id}
                      className="animate-fade-in group relative flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 transition-all hover:border-[var(--border-hover)]"
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
                        {/* Bu liste yalnızca dersleri taşıyor — pratik oturumu
                            kategori başlığında gösteriliyor, o yüzden küçük resim
                            koşulsuz basılıyor. */}
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
                            {/* Süre yalnızca gerçek derste anlamlı. Pratik oturumunun
                                sure alanı ilk kaynak videodan geliyor (oturumun
                                video_id'si NOT NULL olduğu için orada duruyor), yani
                                pratikte rastgele bir dersin süresini gösterirdi. */}
                            {!o.tekrarMi && o.sure > 0 && (
                              <span className="flex items-center gap-1">
                                <Clock size={10} />
                                {formatSure(o.sure)}
                              </span>
                            )}
                            {o.yarim ? (
                              <span className="flex items-center gap-1 text-amber-300/80">
                                <CircleAlert size={10} />
                                {tamamlanmakta(o.id) ? "Tamamlanıyor…" : "Tamamlanmadı — devam et"}
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
                );
              })}

              {oturumlar.length >= LISTE_TAVANI && (
                <p className="px-1 pt-2 text-center text-[11.5px] text-white/25">
                  En yeni {LISTE_TAVANI} ders gösteriliyor. Daha eskileri listede yok.
                </p>
              )}
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
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Ders notlarım"
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
            ref={silmeRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ders-silme-basligi"
            className="animate-fade-in-scale w-full max-w-xs rounded-2xl border border-[var(--border)] bg-[var(--surface-popup)] p-6 shadow-2xl shadow-black/40"
            onClick={(e) => e.stopPropagation()}
          >
            <p id="ders-silme-basligi" className="text-[14px] font-medium text-white/90">
              Bu ders silinsin mi?
            </p>
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
