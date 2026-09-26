"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronRight,
  Clapperboard,
  ExternalLink,
  Film,
  ImagePlus,
  Layers,
  Loader2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  X,
  Youtube,
} from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { useToast } from "@/components/Toast";
import Secici from "@/components/youtube/Secici";
import {
  CALISAN_DURUMLAR,
  DURUM_BILGISI,
  GIZLILIK_ETIKETI,
  NABIZ_ESIGI_MS,
  SURE_SECENEKLERI,
  YOUTUBE_ACIK,
  YT_ONIZLEME_ANAHTARI,
  hataMetni,
  kelimeSay,
  senaryoyuDogrula,
  sureBicimle,
  tekrarDeneDurumu,
  zamanOnce,
  type Bolum,
  type Gizlilik,
  type YayinModu,
  YAYIN_MODU_ETIKETI,
  planliMi,
  yayinDurumu,
  tarihBicimle,
  yerelTarihGirdisi,
  type Nabiz,
  type Seri,
  type Sahne,
  type Kalip,
  KALIP_ETIKETI,
  SAHNE_KULLANIM_SINIRI,
  sahneKullanimi,
  seriHavuzu,
  sayiBicimle,
  derlemeyeUygun,
  type KaliteRaporu,
  type Istatistik,
  YAYIN_GUNLERI,
  YAYIN_SAATI,
  gunAnahtari,
  haftaBasi,
  siradakiBosGun,
} from "@/lib/ablam-youtube";

type Sekme = "bolumler" | "takvim" | "seriler" | "sahneler";

const girdiSinifi =
  "focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[13.5px] text-white/90 placeholder-white/25";
const birincilDugme =
  "flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[var(--accent)]/15 px-4 py-2.5 text-[13px] font-medium text-[var(--accent-light)] transition-colors hover:bg-[var(--accent)]/25 disabled:cursor-not-allowed disabled:opacity-40";
const ikincilDugme =
  "flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-[var(--border)] px-4 py-2.5 text-[13px] text-white/60 transition-colors hover:border-[var(--border-hover)] hover:text-white/85 disabled:cursor-not-allowed disabled:opacity-40";

// ---------------------------------------------------------------- kapı

export default function YoutubeSayfasi() {
  // Bölüm kapalıysa "yakında" ekranı; ?onizleme=1 ile gelen görür (Kariyer ile aynı)
  const [gorunum, setGorunum] = useState<"bilinmiyor" | "yakinda" | "acik">(YOUTUBE_ACIK ? "acik" : "bilinmiyor");
  useEffect(() => {
    if (YOUTUBE_ACIK) return;
    queueMicrotask(() => {
      let onizleme = false;
      try {
        if (new URLSearchParams(window.location.search).get("onizleme") === "1") {
          localStorage.setItem(YT_ONIZLEME_ANAHTARI, "1");
        }
        onizleme = localStorage.getItem(YT_ONIZLEME_ANAHTARI) === "1";
      } catch {
        // gizli pencere vb.
      }
      setGorunum(onizleme ? "acik" : "yakinda");
    });
  }, []);

  if (gorunum !== "acik") return <YakindaEkrani gizli={gorunum === "bilinmiyor"} />;
  return <YoutubeUygulamasi />;
}

function YakindaEkrani({ gizli }: { gizli: boolean }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-x-hidden px-5">
      <AnaSayfaLinki />
      <div className={`animate-fade-in flex flex-col items-center text-center transition-opacity ${gizli ? "opacity-0" : ""}`}>
        <BaslikIkonu />
        <h1 className="text-2xl font-semibold text-white/95">Ablam YouTube</h1>
        <p className="mt-2 max-w-xs text-[13.5px] leading-relaxed text-white/45">
          Hazırlanıyor. Açıldığında konuyu yazacaksın, bölüm kendi kendine hazırlanıp YouTube&apos;a gidecek.
        </p>
        <span className="mt-4 rounded-full border border-[var(--accent)]/25 bg-[var(--accent)]/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-[var(--accent-light)]/80">
          Yakında
        </span>
      </div>
    </main>
  );
}

const AnaSayfaLinki = () => (
  <Link
    href="/"
    className="glass fixed top-5 left-5 z-20 animate-fade-in flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-[13px] text-white/55 transition-all duration-200 hover:border-[var(--border-hover)] hover:text-white/85 sm:top-6 sm:left-7"
  >
    <ArrowLeft size={14} />
    <span>Ana sayfa</span>
  </Link>
);

const BaslikIkonu = () => (
  <div className="glow-md mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent)]/10">
    <Youtube size={24} className="text-[var(--accent-light)]" />
  </div>
);

// ---------------------------------------------------------------- uygulama

function YoutubeUygulamasi() {
  const { addToast } = useToast();
  const [sekme, setSekme] = useState<Sekme>("bolumler");
  const [yukleniyor, setYukleniyor] = useState(true);
  const [bolumler, setBolumler] = useState<Bolum[]>([]);
  const [seriler, setSeriler] = useState<Seri[]>([]);
  const [sahneler, setSahneler] = useState<Sahne[]>([]);
  const [nabiz, setNabiz] = useState<Nabiz | null>(null);
  /** Açık bölüm — liste yerine ayrıntı ekranı */
  const [seciliId, setSeciliId] = useState<string | null>(null);
  /** "şimdi": nabız ve "x dk önce" hesapları render içinde Date.now() çağırmasın */
  const [simdi, setSimdi] = useState(0);
  /** Takvimde boş bir güne "bölüm ekle" denince yeni bölüm formu bu tarihle açılır */
  const [planZamani, setPlanZamani] = useState<Date | null>(null);

  const getir = useCallback(async () => {
    const [b, s, sh, n] = await Promise.all([
      supabase.from("youtube_bolumler").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("youtube_seriler").select("*").order("created_at", { ascending: true }),
      supabase.from("youtube_sahneler").select("*").order("created_at", { ascending: true }),
      supabase.from("youtube_nabiz").select("*").eq("id", 1).maybeSingle(),
    ]);
    if (b.error) addToast("Bölümler okunamadı: " + b.error.message, "error");
    setBolumler((b.data ?? []) as Bolum[]);
    setSeriler((s.data ?? []) as Seri[]);
    setSahneler((sh.data ?? []) as Sahne[]);
    setNabiz((n.data as Nabiz | null) ?? null);
    setSimdi(Date.now());
    setYukleniyor(false);
  }, [addToast]);

  useEffect(() => {
    queueMicrotask(getir);
  }, [getir]);

  // Stüdyo satırları güncelledikçe (ilerleme, durum) sayfa kendini tazeler.
  // Realtime düşerse 20 saniyelik yoklama nabzı ve listeyi yine getirir.
  useEffect(() => {
    const kanal = supabase
      .channel("youtube-studyo")
      .on("postgres_changes", { event: "*", schema: "public", table: "youtube_bolumler" }, () => getir())
      .on("postgres_changes", { event: "*", schema: "public", table: "youtube_seriler" }, () => getir())
      .on("postgres_changes", { event: "*", schema: "public", table: "youtube_sahneler" }, () => getir())
      .subscribe();
    const zamanlayici = setInterval(getir, 20_000);
    return () => {
      supabase.removeChannel(kanal);
      clearInterval(zamanlayici);
    };
  }, [getir]);

  const cevrimici = !!nabiz?.son_gorulme && simdi - new Date(nabiz.son_gorulme).getTime() < NABIZ_ESIGI_MS;
  const secili = useMemo(() => bolumler.find((b) => b.id === seciliId) ?? null, [bolumler, seciliId]);
  const seriAdi = useCallback((id: string | null) => seriler.find((s) => s.id === id)?.ad ?? "—", [seriler]);

  // --- eylemler: hepsi iyimser değil; stüdyo satırı değiştirince realtime getiriyor ---

  const yeniBolum = async (
    seri_id: string,
    konu: string,
    sure_dk: number,
    yayin: YayinModu,
    yayin_zamani: string | null,
    elleSahne: string | null,
    derlemeIdler: string[] = [],
  ): Promise<boolean> => {
    const ek = yayin === "elle" ? {} : { otomatik_yukle: true, gizlilik: "public", yayin_zamani: yayin === "planli" ? yayin_zamani : null };
    // Sahne elle seçildiyse o kullanılır; seçilmediyse stüdyo üretim anında serinin havuzundan dönüşümle seçer
    // (sahne_id burada yalnızca yer tutucu: sütun boş olamıyor).
    const seri = seriler.find((s) => s.id === seri_id);
    const sahne_id = elleSahne ?? (seri ? seriHavuzu(seri)[0] : null) ?? null;
    const sahneAlani = elleSahne ? { sahne_elle: true } : {};
    // Derlemenin senaryosu yok: doğrudan üretim sırasına girer
    const derlemeAlani = derlemeIdler.length ? { derleme_idler: derlemeIdler, durum: "onaylandi" } : {};
    const { error } = await supabase.from("youtube_bolumler").insert({ seri_id, sahne_id, konu, sure_dk, ...sahneAlani, ...derlemeAlani, ...ek });
    if (error) {
      addToast("Eklenemedi: " + error.message, "error");
      return false;  // konu metni formda kalsın, kullanıcı yeniden yazmasın
    }
    addToast(derlemeIdler.length ? "Derleme sıraya alındı; video birleştirilince burada görünür." : "Sıraya alındı. Senaryo hazır olunca burada görünür.");
    getir();
    return true;
  };

  const bolumYama = async (id: string, yama: Partial<Bolum>, mesaj?: string) => {
    const { error } = await supabase.from("youtube_bolumler").update(yama).eq("id", id);
    if (error) return addToast("Kaydedilemedi: " + error.message, "error");
    if (mesaj) addToast(mesaj);
    getir();
  };

  const bolumSil = async (b: Bolum) => {
    if (!confirm(`"${b.baslik ?? b.konu}" silinsin mi? Üretilen dosyalar stüdyoda kalır, YouTube'daki video silinmez.`)) return;
    const { error } = await supabase.from("youtube_bolumler").delete().eq("id", b.id);
    if (error) return addToast("Silinemedi: " + error.message, "error");
    setSeciliId(null);
    getir();
  };

  const yeniSahne = async (ad: string, sahne: string, aciklama: string) => {
    const { error } = await supabase.from("youtube_sahneler").insert({ ad, sahne, aciklama: aciklama || null });
    if (error) return addToast("Eklenemedi: " + error.message, "error");
    addToast("Sahne eklendi; görseli stüdyoda üretilecek.");
    getir();
  };

  const sahneSil = async (sh: Sahne) => {
    if (seriler.some((s) => seriHavuzu(s).includes(sh.id))) return addToast("Bu sahne bir serinin havuzunda; önce seriden çıkar.", "error");
    if (!confirm(`"${sh.ad}" sahnesi silinsin mi?`)) return;
    const { error } = await supabase.from("youtube_sahneler").delete().eq("id", sh.id);
    if (error) return addToast("Silinemedi: " + error.message, "error");
    getir();
  };

  const seriKaydet = async (yeni: Partial<Seri>, id?: string) => {
    const q = id ? supabase.from("youtube_seriler").update(yeni).eq("id", id) : supabase.from("youtube_seriler").insert(yeni);
    const { error } = await q;
    if (error) return addToast("Kaydedilemedi: " + error.message, "error");
    addToast(id ? "Seri güncellendi." : "Seri eklendi.");
    getir();
  };

  const seriSil = async (s: Seri) => {
    if (bolumler.some((b) => b.seri_id === s.id)) return addToast("Bu seriye ait bölümler var; önce onları sil.", "error");
    if (!confirm(`"${s.ad}" serisi silinsin mi? Sahnesi kalır.`)) return;
    const { error } = await supabase.from("youtube_seriler").delete().eq("id", s.id);
    if (error) return addToast("Silinemedi: " + error.message, "error");
    getir();
  };

  return (
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
      <AnaSayfaLinki />

      <div className="relative z-10 mx-auto w-full max-w-2xl px-5 pb-24 pt-24 sm:pt-28">
        <div className="mb-8 flex flex-col items-center text-center">
          <BaslikIkonu />
          <h1 className="text-2xl font-semibold text-white/95">Ablam YouTube</h1>
          <p className="mt-1.5 max-w-md text-[13.5px] leading-relaxed text-white/45">
            Merak ettiğin konuyu yaz; senaryo, seslendirme ve video kendi kendine hazırlanır. Sen okur, onaylar, yüklersin.
          </p>
          <NabizRozeti cevrimici={cevrimici} nabiz={nabiz} />
        </div>

        {secili ? (
          <BolumDetay
            bolum={secili}
            seriAdi={seriAdi(secili.seri_id)}
            cevrimici={cevrimici}
            onGeri={() => setSeciliId(null)}
            onYama={bolumYama}
            onSil={() => bolumSil(secili)}
          />
        ) : (
          <>
            <div className="glass mb-6 flex rounded-xl border border-[var(--border)] p-1">
              {(
                [
                  ["bolumler", "Bölümler", Film],
                  ["takvim", "Takvim", CalendarDays],
                  ["seriler", "Seriler", Layers],
                  ["sahneler", "Sahneler", Clapperboard],
                ] as const
              ).map(([ad, etiket, Ikon]) => (
                <button
                  key={ad}
                  onClick={() => setSekme(ad)}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-2 py-2 text-[13px] transition-colors sm:px-3 ${
                    sekme === ad ? "bg-[var(--accent)]/15 text-[var(--accent-light)]" : "text-white/45 hover:text-white/75"
                  }`}
                >
                  <Ikon size={14} className="hidden shrink-0 sm:block" />
                  {etiket}
                </button>
              ))}
            </div>

            {yukleniyor ? (
              <div className="flex justify-center py-16 text-white/30">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : sekme === "sahneler" ? (
              <SahnelerEkrani sahneler={sahneler} seriler={seriler} bolumler={bolumler} onYeni={yeniSahne} onSil={sahneSil} />
            ) : sekme === "takvim" ? (
              <TakvimEkrani
                bolumler={bolumler}
                seriler={seriler}
                simdi={simdi}
                onAc={setSeciliId}
                onEkle={(d) => {
                  setPlanZamani(d);
                  setSekme("bolumler");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
            ) : sekme === "seriler" ? (
              <SerilerEkrani seriler={seriler} sahneler={sahneler} bolumler={bolumler} onKaydet={seriKaydet} onSil={seriSil} onSahnelereGit={() => setSekme("sahneler")} />
            ) : (
              <BolumlerEkrani
                key={planZamani?.toISOString() ?? "form"}
                planZamani={planZamani}
                onPlanKullanildi={() => setPlanZamani(null)}
                simdi={simdi}
                bolumler={bolumler}
                seriler={seriler}
                sahneler={sahneler}
                onYeni={yeniBolum}
                onAc={setSeciliId}
                onSerilereGit={() => setSekme("seriler")}
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- nabız

function NabizRozeti({ cevrimici, nabiz }: { cevrimici: boolean; nabiz: Nabiz | null }) {
  return (
    <div
      className="mt-4 flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[11.5px] text-white/50"
      title={nabiz?.son_gorulme ? `Son sinyal ${zamanOnce(nabiz.son_gorulme)}${nabiz.makine ? " · " + nabiz.makine : ""}` : "Stüdyo hiç bağlanmadı"}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cevrimici ? "bg-[var(--accent)] shadow-[0_0_6px_rgb(var(--accent-rgb)/0.8)]" : "bg-white/25"}`} />
      {cevrimici ? (
        <span>
          Stüdyo çalışıyor
          {nabiz?.mesaj && nabiz.mesaj !== "boşta" ? <span className="text-white/35"> · {nabiz.mesaj}</span> : null}
        </span>
      ) : (
        <span>Stüdyo çevrimdışı — sıraya alınanlar bilgisayar açılınca işlenir</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- bölümler

function BolumlerEkrani({
  planZamani,
  onPlanKullanildi,
  simdi,
  bolumler,
  seriler,
  sahneler,
  onYeni,
  onAc,
  onSerilereGit,
}: {
  /** takvimden gelindiyse formun planlı yayın tarihi */
  planZamani: Date | null;
  onPlanKullanildi: () => void;
  simdi: number;
  bolumler: Bolum[];
  seriler: Seri[];
  sahneler: Sahne[];
  onYeni: (
    seri_id: string,
    konu: string,
    sure_dk: number,
    yayin: YayinModu,
    yayin_zamani: string | null,
    elleSahne: string | null,
    derlemeIdler?: string[],
  ) => Promise<boolean>;
  onAc: (id: string) => void;
  onSerilereGit: () => void;
}) {
  // Sahnesi hazır olan seriler; en yenisi varsayılan
  const hazirSahne = (s: Seri) => seriHavuzu(s).some((id) => sahneler.find((sh) => sh.id === id)?.loop_durum === "hazir");
  const hazirSeriler = seriler
    .filter(hazirSahne)
    .slice()
    .reverse()
    .sort((a, b) => Number(!!a.derleme) - Number(!!b.derleme));
  const [seriId, setSeriId] = useState(hazirSeriler[0]?.id ?? "");
  const [konu, setKonu] = useState("");
  const [sure, setSure] = useState<number>(60);
  const [sureSecildi, setSureSecildi] = useState(false);
  /** "" = otomatik (dönüşüm); bir sahne kimliği = bu bölüm için elle seçim */
  const [elleSahne, setElleSahne] = useState("");
  const [yayin, setYayin] = useState<YayinModu>(planZamani ? "planli" : "elle");
  // Planlı yayının varsayılanı: takvimden seçilen gün, yoksa yayın düzenindeki ilk boş gün
  const [yayinZamani, setYayinZamani] = useState(() => yerelTarihGirdisi(planZamani ?? siradakiBosGun(bolumler, simdi) ?? undefined));
  const [zamanGecersiz, setZamanGecersiz] = useState(false);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const etkinSeri = hazirSeriler.some((s) => s.id === seriId) ? seriId : (hazirSeriler[0]?.id ?? "");
  // Süre serinin varsayılanından gelir; kullanıcı elle değiştirdiyse ona dokunma
  const seriSure = seriler.find((s) => s.id === etkinSeri)?.sure_dk ?? 60;
  const etkinSure = sureSecildi ? sure : seriSure;
  // Derleme serisi: konu yazılmaz, yayındaki bölümler seçilir
  const derlemeModu = !!seriler.find((s) => s.id === etkinSeri)?.derleme;
  const [secilenler, setSecilenler] = useState<string[]>([]);
  const adaylar = bolumler.filter(derlemeyeUygun);
  const secilenBolumler = secilenler.map((id) => adaylar.find((b) => b.id === id)).filter((b): b is Bolum => !!b);
  const derlemeSn = secilenBolumler.reduce((t, b) => t + (b.sure_sn ?? 0), 0);
  const sadeBaslik = (b: Bolum) => (b.yt_baslik ?? b.baslik ?? b.konu).split(" | ")[0];

  const gonderilebilir =
    !!etkinSeri && (derlemeModu ? secilenBolumler.length >= 2 : konu.trim().length >= 4) && !(yayin === "planli" && zamanGecersiz);

  const gonder = async () => {
    if (!gonderilebilir || gonderiliyor) return;
    setGonderiliyor(true);
    const zaman = yayin === "planli" ? new Date(yayinZamani).toISOString() : null;
    const oldu = derlemeModu
      ? await onYeni(
          etkinSeri,
          ("Derleme: " + secilenBolumler.map(sadeBaslik).join(" · ")).slice(0, 300),
          Math.round(derlemeSn / 60),
          yayin,
          zaman,
          elleSahne || null,
          secilenBolumler.map((b) => b.id),
        )
      : await onYeni(etkinSeri, konu.trim(), etkinSure, yayin, zaman, elleSahne || null);
    setGonderiliyor(false);
    if (oldu) {
      setKonu("");
      setSecilenler([]);
      if (planZamani) onPlanKullanildi();  // form sıfırlansın; aynı güne ikinci bölüm yanlışlıkla eklenmesin
    }
  };

  const onayBekleyen = bolumler.filter((b) => b.durum === "senaryo_onay" || b.durum === "hazir");
  const digerleri = bolumler.filter((b) => !onayBekleyen.includes(b));

  return (
    <div className="animate-fade-in space-y-6">
      {/* Yeni bölüm */}
      <section className="glass rounded-xl border border-[var(--border)] p-4">
        <h2 className="mb-3 flex items-center gap-2 text-[13px] font-medium text-white/80">
          <Plus size={14} className="text-[var(--accent)]/80" />
          Yeni bölüm
        </h2>
        {hazirSeriler.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-white/45">
            Önce bir seri lazım — konu evreni, anlatım kalıbı ve arkada dönecek sahne.{" "}
            <button onClick={onSerilereGit} className="text-[var(--accent-light)]/80 underline-offset-2 hover:underline">
              Seri ekle
            </button>
            {seriler.length > 0 ? " (serinin sahnesi hazırlanınca burada görünür)" : ""}
          </p>
        ) : (
          <div className="space-y-3">
            {derlemeModu ? (
              <DerlemeSecici adaylar={adaylar} secilenler={secilenler} onDegis={setSecilenler} toplamSn={derlemeSn} baslik={sadeBaslik} />
            ) : (
            <textarea
              value={konu}
              onChange={(e) => setKonu(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) gonder();
              }}
              rows={2}
              autoFocus={!!planZamani}
              placeholder="Bu gece ne anlatılsın? Örn: İnsanlık neden takvim kullanıyor? · Bir şehrin kanalizasyonu nasıl çalışır?"
              className={girdiSinifi + " resize-none leading-relaxed"}
            />
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              {hazirSeriler.length > 1 && (
                <div className="sm:flex-1">
                  <Secici deger={etkinSeri} onChange={setSeriId} secenekler={hazirSeriler.map((s) => ({ deger: s.id, etiket: s.ad, aciklama: KALIP_ETIKETI[s.kalip] }))} />
                </div>
              )}
              {!derlemeModu && (
                <div className="sm:flex-1">
                  <Secici deger={etkinSure} onChange={(d) => { setSure(d); setSureSecildi(true); }} secenekler={SURE_SECENEKLERI.map((d) => ({ deger: d as number, etiket: `${d} dakika` }))} />
                </div>
              )}
              <button onClick={gonder} disabled={gonderiliyor || !gonderilebilir} className={birincilDugme + " sm:w-32"}>
                {gonderiliyor ? <Loader2 size={14} className="animate-spin" /> : <Clapperboard size={14} />}
                Hazırla
              </button>
            </div>
            <div>
              <Secici
                deger={elleSahne}
                onChange={setElleSahne}
                secenekler={[
                  { deger: "", etiket: "Sahne: otomatik", aciklama: "Serinin havuzundan dönüşümle seçilir" },
                  ...sahneler
                    .filter((sh) => sh.loop_durum === "hazir")
                    .map((sh) => ({ deger: sh.id, etiket: `Sahne: ${sh.ad}`, aciklama: `${sahneKullanimi(sh.id, bolumler)}/${SAHNE_KULLANIM_SINIRI} bölümde kullanıldı` })),
                ]}
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="sm:flex-1">
                <Secici deger={yayin} onChange={setYayin} secenekler={(Object.keys(YAYIN_MODU_ETIKETI) as YayinModu[]).map((m) => ({ deger: m, etiket: YAYIN_MODU_ETIKETI[m] }))} />
              </div>
              {yayin === "planli" && (
                <input
                  type="datetime-local"
                  value={yayinZamani}
                  onChange={(e) => {
                    setYayinZamani(e.target.value);
                    setZamanGecersiz(new Date(e.target.value).getTime() < Date.now());
                  }}
                  className={girdiSinifi + " sm:w-52"}
                />
              )}
            </div>
            {yayin !== "elle" && (
              <p className="text-[11.5px] leading-relaxed text-white/30">Tam otomatik: senaryo onayı beklenmez; ses, video ve kapak üretilip YouTube&apos;a yüklenir.</p>
            )}
          </div>
        )}
      </section>

      {bolumler.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-white/35">Henüz bölüm yok.</p>
      ) : (
        <>
          {onayBekleyen.length > 0 && (
            <section>
              <h3 className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-[var(--accent-light)]/60">Senden bir şey bekliyor</h3>
              <div className="space-y-2">
                {onayBekleyen.map((b) => (
                  <BolumKarti key={b.id} bolum={b} onAc={() => onAc(b.id)} vurgu />
                ))}
              </div>
            </section>
          )}
          {digerleri.length > 0 && (
            <section>
              {onayBekleyen.length > 0 && <h3 className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-white/30">Diğerleri</h3>}
              <div className="space-y-2">
                {digerleri.map((b) => (
                  <BolumKarti key={b.id} bolum={b} onAc={() => onAc(b.id)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

const TON_SINIFI = {
  bekle: "border-white/10 text-white/45",
  calis: "border-[var(--accent)]/25 text-[var(--accent-light)]/80",
  onay: "border-amber-300/30 bg-amber-300/10 text-amber-100/90",
  hazir: "border-[var(--accent)]/40 bg-[var(--accent)]/15 text-[var(--accent-light)]",
  yayin: "border-white/15 bg-white/10 text-white/80",
  hata: "border-red-300/30 bg-red-400/10 text-red-100/90",
} as const;

function DurumRozeti({ bolum }: { bolum: Bolum }) {
  const { etiket, ton } = planliMi(bolum)
    ? { etiket: `Planlandı · ${tarihBicimle(bolum.yayin_zamani!)}`, ton: "hazir" as const }
    : bolum.durum === "yayinda"
      ? { etiket: yayinDurumu(bolum), ton: bolum.gizlilik === "public" ? ("yayin" as const) : ("bekle" as const) }
      : (DURUM_BILGISI[bolum.durum] ?? { etiket: bolum.durum, ton: "bekle" as const });
  const sinif = TON_SINIFI[ton];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${sinif}`}>
      {ton === "calis" && <Loader2 size={10} className="animate-spin" />}
      {etiket}
    </span>
  );
}

function IlerlemeCubugu({ bolum }: { bolum: Bolum }) {
  if (!CALISAN_DURUMLAR.includes(bolum.durum)) return null;
  return (
    <div className="mt-2.5">
      <div className="h-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-[var(--accent)]/70 transition-all duration-700" style={{ width: `${Math.max(3, bolum.ilerleme)}%` }} />
      </div>
      {bolum.adim && <p className="mt-1.5 text-[11.5px] text-white/40">{bolum.adim}</p>}
    </div>
  );
}

function BolumKarti({ bolum, onAc, vurgu }: { bolum: Bolum; onAc: () => void; vurgu?: boolean }) {
  return (
    <button
      onClick={onAc}
      className={`glass group w-full rounded-xl border p-3.5 text-left transition-colors hover:bg-white/[0.04] ${
        vurgu ? "border-[var(--accent)]/25" : "border-[var(--border)]"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/35">
            <span>{bolum.sure_dk} dk</span>
            {bolum.sure_sn ? <span className="normal-case tracking-normal text-white/25">· üretilen {sureBicimle(bolum.sure_sn)}</span> : null}
          </div>
          <p className="mt-0.5 truncate text-[14px] font-medium text-white/90">{bolum.baslik ?? bolum.konu}</p>
          {bolum.baslik && <p className="truncate text-[12px] text-white/40">{bolum.konu}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <DurumRozeti bolum={bolum} />
          <span className="text-[11px] text-white/30">{zamanOnce(bolum.updated_at)}</span>
        </div>
        <ChevronRight size={14} className="mt-1 shrink-0 text-white/20 transition-all group-hover:translate-x-0.5 group-hover:text-white/50" />
      </div>
      <IlerlemeCubugu bolum={bolum} />
      {bolum.durum === "hata" && bolum.hata && <p className="mt-2 text-[12px] text-red-100/70">{hataMetni(bolum.hata)}</p>}
      {bolum.istatistik && <IstatistikSatiri ist={bolum.istatistik} />}
      {bolum.kalite && bolum.kalite.sonuc !== "ok" && bolum.durum !== "yayinda" && (
        <p className={`mt-1.5 text-[11.5px] ${bolum.kalite.sonuc === "hata" ? "text-red-100/70" : "text-amber-100/60"}`}>
          Teknik kontrol: {bolum.kalite.kontroller.filter((k) => k.durum !== "ok").map((k) => k.ad).join(", ")}
        </p>
      )}
    </button>
  );
}

// ---------------------------------------------------------------- takvim

const TAKVIM_HAFTA = 4;
const GUN_KISA = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

/** Takvimdeki kısa durum: tarih zaten satırda yazdığı için "Planlandı · tarih" yerine */
function takvimDurumu(b: Bolum, simdi: number): { etiket: string; ton: keyof typeof TON_SINIFI } {
  const gecti = new Date(b.yayin_zamani!).getTime() <= simdi;
  if (b.durum === "yayinda") return gecti ? { etiket: "Yayında", ton: "yayin" } : { etiket: "YouTube'da planlı", ton: "hazir" };
  if (b.durum === "hata") return { etiket: "Hata", ton: "hata" };
  if (gecti) return { etiket: "Tarih geçti", ton: "onay" };
  return DURUM_BILGISI[b.durum] ?? { etiket: b.durum, ton: "bekle" };
}

function TakvimEkrani({
  bolumler,
  seriler,
  simdi,
  onAc,
  onEkle,
}: {
  bolumler: Bolum[];
  seriler: Seri[];
  simdi: number;
  onAc: (id: string) => void;
  onEkle: (zaman: Date) => void;
}) {
  const bas = haftaBasi(simdi);
  const bugun = gunAnahtari(new Date(simdi));
  const gunIcin = new Map<string, Bolum[]>();
  for (const b of bolumler) {
    if (!b.yayin_zamani) continue;
    const k = gunAnahtari(new Date(b.yayin_zamani));
    gunIcin.set(k, [...(gunIcin.get(k) ?? []), b]);
  }
  const seriAdi = (id: string | null) => seriler.find((s) => s.id === id)?.ad ?? "";
  // Tarihi olmayan ve henüz yüklenmemiş bölümler: planlanmayı bekleyenler
  const tarihsiz = bolumler.filter((b) => !b.yayin_zamani && b.durum !== "yayinda");

  const haftalar = Array.from({ length: TAKVIM_HAFTA }, (_, h) =>
    Array.from({ length: 7 }, (_, g) => {
      const d = new Date(bas);
      d.setDate(bas.getDate() + h * 7 + g);
      return d;
    }),
  );
  // İleriye dönük yayın günlerinin doluluğu (bugünün geçmiş saati sayılmaz)
  const ilerideki = haftalar.flat().filter((d) => {
    const saat = new Date(d);
    saat.setHours(YAYIN_SAATI, 0, 0, 0);
    return YAYIN_GUNLERI.includes(d.getDay()) && saat.getTime() > simdi;
  });
  const bos = ilerideki.filter((d) => !gunIcin.has(gunAnahtari(d))).length;

  return (
    <div className="animate-fade-in space-y-4">
      <p className="px-1 text-[12.5px] leading-relaxed text-white/45">
        Yayın günleri: {YAYIN_GUNLERI.map((g) => GUN_KISA[g]).join(", ")} · {String(YAYIN_SAATI).padStart(2, "0")}:00.{" "}
        {bos === 0 ? (
          <span className="text-white/70">Önümüzdeki {TAKVIM_HAFTA} hafta dolu.</span>
        ) : (
          <>
            Önümüzdeki {TAKVIM_HAFTA} haftada <span className="text-amber-100/80">{bos} boş gün</span> var.
          </>
        )}
      </p>

      {haftalar.map((gunler, h) => {
        const son = gunler[6];
        const aralik = `${gunler[0].toLocaleDateString("tr-TR", { day: "numeric", month: gunler[0].getMonth() === son.getMonth() ? undefined : "short" })} – ${son.toLocaleDateString("tr-TR", { day: "numeric", month: "long" })}`;
        const gorunen = gunler.filter((d) => YAYIN_GUNLERI.includes(d.getDay()) || gunIcin.has(gunAnahtari(d)));
        const doluGun = gunler.filter((d) => YAYIN_GUNLERI.includes(d.getDay()) && gunIcin.has(gunAnahtari(d))).length;
        return (
          <section key={h} className="glass rounded-xl border border-[var(--border)] p-2">
            <div className="flex items-baseline justify-between px-2 pb-1.5 pt-1">
              <h3 className="text-[12px] font-medium text-white/70">{h === 0 ? "Bu hafta" : h === 1 ? "Gelecek hafta" : aralik}</h3>
              <span className="text-[11px] text-white/30">
                {h < 2 ? `${aralik} · ` : ""}
                {doluGun}/{YAYIN_GUNLERI.length}
              </span>
            </div>
            <div className="divide-y divide-white/[0.05]">
              {gorunen.map((d) => {
                const k = gunAnahtari(d);
                const liste = (gunIcin.get(k) ?? []).slice().sort((a, b) => a.yayin_zamani!.localeCompare(b.yayin_zamani!));
                const slot = new Date(d);
                slot.setHours(YAYIN_SAATI, 0, 0, 0);
                const gecmis = slot.getTime() <= simdi;
                return (
                  <div key={k} className={`flex gap-3 px-2 py-2 ${k === bugun ? "rounded-lg bg-[var(--accent)]/[0.07]" : ""}`}>
                    <div className={`w-10 shrink-0 text-center ${gecmis && liste.length === 0 ? "opacity-40" : ""}`}>
                      <p className="text-[10.5px] uppercase tracking-wider text-white/35">{GUN_KISA[d.getDay()]}</p>
                      <p className={`text-[15px] leading-tight ${k === bugun ? "text-[var(--accent-light)]" : "text-white/80"}`}>{d.getDate()}</p>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      {liste.map((b) => {
                        const { etiket, ton } = takvimDurumu(b, simdi);
                        return (
                          <button
                            key={b.id}
                            onClick={() => onAc(b.id)}
                            className="group flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-white/[0.04]"
                          >
                            <span className="shrink-0 text-[11.5px] tabular-nums text-white/35">
                              {new Date(b.yayin_zamani!).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] text-white/85">{b.baslik ?? b.konu}</span>
                              <span className="block truncate text-[11px] text-white/30">
                                {seriAdi(b.seri_id)} · {b.sure_dk} dk
                              </span>
                            </span>
                            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] ${TON_SINIFI[ton]}`}>{etiket}</span>
                          </button>
                        );
                      })}
                      {liste.length === 0 &&
                        (gecmis ? (
                          <p className="px-1.5 py-1.5 text-[12px] text-white/20">Yayın yok</p>
                        ) : (
                          <button
                            onClick={() => onEkle(slot)}
                            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-white/10 px-2.5 py-1.5 text-[12px] text-white/40 transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--accent-light)]"
                          >
                            <Plus size={12} />
                            Boş · {String(YAYIN_SAATI).padStart(2, "0")}:00 için bölüm ekle
                          </button>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {tarihsiz.length > 0 && (
        <section>
          <h3 className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-white/30">Tarihi olmayanlar</h3>
          <div className="space-y-1">
            {tarihsiz.map((b) => (
              <button
                key={b.id}
                onClick={() => onAc(b.id)}
                className="glass flex w-full items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-left transition-colors hover:bg-white/[0.04]"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] text-white/75">{b.baslik ?? b.konu}</span>
                <span className="shrink-0 text-[11px] text-white/30">{b.otomatik_yukle ? "hazır olunca yayınlanır" : "elle yüklenecek"}</span>
                <DurumRozeti bolum={b} />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- derleme, istatistik, kalite

function DerlemeSecici({
  adaylar,
  secilenler,
  onDegis,
  toplamSn,
  baslik,
}: {
  adaylar: Bolum[];
  secilenler: string[];
  onDegis: (ids: string[]) => void;
  toplamSn: number;
  baslik: (b: Bolum) => string;
}) {
  const degistir = (id: string) => onDegis(secilenler.includes(id) ? secilenler.filter((x) => x !== id) : [...secilenler, id]);
  const saat = toplamSn / 3600;
  if (adaylar.length < 2) {
    return <p className="text-[13px] leading-relaxed text-white/45">Derleme için YouTube&apos;a yüklenmiş en az iki bölüm gerekiyor.</p>;
  }
  return (
    <div>
      <p className="mb-2 text-[12px] leading-relaxed text-white/45">
        Arka arkaya eklenecek bölümleri sırayla seç. Yeni ses üretilmez; sonunda 30 dakika ortam sesi eklenir.
      </p>
      <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
        {adaylar.map((b) => {
          const sira = secilenler.indexOf(b.id);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => degistir(b.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                sira >= 0 ? "border-[var(--accent)]/40 bg-[var(--accent)]/10" : "border-[var(--border)] hover:bg-white/[0.03]"
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                  sira >= 0 ? "border-[var(--accent)]/60 text-[var(--accent-light)]" : "border-white/15 text-transparent"
                }`}
              >
                {sira >= 0 ? sira + 1 : "·"}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-white/80">{baslik(b)}</span>
              <span className="shrink-0 text-[11px] text-white/35">{sureBicimle(b.sure_sn)}</span>
            </button>
          );
        })}
      </div>
      {secilenler.length > 0 && (
        <p className={`mt-2 text-[12px] ${saat > 4.5 ? "text-amber-100/70" : "text-white/50"}`}>
          {secilenler.length} bölüm · toplam {sureBicimle(toplamSn)}
          {saat > 4.5 ? " — 4,5 saati aşıyor; dosya ve yükleme çok büyür, bir bölüm çıkarmayı düşün." : ""}
        </p>
      )}
    </div>
  );
}

function istatistikParcalari(ist: Istatistik): string[] {
  const p: string[] = [];
  if (ist.goruntulenme != null) p.push(`${sayiBicimle(ist.goruntulenme)} izlenme`);
  if (ist.ort_sure_sn) p.push(`ort. ${Math.round(ist.ort_sure_sn / 60)} dk`);
  if (ist.tiklanma_orani != null) p.push(`TO %${ist.tiklanma_orani.toLocaleString("tr-TR")}`);
  if (ist.abone) p.push(`+${ist.abone} abone`);
  return p;
}

function IstatistikSatiri({ ist }: { ist: Istatistik }) {
  const p = istatistikParcalari(ist);
  if (!p.length) return null;
  return <p className="mt-1.5 text-[11.5px] text-white/40">{p.join(" · ")}</p>;
}

function IstatistikPaneli({ ist, zaman }: { ist: Istatistik; zaman: string | null }) {
  const kutular: [string, string][] = [
    ["İzlenme", ist.goruntulenme != null ? sayiBicimle(ist.goruntulenme) : "—"],
    ["İzlenme süresi", ist.izlenme_dk != null ? `${sayiBicimle(Math.round(ist.izlenme_dk / 60))} saat` : "—"],
    ["Ort. izleme", ist.ort_sure_sn ? `${Math.round(ist.ort_sure_sn / 60)} dk${ist.ort_yuzde ? ` · %${ist.ort_yuzde.toLocaleString("tr-TR")}` : ""}` : "—"],
    ["Gösterim", ist.gosterim != null ? sayiBicimle(ist.gosterim) : "—"],
    ["Tıklanma oranı", ist.tiklanma_orani != null ? `%${ist.tiklanma_orani.toLocaleString("tr-TR")}` : "—"],
    ["Abone", ist.abone != null ? `+${ist.abone}` : "—"],
  ];
  return (
    <section className="glass rounded-xl border border-[var(--border)] p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[12px] font-medium uppercase tracking-wider text-white/40">İstatistik</h3>
        {zaman && <span className="text-[11px] text-white/25">güncellendi {zamanOnce(zaman)} · YouTube verisi 2-3 gün gecikmeli</span>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {kutular.map(([ad, deger]) => (
          <div key={ad} className="rounded-lg border border-white/[0.06] px-3 py-2">
            <p className="text-[11px] text-white/35">{ad}</p>
            <p className="text-[15px] text-white/85">{deger}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function KalitePaneli({ rapor }: { rapor: KaliteRaporu }) {
  const renk = { ok: "text-[var(--accent-light)]/70", uyari: "text-amber-100/75", hata: "text-red-100/80" } as const;
  const isaret = { ok: "✓", uyari: "!", hata: "✕" } as const;
  return (
    <details className="glass rounded-xl border border-[var(--border)] px-4 py-3" open={rapor.sonuc !== "ok"}>
      <summary className="cursor-pointer select-none text-[12.5px] text-white/55">
        Teknik kontrol ·{" "}
        <span className={renk[rapor.sonuc]}>{rapor.sonuc === "ok" ? "sorun yok" : rapor.sonuc === "uyari" ? "uyarı var" : "hata var, otomatik yükleme durdu"}</span>
      </summary>
      <ul className="mt-2 space-y-1 text-[12px]">
        {rapor.kontroller.map((k) => (
          <li key={k.ad} className="flex gap-2">
            <span className={`w-3 shrink-0 text-center ${renk[k.durum]}`}>{isaret[k.durum]}</span>
            <span className="w-36 shrink-0 text-white/50">{k.ad}</span>
            <span className="min-w-0 text-white/70">{k.detay}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------- bölüm ayrıntısı

function BolumDetay({
  bolum,
  seriAdi,
  cevrimici,
  onGeri,
  onYama,
  onSil,
}: {
  bolum: Bolum;
  seriAdi: string;
  cevrimici: boolean;
  onGeri: () => void;
  onYama: (id: string, yama: Partial<Bolum>, mesaj?: string) => Promise<void>;
  onSil: () => void;
}) {
  return (
    <div className="animate-fade-in space-y-4">
      <button onClick={onGeri} className="flex items-center gap-1.5 text-[13px] text-white/50 transition-colors hover:text-white/80">
        <ArrowLeft size={14} />
        Bölümler
      </button>

      <section className="glass rounded-xl border border-[var(--border)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-white/35">
              {bolum.sure_dk} dk{bolum.sure_sn ? ` · üretilen ${sureBicimle(bolum.sure_sn)}` : ""} · seri: {seriAdi}
            </p>
            <h2 className="mt-1 text-[17px] font-semibold leading-snug text-white/95">{bolum.baslik ?? bolum.konu}</h2>
            {bolum.baslik && <p className="mt-0.5 text-[12.5px] text-white/45">{bolum.konu}</p>}
          </div>
          <DurumRozeti bolum={bolum} />
        </div>
        <IlerlemeCubugu bolum={bolum} />
        {!cevrimici && ["bekliyor", "onaylandi", "yayinla"].includes(bolum.durum) && (
          <p className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-[12px] text-amber-100/70">
            Stüdyo şu an çevrimdışı; bu iş bilgisayar açılınca devam eder.
          </p>
        )}
      </section>

      {bolum.durum === "senaryo_onay" && <SenaryoOnay bolum={bolum} onYama={onYama} />}
      {(bolum.durum === "hazir" || bolum.durum === "yayinla" || bolum.durum === "yayinda") && <YayinPaneli bolum={bolum} onYama={onYama} />}
      {bolum.durum === "hata" && (
        <section className="glass rounded-xl border border-red-300/20 p-4">
          <p className="text-[13px] leading-relaxed text-red-100/80">{hataMetni(bolum.hata) || "Bilinmeyen hata"}</p>
          <button
            onClick={() => onYama(bolum.id, { durum: tekrarDeneDurumu(bolum), hata: null, ilerleme: 0, adim: null }, "Yeniden sıraya alındı")}
            className={ikincilDugme + " mt-3"}
          >
            <RotateCcw size={14} />
            Tekrar dene
          </button>
        </section>
      )}
      {bolum.istatistik && <IstatistikPaneli ist={bolum.istatistik} zaman={bolum.istatistik_zaman ?? null} />}
      {bolum.kalite && <KalitePaneli rapor={bolum.kalite} />}
      {bolum.senaryo_md && bolum.durum !== "senaryo_onay" && <SenaryoOkuma md={bolum.senaryo_md} kelime={bolum.kelime} />}

      {bolum.gunluk.length > 0 && (
        <details className="glass rounded-xl border border-[var(--border)] px-4 py-3 text-[12px] text-white/45">
          <summary className="cursor-pointer select-none text-white/55">Stüdyo günlüğü</summary>
          <ul className="mt-2 space-y-1 font-mono text-[11.5px] leading-relaxed text-white/40">
            {bolum.gunluk.slice(-30).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex justify-end">
        <button onClick={onSil} className="flex items-center gap-1.5 text-[12px] text-white/30 transition-colors hover:text-red-200/80">
          <Trash2 size={12} />
          Bölümü sil
        </button>
      </div>
    </div>
  );
}

function SenaryoOnay({ bolum, onYama }: { bolum: Bolum; onYama: (id: string, yama: Partial<Bolum>, mesaj?: string) => Promise<void> }) {
  const [md, setMd] = useState(bolum.senaryo_md ?? "");
  const [duzenle, setDuzenle] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const degisti = md !== (bolum.senaryo_md ?? "");
  const sorunlar = useMemo(() => senaryoyuDogrula(md), [md]);
  const kelime = useMemo(() => kelimeSay(md), [md]);

  const onayla = async () => {
    if (sorunlar.length) return;
    setKaydediliyor(true);
    await onYama(bolum.id, { senaryo_md: md, kelime, durum: "onaylandi", adim: null, ilerleme: 0 }, "Onaylandı; seslendirme ve video hazırlanıyor.");
    setKaydediliyor(false);
  };

  return (
    <section className="glass rounded-xl border border-[var(--accent)]/25 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-medium text-white/85">Senaryo hazır — bir göz at</h3>
          <p className="text-[12px] text-white/40">
            {kelime} kelime · yaklaşık {Math.round(kelime / 104)} dakika anlatım
          </p>
        </div>
        <button onClick={() => setDuzenle((d) => !d)} className={ikincilDugme + " px-3 py-1.5 text-[12px]"}>
          <Pencil size={12} />
          {duzenle ? "Okuma" : "Düzenle"}
        </button>
      </div>

      {duzenle ? (
        <textarea value={md} onChange={(e) => setMd(e.target.value)} rows={24} className={girdiSinifi + " resize-y font-mono text-[12.5px] leading-relaxed"} />
      ) : (
        <SenaryoMetni md={md} />
      )}

      {bolum.arastirma_md && (
        <details className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <summary className="cursor-pointer list-none px-4 py-2.5 text-[12px] text-white/50 transition-colors hover:text-white/80">
            Araştırma notları — senaryodaki somut bilgiler buradan alındı
          </summary>
          <div className="border-t border-[var(--border)]">
            <ArastirmaNotlari md={bolum.arastirma_md} />
          </div>
        </details>
      )}

      {sorunlar.length > 0 && (
        <ul className="mt-3 space-y-1 text-[12px] text-amber-100/80">
          {sorunlar.map((s) => (
            <li key={s}>• {s}</li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
        {degisti && (
          <button onClick={() => setMd(bolum.senaryo_md ?? "")} className={ikincilDugme}>
            Değişiklikleri geri al
          </button>
        )}
        <button onClick={onayla} disabled={kaydediliyor || sorunlar.length > 0} className={birincilDugme}>
          {kaydediliyor ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {degisti ? "Kaydet ve seslendir" : "Onayla, seslendir"}
        </button>
      </div>
    </section>
  );
}

/** Bilgi dosyası: ## başlıklar, "- " maddeler, [güven] etiketleri ve kaynak adresleri. */
function ArastirmaNotlari({ md }: { md: string }) {
  const guvenRengi: Record<string, string> = {
    yüksek: "text-[var(--accent-light)]/70",
    orta: "text-white/40",
    tartışmalı: "text-amber-200/70",
  };
  return (
    <div className="max-h-[50vh] space-y-1.5 overflow-y-auto px-4 py-3 text-[12.5px] leading-relaxed text-white/65">
      {md.split("\n").map((satir, i) => {
        const t = satir.trim();
        if (!t) return null;
        if (t.startsWith("## ")) {
          return (
            <h4 key={i} className="pt-2 text-[11px] font-medium uppercase tracking-wider text-[var(--accent-light)]/60">
              {t.slice(3)}
            </h4>
          );
        }
        const madde = t.startsWith("- ") ? t.slice(2) : t;
        const url = madde.match(/https?:\/\/\S+/)?.[0];
        const guven = madde.match(/\[(yüksek|orta|tartışmalı)\]/)?.[1];
        const metin = madde.replace(/\[(yüksek|orta|tartışmalı)\]/, "").replace(url ?? "\u0000", "").replace(/\s+—\s*$/, "").trim();
        return (
          <p key={i} className={t.startsWith("- ") ? "pl-3" : ""}>
            {t.startsWith("- ") && <span className="-ml-3 mr-1.5 text-white/25">•</span>}
            {metin}
            {guven && <span className={`ml-1.5 text-[11px] ${guvenRengi[guven]}`}>[{guven}]</span>}
            {url && (
              <a href={url} target="_blank" rel="noreferrer" className="ml-1.5 text-[11px] text-white/35 underline-offset-2 hover:text-white/70 hover:underline">
                {new URL(url).hostname.replace(/^www\./, "")}
              </a>
            )}
          </p>
        );
      })}
    </div>
  );
}

/** Markdown'ı basitçe çizer: # başlık, ## bölüm, paragraflar. Zengin editör gerekmiyor. */
function SenaryoMetni({ md }: { md: string }) {
  const bloklar = md.split(/\n{2,}/);
  return (
    <div className="max-h-[60vh] space-y-3 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[13.5px] leading-relaxed text-white/75">
      {bloklar.map((b, i) => {
        const t = b.trim();
        if (!t) return null;
        if (t.startsWith("## ")) return <h4 key={i} className="pt-2 text-[12px] font-medium uppercase tracking-wider text-[var(--accent-light)]/70">{t.slice(3)}</h4>;
        if (t.startsWith("# ")) return <h3 key={i} className="text-[15px] font-semibold text-white/90">{t.slice(2)}</h3>;
        return <p key={i}>{t}</p>;
      })}
    </div>
  );
}

function SenaryoOkuma({ md, kelime }: { md: string; kelime: number | null }) {
  return (
    <details className="glass rounded-xl border border-[var(--border)] px-4 py-3">
      <summary className="cursor-pointer select-none text-[13px] text-white/60">Senaryo{kelime ? ` · ${kelime} kelime` : ""}</summary>
      <div className="mt-3">
        <SenaryoMetni md={md} />
      </div>
    </details>
  );
}

function YayinPaneli({ bolum, onYama }: { bolum: Bolum; onYama: (id: string, yama: Partial<Bolum>, mesaj?: string) => Promise<void> }) {
  const { addToast } = useToast();
  const [kapakYukleniyor, setKapakYukleniyor] = useState(false);
  const [baslik, setBaslik] = useState(bolum.yt_baslik ?? bolum.baslik ?? "");
  const [aciklama, setAciklama] = useState(bolum.yt_aciklama ?? "");
  const [gizlilik, setGizlilik] = useState<Gizlilik>(bolum.gizlilik);
  const [planli, setPlanli] = useState(!!bolum.yayin_zamani);
  const [yayinZamani, setYayinZamani] = useState(() => yerelTarihGirdisi(bolum.yayin_zamani ? new Date(bolum.yayin_zamani) : undefined));
  const [zamanGecersiz, setZamanGecersiz] = useState(false);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const yayinda = bolum.durum === "yayinda";
  const yukleniyor = bolum.durum === "yayinla";

  /**
   * Küçük resim: Storage'a (youtube/thumbnail/<id>) yüklenir, satıra yazılır;
   * stüdyo videoyu yayınladıktan sonra YouTube'a gönderir. 2 MB YouTube sınırı.
   */
  const kapakSec = async (dosya: File | undefined) => {
    if (!dosya) return;
    if (!/^image\/(jpeg|png)$/.test(dosya.type)) return addToast("JPG ya da PNG olmalı.", "error");
    if (dosya.size > 2 * 1024 * 1024) return addToast("Küçük resim 2 MB'dan büyük olamaz (YouTube sınırı).", "error");
    setKapakYukleniyor(true);
    const yol = `thumbnail/${bolum.id}.${dosya.type === "image/png" ? "png" : "jpg"}`;
    const { error } = await supabase.storage.from("youtube").upload(yol, dosya, { upsert: true, contentType: dosya.type });
    if (error) {
      setKapakYukleniyor(false);
      return addToast("Yüklenemedi: " + error.message, "error");
    }
    const url = supabase.storage.from("youtube").getPublicUrl(yol).data.publicUrl + `?v=${Date.now()}`;
    await onYama(bolum.id, { thumbnail_url: url }, "Küçük resim eklendi.");
    setKapakYukleniyor(false);
  };

  // Yüklenmiş ama henüz yayına girmemiş (planlı) videonun tarihi değiştirilebilir
  const planDuzenlenir = planliMi(bolum);
  const eskiZaman = bolum.yayin_zamani ? yerelTarihGirdisi(new Date(bolum.yayin_zamani)) : "";
  const tarihDegisti = planDuzenlenir && yayinZamani !== eskiZaman;
  const degisti =
    yayinda && (baslik.trim() !== (bolum.yt_baslik ?? bolum.baslik ?? "") || aciklama !== (bolum.yt_aciklama ?? "") || tarihDegisti);
  const youtubeGuncelle = async () => {
    setGonderiliyor(true);
    const yama: Partial<Bolum> = { yt_baslik: baslik.trim(), yt_aciklama: aciklama, yt_guncelle: true };
    if (tarihDegisti) yama.yayin_zamani = new Date(yayinZamani).toISOString();
    await onYama(
      bolum.id,
      yama,
      tarihDegisti
        ? `Stüdyo YouTube'u güncelliyor; yeni yayın zamanı ${tarihBicimle(yama.yayin_zamani!)}.`
        : "Stüdyo YouTube'daki başlık ve açıklamayı güncelliyor.",
    );
    setGonderiliyor(false);
  };

  const yukle = async () => {
    setGonderiliyor(true);
    const zaman = planli ? new Date(yayinZamani).toISOString() : null;
    await onYama(
      bolum.id,
      { yt_baslik: baslik.trim(), yt_aciklama: aciklama, gizlilik: planli ? "public" : gizlilik, yayin_zamani: zaman, durum: "yayinla", ilerleme: 0, adim: null },
      planli ? `Stüdyo yüklüyor; YouTube ${tarihBicimle(zaman!)} tarihinde yayınlayacak.` : "Stüdyo YouTube'a yüklüyor.",
    );
    setGonderiliyor(false);
  };

  return (
    <section className={`glass rounded-xl border p-4 ${yayinda ? "border-[var(--border)]" : "border-[var(--accent)]/25"}`}>
      {bolum.onizleme_url && (
        <div className="mb-4 overflow-hidden rounded-lg border border-[var(--border)] bg-black/40">
          <video ref={videoRef} src={bolum.onizleme_url} controls preload="metadata" className="aspect-video w-full" />
          <p className="px-3 py-1.5 text-[11px] text-white/35">
            İlk dakika. Tam video {sureBicimle(bolum.sure_sn)}
            {bolum.durum === "yayinda" ? " — YouTube'da" : " — stüdyoda hazır"}.
          </p>
        </div>
      )}

      {yayinda ? (
        <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-white/85">{bolum.yt_baslik ?? bolum.baslik}</p>
            <p className="truncate text-[12px] text-white/40">
              {yayinDurumu(bolum)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:flex-nowrap">
            <button
              onClick={() => onYama(bolum.id, { kapak_istek: true }, "Stüdyo yeni kapağı üretip YouTube'da değiştirecek.")}
              disabled={bolum.kapak_istek}
              title="Yeni kapak üret ve YouTube'daki küçük resmi değiştir"
              className={ikincilDugme}
            >
              {bolum.kapak_istek ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Kapak
            </button>
            {bolum.drive_url && (
              <a href={bolum.drive_url} target="_blank" rel="noreferrer" className={ikincilDugme} title="Ses ve senaryo yedeği">
                Drive
              </a>
            )}
            {bolum.youtube_url && (
              <a href={bolum.youtube_url} target="_blank" rel="noreferrer" className={birincilDugme}>
                <ExternalLink size={14} />
                YouTube&apos;da aç
              </a>
            )}
          </div>
        </div>
        <details className="group">
          <summary className="cursor-pointer list-none text-[12px] text-white/40 transition-colors hover:text-white/70">
            <span className="inline-flex items-center gap-1.5">
              <Pencil size={12} /> {planDuzenlenir ? "Başlık, açıklama ve yayın zamanını düzenle" : "Başlık ve açıklamayı düzenle"}
            </span>
          </summary>
          <div className="mt-3 space-y-3">
            {planDuzenlenir && (
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wider text-white/35">Yayın zamanı</label>
                <input
                  type="datetime-local"
                  value={yayinZamani}
                  onChange={(e) => {
                    setYayinZamani(e.target.value);
                    setZamanGecersiz(new Date(e.target.value).getTime() < Date.now());
                  }}
                  disabled={bolum.yt_guncelle}
                  className={girdiSinifi + " sm:w-60"}
                />
              </div>
            )}
            <input value={baslik} onChange={(e) => setBaslik(e.target.value)} maxLength={100} disabled={bolum.yt_guncelle} className={girdiSinifi} />
            <textarea value={aciklama} onChange={(e) => setAciklama(e.target.value)} rows={6} disabled={bolum.yt_guncelle} className={girdiSinifi + " resize-y text-[12.5px] leading-relaxed"} />
            <div className="flex justify-end">
              <button
                onClick={youtubeGuncelle}
                disabled={gonderiliyor || bolum.yt_guncelle || !degisti || baslik.trim().length < 3 || (tarihDegisti && zamanGecersiz)}
                className={birincilDugme}
              >
                {gonderiliyor || bolum.yt_guncelle ? <Loader2 size={14} className="animate-spin" /> : <Youtube size={14} />}
                {bolum.yt_guncelle ? "Güncelleniyor" : "YouTube'da güncelle"}
              </button>
            </div>
          </div>
        </details>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-white/35">Başlık</label>
            <input value={baslik} onChange={(e) => setBaslik(e.target.value)} maxLength={100} disabled={yukleniyor} className={girdiSinifi} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-white/35">Açıklama</label>
            <textarea value={aciklama} onChange={(e) => setAciklama(e.target.value)} rows={8} disabled={yukleniyor} className={girdiSinifi + " resize-y text-[12.5px] leading-relaxed"} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-white/35">Küçük resim (isteğe bağlı)</label>
            <div className="flex flex-wrap items-center gap-3">
              <label className={`${ikincilDugme} cursor-pointer px-3 py-2 text-[12px]`}>
                {kapakYukleniyor ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
                {bolum.thumbnail_url ? "Değiştir" : "Görsel seç"}
                <input type="file" accept="image/jpeg,image/png" className="hidden" disabled={yukleniyor || kapakYukleniyor} onChange={(e) => kapakSec(e.target.files?.[0])} />
              </label>
              <button
                onClick={() => onYama(bolum.id, { kapak_istek: true }, "Stüdyo kapağı üretiyor (~1 dk).")}
                disabled={yukleniyor || kapakYukleniyor || bolum.kapak_istek}
                title="Konuya uygun illüstrasyon + başlık; kanal kimliğiyle otomatik"
                className={`${ikincilDugme} px-3 py-2 text-[12px]`}
              >
                {bolum.kapak_istek ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {bolum.kapak_istek ? "Üretiliyor" : bolum.thumbnail_url ? "Yeniden üret" : "Otomatik üret"}
              </button>
              {bolum.thumbnail_url ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={bolum.thumbnail_url} alt="" className="h-12 w-[85px] rounded-md border border-[var(--border)] object-cover" />
                  <button onClick={() => onYama(bolum.id, { thumbnail_url: null })} disabled={yukleniyor} className="text-[12px] text-white/35 hover:text-red-200/80">
                    Kaldır
                  </button>
                </>
              ) : (
                <span className="text-[11.5px] text-white/30">Video hazır olunca otomatik üretilir; istersen kendi görselini seç (1280×720, JPG/PNG, ≤ 2 MB).</span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="sm:flex-1">
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-white/35">Yayın</label>
              <Secici
                deger={planli ? "planli" : "hemen"}
                onChange={(v) => setPlanli(v === "planli")}
                disabled={yukleniyor}
                secenekler={[
                  { deger: "hemen", etiket: "Yüklenince yayınla" },
                  { deger: "planli", etiket: "Tarih planla", aciklama: "Gizli yüklenir, YouTube o saatte herkese açar" },
                ]}
              />
            </div>
            <div className="sm:flex-1">
              {planli ? (
                <>
                  <label className="mb-1 block text-[11px] uppercase tracking-wider text-white/35">Yayın zamanı</label>
                  <input
                    type="datetime-local"
                    value={yayinZamani}
                    onChange={(e) => {
                      setYayinZamani(e.target.value);
                      setZamanGecersiz(new Date(e.target.value).getTime() < Date.now());
                    }}
                    disabled={yukleniyor}
                    className={girdiSinifi}
                  />
                </>
              ) : (
                <>
                  <label className="mb-1 block text-[11px] uppercase tracking-wider text-white/35">Kim görsün</label>
                  <Secici
                    deger={gizlilik}
                    onChange={setGizlilik}
                    disabled={yukleniyor}
                    secenekler={(Object.keys(GIZLILIK_ETIKETI) as Gizlilik[]).map((g) => ({ deger: g, etiket: GIZLILIK_ETIKETI[g] }))}
                  />
                </>
              )}
            </div>
            <button
              onClick={yukle}
              disabled={gonderiliyor || yukleniyor || baslik.trim().length < 3 || (planli && zamanGecersiz)}
              className={birincilDugme + " sm:w-44"}
            >
              {yukleniyor || gonderiliyor ? <Loader2 size={14} className="animate-spin" /> : planli ? <CalendarClock size={14} /> : <Upload size={14} />}
              {yukleniyor ? "Yükleniyor" : planli ? "Yükle ve planla" : "YouTube'a yükle"}
            </button>
          </div>
          {bolum.yt_etiketler.length > 0 && (
            <p className="text-[11.5px] text-white/30">Etiketler: {bolum.yt_etiketler.join(", ")}</p>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- seriler

function SerilerEkrani({
  seriler,
  sahneler,
  bolumler,
  onKaydet,
  onSil,
  onSahnelereGit,
}: {
  seriler: Seri[];
  sahneler: Sahne[];
  bolumler: Bolum[];
  onKaydet: (yeni: Partial<Seri>, id?: string) => Promise<void>;
  onSil: (s: Seri) => void;
  onSahnelereGit: () => void;
}) {
  const [duzenlenen, setDuzenlenen] = useState<string | null>(null);
  const [yeniAcik, setYeniAcik] = useState(false);

  return (
    <div className="animate-fade-in space-y-6">
      <section className="glass rounded-xl border border-[var(--border)] p-4">
        {/* Başlık satırı diğer bölümlerin başlığıyla aynı yükseklikte kalsın: buton küçük metin düğmesi */}
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[13px] font-medium text-white/80">
            <Layers size={14} className="text-[var(--accent)]/80" />
            Seriler
          </h2>
          {!yeniAcik && (
            <button
              onClick={() => setYeniAcik(true)}
              className="-my-1 flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-[var(--accent-light)]/75 transition-colors hover:bg-white/[0.05] hover:text-[var(--accent-light)]"
            >
              <Plus size={13} />
              Yeni seri
            </button>
          )}
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-white/40">
          Seri, bölümlerin konu evrenini ve anlatım kalıbını belirler; arkada dönen sahneyi de seriden alır.
        </p>
        {yeniAcik && (
          <div className="mt-4">
            <SeriFormu
              sahneler={sahneler}
              onIptal={() => setYeniAcik(false)}
              onKaydet={async (v) => {
                await onKaydet(v);
                setYeniAcik(false);
              }}
              onSahnelereGit={onSahnelereGit}
            />
          </div>
        )}
      </section>

      {seriler.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-white/35">Henüz seri yok.</p>
      ) : (
        <div className="space-y-2">
          {seriler.map((s) => {
            const havuz = seriHavuzu(s).map((id) => sahneler.find((sh) => sh.id === id)).filter((x): x is Sahne => !!x);
            const sahne = havuz[0] ?? null;
            const aktif = havuz.filter((sh) => sahneKullanimi(sh.id, bolumler) < SAHNE_KULLANIM_SINIRI).length;
            const adet = bolumler.filter((b) => b.seri_id === s.id).length;
            const acik = duzenlenen === s.id;
            return (
              <div key={s.id} className="glass rounded-xl border border-[var(--border)] p-3">
                <div className="flex items-center gap-3">
                  <div className="h-14 w-24 shrink-0 overflow-hidden rounded-lg border border-[var(--border)] bg-black/30">
                    {sahne?.kapak_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sahne.kapak_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-white/20">
                        <Film size={14} />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-white/90">{s.ad}</p>
                    <p className="truncate text-[12px] text-white/40">{s.aciklama || KALIP_ETIKETI[s.kalip]}</p>
                    <p className="mt-0.5 text-[11px] text-white/30">
                      {adet} bölüm · {s.sure_dk} dk · {havuz.length > 1 ? `${havuz.length} sahne dönüşümde` : `sahne: ${sahne?.ad ?? "seçilmedi"}`}
                      {sahne && sahne.loop_durum !== "hazir" ? " (hazırlanıyor)" : ""}
                    </p>
                    {havuz.length > 0 && aktif < 2 && (
                      <p className="mt-0.5 text-[11px] text-amber-100/70">
                        {aktif === 0 ? "Bütün sahneler emekli — yeni sahne ekleyin." : "Dönüşüm için en az bir sahne daha ekleyin."}
                      </p>
                    )}
                  </div>
                  <button onClick={() => setDuzenlenen(acik ? null : s.id)} className="shrink-0 p-1.5 text-white/25 transition-colors hover:text-white/70" title="Düzenle">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => onSil(s)} className="shrink-0 p-1.5 text-white/25 transition-colors hover:text-red-200/80" title="Seriyi sil">
                    <Trash2 size={13} />
                  </button>
                </div>
                {acik && (
                  <div className="mt-3 border-t border-[var(--border)] pt-3">
                    <SeriFormu
                      seri={s}
                      sahneler={sahneler}
                      onIptal={() => setDuzenlenen(null)}
                      onKaydet={async (v) => {
                        await onKaydet(v, s.id);
                        setDuzenlenen(null);
                      }}
                      onSahnelereGit={onSahnelereGit}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SeriFormu({
  seri,
  sahneler,
  onKaydet,
  onIptal,
  onSahnelereGit,
}: {
  seri?: Seri;
  sahneler: Sahne[];
  onKaydet: (v: Partial<Seri>) => Promise<void>;
  onIptal: () => void;
  onSahnelereGit: () => void;
}) {
  const [ad, setAd] = useState(seri?.ad ?? "");
  const [aciklama, setAciklama] = useState(seri?.aciklama ?? "");
  const [kalip, setKalip] = useState<Kalip>(seri?.kalip ?? "aciklayici");
  const [secili, setSecili] = useState<string[]>(() => (seri ? seriHavuzu(seri) : sahneler[0] ? [sahneler[0].id] : []));
  const secimDegistir = (id: string) => setSecili((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  const [sure, setSure] = useState<number>(seri?.sure_dk ?? 60);
  const [kapakStil, setKapakStil] = useState(seri?.kapak_stil ?? "");
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const gonder = async () => {
    if (ad.trim().length < 2) return;
    setKaydediliyor(true);
    if (secili.length === 0) return;
    await onKaydet({
      ad: ad.trim(),
      aciklama: aciklama.trim() || null,
      kalip,
      sahne_id: secili[0] ?? null,
      sahne_idler: secili,
      sure_dk: sure,
      kapak_stil: kapakStil.trim() || null,
    });
    setKaydediliyor(false);
  };

  return (
    <div className="space-y-3">
      <input value={ad} onChange={(e) => setAd(e.target.value)} placeholder="Seri adı — örn. Bir Gece Orada Olsaydın" className={girdiSinifi} />
      <textarea
        value={aciklama}
        onChange={(e) => setAciklama(e.target.value)}
        rows={2}
        placeholder="Konu evreni: seride ne anlatılıyor? (senaryonun tonuna girer)"
        className={girdiSinifi + " resize-none leading-relaxed"}
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="sm:flex-1">
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-white/35">Anlatım kalıbı</label>
          <Secici deger={kalip} onChange={setKalip} secenekler={(Object.keys(KALIP_ETIKETI) as Kalip[]).map((k) => ({ deger: k, etiket: KALIP_ETIKETI[k] }))} />
        </div>
        <div className="sm:w-40">
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-white/35">Varsayılan süre</label>
          <Secici deger={sure} onChange={setSure} secenekler={SURE_SECENEKLERI.map((d) => ({ deger: d as number, etiket: `${d} dakika` }))} />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-[11px] uppercase tracking-wider text-white/35">Sahneler (dönüşüm havuzu)</label>
        {sahneler.length === 0 ? (
          <p className="text-[12.5px] text-white/40">
            Önce bir sahne lazım.{" "}
            <button onClick={onSahnelereGit} className="text-[var(--accent-light)]/80 underline-offset-2 hover:underline">
              Sahne ekle
            </button>
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {sahneler.map((sh) => {
                const on = secili.includes(sh.id);
                return (
                  <button
                    key={sh.id}
                    type="button"
                    onClick={() => secimDegistir(sh.id)}
                    className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-[12px] transition-colors ${
                      on ? "border-[var(--accent)]/50 bg-[var(--accent)]/15 text-[var(--accent-light)]" : "border-[var(--border)] text-white/50 hover:text-white/80"
                    }`}
                  >
                    {sh.kapak_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sh.kapak_url} alt="" className="h-6 w-10 rounded object-cover" />
                    )}
                    {sh.ad}
                    {sh.loop_durum !== "hazir" && <span className="text-white/30">(hazırlanıyor)</span>}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-white/30">
              Birden fazla seçersen stüdyo her bölümde sırayla seçer: art arda aynı sahne gelmez, bir sahne en fazla {SAHNE_KULLANIM_SINIRI} bölümde kullanılır.
            </p>
          </>
        )}
      </div>
      <div>
        <label className="mb-1 block text-[11px] uppercase tracking-wider text-white/35">Kapak stili (isteğe bağlı)</label>
        <textarea
          value={kapakStil}
          onChange={(e) => setKapakStil(e.target.value)}
          rows={2}
          placeholder="Boş bırak: stüdyo bu seriye özel bir kapak kimliği (teknik + palet) üretsin. Kendin yazmak istersen İngilizce teknik + palet — örn. antique black-figure print, amber-ochre and black. Her bölümde konunun dönemine göre değişsin istiyorsan: konuya göre"
          className={girdiSinifi + " resize-none text-[12.5px] leading-relaxed"}
        />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onIptal} className={`${ikincilDugme} px-3 py-2 text-[12px]`}>
          Vazgeç
        </button>
        <button onClick={gonder} disabled={kaydediliyor || ad.trim().length < 2} className={birincilDugme}>
          {kaydediliyor ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Kaydet
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- sahneler

function SahnelerEkrani({
  sahneler,
  seriler,
  bolumler,
  onYeni,
  onSil,
}: {
  sahneler: Sahne[];
  seriler: Seri[];
  bolumler: Bolum[];
  onYeni: (ad: string, sahne: string, aciklama: string) => Promise<void>;
  onSil: (s: Sahne) => void;
}) {
  const [ad, setAd] = useState("");
  const [sahne, setSahne] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [acikSahne, setAcikSahne] = useState<string | null>(null);

  const gonder = async () => {
    if (ad.trim().length < 2 || sahne.trim().length < 10) return;
    setGonderiliyor(true);
    await onYeni(ad.trim(), sahne.trim(), aciklama.trim());
    setAd("");
    setSahne("");
    setAciklama("");
    setGonderiliyor(false);
  };

  return (
    <div className="animate-fade-in space-y-6">
      <section className="glass rounded-xl border border-[var(--border)] p-4">
        <h2 className="mb-1 flex items-center gap-2 text-[13px] font-medium text-white/80">
          <Plus size={14} className="text-[var(--accent)]/80" />
          Yeni sahne
        </h2>
        <p className="mb-3 text-[12px] leading-relaxed text-white/40">
          Bölüm boyunca arkada dönen tek görsel. Bir kez üretilir, sonraki her bölümde kullanılır. Şömine ışığı ve camda yağmur her sahneye kendiliğinden eklenir; sen sadece odayı/mekânı tarif et.
        </p>
        <div className="space-y-2">
          <input value={ad} onChange={(e) => setAd(e.target.value)} placeholder="Sahne adı — örn. Kış Kulübesi" className={girdiSinifi} />
          <textarea
            value={sahne}
            onChange={(e) => setSahne(e.target.value)}
            rows={3}
            placeholder="Mekân — örn. Ahşap bir dağ kulübesinin içi; yün battaniyeli koltuk, masada bir fincan çay, pencerede gece"
            className={girdiSinifi + " resize-none leading-relaxed"}
          />
          <input value={aciklama} onChange={(e) => setAciklama(e.target.value)} placeholder="Kısa not (isteğe bağlı) — sadece listede görünür" className={girdiSinifi} />
          <div className="flex justify-end">
            <button onClick={gonder} disabled={gonderiliyor || ad.trim().length < 2 || sahne.trim().length < 10} className={birincilDugme}>
              {gonderiliyor ? <Loader2 size={14} className="animate-spin" /> : <Layers size={14} />}
              Sahneyi ekle
            </button>
          </div>
        </div>
      </section>

      {sahneler.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-white/35">Henüz sahne yok.</p>
      ) : (
        <div className="space-y-2">
          {sahneler.map((s) => {
            const adet = seriler.filter((x) => seriHavuzu(x).includes(s.id)).length;
            const kullanim = sahneKullanimi(s.id, bolumler);
            const emekli = kullanim >= SAHNE_KULLANIM_SINIRI;
            const acik = acikSahne === s.id && !!s.onizleme_url;
            return (
              <div key={s.id} className="glass rounded-xl border border-[var(--border)] p-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => s.onizleme_url && setAcikSahne(acik ? null : s.id)}
                  disabled={!s.onizleme_url}
                  title={s.onizleme_url ? (acik ? "Önizlemeyi kapat" : "Loop'u izle") : s.loop_durum === "hazir" ? "Önizleme hazırlanıyor" : undefined}
                  className="group relative h-14 w-24 shrink-0 overflow-hidden rounded-lg border border-[var(--border)] bg-black/30 disabled:cursor-default"
                >
                  {s.kapak_url ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.kapak_url} alt="" className="h-full w-full object-cover" />
                      {s.onizleme_url && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white/85 opacity-80 transition-opacity group-hover:opacity-100">
                          {acik ? <X size={16} /> : <Play size={16} fill="currentColor" />}
                        </span>
                      )}
                    </>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-white/20">
                      {s.loop_durum === "uretiliyor" ? <Loader2 size={14} className="animate-spin" /> : <Film size={14} />}
                    </div>
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-white/90">{s.ad}</p>
                  <p className="truncate text-[12px] text-white/40">{s.aciklama || s.sahne}</p>
                  <p className="mt-0.5 text-[11px] text-white/30">
                    {adet} seri · {kullanim}/{SAHNE_KULLANIM_SINIRI} bölüm{emekli && <span className="text-amber-100/70"> · emekli</span>} ·{" "}
                    {s.loop_durum === "hazir" ? "hazır" : s.loop_durum === "uretiliyor" ? "görsel üretiliyor" : s.loop_durum === "hata" ? `hata: ${s.hata ?? ""}` : "sırada"}
                  </p>
                </div>
                <button onClick={() => onSil(s)} className="shrink-0 p-1.5 text-white/25 transition-colors hover:text-red-200/80" title="Sahneyi sil">
                  <Trash2 size={13} />
                </button>
              </div>
              {acik && (
                <div className="mt-3 overflow-hidden rounded-lg border border-[var(--border)] bg-black">
                  <video src={s.onizleme_url!} controls autoPlay loop muted playsInline className="aspect-video w-full" />
                  <p className="px-3 py-1.5 text-[11px] text-white/35">Loop 3 kez üst üste — ek yeri buradan kontrol edilir. Videoda 4K, sessiz.</p>
                </div>
              )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
