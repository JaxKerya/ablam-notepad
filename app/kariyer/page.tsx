"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  ArrowLeft,
  Briefcase,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  CircleCheckBig,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { useToast } from "@/components/Toast";
import BahceLogo, { MODUL_PALETLERI } from "@/components/BahceLogo";
import {
  BOS_PROFIL,
  kalanGun,
  KARIYER_ACIK,
  kaynakEtiketi,
  konumdakiIller,
  ONIZLEME_ANAHTARI,
  profilBosMu,
  profilDogrula,
  sadelestir,
  sehirleriDogrula,
  sonBasvuruMetni,
  takipGerekli,
  tarihMetni,
  type BasvuruDurumu,
  type GeriBildirim,
  type ProfilOnerisi,
  type KariyerProfili,
  type Karar,
  type Risk,
} from "@/lib/kariyer";

// İki ekran: Profil ve Eşleşmeler. Ablam çoğunlukla ikincisine gelecek;
// birincisi kurulumda ve ara sıra düzeltmede kullanılır.

type Sekme = "eslesmeler" | "tumu" | "basvurular" | "profil";

/** Embedded ad row -> Eslesme["ilan"]; a removed ad keeps its record but loses its dead link */
function ilanNormalle(ham: unknown): Eslesme["ilan"] {
  const ilan = (Array.isArray(ham) ? ham[0] : ham) as Eslesme["ilan"];
  return ilan?.kaldirildi ? { ...ilan, url: null } : ilan;
}

interface Eslesme {
  ilan_id: string;
  puan: number;
  gerekce: string | null;
  uyusan: string[];
  uyusmayan: string[];
  karar: Karar;
  geri_bildirim: GeriBildirim | null;
  geri_bildirim_notu: string | null;
  /** İlan güvenilirliği: kritik/orta bayrak ve kısa sebepleri (eski satırlarda boş) */
  risk: Risk | null;
  uyarilar: string[];
  /** Başvuru takibi — ablam işaretler */
  basvuru_durumu: BasvuruDurumu | null;
  basvuru_ts: string | null;
  basvuru_hatirlatma: string | null;
  degerlendirildi: string;
  ilan: {
    baslik: string;
    sirket: string | null;
    sehir: string | null;
    url: string | null;
    kaynak: string;
    son_basvuru: string | null;
    /** Set by the worker when the ad left its source (Careerjet: the link then 404s) */
    kaldirildi?: string | null;
  };
}

interface ProfilSatiri {
  serbest_metin: string | null;
  profil: KariyerProfili | null;
  sehirler: string[];
  uzaktan_olur: boolean;
  bildirim_eposta: string | null;
  updated_at: string | null;
}

interface Tarama {
  kaynak: string;
  baslangic: string;
  bitis: string | null;
  bulunan: number;
  yeni: number;
  hata: string | null;
  /** Son tarama 3 saatten eski — veri gelirken hesaplanıyor (render saf kalsın) */
  sessiz: boolean;
}

/** Kaynak başına durum — şerit yalnızca son kaynağa bakıyordu, biri kırıkken diğeri sağlam görünüyordu */
interface KaynakDurumu {
  kaynak: string;
  /** Son başarılı bitiş */
  sonBasari: string | null;
  bulunan: number;
  /** En son satır hatalıysa metni */
  sonHata: string | null;
  /** Kaynağın kendi aralığına göre gecikmiş mi (İŞKUR 6 sa, LinkedIn 12 sa, diğerleri 1 sa; +2 sa pay) */
  bayat: boolean;
}

const KAYNAK_ARALIK_SAAT: Record<string, number> = { iskur: 6, linkedin: 12, eleman: 3, kamuilan: 3, yerelyonetim: 3, jooble: 3, adalet: 6, osym: 6, iskurkamu: 6 };

function kaynakDurumlari(satirlar: Tarama[]): KaynakDurumu[] {
  const simdi = Date.now();
  const gruplar = new Map<string, Tarama[]>();
  for (const t of satirlar) {
    if (t.kaynak === "nabiz" || t.kaynak === "ozet") continue;
    gruplar.set(t.kaynak, [...(gruplar.get(t.kaynak) ?? []), t]);
  }
  return [...gruplar.entries()].map(([kaynak, liste]) => {
    const sonBasarili = liste.find((t) => !t.hata && t.bitis);
    const enSon = liste[0];
    const aralik = (KAYNAK_ARALIK_SAAT[kaynak] ?? 1) + 2;
    return {
      kaynak,
      sonBasari: sonBasarili?.bitis ?? null,
      bulunan: sonBasarili?.bulunan ?? 0,
      sonHata: enSon?.hata ?? null,
      bayat: !sonBasarili || simdi - new Date(sonBasarili.bitis!).getTime() > aralik * 3600_000,
    };
  });
}

const SIRA: Karar[] = ["bildir", "ozet", "listele"];

// Decision tone (local redefinition): no borders, no amber; the colour only says how well it fits.
const KARAR_STIL: Record<Karar, string> = {
  bildir: "bg-[var(--accent)]/15 text-[var(--accent-light)]",
  ozet: "bg-white/[0.08] text-[var(--k-t1)]",
  listele: "bg-white/[0.05] text-[var(--k-t2)]",
  ele: "bg-white/[0.03] text-[var(--k-t3)]",
};

/** Page-only group names: plain, non-judging, same wording as the e-mail. DB values stay as they are. */
const GRUP: Record<Karar, { etiket: string; aciklama: string }> = {
  bildir: { etiket: "Sana çok uygun", aciklama: "Profilinle en çok örtüşenler; önce bunlara bak" },
  ozet: { etiket: "Bakmaya değer", aciklama: "Kısmen uyuyor, bir göz at" },
  listele: { etiket: "Daha az uygun", aciklama: "Uyumu düşük; vaktin olursa bak" },
  // Never shown as a group (the list excludes "ele"); only counted in the full list
  ele: { etiket: "Uymadı", aciklama: "" },
};

/**
 * Local soft-contrast tokens. Set on <main> and again on the portal panel,
 * which is mounted on document.body and would not inherit them otherwise.
 * Text levels are tuned for small type on the sage background: t2 stays near
 * 4.5:1 on plain sage, t3 only on darker surfaces (cards, panels) where it
 * clears 4.5:1. Softness comes from weight and size, not from low opacity.
 */
const KARIYER_TOKENLARI = {
  "--k-t1": "var(--foreground)",
  "--k-t2": "rgba(255,255,255,.90)",
  "--k-t3": "rgba(255,255,255,.78)",
  "--k-card": "rgba(0,0,0,.14)",
  "--k-card-open": "rgba(0,0,0,.20)",
  "--k-hair": "rgba(255,255,255,.07)",
  // Darker than the page so chip text keeps its contrast (a light chip washed it out)
  "--k-chip": "rgba(0,0,0,.12)",
  "--k-chip-hover": "rgba(0,0,0,.20)",
  "--k-chip-on": "rgb(var(--accent-rgb) / .18)",
} as React.CSSProperties;

/** Visible keyboard focus for every button and link */
const ODAK =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-rgb)/0.7)]";

/**
 * Same focus look for text fields. Not the global .focus-ring: its unlayered
 * `outline: none` would beat these utilities.
 */
const GIRDI_ODAK =
  "transition-colors focus:border-[rgb(var(--accent-rgb)/0.5)] focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-[rgb(var(--accent-rgb)/0.7)]";

/** Shared chip style: filter chips and reason chips look the same */
const cipSinifi = (aktif: boolean) =>
  `flex h-10 items-center gap-1 rounded-full px-3.5 text-[12.5px] transition-colors ${ODAK} ${
    aktif ? "bg-[var(--k-chip-on)] text-[var(--accent-light)]" : "bg-[var(--k-chip)] text-[var(--k-t2)] hover:bg-[var(--k-chip-hover)] hover:text-[var(--k-t1)]"
  }`;

/** Remembered open/closed choice for the "Daha az uygun" group */
const ZAYIF_ANAHTARI = "kariyer-zayif-acik";

export default function KariyerSayfasi() {
  // Bölüm kapalıysa "yakında" ekranı. ?onizleme=1 ile gelen (geliştiren kişi)
  // görür; tercih localStorage'da kalır, sonraki girişlerde sormaz.
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
        // gizli pencere vb. — görmesin
      }
      setGorunum(onizleme ? "acik" : "yakinda");
    });
  }, []);

  if (gorunum !== "acik") return <YakindaEkrani gizli={gorunum === "bilinmiyor"} />;
  return <KariyerUygulamasi />;
}

function YakindaEkrani({ gizli }: { gizli: boolean }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-x-hidden px-5">
      <AnaSayfaDugmesi />
      <div className={`animate-fade-in motion-reduce:animate-none flex flex-col items-center text-center transition-opacity ${gizli ? "opacity-0" : ""}`}>
        <h1 className="sr-only">Ablam Kariyer</h1>
        <BahceLogo metin="Ablam Kariyer" palet={MODUL_PALETLERI.kariyer} yukseklik={200} className="w-[min(36rem,90vw)]" />
        <span className="-mt-6 rounded-full border border-[var(--accent)]/25 bg-[var(--accent)]/10 px-3 py-1 text-[12px] font-medium text-[var(--accent-light)]/85">
          Yakında
        </span>
      </div>
    </main>
  );
}

function KariyerUygulamasi() {
  const { addToast } = useToast();
  const [sekme, setSekme] = useState<Sekme>("eslesmeler");
  const [yukleniyor, setYukleniyor] = useState(true);
  const [profilSatiri, setProfilSatiri] = useState<ProfilSatiri | null>(null);
  const [eslesmeler, setEslesmeler] = useState<Eslesme[]>([]);
  const [sonTarama, setSonTarama] = useState<Tarama | null>(null);
  const [tumu, setTumu] = useState<Eslesme[] | null>(null);
  /** Başvurulmuş ilanlar — ayrı sorgu: eşleşme listesi 200 ile sınırlı ve "ele"yi dışlıyor, başvurular hepsinden olabilir */
  const [basvurular, setBasvurular] = useState<Eslesme[] | null>(null);
  const [basvuruSayisi, setBasvuruSayisi] = useState(0);
  /** Başvuru listesinin yüklendiği an — gün hesabı render içinde Date.now() çağırmasın */
  const [basvuruZamani, setBasvuruZamani] = useState(0);
  const [toplamInceleme, setToplamInceleme] = useState<number | null>(null);
  const [kaynaklar, setKaynaklar] = useState<KaynakDurumu[]>([]);
  /** Eşleşme sorgusu düştü — boş liste "ilan yok" gibi görünmesin (inceleme bulgusu) */
  const [listeHatasi, setListeHatasi] = useState<string | null>(null);
  /** Bugünün toplamı (TR günü): kaç kaynak koştu, kaç yeni ilan geldi — şerit tek kaynağı değil günü anlatsın */
  const [bugun, setBugun] = useState<{ kaynak: number; yeni: number } | null>(null);
  /** Verinin yüklendiği an — "son 24 saat" eşiği render içinde Date.now() çağırmasın (saf kalsın) */
  const [yuklenmeZamani, setYuklenmeZamani] = useState(0);
  /**
   * Son ziyaret: tarayıcıda tutulur. Sayfa açılınca önceki değer okunur (o
   * zamandan sonra puanlanan kartlar "yeni"), şimdiki zaman yazılır. Bu
   * tarayıcıya özgü — ablamın telefonuyla bilgisayarı ayrı sayar, kabul.
   */
  const [sonZiyaret, setSonZiyaret] = useState<string | null>(null);
  const [secilenSehirler, setSecilenSehirler] = useState<string[]>([]);
  const [son24, setSon24] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        setSonZiyaret(localStorage.getItem("kariyer-son-ziyaret"));
        localStorage.setItem("kariyer-son-ziyaret", new Date().toISOString());
        const s = localStorage.getItem("kariyer-suzgec");
        if (s) {
          const v = JSON.parse(s) as { sehirler?: string[]; son24?: boolean };
          setSecilenSehirler(Array.isArray(v.sehirler) ? v.sehirler : []);
          setSon24(!!v.son24);
        }
      } catch {
        // gizli pencere vb.
      }
    });
  }, []);

  const suzgecYaz = (sehirler: string[], s24: boolean) => {
    setSecilenSehirler(sehirler);
    setSon24(s24);
    try {
      localStorage.setItem("kariyer-suzgec", JSON.stringify({ sehirler, son24: s24 }));
    } catch {
      // yazılamazsa oturumluk kalır
    }
  };

  const getir = useCallback(async () => {
    const [p, e, t, n, b] = await Promise.all([
      supabase.from("kariyer_profil").select("*").eq("id", 1).maybeSingle(),
      supabase
        .from("kariyer_eslesmeler")
        .select(
          "ilan_id, puan, gerekce, uyusan, uyusmayan, karar, geri_bildirim, geri_bildirim_notu, risk, uyarilar, basvuru_durumu, basvuru_ts, basvuru_hatirlatma, degerlendirildi, kariyer_ilanlar!inner(baslik, sirket, sehir, url, kaynak, son_basvuru, kaldirildi)"
        )
        .neq("karar", "ele")
        // Ads that left their source are hidden like an expired deadline (the row stays)
        .is("kariyer_ilanlar.kaldirildi", null)
        .order("degerlendirildi", { ascending: false })
        .limit(200),
      // ~3 gün: 8 kaynak × saatlik koşu. 60 satır 7 saat ediyordu; 8 saatte bir taranan
      // LinkedIn'in başarılı satırı pencereden düşüp panel "taranmadı" diyordu, günlük sayaç da eksikti
      supabase.from("kariyer_taramalar").select("*").not("kaynak", "in", "(nabiz,ozet)").order("baslangic", { ascending: false }).limit(600),
      supabase.from("kariyer_eslesmeler").select("ilan_id", { count: "exact", head: true }),
      supabase.from("kariyer_eslesmeler").select("ilan_id", { count: "exact", head: true }).not("basvuru_durumu", "is", null),
    ]);
    setToplamInceleme(n.count ?? null);
    setBasvuruSayisi(b.count ?? 0);
    setYuklenmeZamani(Date.now());
    setKaynaklar(kaynakDurumlari((t.data ?? []) as Tarama[]));
    // TR günü: tarama satırları UTC, günü Europe/Istanbul'a göre kes
    const gunTR = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(new Date(iso));
    const bugunTR = gunTR(new Date().toISOString());
    const bugunku = ((t.data ?? []) as Tarama[]).filter((x) => gunTR(x.baslangic) === bugunTR && !x.hata);
    setBugun({ kaynak: new Set(bugunku.map((x) => x.kaynak)).size, yeni: bugunku.reduce((a, x) => a + (x.yeni ?? 0), 0) });
    if (p.data) {
      setProfilSatiri({ ...p.data, profil: p.data.profil ? profilDogrula(p.data.profil) : null, sehirler: p.data.sehirler ?? [] });
    }
    setListeHatasi(e.error?.message ?? null);
    setEslesmeler(
      (e.data ?? [])
        .map((r) => {
          const ham = r.kariyer_ilanlar as unknown;
          const ilan = ilanNormalle(ham);
          return { ...(r as Omit<Eslesme, "ilan">), ilan };
        })
        // Son başvurusu geçen ilan listede durmasın — kayıt kalır, gösterilmez
        .filter((x) => (kalanGun(x.ilan?.son_basvuru) ?? 0) >= 0)
    );
    const son = t.data?.[0];
    setSonTarama(son ? { ...son, sessiz: Date.now() - new Date(son.baslangic).getTime() > 3 * 3600_000 } : null);
    setYukleniyor(false);
  }, []);

  useEffect(() => {
    // Mikro göreve erteleme: setState efektin eş-zamanlı gövdesinde çağrılmıyor,
    // veri geldikten sonra çağrılıyor. Diğer sayfalardaki doğrudan çağrı lint'te
    // hata veriyor; burada tekrarlamıyoruz.
    queueMicrotask(getir);
  }, [getir]);

  /** "Tümü" sekmesi: elenenler ve süresi geçenler dahil son 300 değerlendirme */
  const tumunuGetir = useCallback(async () => {
    const { data } = await supabase
      .from("kariyer_eslesmeler")
      .select(
        "ilan_id, puan, gerekce, uyusan, uyusmayan, karar, geri_bildirim, geri_bildirim_notu, risk, uyarilar, basvuru_durumu, basvuru_ts, basvuru_hatirlatma, degerlendirildi, kariyer_ilanlar(baslik, sirket, sehir, url, kaynak, son_basvuru, kaldirildi)"
      )
      .order("degerlendirildi", { ascending: false })
      .limit(300);
    setTumu(
      (data ?? []).map((r) => {
        const ham = r.kariyer_ilanlar as unknown;
        const ilan = ilanNormalle(ham);
        return { ...(r as Omit<Eslesme, "ilan">), ilan };
      })
    );
  }, []);

  const basvurulariGetir = useCallback(async () => {
    const { data } = await supabase
      .from("kariyer_eslesmeler")
      .select(
        "ilan_id, puan, gerekce, uyusan, uyusmayan, karar, geri_bildirim, geri_bildirim_notu, risk, uyarilar, basvuru_durumu, basvuru_ts, basvuru_hatirlatma, degerlendirildi, kariyer_ilanlar(baslik, sirket, sehir, url, kaynak, son_basvuru, kaldirildi)"
      )
      .not("basvuru_durumu", "is", null)
      .order("basvuru_guncelleme", { ascending: false })
      .limit(200);
    setBasvuruZamani(Date.now());
    setBasvurular(
      (data ?? []).map((r) => {
        const ham = r.kariyer_ilanlar as unknown;
        const ilan = ilanNormalle(ham);
        return { ...(r as Omit<Eslesme, "ilan">), ilan };
      })
    );
  }, []);

  // Sekme her açılışta tazelenir — eşleşmelerde verilen geri bildirim burada da görünsün
  useEffect(() => {
    if (sekme === "tumu") queueMicrotask(tumunuGetir);
    if (sekme === "basvurular") queueMicrotask(basvurulariGetir);
  }, [sekme, tumunuGetir, basvurulariGetir]);

  // Profil boşsa ablam eşleşme ekranında boş bir listeyle karşılaşmasın:
  // sekme state'e yazılmıyor, TÜRETİLİYOR. Profil dolunca kendiliğinden açılır.
  const profilBos = !yukleniyor && profilBosMu(profilSatiri?.profil);
  const etkinSekme: Sekme = profilBos ? "profil" : sekme;

  /**
   * Şehir süzgeci: ilanın konumunda tanınan il varsa ona göre; il tanınmıyorsa
   * ("Sincan", "Türkiye") gizlenmez — sert filtredeki ilkeyle aynı, süzgeç
   * belirsiz olanı saklamasın.
   */
  const suzulmus = useMemo(() => {
    const istenen = secilenSehirler.map(sadelestir);
    const esik = yuklenmeZamani - 24 * 3600_000;
    return eslesmeler.filter((e) => {
      if (son24 && new Date(e.degerlendirildi).getTime() < esik) return false;
      if (!istenen.length) return true;
      const iller = konumdakiIller(e.ilan?.sehir ?? "");
      return !iller.length || iller.some((il) => istenen.includes(il));
    });
  }, [eslesmeler, secilenSehirler, son24, yuklenmeZamani]);

  const gruplar = useMemo(() => {
    const g: Record<Karar, Eslesme[]> = { bildir: [], ozet: [], listele: [], ele: [] };
    for (const e of suzulmus) g[e.karar]?.push(e);
    for (const k of SIRA) g[k].sort((a, b) => b.puan - a.puan);
    return g;
  }, [suzulmus]);

  const ziyarettenBeriYeni = useMemo(
    () => (sonZiyaret ? eslesmeler.filter((e) => e.degerlendirildi > sonZiyaret).length : 0),
    [eslesmeler, sonZiyaret]
  );

  /**
   * gb = null: geri al. Not yalnızca "ilgilenmedim"de anlamlı; kartın içindeki
   * panelden geliyor (sebep çipleri + serbest metin). Sebep modele olumsuz
   * örnek olarak gidiyor — tek kelime bile puanlamayı keskinleştiriyor.
   */
  const geriBildir = async (e: Eslesme, gb: GeriBildirim | null, not: string | null = null) => {
    const yeni = gb;
    setEslesmeler((l) =>
      l.map((x) => (x.ilan_id === e.ilan_id ? { ...x, geri_bildirim: yeni, geri_bildirim_notu: yeni === "ilgilenmedim" ? not : null } : x))
    );
    const { error } = await supabase
      .from("kariyer_eslesmeler")
      .update({
        geri_bildirim: yeni,
        geri_bildirim_notu: yeni === "ilgilenmedim" ? not : null,
        geri_bildirim_ts: yeni ? new Date().toISOString() : null,
      })
      .eq("ilan_id", e.ilan_id);
    if (error) {
      // Raw message goes to the console for the developer; the toast stays plain
      console.error(error);
      addToast("Kaydedilemedi, tekrar dene.", "error");
      getir();
    }
  };

  /**
   * Başvurdum işareti: tek bit. Ablam yalnızca "buna başvurdum"u bilsin yeter;
   * görüşme/sonuç aşamaları istenmedi (kullanıcı kararı, 20.09.2026). Kolon
   * "basvurdu" değerini taşıyor, ileride aşama eklenirse şema hazır.
   */
  const basvuruDegistir = async (e: Eslesme, basvurdu: boolean) => {
    const simdi = new Date().toISOString();
    const durum: BasvuruDurumu | null = basvurdu ? "basvurdu" : null;
    const yama = {
      basvuru_durumu: durum,
      basvuru_ts: basvurdu ? e.basvuru_ts ?? simdi : null,
      basvuru_guncelleme: basvurdu ? simdi : null,
      // Başvurdum = ilgilendim; olumsuz örnek olmasın, yeniden puanlamada dokunulmasın
      ...(basvurdu ? { geri_bildirim: "ilgilendim" as GeriBildirim, geri_bildirim_notu: null, geri_bildirim_ts: simdi } : {}),
    };
    const uygula = (l: Eslesme[]) => l.map((x) => (x.ilan_id === e.ilan_id ? { ...x, ...yama } : x));
    setEslesmeler(uygula);
    // Başvurularım listesi yalnızca işaretlileri taşır: geri alınan satır anında düşer.
    // Re-marking a row that already left the list (undo on that screen) puts it back.
    setBasvurular((l) =>
      l ? (basvurdu && !l.some((x) => x.ilan_id === e.ilan_id) ? [...l, { ...e, ...yama }] : uygula(l).filter((x) => x.basvuru_durumu)) : l
    );
    setBasvuruSayisi((n) => n + (basvurdu && !e.basvuru_durumu ? 1 : !basvurdu && e.basvuru_durumu ? -1 : 0));
    const { error } = await supabase.from("kariyer_eslesmeler").update(yama).eq("ilan_id", e.ilan_id);
    if (error) {
      console.error(error);
      addToast("Kaydedilemedi, tekrar dene.", "error");
      getir();
      basvurulariGetir();
    }
  };

  // Başvurularım is its own tab now; the full list ("tumu") still belongs to İlanlar
  const vurguSekme: Sekme = etkinSekme === "tumu" ? "eslesmeler" : etkinSekme;

  return (
    <main className="relative min-h-screen overflow-x-hidden" style={KARIYER_TOKENLARI}>
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background: [
            "radial-gradient(ellipse 80% 50% at 50% 0%, rgb(var(--accent-rgb) / 0.07) 0%, transparent 60%)",
            "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.15) 100%)",
          ].join(", "),
        }}
      />

      <AnaSayfaDugmesi />

      <div className="relative z-10 mx-auto w-full max-w-2xl px-4 pb-24 pt-16 sm:pt-28">
        <div className="mb-2 flex flex-col items-center text-center">
          {/* Bahçe logosu (components/BahceLogo): yazı açılışta kendiliğinden yazılır,
              harflerden güller açar. Başlığın kendisi ekran okuyucu için duruyor. */}
          <h1 className="sr-only">Ablam Kariyer</h1>
          <BahceLogo metin="Ablam Kariyer" palet={MODUL_PALETLERI.kariyer} yukseklik={200} className="-mt-10 w-full max-w-xl sm:-mt-16" />
        </div>

        {/* Tabs. The middle column is a little wider so "Başvurularım" + badge fits at 320-375 px. */}
        <nav aria-label="Bölümler" className="glass mb-4 grid grid-cols-[1fr_1.35fr_1fr] gap-1 rounded-2xl p-1 ring-1 ring-[var(--k-hair)]">
          {(
            [
              ["eslesmeler", "İlanlar", Briefcase],
              ["basvurular", "Başvurularım", Send],
              ["profil", "Profilim", UserRound],
            ] as const
          ).map(([ad, etiket, Ikon]) => {
            const aktif = vurguSekme === ad;
            const kapali = profilBos && ad !== "profil";
            return (
              <button
                key={ad}
                type="button"
                onClick={() => {
                  // A closed tab must not change hidden state (it would open after saving); say why instead
                  if (kapali) {
                    addToast("Önce profilini kaydet; ilanlar sonra burada görünür.", "info");
                    return;
                  }
                  setSekme(ad);
                }}
                aria-current={aktif ? "page" : undefined}
                aria-disabled={kapali ? "true" : undefined}
                aria-describedby={kapali ? "kariyer-kapali-ipucu" : undefined}
                className={`flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl px-1 text-[13.5px] font-medium transition-colors ${ODAK} ${
                  aktif ? "bg-[var(--accent)]/14 text-[var(--accent-light)]" : "text-[var(--k-t2)] hover:text-[var(--k-t1)]"
                } ${kapali ? "opacity-50" : ""}`}
              >
                <Ikon size={15} className="hidden flex-shrink-0 sm:inline" aria-hidden />
                <span className="truncate">{etiket}</span>
                {ad === "basvurular" && basvuruSayisi > 0 && (
                  <span className="grid h-[18px] min-w-[18px] flex-shrink-0 place-items-center rounded-full bg-white/[0.12] px-1 text-[11px] tabular-nums">
                    {basvuruSayisi}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {profilBos && (
          <p id="kariyer-kapali-ipucu" className="-mt-1 mb-3 text-center text-[12.5px] leading-[18px] text-[var(--k-t2)]">
            İlanlar ve Başvurularım, profilini kaydedince açılır.
          </p>
        )}

        {yukleniyor ? (
          <IlanIskeleti />
        ) : etkinSekme === "tumu" ? (
          <TumuEkrani liste={tumu} onGeri={() => setSekme("eslesmeler")} />
        ) : etkinSekme === "basvurular" ? (
          <BasvurularEkrani
            liste={basvurular}
            simdi={basvuruZamani}
            onGeriAl={(e) => basvuruDegistir(e, false)}
            onYenidenEkle={(e) => basvuruDegistir(e, true)}
          />
        ) : etkinSekme === "profil" ? (
          <ProfilEkrani key={profilSatiri?.updated_at ?? "yok"} satir={profilSatiri} onKaydedildi={getir} />
        ) : (
          <EslesmeEkrani
            gruplar={gruplar}
            sonTarama={sonTarama}
            profilBos={profilBos}
            onGeriBildir={geriBildir}
            onBasvuru={basvuruDegistir}
            onProfileGit={() => setSekme("profil")}
            onTumuGit={() => setSekme("tumu")}
            toplamInceleme={toplamInceleme}
            kaynaklar={kaynaklar}
            listeHatasi={listeHatasi}
            bugun={bugun}
            sonZiyaret={sonZiyaret}
            ziyarettenBeriYeni={ziyarettenBeriYeni}
            sehirSecenekleri={profilSatiri?.sehirler ?? []}
            secilenSehirler={secilenSehirler}
            son24={son24}
            onSuzgec={suzgecYaz}
          />
        )}
      </div>
    </main>
  );
}

/** Home link: a 40 px round icon on phones (absolute, so it never floats over cards), labelled and fixed from sm up */
function AnaSayfaDugmesi() {
  return (
    <Link
      href="/"
      aria-label="Ana sayfa"
      className={`glass absolute top-4 left-4 z-20 flex h-10 w-10 items-center justify-center gap-2 rounded-full border border-[var(--border)] text-[13px] text-[var(--k-t2)] transition-colors duration-200 hover:border-[var(--border-hover)] hover:text-[var(--k-t1)] sm:fixed sm:top-6 sm:left-7 sm:h-auto sm:w-auto sm:rounded-xl sm:px-3 sm:py-2 ${ODAK}`}
    >
      <ArrowLeft size={16} aria-hidden />
      <span className="hidden sm:inline">Ana sayfa</span>
    </Link>
  );
}

/** First-load placeholder: summary bar + four card shapes instead of a spinner */
function IlanIskeleti() {
  return (
    <div aria-busy="true" className="space-y-2">
      <span className="sr-only">Yükleniyor</span>
      <div className="mb-3 h-11 rounded-2xl bg-white/[0.05] motion-safe:animate-pulse" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex h-[140px] flex-col rounded-2xl bg-white/[0.05] p-3 motion-safe:animate-pulse">
          <div className="h-3.5 w-[70%] rounded-full bg-white/[0.07]" />
          <div className="mt-2 h-2.5 w-[45%] rounded-full bg-white/[0.07]" />
          <div className="mt-auto h-11 w-full rounded-xl bg-white/[0.07]" />
        </div>
      ))}
    </div>
  );
}

/** Row placeholder for the list screens */
function SatirIskeleti({ adet }: { adet: number }) {
  return (
    <div aria-busy="true" className="space-y-2">
      <span className="sr-only">Yükleniyor</span>
      {Array.from({ length: adet }, (_, i) => (
        <div key={i} className="h-14 rounded-2xl bg-white/[0.05] motion-safe:animate-pulse" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- tümü

/**
 * İncelenen her ilan, kararı ne olursa olsun: "sistem neyi gördü, neden
 * elendi" sorusunun cevabı. Eşleşmeler sekmesinden farklı olarak elenenler ve
 * süresi geçenler de burada; kartlar değil satırlar — 300 kayıt okunabilsin.
 */
function TumuEkrani({ liste, onGeri }: { liste: Eslesme[] | null; onGeri: () => void }) {
  const geri = (
    <button
      type="button"
      onClick={onGeri}
      className={`-ml-2 mb-2 flex h-10 items-center gap-1.5 rounded-xl px-2 text-[13px] text-[var(--k-t2)] transition-colors hover:bg-[var(--k-chip)] hover:text-[var(--k-t1)] ${ODAK}`}
    >
      <ArrowLeft size={14} aria-hidden /> İlanlara dön
    </button>
  );
  if (liste === null) {
    return (
      <div>
        {geri}
        <SatirIskeleti adet={6} />
      </div>
    );
  }
  if (!liste.length) {
    return (
      <div>
        {geri}
        <div className="rounded-2xl p-6 text-center text-[13.5px] text-[var(--k-t2)] ring-1 ring-[var(--k-hair)]">Henüz incelenen ilan yok.</div>
      </div>
    );
  }
  const sayim = liste.reduce<Record<string, number>>((t, e) => ({ ...t, [e.karar]: (t[e.karar] ?? 0) + 1 }), {});
  return (
    <div className="animate-fade-in motion-reduce:animate-none">
      {geri}
      <p className="mb-3 text-[12.5px] leading-[18px] text-[var(--k-t2)]">
        Sistemin baktığı son {liste.length} ilan · {SIRA.map((k) => `${sayim[k] ?? 0} ${GRUP[k].etiket.toLocaleLowerCase("tr")}`).join(" · ")} ·{" "}
        {sayim.ele ?? 0} uymadı
        <span className="mt-0.5 block">
          Uymayanlar profilinle örtüşmediği için İlanlar listesinde gösterilmiyor. Soldaki sayı 100 üzerinden uyum.
        </span>
      </p>
      <div className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl bg-[var(--k-card)] ring-1 ring-[var(--k-hair)]">
        {liste.map((e) => {
          const gecti = (kalanGun(e.ilan?.son_basvuru) ?? 0) < 0;
          const kalkti = !!e.ilan?.kaldirildi;
          const elendi = e.karar === "ele";
          return (
            <div key={e.ilan_id} className="flex items-start gap-3 px-3.5 py-2.5">
              <span className={`mt-0.5 w-9 flex-shrink-0 rounded-md px-1.5 py-0.5 text-center text-[11.5px] font-medium tabular-nums ${KARAR_STIL[e.karar]}`}>
                <span aria-hidden>{e.puan}</span>
                <span className="sr-only">Uyum {e.puan}/100</span>
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-[13.5px] ${elendi || gecti || kalkti ? "text-[var(--k-t3)]" : "text-[var(--k-t1)]"}`}>
                  {e.ilan?.url ? (
                    <a href={e.ilan.url} target="_blank" rel="noopener noreferrer" className={`block truncate rounded-sm hover:text-[var(--accent-light)] ${ODAK}`}>
                      {e.ilan.baslik}
                      <span className="sr-only"> (yeni sekmede açılır)</span>
                    </a>
                  ) : (
                    <span className="block truncate">{e.ilan?.baslik}</span>
                  )}
                </p>
                <p className="truncate text-[12px] text-[var(--k-t3)]">
                  {[e.ilan?.sirket, e.ilan?.sehir, kaynakEtiketi(e.ilan?.kaynak ?? ""), tarihMetni(e.degerlendirildi)].filter(Boolean).join(" · ")}
                  {elendi && " · uymadı"}
                  {gecti && " · süresi geçti"}
                  {kalkti && " · ilan kaldırıldı"}
                  {e.basvuru_durumu ? " · başvurdun" : e.geri_bildirim && ` · ${e.geri_bildirim === "ilgilendim" ? "ilgini çekti" : "uymaz dedin"}`}
                  {e.risk && (
                    <span className="text-rose-200/80">
                      {" · "}
                      <TriangleAlert size={11} className="-mt-0.5 inline" aria-hidden /> {e.uyarilar?.join(", ") || "şüpheli ilan"}
                    </span>
                  )}
                </p>
                {e.gerekce && (
                  <p className="mt-0.5 truncate text-[12px] text-[var(--k-t2)]" title={e.gerekce}>
                    {e.gerekce}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- kaynak paneli

/**
 * "N kaynak çalışıyor" hapı ve açılır paneli. Panel createPortal ile
 * document.body'ye takılıyor, Notepad'deki menüler gibi (components/Toolbar.tsx):
 * sayfa ağacının içinde kalınca animate-fade-in atasının kalıcı transform'u
 * yüzünden Chromium backdrop-filter'ı uygulamıyor, cam düz yarı saydam kalıyordu.
 */
function KaynakPaneli({ kaynaklar, sorunlu }: { kaynaklar: KaynakDurumu[]; sorunlu: number }) {
  const [acik, setAcik] = useState(false);
  const [konum, setKonum] = useState<{ top: number; left: number } | null>(null);
  const dugme = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const ac = () => {
    const r = dugme.current?.getBoundingClientRect();
    if (r) {
      // Keep the centred panel inside the viewport with an 8 px margin (trigger sits at the right edge)
      const w = Math.min(0.92 * window.innerWidth, 352);
      const orta = r.left + r.width / 2;
      setKonum({ top: r.bottom + 8, left: Math.min(Math.max(orta, 8 + w / 2), window.innerWidth - 8 - w / 2) });
    }
    setAcik((a) => !a);
  };

  // Close on an outside press, on Escape (focus back to the trigger) and when the page scrolls.
  // Presses and scrolling inside the panel itself keep it open.
  useEffect(() => {
    if (!acik) return;
    panel.current?.focus();
    const kapat = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key !== "Escape") return;
        setAcik(false);
        dugme.current?.focus();
        return;
      }
      const hedef = e.target as Node;
      if (dugme.current?.contains(hedef) || panel.current?.contains(hedef)) return;
      setAcik(false);
    };
    document.addEventListener("mousedown", kapat);
    document.addEventListener("keydown", kapat);
    window.addEventListener("scroll", kapat, true);
    return () => {
      document.removeEventListener("mousedown", kapat);
      document.removeEventListener("keydown", kapat);
      window.removeEventListener("scroll", kapat, true);
    };
  }, [acik]);

  const etiket = sorunlu === 0 ? "Siteler" : sorunlu < kaynaklar.length ? `${sorunlu} site gecikti` : "Siteler gecikti";

  return (
    <>
      <button
        ref={dugme}
        type="button"
        onClick={ac}
        aria-expanded={acik}
        aria-controls={acik ? panelId : undefined}
        title="Hangi sitelere bakıldığını göster"
        className={`flex h-10 flex-shrink-0 items-center gap-1.5 rounded-full bg-[var(--k-chip)] px-3 text-[12.5px] text-[var(--k-t2)] transition-colors hover:bg-[var(--k-chip-hover)] hover:text-[var(--k-t1)] ${ODAK}`}
      >
        <span aria-hidden className={`h-2 w-2 flex-shrink-0 rounded-full ${sorunlu === 0 ? "bg-emerald-300/80" : "bg-amber-300"}`} />
        {etiket}
      </button>
      {acik &&
        konum &&
        createPortal(
          <div
            ref={panel}
            id={panelId}
            role="dialog"
            aria-label="Site durumu"
            tabIndex={-1}
            style={{ ...KARIYER_TOKENLARI, top: konum.top, left: konum.left, maxHeight: `calc(100dvh - ${konum.top}px - 16px)` }}
            className="animate-fade-in-scale fixed z-[var(--z-panel)] w-[min(92vw,22rem)] -translate-x-1/2 overflow-y-auto overscroll-contain rounded-2xl glass-strong shadow-xl shadow-black/30 outline-none ring-1 ring-[var(--k-hair)] motion-reduce:animate-none"
          >
            <p className="px-3.5 pb-1 pt-3 text-[11.5px] text-[var(--k-t3)]">Bu liste bilgi içindir; bir şey yapman gerekmez.</p>
            <div className="divide-y divide-white/[0.06]">
              {kaynaklar.map((k) => (
                <div key={k.kaynak} className="flex items-start gap-2.5 px-3.5 py-2.5 text-left">
                  <span
                    aria-hidden
                    className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${k.sonHata ? "bg-rose-300/80" : k.bayat ? "bg-amber-300" : "bg-emerald-300/80"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] text-[var(--k-t1)]">
                      {kaynakEtiketi(k.kaynak)}
                      <span className="text-[var(--k-t3)]"> · {k.sonBasari ? `${tarihMetni(k.sonBasari)}, ${k.bulunan} ilan` : "henüz ilan alınamadı"}</span>
                    </p>
                    {k.sonHata && (
                      // Raw error only as a tooltip, for the developer
                      <p className="mt-0.5 text-[12px] text-rose-100/90" title={k.sonHata}>
                        Son denemede açılamadı
                      </p>
                    )}
                    {!k.sonHata && k.bayat && <p className="mt-0.5 text-[12px] text-amber-200">Bir süredir bakılamadı</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

// ---------------------------------------------------------------- eşleşmeler

function EslesmeEkrani({
  gruplar,
  sonTarama,
  profilBos,
  onGeriBildir,
  onBasvuru,
  onProfileGit,
  onTumuGit,
  toplamInceleme,
  kaynaklar,
  listeHatasi,
  bugun,
  sonZiyaret,
  ziyarettenBeriYeni,
  sehirSecenekleri,
  secilenSehirler,
  son24,
  onSuzgec,
}: {
  gruplar: Record<Karar, Eslesme[]>;
  sonTarama: Tarama | null;
  profilBos: boolean;
  onGeriBildir: (e: Eslesme, gb: GeriBildirim | null, not?: string | null) => void;
  onBasvuru: (e: Eslesme, basvurdu: boolean) => void;
  onProfileGit: () => void;
  onTumuGit: () => void;
  toplamInceleme: number | null;
  kaynaklar: KaynakDurumu[];
  listeHatasi: string | null;
  bugun: { kaynak: number; yeni: number } | null;
  sonZiyaret: string | null;
  ziyarettenBeriYeni: number;
  sehirSecenekleri: string[];
  secilenSehirler: string[];
  son24: boolean;
  onSuzgec: (sehirler: string[], son24: boolean) => void;
}) {
  const toplam = SIRA.reduce((n, k) => n + gruplar[k].length, 0);
  const sorunlu = kaynaklar.filter((k) => k.bayat || k.sonHata);
  const suzgecAcik = secilenSehirler.length > 0 || son24;
  const sehirDegistir = (sehir: string) =>
    onSuzgec(secilenSehirler.includes(sehir) ? secilenSehirler.filter((x) => x !== sehir) : [...secilenSehirler, sehir], son24);

  // "Daha az uygun" fold: open when the two upper groups are empty, else the remembered choice, else closed.
  // null = no toggle in this visit yet, follow the default.
  const [zayifSecim, setZayifSecim] = useState<boolean | null>(null);
  const [zayifKayitli, setZayifKayitli] = useState(false);
  useEffect(() => {
    queueMicrotask(() => {
      try {
        setZayifKayitli(localStorage.getItem(ZAYIF_ANAHTARI) === "1");
      } catch {
        // storage blocked: stay closed
      }
    });
  }, []);
  const ustBos = gruplar.bildir.length === 0 && gruplar.ozet.length === 0;
  const zayifAcik = zayifSecim ?? (ustBos || zayifKayitli);
  const zayifDegistir = () => {
    const yeni = !zayifAcik;
    setZayifSecim(yeni);
    try {
      localStorage.setItem(ZAYIF_ANAHTARI, yeni ? "1" : "0");
    } catch {
      // not remembered, fine
    }
  };

  const tetik = !profilBos && kaynaklar.length > 0 ? <KaynakPaneli kaynaklar={kaynaklar} sorunlu={sorunlu.length} /> : null;
  const sessiz = !!sonTarama?.sessiz;
  const aksadi = !sessiz && !!sonTarama?.hata;

  return (
    <div className="animate-fade-in motion-reduce:animate-none">
      {/* Summary row: what is new since the last visit, when the system last looked. Silent/error turns it into a soft box. */}
      {sonTarama && (sessiz || aksadi) ? (
        <div className={`mb-3 flex items-center gap-3 rounded-2xl p-3 ${sessiz ? "bg-rose-300/[0.10] text-rose-100/90" : "bg-amber-300/[0.10] text-amber-200"}`}>
          <TriangleAlert size={14} className="flex-shrink-0 self-start mt-[3px]" aria-hidden />
          <div className="min-w-0 flex-1 text-[13px] leading-5">
            {sessiz ? (
              <>
                Sistem {tarihMetni(sonTarama.baslangic)}den beri yeni ilana bakamadı.
                <span className="block text-[12px] opacity-85">Haber ver, düzeltilsin.</span>
              </>
            ) : (
              <>Son deneme {tarihMetni(sonTarama.baslangic)} aksadı; sistem kendisi yeniden deneyecek.</>
            )}
          </div>
          {tetik}
        </div>
      ) : (
        <div className="mb-3 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] leading-5 text-[var(--k-t1)]">
              {sonZiyaret ? (
                ziyarettenBeriYeni > 0 ? (
                  <>
                    Son bakışından beri <span className="font-medium text-[var(--accent-light)]">{ziyarettenBeriYeni} yeni ilan</span>
                  </>
                ) : (
                  "Son bakışından beri yeni ilan yok"
                )
              ) : (
                `Bugün ${bugun?.yeni ?? 0} yeni ilan bulundu`
              )}
            </p>
            {/* "Bakmak" is the sister's verb above; the system "checks". Today's count only once. */}
            <p className="truncate text-[12px] leading-[18px] text-[var(--k-t2)]">
              {sonTarama
                ? `Siteler en son ${tarihMetni(sonTarama.baslangic)} kontrol edildi${
                    bugun && sonZiyaret ? ` · bugün ${bugun.kaynak} siteden ${bugun.yeni} yeni ilan` : ""
                  }`
                : "Siteler henüz kontrol edilmedi"}
            </p>
          </div>
          {tetik}
        </div>
      )}

      {/* Süzgeç: birden fazla şehir varsa şehir çipleri, her zaman "son 24 saat". Belirsiz konum gizlenmez. */}
      {!profilBos && (sehirSecenekleri.length > 1 || son24 || eslesmeVarMi(gruplar)) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {sehirSecenekleri.length > 1 &&
            sehirSecenekleri.map((sehir) => {
              const aktif = secilenSehirler.includes(sehir);
              return (
                <button key={sehir} type="button" onClick={() => sehirDegistir(sehir)} aria-pressed={aktif} className={cipSinifi(aktif)}>
                  {aktif && <Check size={12} aria-hidden />}
                  {sehir}
                </button>
              );
            })}
          <button type="button" onClick={() => onSuzgec(secilenSehirler, !son24)} aria-pressed={son24} className={cipSinifi(son24)}>
            {son24 && <Check size={12} aria-hidden />}
            Son 24 saat
          </button>
          {suzgecAcik && (
            <button
              type="button"
              onClick={() => onSuzgec([], false)}
              className={`h-10 rounded-full px-3 text-[12.5px] text-[var(--k-t2)] transition-colors hover:bg-[var(--k-chip)] hover:text-[var(--k-t1)] ${ODAK}`}
            >
              Süzgeci kaldır
            </button>
          )}
        </div>
      )}

      {listeHatasi && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl bg-rose-300/[0.10] p-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] leading-5 text-[var(--k-t1)]">İlanlar şu an yüklenemedi. Sayfayı yenile; düzelmezse haber ver.</p>
            {/* Raw error folded away for the developer */}
            <details className="mt-0.5 text-[11.5px] text-[var(--k-t2)]">
              <summary className={`flex min-h-8 w-fit cursor-pointer items-center rounded-sm ${ODAK}`}>Teknik ayrıntı</summary>
              <p className="break-words">{listeHatasi}</p>
            </details>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={`h-10 flex-shrink-0 rounded-xl bg-white/[0.08] px-4 text-[13px] text-[var(--k-t1)] transition-colors hover:bg-white/[0.12] ${ODAK}`}
          >
            Yenile
          </button>
        </div>
      )}

      {profilBos ? (
        <div className="rounded-2xl p-6 text-center ring-1 ring-[var(--k-hair)]">
          <p className="text-[13.5px] leading-5 text-[var(--k-t2)]">Önce kendini anlat; sana uygun ilanları buna göre ararız.</p>
          <button
            type="button"
            onClick={onProfileGit}
            className={`mt-4 h-11 rounded-xl bg-[var(--accent)] px-5 text-[13px] font-medium text-[var(--background)] transition-colors hover:bg-[var(--accent-light)] ${ODAK}`}
          >
            Profilini oluştur
          </button>
        </div>
      ) : toplam === 0 ? (
        // A failed query is explained above; do not also claim "no ads"
        !listeHatasi && (
          <div className="rounded-2xl p-6 text-center text-[13.5px] leading-5 text-[var(--k-t2)] ring-1 ring-[var(--k-hair)]">
            {suzgecAcik ? (
              <>
                <p>Bu süzgeçle ilan yok.</p>
                <button
                  type="button"
                  onClick={() => onSuzgec([], false)}
                  className={`mt-3 h-10 rounded-xl bg-white/[0.08] px-4 text-[13px] text-[var(--k-t1)] transition-colors hover:bg-white/[0.12] ${ODAK}`}
                >
                  Süzgeci kaldır
                </button>
              </>
            ) : (
              "Şimdilik sana uygun ilan yok. Sistem saat başı bakıyor; bulunca burada ve e-postanda olacak."
            )}
          </div>
        )
      ) : (
        SIRA.map((k) => {
          const liste = gruplar[k];
          if (!liste.length) return null;
          const katlanir = k === "listele";
          const acik = !katlanir || zayifAcik;
          const listeId = `kariyer-grup-${k}`;
          const baslik = (
            <span className="flex items-center gap-2">
              <span className="text-[14px] font-semibold text-[var(--k-t1)]">{GRUP[k].etiket}</span>
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-white/[0.10] px-1.5 text-[11.5px] tabular-nums text-[var(--k-t2)]">
                {liste.length}
              </span>
            </span>
          );
          return (
            <section key={k} className="mb-6">
              {katlanir ? (
                <>
                  <h2>
                    <button
                      type="button"
                      onClick={zayifDegistir}
                      aria-expanded={acik}
                      aria-controls={listeId}
                      className={`-mx-1 flex h-12 w-[calc(100%+0.5rem)] items-center gap-2 rounded-xl px-1 text-left transition-colors hover:bg-white/[0.04] ${ODAK}`}
                    >
                      <span className="min-w-0 flex-1">
                        {baslik}
                        <span className="mt-0.5 block text-[12px] font-normal text-[var(--k-t2)]">{GRUP[k].aciklama}</span>
                      </span>
                      <ChevronDown
                        size={16}
                        aria-hidden
                        className={`flex-shrink-0 text-[var(--k-t2)] transition-transform duration-150 motion-reduce:transition-none ${acik ? "rotate-180" : ""}`}
                      />
                    </button>
                  </h2>
                  {!acik && (
                    // Same action as the heading button; kept out of the tab order to avoid a duplicate stop
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-hidden
                      onClick={zayifDegistir}
                      className="mt-0.5 min-h-10 text-left text-[12.5px] text-[var(--k-t2)] transition-colors hover:text-[var(--k-t1)]"
                    >
                      {liste.length} ilan gizli · göster
                    </button>
                  )}
                </>
              ) : (
                <>
                  <h2>{baslik}</h2>
                  <p className="mt-0.5 text-[12px] text-[var(--k-t2)]">{GRUP[k].aciklama}</p>
                </>
              )}
              {acik && (
                <div id={listeId} className="mt-2 space-y-2">
                  {liste.map((e) => (
                    <EslesmeKarti key={e.ilan_id} e={e} onGeriBildir={onGeriBildir} onBasvuru={onBasvuru} yeni={!!sonZiyaret && e.degerlendirildi > sonZiyaret} />
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}

      {/* Full list incl. eliminated ads: a quiet row at the end, always reachable */}
      {!profilBos && (
        <button
          type="button"
          onClick={onTumuGit}
          className={`mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--k-chip)] px-3 text-[13px] text-[var(--k-t2)] transition-colors hover:bg-[var(--k-chip-hover)] hover:text-[var(--k-t1)] ${ODAK}`}
        >
          {/* The full list loads at most 300 rows; the count must not promise more */}
          <span className="min-w-0 truncate">
            Bakılan bütün ilanlar (uymayanlar dahil)
            {toplamInceleme != null && toplamInceleme > 0 ? ` · ${toplamInceleme > 300 ? "son 300" : toplamInceleme}` : ""}
          </span>
          <ChevronRight size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Hızlı sebepler — ablam tıklasın, yazmasın. Metin kutusu yine var, isteyen yazar. */
// "Zaten başvurdum" burada YOK: ilgisizlik değil ilgi; olumsuz örnek olarak modele gidiyordu (denetim bulgusu)
const SEBEPLER = ["Alanım değil", "Şartları taşımıyorum", "Şehir / mesafe", "Maaş düşük"] as const;

/** Eşleşme var mı — süzgeç satırı boş listede de görünsün ama hiç eşleşme yokken görünmesin */
const eslesmeVarMi = (g: Record<Karar, Eslesme[]>) => SIRA.some((k) => g[k].length > 0);

/** Small inline chip on the meta row */
const META_CIP = "inline-flex h-5 flex-shrink-0 items-center rounded-md px-1.5 text-[11.5px]";

function EslesmeKarti({
  e,
  onGeriBildir,
  onBasvuru,
  yeni = false,
}: {
  e: Eslesme;
  onGeriBildir: (e: Eslesme, gb: GeriBildirim | null, not?: string | null) => void;
  onBasvuru: (e: Eslesme, basvurdu: boolean) => void;
  yeni?: boolean;
}) {
  const sonuk = e.geri_bildirim === "ilgilenmedim";
  const basvurdu = !!e.basvuru_durumu;
  // "İlgilenmedim" iki adım: önce sebep paneli açılır, kaydedince işaretlenir.
  // Kaydetmeden kapatırsa hiçbir şey değişmez — yanlışlıkla basılan tuş kayıt olmasın.
  const [panelAcik, setPanelAcik] = useState(false);
  const [secili, setSecili] = useState<string[]>([]);
  const [metin, setMetin] = useState("");
  // Details (full reason, tags, source) open from the "why it fits" row
  const [gerekceAcik, setGerekceAcik] = useState(false);
  const ayrintiId = useId();
  const panelBaslik = useRef<HTMLParagraphElement>(null);
  const uymazDugme = useRef<HTMLButtonElement>(null);
  const basvuruDugme = useRef<HTMLButtonElement>(null);
  const geriAlDugme = useRef<HTMLButtonElement>(null);
  /** Where focus lands after the card swaps between its full and folded forms (the old button unmounts) */
  const odakHedefi = useRef<"geriAl" | "uymaz" | "basvuru" | null>(null);
  const katli = sonuk && !basvurdu;

  // Move focus into the reason panel when it opens
  useEffect(() => {
    if (panelAcik) panelBaslik.current?.focus();
  }, [panelAcik]);

  useEffect(() => {
    const hedef = odakHedefi.current;
    if (!hedef) return;
    odakHedefi.current = null;
    (hedef === "geriAl" ? geriAlDugme : hedef === "uymaz" ? uymazDugme : basvuruDugme).current?.focus();
  }, [katli]);

  const ilgilenmedimTikla = () => {
    if (sonuk) {
      odakHedefi.current = "uymaz";
      onGeriBildir(e, null); // geri al
      return;
    }
    setPanelAcik((a) => !a);
  };
  const kaydet = () => {
    const not = [...secili, metin.trim()].filter(Boolean).join(", ") || null;
    odakHedefi.current = "geriAl";
    onGeriBildir(e, "ilgilenmedim", not);
    setPanelAcik(false);
    setSecili([]);
    setMetin("");
  };
  const vazgec = () => {
    setPanelAcik(false);
    uymazDugme.current?.focus();
  };

  const kritik = e.risk === "kritik";

  // "Bana uymaz" marked: fold to one quiet row in place. The ad link, "Başvurdum" and a critical
  // warning stay; "Geri al" restores the full card (and with it "İlgimi çekti").
  if (katli) {
    return (
      <article className={`flex items-center gap-2 rounded-2xl bg-black/[0.06] p-3 ring-1 ${kritik ? "ring-rose-300/25" : "ring-[var(--k-hair)]"}`}>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13.5px] text-[var(--k-t2)]">
            {e.ilan.url ? (
              <a href={e.ilan.url} target="_blank" rel="noopener noreferrer" className={`block truncate rounded-sm hover:text-[var(--accent-light)] ${ODAK}`}>
                {e.ilan.baslik}
                <span className="sr-only"> (yeni sekmede açılır)</span>
              </a>
            ) : (
              <span className="block truncate">{e.ilan.baslik}</span>
            )}
          </h3>
          <p className="truncate text-[12px] text-[var(--k-t2)]">
            {kritik && (
              <span className="text-rose-200">
                <TriangleAlert size={11} className="-mt-0.5 inline" aria-hidden /> Güvenilir görünmüyor ·{" "}
              </span>
            )}
            Uymaz dedin{e.geri_bildirim_notu ? ` · ${e.geri_bildirim_notu}` : ""}
          </p>
        </div>
        <button
          ref={basvuruDugme}
          type="button"
          onClick={() => {
            odakHedefi.current = "basvuru";
            onBasvuru(e, true);
          }}
          aria-label={`${e.ilan.baslik}: başvurdum olarak işaretle`}
          className={`h-10 flex-shrink-0 rounded-xl bg-[var(--accent)]/12 px-3 text-[13px] text-[var(--accent-light)] transition-colors hover:bg-[var(--accent)]/20 ${ODAK}`}
        >
          Başvurdum
        </button>
        <button
          ref={geriAlDugme}
          type="button"
          onClick={ilgilenmedimTikla}
          aria-label={`${e.ilan.baslik}: “Bana uymaz” işaretini geri al`}
          className={`h-10 flex-shrink-0 rounded-xl bg-white/[0.06] px-3 text-[13px] text-[var(--k-t2)] transition-colors hover:bg-white/[0.10] hover:text-[var(--k-t1)] ${ODAK}`}
        >
          Geri al
        </button>
      </article>
    );
  }

  const kalan = kalanGun(e.ilan.son_basvuru);
  const { sirket, sehir } = e.ilan;
  const orta = !!e.risk && !kritik;
  const halka = kritik ? "ring-rose-300/30" : basvurdu ? "ring-[var(--accent)]/25" : "ring-[var(--k-hair)]";
  const kunye = [kaynakEtiketi(e.ilan.kaynak), `${tarihMetni(e.degerlendirildi)} bulundu`, sonBasvuruMetni(e.ilan.son_basvuru)].filter(Boolean).join(" · ");

  return (
    <article className={`rounded-2xl p-4 ring-1 sm:p-5 ${basvurdu ? "bg-[var(--accent)]/[0.06]" : "bg-[var(--k-card)]"} ${halka}`}>
      {/* 1: title (+ new dot, open-ad corner button) */}
      <div className="flex items-start gap-3">
        {yeni && <span aria-hidden className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--accent)]" />}
        <h3 className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-5 text-[var(--k-t1)]">
          {yeni && <span className="sr-only">Yeni: </span>}
          {e.ilan.url ? (
            <a
              href={e.ilan.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`line-clamp-2 rounded-sm transition-colors hover:text-[var(--accent-light)] ${ODAK}`}
            >
              {e.ilan.baslik}
              <span className="sr-only"> (yeni sekmede açılır)</span>
            </a>
          ) : (
            <span className="line-clamp-2">{e.ilan.baslik}</span>
          )}
        </h3>
        {e.ilan.url && (
          // Touch shortcut to the same link: small to the eye, 40 px to the finger (after:),
          // and it does not grow the title row. The title link covers keyboard and screen readers.
          <a
            href={e.ilan.url}
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={-1}
            aria-hidden
            className="relative -mt-0.5 grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-white/[0.06] text-[var(--k-t2)] transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-white/[0.10] hover:text-[var(--k-t1)]"
          >
            <ExternalLink size={14} aria-hidden />
          </a>
        )}
      </div>

      {/* 2: where (city kept whole, company truncates first) + deadline + fit. Chips wrap below
          when the place would get narrower than ~9rem. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px] leading-5 text-[var(--k-t2)]">
        <span className="flex min-w-0 flex-[1_1_9rem]">
          {sirket && <span className="min-w-0 truncate">{sirket}</span>}
          {sirket && sehir && (
            <span aria-hidden className="flex-shrink-0 px-1">
              ·
            </span>
          )}
          {sehir && <span className={`truncate ${sirket ? "max-w-[65%] flex-shrink-0" : "min-w-0"}`}>{sehir}</span>}
        </span>
        <span className="ml-auto flex flex-shrink-0 items-center gap-1.5">
          {orta && (
            <span className={`${META_CIP} gap-1 bg-amber-300/[0.10] text-amber-200`}>
              <TriangleAlert size={11} aria-hidden />
              Kontrol et
            </span>
          )}
          {kalan !== null && kalan >= 0 && kalan <= 14 && (
            <span className={`${META_CIP} ${kalan <= 3 ? "bg-amber-300/[0.10] text-amber-200" : "bg-white/[0.08] text-[var(--k-t2)]"}`}>
              {kalan === 0 ? "Bugün son gün" : `${kalan} gün kaldı`}
            </span>
          )}
          <span className={`${META_CIP} font-semibold tabular-nums ${KARAR_STIL[e.karar]}`}>
            <span aria-hidden>Uyum {e.puan}</span>
            <span className="sr-only">Uyum {e.puan}/100</span>
          </span>
        </span>
      </div>

      {/* 3: why it fits, one line; also the details toggle */}
      <button
        type="button"
        onClick={() => setGerekceAcik((a) => !a)}
        aria-expanded={gerekceAcik}
        aria-controls={ayrintiId}
        className={`-mx-1.5 mt-1 flex min-h-9 w-[calc(100%+0.75rem)] items-center gap-1.5 rounded-lg px-1.5 text-left text-[12.5px] transition-colors hover:bg-white/[0.04] ${ODAK}`}
      >
        <span className="sr-only">Neden uygun: </span>
        {e.uyusan.length > 0 ? (
          <>
            <Check size={13} aria-hidden className="flex-shrink-0 text-[var(--accent)]" />
            <span className="min-w-0 truncate text-[var(--accent-light)]/90">{e.uyusan.slice(0, 2).join(" · ")}</span>
            {e.uyusan.length > 2 && <span className="flex-shrink-0 text-[var(--k-t3)]">+{e.uyusan.length - 2}</span>}
          </>
        ) : e.gerekce ? (
          <span className="min-w-0 truncate text-[var(--k-t2)]">{e.gerekce}</span>
        ) : (
          <span className="text-[var(--k-t2)]">Ayrıntılar</span>
        )}
        {e.uyusmayan.length > 0 && <span className="flex-shrink-0 whitespace-nowrap text-[var(--k-t3)]">· {e.uyusmayan.length} eksik</span>}
        <ChevronDown
          size={16}
          aria-hidden
          className={`ml-auto flex-shrink-0 text-[var(--k-t3)] transition-transform duration-150 motion-reduce:transition-none ${gerekceAcik ? "rotate-180" : ""}`}
        />
      </button>

      {kritik && <UyariSeridi risk={e.risk!} uyarilar={e.uyarilar} className="mt-2" />}

      {gerekceAcik && (
        <div id={ayrintiId} className="mt-2 space-y-2.5 rounded-xl bg-[var(--k-card-open)] p-3">
          {e.gerekce && <p className="text-[13px] leading-5 text-[var(--k-t2)]">{e.gerekce}</p>}
          {e.uyusan.length > 0 && (
            <div>
              <p className="text-[11.5px] text-[var(--k-t3)]">Uyanlar</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {e.uyusan.map((u) => (
                  <span key={"+" + u} className="h-6 max-w-full truncate rounded-full bg-[var(--accent)]/10 px-2 text-[12px] leading-6 text-[var(--accent-light)]/90">
                    {u}
                  </span>
                ))}
              </div>
            </div>
          )}
          {e.uyusmayan.length > 0 && (
            <div>
              <p className="text-[11.5px] text-[var(--k-t3)]">Eksikler</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {e.uyusmayan.map((u) => (
                  <span key={"-" + u} className="h-6 max-w-full truncate rounded-full bg-white/[0.06] px-2 text-[12px] leading-6 text-[var(--k-t2)]">
                    {u}
                  </span>
                ))}
              </div>
            </div>
          )}
          <p className="text-[12px] text-[var(--k-t3)]">{kunye}</p>
          {orta && <UyariSeridi risk={e.risk!} uyarilar={e.uyarilar} />}
          {e.ilan.url && (
            <a
              href={e.ilan.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-white/[0.06] text-[13px] text-[var(--k-t1)] transition-colors hover:bg-white/[0.10] ${ODAK}`}
            >
              İlanı sitede aç
              <ExternalLink size={14} aria-hidden />
            </a>
          )}
        </div>
      )}

      {/* 4: actions. On an applied card the feedback buttons are hidden (they are locked anyway). */}
      <div className="mt-2.5 grid grid-cols-3 gap-2">
        <EylemDugmesi
          ref={basvuruDugme}
          aktif={basvurdu}
          birincil
          onClick={() => {
            setPanelAcik(false);
            onBasvuru(e, !basvurdu);
          }}
          Ikon={basvurdu ? CircleCheckBig : CircleCheck}
          etiket={basvurdu ? "Başvurdun" : "Başvurdum"}
        />
        {basvurdu ? (
          <p className="col-span-2 self-center text-[12px] leading-4 text-[var(--k-t2)]">
            {"Başvurularım'da takip ediliyor"}
            <span className="block">Kaldırmak için yeniden bas</span>
          </p>
        ) : (
          <>
            <EylemDugmesi
              aktif={e.geri_bildirim === "ilgilendim" && !panelAcik}
              onClick={() => {
                // Tek değer: biri seçilince öbürü düşer; açık sebep paneli de kapanır
                setPanelAcik(false);
                onGeriBildir(e, e.geri_bildirim === "ilgilendim" ? null : "ilgilendim");
              }}
              Ikon={ThumbsUp}
              etiket="İlgimi çekti"
            />
            <EylemDugmesi
              ref={uymazDugme}
              aktif={sonuk || panelAcik}
              aktifSinif="bg-black/[0.18] text-[var(--k-t1)]"
              onClick={ilgilenmedimTikla}
              Ikon={ThumbsDown}
              etiket="Bana uymaz"
            />
          </>
        )}
      </div>

      {panelAcik && !sonuk && (
        <div
          role="group"
          aria-label="Neden uymadı?"
          className="mt-2 rounded-xl bg-white/[0.05] p-3"
          onKeyDown={(ev) => {
            if (ev.key === "Escape") {
              ev.stopPropagation();
              vazgec();
            }
          }}
        >
          <p ref={panelBaslik} tabIndex={-1} className="text-[13px] font-semibold text-[var(--k-t1)] outline-none">
            Neden uymadı?
          </p>
          <p className="mt-0.5 text-[12px] text-[var(--k-t2)]">Seçersen benzerlerini daha az gösteririz. Boş da bırakabilirsin.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SEBEPLER.map((sebep) => {
              const acik = secili.includes(sebep);
              return (
                <button
                  key={sebep}
                  type="button"
                  aria-pressed={acik}
                  onClick={() => setSecili((l) => (acik ? l.filter((x) => x !== sebep) : [...l, sebep]))}
                  className={cipSinifi(acik)}
                >
                  {acik && <Check size={12} aria-hidden />}
                  {sebep}
                </button>
              );
            })}
          </div>
          <input
            value={metin}
            onChange={(ev) => setMetin(ev.target.value)}
            onKeyDown={(ev) => ev.key === "Enter" && kaydet()}
            placeholder="Başka bir sebep (isteğe bağlı)"
            aria-label="Başka bir sebep (isteğe bağlı)"
            className={`mt-2 h-10 w-full rounded-xl border border-white/[0.08] bg-[var(--surface)] px-3 text-[13px] text-[var(--k-t1)] placeholder-[var(--k-t3)] ${GIRDI_ODAK}`}
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={vazgec}
              className={`h-10 rounded-xl px-4 text-[13px] text-[var(--k-t2)] transition-colors hover:bg-white/[0.06] hover:text-[var(--k-t1)] ${ODAK}`}
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={kaydet}
              className={`h-10 rounded-xl bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--background)] transition-colors hover:bg-[var(--accent-light)] ${ODAK}`}
            >
              Kaydet
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

/**
 * Kırmızı bayrak şeridi. Puan tavanı kodda uygulanıyor (lib/kariyer.ts riskliPuan);
 * burası ablama NEDENİNİ söylüyor — "puan neden 40" sorusu cevapsız kalmasın.
 */
function UyariSeridi({ risk, uyarilar, className = "" }: { risk: Risk; uyarilar: string[]; className?: string }) {
  const kritik = risk === "kritik";
  return (
    <div
      className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[12.5px] leading-[18px] ${
        kritik ? "bg-rose-300/[0.10] text-rose-100/90" : "bg-amber-300/[0.10] text-amber-200"
      } ${className}`}
    >
      <TriangleAlert size={14} className="mt-0.5 flex-shrink-0" aria-hidden />
      <div>
        <span className="font-medium">{kritik ? "Dikkat, bu ilan güvenilir görünmüyor" : "Kontrol et, şüpheli noktalar var"}</span>
        {uyarilar.length > 0 && <span className="text-current/80">: {uyarilar.join(", ")}</span>}
        {kritik && <span className="block text-[11.5px] opacity-80">Para, kimlik ya da kart bilgisi isteyen ilana başvurma.</span>}
      </div>
    </div>
  );
}

/**
 * Başvurularım: başvurduğun ilanlar, en eskisi üstte (cevap en çok onun için
 * gecikmiştir). 10 günü geçip cevap gelmeyenlerde "takip et" satırı — akşam
 * e-postasındaki hatırlatmayla aynı kural (lib/kariyer.ts takipGerekli).
 */
function BasvurularEkrani({
  liste,
  simdi,
  onGeriAl,
  onYenidenEkle,
}: {
  liste: Eslesme[] | null;
  simdi: number;
  onGeriAl: (e: Eslesme) => void;
  onYenidenEkle: (e: Eslesme) => void;
}) {
  // Rows removed during this visit stay in place, faded, with "Geri al": the button must not read as
  // "withdraw my application" with no way back. Snapshot keeps the original application date.
  const [cikarilan, setCikarilan] = useState<Record<string, Eslesme>>({});
  if (liste === null) return <SatirIskeleti adet={5} />;
  const kalanlar = Object.values(cikarilan).filter((c) => !liste.some((x) => x.ilan_id === c.ilan_id));
  if (!liste.length && !kalanlar.length) {
    return (
      <div className="rounded-2xl p-6 text-center text-[13.5px] leading-5 text-[var(--k-t2)] ring-1 ring-[var(--k-hair)]">
        Henüz başvuru işaretlemedin. Bir ilana başvurunca kartındaki “Başvurdum”a bas; burada görürsün. 10 gün cevap gelmezse akşam e-postası hatırlatır.
      </div>
    );
  }
  const gunOnce = (ts: string | null) => (ts ? Math.floor((simdi - new Date(ts).getTime()) / 86_400_000) : null);
  const cikarildiMi = (e: Eslesme) => !liste.some((x) => x.ilan_id === e.ilan_id);
  const satirlar = [...liste, ...kalanlar].sort((x, y) => (gunOnce(y.basvuru_ts) ?? 0) - (gunOnce(x.basvuru_ts) ?? 0));
  const takipSayisi = liste.filter((e) => takipGerekli(e.basvuru_durumu, e.basvuru_ts, null, new Date(simdi)) !== null).length;
  return (
    <div className="animate-fade-in motion-reduce:animate-none">
      <p className="mb-3 text-[12.5px] leading-[18px] text-[var(--k-t2)]">
        {liste.length} başvurun var
        {takipSayisi > 0 && <span className="text-amber-200"> · {takipSayisi} tanesine 10 günden uzun süredir cevap yok</span>}
      </p>
      <div className="space-y-2">
        {satirlar.map((e) => {
          const cikti = cikarildiMi(e);
          const gun = gunOnce(e.basvuru_ts);
          const takip = !cikti && takipGerekli(e.basvuru_durumu, e.basvuru_ts, null, new Date(simdi)) !== null;
          const meta = [
            e.ilan?.sirket,
            e.ilan?.sehir,
            kaynakEtiketi(e.ilan?.kaynak ?? ""),
            gun !== null ? `${gun === 0 ? "bugün" : `${gun} gün önce`} başvurdun` : null,
            e.ilan?.kaldirildi ? "ilan sitede kaldırıldı" : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <div
              key={e.ilan_id}
              className={`flex items-center gap-2 rounded-2xl p-3 ring-1 ring-[var(--k-hair)] ${cikti ? "bg-black/[0.06]" : "bg-[var(--k-card)]"}`}
            >
              <div className="min-w-0 flex-1">
                <p className={`text-[14px] font-medium ${cikti ? "text-[var(--k-t2)]" : "text-[var(--k-t1)]"}`}>
                  {e.ilan?.url ? (
                    <a href={e.ilan.url} target="_blank" rel="noopener noreferrer" className={`block truncate rounded-sm hover:text-[var(--accent-light)] ${ODAK}`}>
                      {e.ilan.baslik}
                      <span className="sr-only"> (yeni sekmede açılır)</span>
                    </a>
                  ) : (
                    <span className="block truncate">{e.ilan?.baslik}</span>
                  )}
                </p>
                {cikti ? (
                  <p className="truncate text-[12px] text-[var(--k-t2)]">Listeden çıkarıldı; şirketteki başvurun etkilenmez</p>
                ) : (
                  meta && <p className="truncate text-[12px] text-[var(--k-t2)]">{meta}</p>
                )}
                {takip && (
                  <p className="mt-1 flex w-fit max-w-full items-start gap-1 rounded-md bg-amber-300/[0.10] px-1.5 py-0.5 text-[11.5px] text-amber-200">
                    <TriangleAlert size={11} className="mt-[3px] flex-shrink-0" aria-hidden />
                    <span>{gun} gündür cevap yok; kurumu arayıp sorabilirsin</span>
                  </p>
                )}
              </div>
              {cikti ? (
                <button
                  type="button"
                  onClick={() => {
                    // Undo: re-mark from the snapshot (as "not applied" so the counter goes up again)
                    onYenidenEkle({ ...e, basvuru_durumu: null });
                    setCikarilan((m) => {
                      const geri = { ...m };
                      delete geri[e.ilan_id];
                      return geri;
                    });
                  }}
                  aria-label={`${e.ilan?.baslik ?? "İlan"}: listeye geri al`}
                  className={`h-10 flex-shrink-0 rounded-xl bg-[var(--accent)]/12 px-3 text-[13px] text-[var(--accent-light)] transition-colors hover:bg-[var(--accent)]/20 ${ODAK}`}
                >
                  Geri al
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setCikarilan((m) => ({ ...m, [e.ilan_id]: e }));
                    onGeriAl(e);
                  }}
                  aria-label={`${e.ilan?.baslik ?? "İlan"}: başvuru işaretini kaldır`}
                  className={`h-10 flex-shrink-0 rounded-xl bg-white/[0.06] px-3 text-[13px] text-[var(--k-t2)] transition-colors hover:bg-white/[0.10] hover:text-[var(--k-t1)] ${ODAK}`}
                >
                  İşareti kaldır
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Card action button. Label always visible, icon beside it in one 40 px row
 * (the icon drops below 370 px so the label fits). birincil: "Başvurdum", accent-tinted.
 */
function EylemDugmesi({
  aktif,
  onClick,
  Ikon,
  etiket,
  birincil = false,
  aktifSinif = "bg-[var(--accent)]/15 text-[var(--accent-light)]",
  ref,
}: {
  aktif: boolean;
  onClick: () => void;
  Ikon: typeof ThumbsUp;
  etiket: string;
  birincil?: boolean;
  aktifSinif?: string;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  const durum = birincil
    ? aktif
      ? "bg-[var(--accent)]/25 text-[var(--accent-light)]"
      : "bg-[var(--accent)]/12 text-[var(--accent-light)] hover:bg-[var(--accent)]/20"
    : aktif
      ? aktifSinif
      : "bg-white/[0.05] text-[var(--k-t2)] hover:bg-white/[0.08] hover:text-[var(--k-t1)]";
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-pressed={aktif}
      className={`flex h-10 min-w-0 items-center justify-center gap-1 rounded-xl px-1 text-[12.5px] font-medium leading-tight transition-colors sm:gap-1.5 sm:text-[13px] ${ODAK} ${durum}`}
    >
      <Ikon size={15} className="flex-shrink-0 max-[369px]:hidden" aria-hidden />
      <span className="max-w-full truncate">{etiket}</span>
    </button>
  );
}

// ---------------------------------------------------------------- profil

/**
 * Tek kayıt noktası. "Profili çıkar" yalnızca gösterir; "Kaydet" metni, profili
 * ve şartları birlikte yazar. Önceki sürümde çıkarma da kaydediyordu ve ablam
 * "kaydettim mi?" diye ikilemde kalıyordu. Kaydedilmemiş değişiklik varsa
 * düğmenin üstünde yazıyor; yoksa düğme sönük.
 */
function ProfilEkrani({ satir, onKaydedildi }: { satir: ProfilSatiri | null; onKaydedildi: () => void }) {
  const { addToast } = useToast();
  const [metin, setMetin] = useState(satir?.serbest_metin ?? "");
  const [profil, setProfil] = useState<KariyerProfili>(satir?.profil ?? BOS_PROFIL);
  const [oneriler, setOneriler] = useState<ProfilOnerisi[]>([]);
  const [sehirler, setSehirler] = useState<string[]>(satir?.sehirler ?? []);
  const [uzaktan, setUzaktan] = useState(satir?.uzaktan_olur ?? true);
  const [eposta, setEposta] = useState(satir?.bildirim_eposta ?? "");
  const [cikariliyor, setCikariliyor] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [sifirlaniyor, setSifirlaniyor] = useState(false);
  const [temizleniyor, setTemizleniyor] = useState(false);

  /**
   * Bütün ilanlar ve eşleşmeler silinir; profil ve tarama geçmişi kalır.
   * Sonraki tarama her şeyi sıfırdan çekip yeniden puanlar — onay bunu söylüyor.
   */
  const ilanlariTemizle = async () => {
    if (temizleniyor) return;
    if (!window.confirm("Bütün ilanlar, puanlar ve geri bildirimler silinecek; profil kalır. Bir sonraki tarama her şeyi sıfırdan çekip yeniden puanlar (ilk koşu paralı, günlük tavan geçerli). Devam?")) return;
    setTemizleniyor(true);
    try {
      const res = await fetch("/api/kariyer/ilanlar", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.hata ?? "Temizlenemedi.");
      addToast(`${data.silinen} ilan silindi${data.korunan ? `, ${data.korunan} başvurun korundu` : ""} — liste bir sonraki taramada yeniden dolar`, "success");
      onKaydedildi();
    } catch (err) {
      addToast((err as Error).message, "error");
    } finally {
      setTemizleniyor(false);
    }
  };
  const [yenidenSayi, setYenidenSayi] = useState<number | null>(null);
  const [yenideniliyor, setYenideniliyor] = useState(false);

  // Kaydedilmiş profil varsa: son 7 günün kaç ilanı yeniden puanlanabilir (düğme sayıyı gösterir)
  useEffect(() => {
    if (!satir?.profil || profilBosMu(satir.profil)) return;
    queueMicrotask(async () => {
      const res = await fetch("/api/kariyer/yeniden-degerlendir").catch(() => null);
      const data = res?.ok ? await res.json() : null;
      setYenidenSayi(typeof data?.sayi === "number" ? data.sayi : null);
    });
  }, [satir]);

  /** Paralı, o yüzden onaylı: son 7 günün puanları silinir, tarayıcı yeni profille yeniden puanlar */
  const yenidenPuanla = async () => {
    if (yenideniliyor || !yenidenSayi) return;
    const tahmin = (yenidenSayi * 0.004).toFixed(2);
    if (!window.confirm(`Son 7 günün ${yenidenSayi} ilanı yeni profile göre yeniden puanlanacak (yaklaşık $${tahmin}, saat başı 25'er). Geri bildirim verdiklerin korunur. Devam?`)) return;
    setYenideniliyor(true);
    try {
      const res = await fetch("/api/kariyer/yeniden-degerlendir", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.hata ?? "Başlatılamadı.");
      addToast(`${data.sifirlanan} ilan sıraya alındı — uyumları sonraki taramalarda yeniden hesaplanacak`, "success");
      setYenidenSayi(0);
    } catch (err) {
      addToast((err as Error).message, "error");
    } finally {
      setYenideniliyor(false);
    }
  };
  // Her çıkarmada artıyor; liste alanları key ile sıfırlanıyor
  const [surum, setSurum] = useState(0);

  // Kaydedilmiş hâlin anlık görüntüsü — "değişiklik var mı" bununla kıyaslanıyor
  const kayitli = useMemo(
    () =>
      JSON.stringify({
        metin: satir?.serbest_metin ?? "",
        profil: satir?.profil ?? BOS_PROFIL,
        sehirler: satir?.sehirler ?? [],
        uzaktan: satir?.uzaktan_olur ?? true,
        eposta: satir?.bildirim_eposta ?? "",
      }),
    [satir]
  );
  const simdiki = JSON.stringify({ metin, profil, sehirler, uzaktan, eposta });
  const degisti = simdiki !== kayitli;
  const bos = profilBosMu(profil);

  const cikar = async () => {
    if (cikariliyor) return;
    setCikariliyor(true);
    try {
      const res = await fetch("/api/kariyer/profil", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serbestMetin: metin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.hata ?? "Profil çıkarılamadı.");
      setProfil(data.profil);
      setOneriler(data.oneriler ?? []);
      setSurum((n) => n + 1);
    } catch (err) {
      addToast((err as Error).message, "error");
    } finally {
      setCikariliyor(false);
    }
  };

  const kaydet = async () => {
    if (kaydediliyor) return;
    setKaydediliyor(true);
    try {
      const res = await fetch("/api/kariyer/profil", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serbestMetin: metin,
          profil,
          sehirler,
          uzaktanOlur: uzaktan,
          bildirimEposta: eposta,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.hata ?? "Kaydedilemedi.");
      addToast(
        data.sifirlanan
          ? `Kaydedildi — şehir süzgecine takılan ${data.sifirlanan} ilana yeni şartlarla yeniden bakılacak`
          : "Kaydedildi — bir sonraki taramada bu profil kullanılacak",
        "success"
      );
      onKaydedildi();
    } catch (err) {
      addToast((err as Error).message, "error");
    } finally {
      setKaydediliyor(false);
    }
  };

  /**
   * Profili baştan kurmak için: metin, profil ve şehirler silinir.
   * E-posta ve "uzaktan olur" kalır — kimlik bilgisi, profil değil. İlanlar ve
   * eşleşmeler de kalır; sıfırlama "beni yeniden anlat" demek, "geçmişi sil" değil.
   */
  const sifirla = async () => {
    if (sifirlaniyor) return;
    if (!window.confirm("Profil silinecek: anlattığın metin, çıkarılan profil ve şehirler. İlanlar ve eşleşmeler kalır. Devam?")) return;
    setSifirlaniyor(true);
    try {
      const res = await fetch("/api/kariyer/profil", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serbestMetin: "", profil: BOS_PROFIL, sehirler: [] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.hata ?? "Sıfırlanamadı.");
      addToast("Profil sıfırlandı — yeni profil kaydedilene kadar ilan aranmaz", "success");
      onKaydedildi();
    } catch (err) {
      addToast((err as Error).message, "error");
    } finally {
      setSifirlaniyor(false);
    }
  };

  /** Öneriyi "kabul edeceğin işler"e ekler/çıkarır */
  const oneriyiDegistir = (is: string) => {
    const varMi = profil.kabulEder.includes(is);
    setProfil({ ...profil, kabulEder: varMi ? profil.kabulEder.filter((x) => x !== is) : [...profil.kabulEder, is] });
    setSurum((n) => n + 1);
  };

  const kartSinifi = "rounded-2xl bg-[var(--k-card)] p-4 ring-1 ring-[var(--k-hair)]";
  const baslikSinifi = "text-[15px] font-semibold text-[var(--k-t1)]";
  const aciklamaSinifi = "mt-1 text-[13px] leading-5 text-[var(--k-t2)]";

  return (
    <div className="animate-fade-in space-y-3 motion-reduce:animate-none">
      <section className={kartSinifi}>
        <h2 className={baslikSinifi}>1 · Kendini anlat</h2>
        <p className={aciklamaSinifi}>
          Eğitimin, yaptığın işler, bildiğin programlar, ne istediğin, ne istemediğin — kendi cümlelerinle.
          Şehri aşağıda ayrıca soruyoruz.
        </p>
        <textarea
          value={metin}
          onChange={(e) => setMetin(e.target.value)}
          rows={6}
          aria-label="Kendini anlat"
          placeholder="Örn: Grafik tasarım mezunuyum, 3 yıl ajansta çalıştım, Photoshop ve Illustrator bilirim. Tasarım ya da sosyal medya işi arıyorum; satış istemem…"
          className={`mt-3 w-full resize-y rounded-xl border border-white/[0.08] bg-[var(--surface)] p-3.5 text-[13.5px] leading-relaxed text-[var(--k-t1)] placeholder-[var(--k-t3)] ${GIRDI_ODAK}`}
        />
        <button
          onClick={cikar}
          disabled={cikariliyor || metin.trim().length < 20}
          aria-describedby={!cikariliyor && metin.trim().length < 20 ? "kariyer-anlat-ipucu" : undefined}
          className={`mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 text-[13px] font-medium text-[var(--background)] transition-colors hover:bg-[var(--accent-light)] disabled:cursor-not-allowed disabled:opacity-40 ${ODAK}`}
        >
          {cikariliyor ? <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}
          {cikariliyor ? "Okuyorum..." : bos ? "Yazdıklarımdan profil oluştur" : "Yazdıklarımdan yeniden oluştur"}
        </button>
        {/* Why the button is dim: the 20-character minimum was never said */}
        {!cikariliyor && metin.trim().length < 20 && (
          <p id="kariyer-anlat-ipucu" className="mt-1.5 text-center text-[12px] text-[var(--k-t3)]">
            {metin.trim().length === 0
              ? "Önce birkaç cümle yaz, sonra bu düğme açılır."
              : `Biraz daha anlat: ${20 - metin.trim().length} harf daha yazınca düğme açılır.`}
          </p>
        )}
      </section>

      {!bos && (
        <section key={surum} className={kartSinifi}>
          <h2 className={baslikSinifi}>2 · Seni şöyle anladım</h2>
          <p className={aciklamaSinifi}>İlanlar buna göre sıralanıyor. Yanlış ya da eksik varsa doğrudan düzelt — her satır bir madde.</p>
          <div className="mt-4 space-y-4">
            <Alan etiket="Özet">
              <textarea value={profil.ozet} onChange={(e) => setProfil({ ...profil, ozet: e.target.value })} rows={2} className={girdiSinifi} />
            </Alan>
            <ListeAlani etiket="Yapabildiğin işler" deger={profil.yapabildigi} onChange={(v) => setProfil({ ...profil, yapabildigi: v })} />
            <ListeAlani etiket="Kabul edeceğin işler" deger={profil.kabulEder} onChange={(v) => setProfil({ ...profil, kabulEder: v })} />

            {oneriler.length > 0 && (
              <div className="rounded-xl bg-[var(--accent)]/[0.06] p-3.5">
                <p className="text-[13px] leading-5 text-[var(--k-t2)]">
                  <span className="font-medium text-[var(--accent-light)]">Bunlar da uyabilir.</span> Tıkladığın &quot;kabul
                  edeceğin işler&quot;e eklenir; tıklamadığın yok sayılır.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {oneriler.map((o) => {
                    const secili = profil.kabulEder.includes(o.is);
                    return (
                      <button key={o.is} type="button" onClick={() => oneriyiDegistir(o.is)} title={o.neden} aria-pressed={secili} className={cipSinifi(secili)}>
                        {secili ? <Check size={12} aria-hidden /> : <Plus size={12} aria-hidden />}
                        {o.is}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <ListeAlani etiket="İstemediklerin" deger={profil.istemez} onChange={(v) => setProfil({ ...profil, istemez: v })} />
            <ListeAlani etiket="Güçlü yanların" deger={profil.guclu} onChange={(v) => setProfil({ ...profil, guclu: v })} />

            <details className="group rounded-xl bg-white/[0.03] px-3.5">
              <summary
                className={`flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg text-[13px] text-[var(--k-t2)] transition-colors hover:text-[var(--k-t1)] ${ODAK}`}
              >
                <span className="min-w-0 flex-1">Arama terimleri ({profil.aramaTerimleri.length}) — iş sitelerinde bunlar aranıyor</span>
                <ChevronDown size={14} aria-hidden className="flex-shrink-0 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
              </summary>
              <div className="pb-3 pt-1">
                <ListeAlani
                  etiket="Terimler"
                  aciklama="Her satır bir arama. Türkçe ve İngilizce karışık olabilir; LinkedIn'de İngilizce başlık çok."
                  deger={profil.aramaTerimleri}
                  onChange={(v) => setProfil({ ...profil, aramaTerimleri: v })}
                />
              </div>
            </details>
          </div>
        </section>
      )}

      <section className={kartSinifi}>
        <h2 className={baslikSinifi}>{bos ? "2" : "3"} · Nerede, nasıl çalışırsın</h2>
        <p className={aciklamaSinifi}>Bunlar kesin süzgeç: uymayan ilana hiç bakılmaz.</p>
        <div className="mt-4 space-y-4">
          <Alan etiket="Şehirler" aciklama="Birden fazla olabilir. Boş bırakırsan her yer." sarmalama={false}>
            <EtiketGirdisi deger={sehirler} onChange={(v) => setSehirler(sehirleriDogrula(v))} placeholder="Şehir yaz, Ekle'ye bas" />
          </Alan>
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl bg-[var(--surface)] px-3.5 py-2">
            <input
              type="checkbox"
              checked={uzaktan}
              onChange={(e) => setUzaktan(e.target.checked)}
              className={`h-5 w-5 flex-shrink-0 accent-[var(--accent)] ${ODAK}`}
            />
            <span className="min-w-0">
              <span className="block text-[13px] text-[var(--k-t1)]">Uzaktan (evden) çalışmaya açığım</span>
              <span className="block text-[12px] text-[var(--k-t3)]">Başka şehirdeki ilan uzaktansa yine gösterilir</span>
            </span>
          </label>
          <Alan etiket="E-posta" aciklama="Sana çok uygun ilanlar ve akşam özeti buraya gelir.">
            <input value={eposta} onChange={(e) => setEposta(e.target.value)} type="email" placeholder="sen@ornek.com" className={girdiSinifi} />
          </Alan>
        </div>
      </section>

      <div className="glass sticky bottom-4 z-10 rounded-2xl p-2 shadow-lg shadow-black/20 ring-1 ring-[var(--k-hair)]">
        {degisti && !bos && <p className="mb-1.5 text-center text-[12px] text-amber-200/85">Kaydedilmemiş değişiklik var</p>}
        <button
          onClick={kaydet}
          disabled={kaydediliyor || bos || !degisti}
          className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-[13.5px] transition-colors disabled:cursor-not-allowed ${ODAK} ${
            bos
              ? "bg-white/[0.06] text-[var(--k-t2)]"
              : degisti
                ? "bg-[var(--accent)] font-medium text-[var(--background)] hover:bg-[var(--accent-light)] disabled:opacity-70"
                : "bg-white/[0.06] text-[var(--k-t2)]"
          }`}
        >
          {kaydediliyor ? <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden /> : !bos && !degisti ? <Check size={14} aria-hidden /> : null}
          {bos ? "Önce profilini oluştur" : degisti ? "Değişiklikleri kaydet" : "Kaydedildi"}
        </button>
      </div>

      {satir?.profil && !profilBosMu(satir.profil) && (
        <details className="group">
          <summary
            className={`flex h-11 cursor-pointer list-none items-center justify-center gap-1.5 rounded-xl text-[13px] text-[var(--k-t2)] transition-colors hover:text-[var(--k-t1)] ${ODAK}`}
          >
            Diğer işlemler
            <ChevronDown size={14} aria-hidden className="transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
          </summary>
          <div className="mt-1 space-y-1.5">
            <IslemSatiri
              onClick={yenidenPuanla}
              disabled={yenideniliyor || !yenidenSayi || degisti}
              title={degisti ? "Önce kaydet" : "Profil değiştiyse eski uyum sonuçları eski profile ait; bu düğme onları yeniden hesaplatır"}
              yukleniyor={yenideniliyor}
              Ikon={RefreshCw}
              baslik={`Son 7 günün uyumunu yeniden hesapla${yenidenSayi ? ` (${yenidenSayi})` : ""}`}
              aciklama="Profilini değiştirdiysen eski ilanları yeni profile göre yeniden sıralar."
            />
            <IslemSatiri
              onClick={sifirla}
              disabled={sifirlaniyor}
              yukleniyor={sifirlaniyor}
              Ikon={RotateCcw}
              yikici
              baslik="Profili sıfırla"
              aciklama="Anlattığın metin, profil ve şehirler silinir; ilanlar kalır."
            />
            <IslemSatiri
              onClick={ilanlariTemizle}
              disabled={temizleniyor}
              yukleniyor={temizleniyor}
              Ikon={Trash2}
              ikonSinifi="text-rose-300/80"
              yikici
              baslik="Tüm ilanları temizle"
              aciklama="İlanlar, uyum sonuçları ve geri bildirimler silinir; profil kalır."
            />
          </div>
        </details>
      )}
    </div>
  );
}

/** Full-width row button inside "Diğer işlemler": icon + title + one-line explanation */
function IslemSatiri({
  onClick,
  disabled,
  title,
  yukleniyor,
  Ikon,
  baslik,
  aciklama,
  yikici = false,
  ikonSinifi = "text-[var(--k-t2)]",
}: {
  onClick: () => void;
  disabled: boolean;
  title?: string;
  yukleniyor: boolean;
  Ikon: typeof Trash2;
  baslik: string;
  aciklama: string;
  yikici?: boolean;
  ikonSinifi?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex min-h-12 w-full items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        yikici ? "enabled:hover:bg-rose-300/[0.10]" : "enabled:hover:bg-white/[0.06]"
      } ${ODAK}`}
    >
      {yukleniyor ? (
        <Loader2 size={16} aria-hidden className={`flex-shrink-0 motion-safe:animate-spin ${ikonSinifi}`} />
      ) : (
        <Ikon size={16} aria-hidden className={`flex-shrink-0 ${ikonSinifi}`} />
      )}
      <span className="min-w-0">
        <span className="block text-[13.5px] text-[var(--k-t1)]">{baslik}</span>
        <span className="block text-[11.5px] leading-4 text-[var(--k-t2)]">{aciklama}</span>
      </span>
    </button>
  );
}

/**
 * Etiket girdisi: Enter ya da virgül ekler, × siler, Backspace boş kutuda
 * sonuncuyu siler. Şehirler için; ablam tek tek yazsın, liste görünsün.
 * "Ekle" button: the same ekle(), for people who do not know Enter adds.
 */
function EtiketGirdisi({ deger, onChange, placeholder }: { deger: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [yazilan, setYazilan] = useState("");
  const ekle = () => {
    const parcalar = yazilan.split(",").map((s) => s.trim()).filter(Boolean);
    if (parcalar.length) onChange([...deger, ...parcalar]);
    setYazilan("");
  };
  return (
    <div className="flex items-center gap-2">
      <div className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[var(--surface)] px-2.5 py-1.5 transition-shadow focus-within:border-[var(--accent)]/40 focus-within:ring-2 focus-within:ring-[rgb(var(--accent-rgb)/0.6)]">
        {deger.map((d) => (
          <span key={d} className="flex items-center gap-1 rounded-full bg-[var(--accent)]/10 py-1 pl-3 pr-1 text-[12.5px] text-[var(--accent-light)]">
            {d}
            {/* 28x24 button; the hit area grows to 40x40 but only 4 px towards the label and
                8 px elsewhere, so it stays inside the chip padding and the 6 px gaps (no overlap
                with the input or the next row). */}
            <button
              type="button"
              onClick={() => onChange(deger.filter((x) => x !== d))}
              aria-label={`${d} kaldır`}
              className={`relative grid h-6 w-7 place-items-center rounded-full text-[var(--accent-light)]/70 transition-colors after:absolute after:-inset-y-2 after:-left-1 after:-right-2 after:content-[''] hover:bg-white/10 hover:text-[var(--k-t1)] ${ODAK}`}
            >
              <X size={12} aria-hidden />
            </button>
          </span>
        ))}
        <input
          value={yazilan}
          onChange={(e) => setYazilan(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              ekle();
            } else if (e.key === "Backspace" && !yazilan && deger.length) {
              onChange(deger.slice(0, -1));
            }
          }}
          onBlur={ekle}
          aria-label={placeholder ?? "Ekle"}
          placeholder={deger.length ? "" : placeholder}
          className="min-w-[10ch] flex-1 bg-transparent px-1 py-1 text-[13.5px] text-[var(--k-t1)] placeholder-[var(--k-t3)] outline-none"
        />
      </div>
      {yazilan.trim() && (
        <button
          type="button"
          // Keep focus in the input so blur does not add first and remove this button mid-click
          onMouseDown={(e) => e.preventDefault()}
          onClick={ekle}
          className={`h-10 flex-shrink-0 rounded-xl bg-white/[0.08] px-3 text-[13px] text-[var(--k-t1)] transition-colors hover:bg-white/[0.12] ${ODAK}`}
        >
          Ekle
        </button>
      )}
    </div>
  );
}

const girdiSinifi = `min-h-11 w-full rounded-xl border border-white/[0.08] bg-[var(--surface)] px-3.5 py-2.5 text-[13.5px] text-[var(--k-t1)] placeholder-[var(--k-t3)] ${GIRDI_ODAK}`;

/**
 * Alan başlığı + girdi. Varsayılan <label>: başlığa tıklayınca girdi odaklanır.
 * `sarmalama`: içinde DÜĞME olan girdiler (etiket listesi) için — <label>'a
 * tıklamak içindeki ilk etiketlenebilir öğeyi tetikler, o da ilk şehrin "×"
 * düğmesi oluyordu: başlığa her tıklamada bir şehir siliniyordu.
 */
function Alan({ etiket, aciklama, children, sarmalama = true }: { etiket: string; aciklama?: string; children: React.ReactNode; sarmalama?: boolean }) {
  const Sarici = sarmalama ? "label" : "div";
  return (
    <Sarici className="block">
      <span className={`block text-[13px] font-medium text-[var(--k-t1)] ${aciklama ? "mb-0.5" : "mb-1.5"}`}>{etiket}</span>
      {aciklama && <span className="mb-1.5 block text-[12px] text-[var(--k-t3)]">{aciklama}</span>}
      {children}
    </Sarici>
  );
}

/**
 * Liste alanı: her satır bir madde. Ablam için en az sürtünmeli düzenleme biçimi.
 * Metin yerel state; dışarıdan yeni profil gelince (yeniden anla) üst bileşen
 * key değiştirerek bu alanı sıfırlıyor — efektle prop'tan state kopyalamak yok.
 */
function ListeAlani({ etiket, aciklama, deger, onChange }: { etiket: string; aciklama?: string; deger: string[]; onChange: (v: string[]) => void }) {
  const [metin, setMetin] = useState(deger.join("\n"));
  return (
    <Alan etiket={etiket} aciklama={aciklama}>
      <textarea
        value={metin}
        onChange={(e) => setMetin(e.target.value)}
        onBlur={() => onChange(metin.split("\n").map((s) => s.trim()).filter(Boolean))}
        rows={Math.max(2, Math.min(6, deger.length + 1))}
        className={girdiSinifi + " resize-y leading-relaxed"}
      />
    </Alan>
  );
}
