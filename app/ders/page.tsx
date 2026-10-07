"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
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
  Pilcrow,
  Dices,
  Search,
  Timer,
  ListChecks,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Archive,
  ArchiveRestore,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { useToast } from "@/components/Toast";
import { useModal } from "@/components/useModal";
import { useKuyruk } from "@/components/ders/DersKuyrugu";
import BahceLogo, { MODUL_PALETLERI } from "@/components/BahceLogo";
import { yanlisKuraliMetni } from "@/lib/yanlislar";
import {
  DERS_NOTLARI_KLASORU,
  ES_ZAMANLI_URETIM,
  formatSure,
  IS_CALISIYOR,
  DENEME_EN_AZ_HAVUZ,
  DENEME_EN_AZ_SORU,
  DENEME_EN_FAZLA_SORU,
  DENEME_TEMPOLARI,
  DENEME_VARSAYILAN_SORU,
  DENEME_VARSAYILAN_TEMPO,
  netHesapla,
  sayacMetni,
  KATEGORI_DIGER,
  KATEGORILER,
  linkleriAyikla,
  METIN_EN_AZ,
  METIN_EN_FAZLA,
  metinDersiMi,
  PARAGRAF_VIDEO,
  NOT_KATEGORISIZ,
  notBasligi,
  oynatmaListesiKimligi,
  notVideoId,
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
  /** 'ders' dışındakiler bir videodan üretilmedi: 'tekrar' pratik, 'deneme' sınav */
  tur: string;
  tekrarMi: boolean;
  sure: number;
  /** Videonun YouTube'daki kendi adı — ders adı modelin verdiği addır */
  videoBaslik: string | null;
  /** Metinden üretilmiş ders (video yok): küçük resim, süre, yayın tarihi gösterilmez */
  metin: boolean;
  /** Türkçe kartındaki düğmeyle istenen paragraf dersi (paragrafları model yazdı) */
  paragraf: boolean;
  /** Videonun YouTube'a yüklenme anı; liste bu alana göre sıralanıyor */
  yayin: string | null;
  /** Yalnızca denemelerde: sınavın toplam süresi (saniye) */
  denemeSure: number | null;
  /** Deneme bitirildiyse o an; doluysa sınav kapanmıştır */
  denemeBitti: string | null;
  soruSayisi: number;
  cevapSayisi: number;
  dogruSayisi: number;
  yarim: boolean;
}

/** Arşivlenmiş ders (tur "arsiv") — listenin altındaki katlanır bölümde */
interface ArsivDersi {
  id: string;
  title: string | null;
  kategori: string;
  created_at: string;
}

/** Ders notu — kategorisi ve başlığı ait olduğu dersten çözülmüş hâliyle */
interface DersNotu {
  id: string;
  updated_at: string;
  kategori: string;
  baslik: string;
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

/** Oynatma listesi karşılaştırması — /api/ders/oynatma-listesi'nin döndürdüğü */
interface ListeSatiri {
  videoId: string;
  baslik: string;
  sira: number;
  durum: "ders" | "yarim" | "transkript" | "eksik" | "baska";
  dersSayisi: number;
  dersId: string | null;
  kategori: string | null;
}
interface ListeKarsilastirma {
  baslik: string | null;
  toplam: number;
  atlanan: number;
  /** Liste 500 videodan uzundu, ilk 500'ü okundu */
  kirpildi: boolean;
  ozet: {
    ders: number;
    yarim: number;
    transkript: number;
    eksik: number;
    baska: number;
    mukerrer: number;
  };
  satirlar: ListeSatiri[];
}

const LISTE_DURUM_METNI: Record<ListeSatiri["durum"], string> = {
  ders: "eklendi",
  yarim: "yarım kaldı",
  transkript: "transkripti var, dersi yok",
  eksik: "eksik",
  baska: "başka kategoride",
};

/** Kategori başına son karşılaştırılan liste linki — bir daha yapıştırmasın */
const LISTE_HAFIZASI = "ablam-liste-linkleri";

/**
 * Kategorinin listedeki yeri: önce ablamın verdiği sıra, sırası verilmemişler
 * onların altında kapalı listedeki düzenle (Tarih, Coğrafya, … — KPSS gibi liste
 * dışı adlar en sonda). Sabit: yeni ders eklemek kategorinin yerini değiştirmez.
 */
function kategoriYeri(kategori: string, sira: string[]): number {
  const i = sira.indexOf(kategori);
  if (i >= 0) return i;
  const j = (KATEGORILER as readonly string[]).indexOf(kategori);
  return 1000 + (j >= 0 ? j : 500);
}

/** Hangi kategoriler açık bırakıldı — sayfa en son bırakıldığı gibi açılsın */
const ACIK_KATEGORI_HAFIZASI = "ablam-ders-acik-kategoriler";

/** Kuyruktaki bir işin ekranda görünen hâli */
const DURUM_METNI: Record<IsDurumu, string> = {
  bekliyor: "Sırada bekliyor",
  transkript: "Altyazı alınıyor…",
  cozumleme: "Ders çözümleniyor: özet ve konular…",
  coktan: "Çoktan seçmeli sorular hazırlanıyor…",
  paragraf: "Paragraf soruları yazılıyor…",
  hazir: "Hazır",
  elle: "Altyazı alınamadı — transkripti yapıştır",
  mevcut: "Bu ders zaten var",
  hata: "Hata",
};

/**
 * Listede en fazla kaç ders gösterilir. 50'ydi ve tavana çarpınca eski dersler
 * hiçbir uyarı olmadan kayboluyordu — günde birkaç ders çözüldüğünde bir ay
 * bile sürmüyor, ablam derslerinin silindiğini sanıyordu. Sayı yükseltildi ve
 * tavana çarpıldığı artık listenin altında yazıyor: sessiz kesme yok.
 */
const LISTE_TAVANI = 200;

/**
 * Kategori kartında listelenen deneme sayısı. Net gelişimini görmeye yetecek
 * kadar; daha fazlası kartı ders listesinden uzaklaştırıyor. Tavana çarpıldığı
 * listenin altında yazıyor, sessiz kesme yok.
 */
const DENEME_LISTE_TAVANI = 5;


export default function DersAnaSayfa() {
  const [link, setLink] = useState("");
  /**
   * Ders ekleme kutusu iki biçimde: YouTube linki ya da ders METNİ (not, özet).
   * Metin de aynı kuyruktan geçip kategorisinde normal ders olarak duruyor
   * (bkz. lib/ders.ts METIN_ONEKI).
   */
  const [girisModu, setGirisModu] = useState<"link" | "metin">("link");
  const [dersMetni, setDersMetni] = useState("");
  const [oturumlar, setOturumlar] = useState<OturumOzeti[]>([]);
  /**
   * ARŞİV. Ablam bir dersle işi bitince (KPSS'den sonra TYT/AYT'ye geçti) ders
   * silinmiyor, türü "arsiv" oluyor: Soru Gönder, deneme, Yanlışlarım ve arama
   * yalnızca "ders" türüne baktığı için hepsinden çıkıyor, cevap geçmişi ise
   * duruyor. "Geri al" türü "ders"e döndürüyor, her şey kaldığı yerden sürüyor.
   */
  const [arsiv, setArsiv] = useState<ArsivDersi[]>([]);
  const [arsivAcik, setArsivAcik] = useState(false);
  /**
   * KATEGORİ SIRASI ablamın elinde. Eskiden kategoriler en son ders eklenene
   * göre diziliyordu; yeni ders ekledikçe yerleri değişiyordu (07.10.2026'da
   * ablam istemedi). Sıra ders_kategori_sira tablosunda (db/ders-kategori-sira.sql),
   * telefonla bilgisayar aynı sırayı görsün diye tarayıcıda değil.
   */
  const [kategoriSirasi, setKategoriSirasi] = useState<string[]>([]);
  /** "Sırala" modu: kategori başlıklarında ↑↓ çıkıyor */
  const [kategoriSiralama, setKategoriSiralama] = useState(false);
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
  /** Silme onayı: yalnızca kimlik değil, ne silindiği de lazım (metin değişiyor) */
  const [silinecek, setSilinecek] = useState<{ id: string; deneme: boolean } | null>(null);
  const [tekrarKuruluyor, setTekrarKuruluyor] = useState<string | null>(null);
  /**
   * Yanlışlarım, DERS BAZLI (bkz. lib/yanlislar.ts): kategori -> bugün vadesi
   * gelen, sistemdeki, öğrenilen ve bugün başlanmış oturum. Ayrı istekte ve
   * hatası yutularak: bu sayılar gelmese de ders listesi eksiksiz çalışsın.
   */
  const [yanlislar, setYanlislar] = useState<
    Record<string, { bekleyen: number; aktif: number; ogrenilen: number; bugunOturum: { id: string; cozulen: number } | null }>
  >({});
  const [yanlisKuruluyor, setYanlisKuruluyor] = useState<string | null>(null);

  /**
   * DERS İÇİ ARAMA. Transkriptler zaten veritabanında duruyor ve üretimden sonra
   * kullanılmıyordu; bu kutu "bunu nerede anlatmıştı?" sorusuna cevap veriyor.
   * Model çağrısı yok, arama sunucuda (/api/ders/ara) yapılıyor.
   */
  const [arama, setArama] = useState("");
  const [aramaSonucu, setAramaSonucu] = useState<AramaSonucu[] | null>(null);
  const [aramaToplam, setAramaToplam] = useState(0);
  const [araniyor, setAraniyor] = useState(false);
  /** Not paneli hangi kategori için açık — kapalıysa null */
  const [notKategorisi, setNotKategorisi] = useState<string | null>(null);
  const [dersNotlari, setDersNotlari] = useState<DersNotu[] | null>(null);
  const router = useRouter();
  const { addToast } = useToast();
  // Üretim kuyruğu layout'ta yaşıyor; sayfa yalnızca gösteriyor ve besliyor.
  const { isler, ekle, ekleMetin, ekleParagraf, tamamlaEkle, kaldir, tekrarDene, elleGonder, yinedeUret, tamamlananSayac } =
    useKuyruk();

  /** Sırada ya da çalışan bir paragraf işi varken düğme ikinci kez basılmasın */
  const paragrafCalisiyor = isler.some((i) => i.tur === "paragraf" && i.durum !== "hazir" && i.durum !== "hata");

  // Esc ile kapanma, odak tuzağı ve odağın geri verilmesi — bkz. useModal
  const silmeRef = useModal<HTMLDivElement>(!!silinecek, () => setSilinecek(null));
  const panelRef = useModal<HTMLElement>(notKategorisi !== null, () => setNotKategorisi(null));

  const oturumlariGetir = useCallback(async () => {
    const { data, error } = await supabase
      .from("ders_sessions")
      // ders_answers kırılımı ayrı sorguda alınıyor: PostgREST'te aynı gömülü
      // seçimde count ile sütun birlikte istenemiyor.
      .select(
        "id, title, created_at, video_id, status, kategori, tur, ders_videos(duration_seconds, title), ders_questions(count)"
      )
      // Yarım kalanlar da listeleniyor: ikinci adım düşerse ya da sekme
      // kapanırsa oturum "hazirlaniyor"da kalıyordu ve tamamen görünmez
      // oluyordu — üretilen özet ve konular boşa gidiyordu.
      .in("status", ["hazir", "hazirlaniyor"])
      // Havuzdan çıkarılmış sorular sayılmıyor: kartta "12 soru" yazıp ders
      // açıldığında 11 soru çıkması, sayının yanlış olduğu anlamına gelirdi.
      .eq("ders_questions.flagged", false)
      // Açık uçlu üretimi kapatıldı; eski derslerin açık uçluları hiçbir
      // ekranda görünmüyor, kartta da sayılmıyor.
      .eq("ders_questions.kind", "coktan")
      // Yanlışlarım oturumları kategorisiz ve her gün bir tane açılıyor; listeye
      // girseydi "Diğer" grubu şişer, LISTE_TAVANI da gerçek dersleri keserdi.
      // Onların yeri tepedeki kart (components/ders/YanlislarKarti).
      // "test": yerel test modunda açılan dersler (bkz. /api/ders/paragraf TEST_MODU)
      // "arsiv": aşağıda ayrı ve hafif bir sorguyla geliyor; burada olsaydı
      // LISTE_TAVANI'nı yiyip gerçek dersleri listeden atardı
      .not("tur", "in", "(yanlis,test,arsiv)")
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
    // YALNIZCA listelenen oturumlar için ve SAYFA SAYFA: Supabase bir sorguda en
    // fazla 1000 satır döndürüyor, üstü sessizce düşüyor. İlk sürüm filtresiz
    // çekiyordu, eski derslerde "0 doğru" yazıyordu; oturum filtresiyle
    // düzeltildi, cevaplar 1264'e ulaşınca yine taştı ve bu kez EN YENİ deneme
    // 0 net görünüyordu. Sayfalama olmadan bu sayı büyüdükçe tekrar olur.
    const kimlikler = (data ?? []).map((o) => o.id);
    // Yalnızca çoktan seçmeli cevaplar: eski derslerde açık uçlulara verilmiş
    // cevaplar var ve soru sayısı artık onları içermiyor — sayılsalardı kartta
    // "12/10 doğru" çıkardı. Süzgeç iç birleşimle sunucuda.
    const cevaplar: { session_id: string; verdict: string | null }[] = [];
    const SAYFA = 1000;
    for (let bas = 0; kimlikler.length; bas += SAYFA) {
      const { data: sayfa, error: sayfaHatasi } = await supabase
        .from("ders_answers")
        .select("session_id, verdict, ders_questions!inner(kind)")
        .eq("ders_questions.kind", "coktan")
        .in("session_id", kimlikler)
        .order("id")
        .range(bas, bas + SAYFA - 1);
      if (sayfaHatasi) {
        console.error("Cevaplar yüklenemedi:", sayfaHatasi.message);
        break;
      }
      cevaplar.push(...(sayfa ?? []));
      if (!sayfa || sayfa.length < SAYFA) break;
    }

    /**
     * Yayın tarihleri AYRI ve hatası yutulan bir sorguda alınıyor, gömülü
     * seçimin içinde değil. Sebebi kırılganlık: kolon henüz eklenmemişken
     * gömülü seçim bütün sorguyu 400'e düşürüyor, yani SQL'i çalıştırmayı
     * unutmak ders listesini tamamen kaybettiriyordu. Böyle olunca en kötü
     * ihtimalle sıralama ekleme sırasına düşüyor.
     */
    const videoKimlikleri = [...new Set((data ?? []).map((o) => o.video_id))];
    const yayinlar = new Map<string, string>();
    if (videoKimlikleri.length) {
      const { data: videolar } = await supabase
        .from("ders_videos")
        .select("video_id, published_at")
        .in("video_id", videoKimlikleri);
      for (const v of videolar ?? []) {
        if (v.published_at) yayinlar.set(v.video_id, v.published_at as string);
      }
    }

    // Kategori sırası. Yayın tarihiyle aynı gerekçe: AYRI ve hatası yutulan
    // sorgu — tablo db/ders-kategori-sira.sql ile ekleniyor, eklenmeden önce
    // liste düşmesin, sıralama varsayılana dönsün.
    {
      const { data: sira } = await supabase.from("ders_kategori_sira").select("kategori, sira").order("sira");
      setKategoriSirasi((sira ?? []).map((r) => r.kategori as string));
    }

    // Arşiv: yalnızca başlık ve kategori (kart sayıları gerekmiyor)
    {
      const { data: arsivlenen } = await supabase
        .from("ders_sessions")
        .select("id, title, kategori, created_at")
        .eq("tur", "arsiv")
        .order("created_at", { ascending: false })
        .limit(1000);
      setArsiv(
        (arsivlenen ?? []).map((a) => ({
          id: a.id as string,
          title: a.title as string | null,
          kategori: (a.kategori as string | null)?.trim() || KATEGORI_DIGER,
          created_at: a.created_at as string,
        }))
      );
    }

    /**
     * Kategori başına soru havuzu (deneme eşiği için) — kartların zaten
     * taşıdığı `count` toplanıyor, satır çekilmiyor. Eski hâli soru
     * kimliklerini çekip istemcide sayıyordu ve Supabase'in 1000 satır
     * tavanına takılıyordu: Tarih'te 950 soru varken "havuzda 636 var"
     * yazıyordu, deneme kurulumu da o yanlış sayıyla sınırlanıyordu.
     */
    const coktanHavuz = new Map<string, number>();
    for (const o of data ?? []) {
      if (o.tur !== "ders") continue;
      const kat = (o.kategori as string | null)?.trim() || KATEGORI_DIGER;
      const sayi = (o.ders_questions as unknown as { count: number }[])?.[0]?.count ?? 0;
      coktanHavuz.set(kat, (coktanHavuz.get(kat) ?? 0) + sayi);
    }
    setHavuzlar(coktanHavuz);

    /**
     * Deneme süreleri. published_at ile aynı gerekçe: gömülü seçime koymak,
     * kolon eklenmemişken bütün ders listesini 400'e düşürürdü. Hatası
     * yutuluyor, süre bilinmezse varsayılan tempoya düşülüyor.
     */
    const denemeSureleri = new Map<string, number>();
    const denemeBitisleri = new Map<string, string>();
    const denemeKimlikleri = (data ?? []).filter((o) => o.tur === "deneme").map((o) => o.id);
    if (denemeKimlikleri.length) {
      const { data: denemeler } = await supabase
        .from("ders_sessions")
        .select("id, deneme_sure_sn, deneme_bitti_at")
        .in("id", denemeKimlikleri);
      for (const d of denemeler ?? []) {
        if (d.deneme_sure_sn) denemeSureleri.set(d.id, d.deneme_sure_sn as number);
        if (d.deneme_bitti_at) denemeBitisleri.set(d.id, d.deneme_bitti_at as string);
      }
    }

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
          | { duration_seconds: number; title: string | null }
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
          tur: (o.tur as string) ?? "ders",
          // Ders listesinde yalnızca gerçek dersler var; pratik ve deneme
          // oturumları kategori başlığında özetleniyor.
          tekrarMi: o.tur !== "ders",
          sure: video?.duration_seconds ?? 0,
          videoBaslik: video?.title ?? null,
          // Metin dersinin yayın tarihi yok; sıralamada eklendiği an yerine geçiyor ki
          // yeni yapıştırılan metin listenin sonuna düşmesin
          yayin: metinDersiMi(o.video_id) ? o.created_at : (yayinlar.get(o.video_id) ?? null),
          metin: metinDersiMi(o.video_id),
          paragraf: (o.video_id as string).startsWith(PARAGRAF_VIDEO),
          denemeSure: denemeSureleri.get(o.id) ?? null,
          denemeBitti: denemeBitisleri.get(o.id) ?? null,
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

  useEffect(() => {
    queueMicrotask(async () => {
      try {
        const res = await fetch("/api/ders/yanlislar");
        if (res.ok) setYanlislar(((await res.json()) as { kategoriler: typeof yanlislar }).kategoriler ?? {});
      } catch {
        // Sayılar gelmezse düğme görünmez; ders listesi etkilenmez
      }
    });
  }, []);

  /**
   * Ders notlarını çeker ve her birini KATEGORİSİNE bağlar.
   *
   * Kategori notun kendisinde yazmıyor: notlar tablosu not defteriyle ortak ve
   * ders kimliği tutan bir kolonu yok. Bağ, not kimliğinin sonundaki video
   * kimliği üzerinden kuruluyor (bkz. lib/ders.ts notVideoId). Böylece daha
   * önce kaydedilmiş notlar da şema değişikliği olmadan yerine oturuyor.
   *
   * Sayfa açılışında çağrılıyor, panel açılışında değil: kategori başlığındaki
   * "2 not" sayacı için veri zaten en baştan gerekiyor.
   */
  const dersNotlariniGetir = useCallback(async () => {
    const { data: klasor } = await supabase
      .from("folders")
      .select("id")
      .eq("name", DERS_NOTLARI_KLASORU)
      .limit(1)
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

    const notlar = data ?? [];
    const adaylar = [...new Set(notlar.map((n) => notVideoId(n.id)).filter(Boolean))] as string[];

    // Video kimliği -> dersin kategorisi ve gerçek başlığı
    const harita = new Map<string, { kategori: string; baslik: string }>();
    if (adaylar.length) {
      const { data: dersler } = await supabase
        .from("ders_sessions")
        .select("video_id, kategori, title")
        .eq("tur", "ders")
        .in("video_id", adaylar);
      for (const d of dersler ?? []) {
        harita.set(d.video_id, {
          kategori: (d.kategori as string | null)?.trim() || KATEGORI_DIGER,
          baslik: d.title ?? "",
        });
      }
    }

    setDersNotlari(
      notlar.map((n) => {
        const videoId = notVideoId(n.id);
        const ders = videoId ? harita.get(videoId) : undefined;
        return {
          id: n.id,
          updated_at: n.updated_at,
          // Ders silinmişse not öksüz kalıyor; kaybolmasın diye kendi kovasına
          kategori: ders?.kategori ?? NOT_KATEGORISIZ,
          baslik: ders?.baslik || notBasligi(n.id, videoId),
        };
      })
    );
  }, []);

  useEffect(() => {
    dersNotlariniGetir();
  }, [dersNotlariniGetir]);


  /**
   * Kutudaki metni sıraya alır. Tek link de olabilir, alt alta beş link de —
   * üretim kuyrukta yürüdüğü için kutu kilitlenmiyor: ablam bir ders
   * hazırlanırken ikinci linki yapıştırabiliyor.
   */
  /**
   * OYNATMA LİSTESİ KARŞILAŞTIRMASI — kategori kartından.
   *
   * Ablam dersleri bir listeden tek tek seçip ekliyor; 65 videoluk seride
   * ikisini atlamış, birini iki kez eklemişti ve bunu listeye bakarak bulmak
   * imkânsızdı (ders adı modelin verdiği ad, video adı değil). Kategori
   * başlığındaki düğme bir panel açıyor: liste linki yapıştırılıyor, listedeki
   * her videonun O KATEGORİDEKİ durumu görünüyor, eksikler tek tıkla kuyruğa
   * giriyor. Model çağrısı yok; YouTube kotasından 50 video başına 1 birim.
   *
   * Karşılaştırma kategoriye bağlı: video başka kategoride varsa "başka
   * kategoride" diye ayrı gösteriliyor ve sıraya alınmıyor — aynı dersi iki kez
   * üretmek olurdu.
   */
  const [listePaneli, setListePaneli] = useState<string | null>(null);
  const [listeUrl, setListeUrl] = useState("");
  const [liste, setListe] = useState<ListeKarsilastirma | null>(null);
  const [listeYukleniyor, setListeYukleniyor] = useState(false);
  /**
   * Sıraya alınacak videolar — ablam seçiyor. Eksiklerin hepsini birden
   * eklemek zorunda değil (84 eksik ≈ $10); varsayılan hiçbiri seçili değil,
   * "tümünü seç" tek tık. Shift ile aralık: seri olduğu için "75'ten 90'a
   * kadar" en sık ihtiyaç.
   */
  const [secilenler, setSecilenler] = useState<Set<string>>(new Set());
  const sonTiklanan = useRef<number | null>(null);
  const secilebilir = (v: ListeSatiri) => v.durum === "eksik" || v.durum === "transkript";

  const secimiCevir = (indeks: number, shift: boolean) => {
    if (!liste) return;
    const satirlar = liste.satirlar;
    const hedef = satirlar[indeks];
    if (!secilebilir(hedef)) return;
    // Önceki tıklama BURADA okunuyor, güncelleyicinin içinde değil: React
    // güncelleyiciyi sonradan çalıştırıyor ve o ana kadar ref yeni indeksle
    // ezilmiş oluyordu — aralık hep tek satıra düşüyordu (ölçüldü: 78 + Shift
    // 84 yalnızca ikisini seçiyordu).
    const oncekiTiklama = sonTiklanan.current;
    setSecilenler((onceki) => {
      const yeni = new Set(onceki);
      if (shift && oncekiTiklama !== null) {
        const [a, b] = [oncekiTiklama, indeks].sort((x, y) => x - y);
        const ekle = !yeni.has(hedef.videoId);
        for (let i = a; i <= b; i++) {
          if (!secilebilir(satirlar[i])) continue;
          if (ekle) yeni.add(satirlar[i].videoId);
          else yeni.delete(satirlar[i].videoId);
        }
      } else if (yeni.has(hedef.videoId)) {
        yeni.delete(hedef.videoId);
      } else {
        yeni.add(hedef.videoId);
      }
      return yeni;
    });
    sonTiklanan.current = indeks;
  };

  const tumunuSec = () => {
    if (!liste) return;
    setSecilenler(new Set(liste.satirlar.filter(secilebilir).map((v) => v.videoId)));
  };
  const listeRef = useModal<HTMLDivElement>(listePaneli !== null, () => setListePaneli(null));

  /**
   * Panel iki yerden açılıyor:
   *   - kategori kartındaki "Liste" düğmesi -> kategori = "Tarih" gibi;
   *     karşılaştırma yalnızca o kategoriyle
   *   - ana link kutusuna liste linki yapıştırılınca -> kategori = "" ;
   *     karşılaştırma BÜTÜN derslerle, link hazır geldiği için tarama
   *     kendiliğinden başlıyor
   * Boş dize "kategorisiz" demek; null "panel kapalı" demek.
   */
  const listePaneliAc = (kategori: string, hazirUrl?: string) => {
    setListe(null);
    let onceki = "";
    try {
      const hafiza = JSON.parse(localStorage.getItem(LISTE_HAFIZASI) ?? "{}");
      const anahtar = kategori || "*";
      onceki = typeof hafiza[anahtar] === "string" ? hafiza[anahtar] : "";
    } catch {
      // Bozuk kayıt: boş kutuyla aç
    }
    const url = hazirUrl ?? onceki;
    setListeUrl(url);
    setListePaneli(kategori);
    if (hazirUrl) void listeyiKarsilastir(hazirUrl, kategori);
  };

  const listeyiKarsilastir = async (verilenUrl?: string, verilenKategori?: string) => {
    if (listeYukleniyor) return;
    const kategori = verilenKategori ?? listePaneli ?? "";
    const url = (verilenUrl ?? listeUrl).trim();
    if (!oynatmaListesiKimligi(url)) {
      addToast("Bu bir oynatma listesi linkine benzemiyor (youtube.com/playlist?list=…).", "error");
      return;
    }
    setListeYukleniyor(true);
    try {
      const res = await fetch("/api/ders/oynatma-listesi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, kategori }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.hata ?? "Liste okunamadı.");
      setListe(data as ListeKarsilastirma);
      setSecilenler(new Set());
      sonTiklanan.current = null;
      try {
        const hafiza = JSON.parse(localStorage.getItem(LISTE_HAFIZASI) ?? "{}");
        hafiza[kategori || "*"] = url;
        localStorage.setItem(LISTE_HAFIZASI, JSON.stringify(hafiza));
      } catch {
        // Depolama kapalıysa hatırlanmaz, karşılaştırma yine çalışır
      }
    } catch (err) {
      addToast((err as Error).message, "error");
    } finally {
      setListeYukleniyor(false);
    }
  };

  /** SEÇİLEN videoları üretim kuyruğuna alır */
  const eksikleriSirayaAl = () => {
    if (!liste || !secilenler.size) return;
    const linkler = liste.satirlar
      .filter((v) => secilenler.has(v.videoId))
      .map((v) => `https://www.youtube.com/watch?v=${v.videoId}`);
    const eklenen = ekle(linkler.join("\n"));
    if (eklenen) addToast(`${eklenen} ders sıraya alındı`, "success");
    setListePaneli(null);
    setListe(null);
  };

  const siradanEkle = (metin: string) => {
    // Saf liste linki: ekleme değil, seçim. Panel bütün derslerle
    // karşılaştırıp açılıyor; ablam işlenecek videoları içinden seçiyor.
    if (oynatmaListesiKimligi(metin.trim())) {
      listePaneliAc("", metin.trim());
      setLink("");
      return;
    }
    const eklenen = ekle(metin);
    if (!eklenen) return;
    setLink("");
    if (eklenen > 1) addToast(`${eklenen} ders sıraya alındı`, "success");
  };

  /**
   * Yarım kalan oturumu tamamlar: yalnızca ikinci adımı çağırır, birinci adım
   * (özet + konular) zaten kayıtlı olduğu için tekrar üretilmez.
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
      // DERS SIRASI = VİDEONUN YAYIN SIRASI, ekleme sırası değil: aynı seriyi
      // toplu işlerken ekleme sırası rastgele oluyordu. En YENİ yüklenen video
      // üstte — kanal yeni bölüm çıkardığında o, listenin başında görünsün.
      // Yayın tarihi bilinmeyen ders (anahtar yoktu ya da video bulunamadı) en
      // sona düşüyor, kendi içinde yeniden eskiye.
      const dersler = liste
        .filter((o) => !o.tekrarMi)
        .sort((a, b) => {
          if (a.yayin && b.yayin) return b.yayin.localeCompare(a.yayin);
          if (a.yayin) return -1;
          if (b.yayin) return 1;
          return b.created_at.localeCompare(a.created_at);
        });
      const pratik = liste.find((o) => o.tur === "tekrar") ?? null;
      // Denemeler: net = D − Y/4. Liste created_at'e göre sıralı olduğu için
      // ilk eleman en yeni deneme.
      const denemeler = liste.filter((o) => o.tur === "deneme");
      const deneme = denemeler[0] ?? null;
      return {
        kategori,
        dersler,
        pratik,
        deneme,
        denemeler,
        dersSayisi: dersler.filter((o) => !o.yarim).length,
        yarimSayisi: dersler.filter((o) => o.yarim).length,
        soruSayisi: dersler.reduce((t, o) => t + o.soruSayisi, 0),
        notSayisi: (dersNotlari ?? []).filter((n) => n.kategori === kategori).length,
      };
    })
      // Dersi kalmayan kategori (hepsi arşivlendi) gizli; pratik ve deneme geçmişi silinmiyor
      .filter((g) => g.dersler.length > 0)
      // Önce ablamın verdiği sıra; sırası verilmemişler (yeni kategori) altta,
      // sabit bir düzende — yeni ders eklemek kategorilerin yerini değiştirmesin
      .sort((a, b) => kategoriYeri(a.kategori, kategoriSirasi) - kategoriYeri(b.kategori, kategoriSirasi) || a.kategori.localeCompare(b.kategori, "tr"));
  }, [oturumlar, dersNotlari, kategoriSirasi]);

  /**
   * Dersi silinmiş notlar. Kategorisi çözülemediği için hiçbir kategori
   * kartında görünmezlerdi; not duruyorken erişilemez olmasın diye listenin
   * altında kendi küçük kartını alıyor. Normalde boş.
   */
  const kategorisizNotlar = useMemo(
    () => (dersNotlari ?? []).filter((n) => n.kategori === NOT_KATEGORISIZ),
    [dersNotlari]
  );

  /**
   * Panel kapanırken 300 ms boyunca kayarak çıkıyor. İçeriği doğrudan
   * notKategorisi'ne bağlasaydık kapatma anında kategori null olur ve panel
   * daha ekrandayken "bu kategoride not yok" yazısına dönüşürdü. Bu yüzden
   * gösterilen kategori ayrı tutuluyor: yalnızca AÇILIRKEN güncelleniyor.
   */
  const [gosterilenNotKategorisi, setGosterilenNotKategorisi] = useState<string | null>(null);
  useEffect(() => {
    if (notKategorisi !== null) setGosterilenNotKategorisi(notKategorisi);
  }, [notKategorisi]);

  /** Panelde gösterilen notlar */
  const panelNotlari = useMemo(
    () => (dersNotlari ?? []).filter((n) => n.kategori === gosterilenNotKategorisi),
    [dersNotlari, gosterilenNotKategorisi]
  );

  /**
   * Katlanır kategoriler. Kategori sayısı arttıkça sayfa 150 satırlık düz bir
   * kaydırmaya dönüyordu ve "Soru Gönder" düğmeleri arada kayboluyordu.
   *
   * Hangi kategorinin açık olduğu tarayıcıda saklanıyor: sayfa ablamın en son
   * bıraktığı gibi açılıyor. Eskiden en son ders eklenen kategori her girişte
   * kendiliğinden açılıyordu (07.10.2026'da kaldırıldı). Hiç kayıt yoksa hepsi
   * kapalı. İlk çizimde liste henüz yüklenmediği için sunucu çizimiyle
   * uyuşmazlık olmuyor.
   */
  const [acikKategoriler, setAcikKategoriler] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const ham: unknown = JSON.parse(localStorage.getItem(ACIK_KATEGORI_HAFIZASI) ?? "[]");
      return new Set(Array.isArray(ham) ? ham.filter((k): k is string => typeof k === "string") : []);
    } catch {
      return new Set();
    }
  });
  const kategoriAcikMi = (k: string) => acikKategoriler.has(k);
  const kategoriCevir = (k: string) =>
    setAcikKategoriler((mevcut) => {
      const yeni = new Set(mevcut);
      if (yeni.has(k)) yeni.delete(k);
      else yeni.add(k);
      try {
        localStorage.setItem(ACIK_KATEGORI_HAFIZASI, JSON.stringify([...yeni]));
      } catch {
        // Depolama kapalıysa yalnızca bu oturum boyunca hatırlanır
      }
      return yeni;
    });

  /**
   * Kategoriyi bir yukarı/aşağı taşır. Ekrandaki sıranın tamamı (sırası hiç
   * verilmemiş kategoriler dahil) 0..n diye kaydediliyor: yalnız ikisini yazmak,
   * sırasız kategorilerle karışınca belirsiz kalırdı. Ekranda hemen değişiyor.
   */
  const kategoriyiTasi = async (indeks: number, yon: -1 | 1) => {
    const hedef = indeks + yon;
    if (hedef < 0 || hedef >= gruplar.length) return;
    const yeni = gruplar.map((g) => g.kategori);
    [yeni[indeks], yeni[hedef]] = [yeni[hedef], yeni[indeks]];
    setKategoriSirasi(yeni);
    const { error } = await supabase
      .from("ders_kategori_sira")
      .upsert(yeni.map((kategori, sira) => ({ kategori, sira })), { onConflict: "kategori" });
    if (error) addToast(`Kategori sırası kaydedilemedi: ${error.message}`, "error");
  };

  /** Dersi arşive kaldırır (bkz. `arsiv` durumunun açıklaması) */
  const arsivle = async (o: OturumOzeti) => {
    const { error } = await supabase.from("ders_sessions").update({ tur: "arsiv" }).eq("id", o.id);
    if (error) {
      addToast(`Arşive kaldırılamadı: ${error.message}`, "error");
      return;
    }
    setOturumlar((liste) => liste.filter((x) => x.id !== o.id));
    setArsiv((a) => [{ id: o.id, title: o.title, kategori: o.kategori, created_at: o.created_at }, ...a]);
    addToast("Ders arşive kaldırıldı", "info");
  };

  const arsivdenCikar = async (a: ArsivDersi) => {
    const { error } = await supabase.from("ders_sessions").update({ tur: "ders" }).eq("id", a.id);
    if (error) {
      addToast(`Geri alınamadı: ${error.message}`, "error");
      return;
    }
    setArsiv((liste) => liste.filter((x) => x.id !== a.id));
    void oturumlariGetir();
    addToast("Ders arşivden geri alındı", "success");
  };

  /**
   * Kategoriden pratik. TEST HAZIRLAMIYOR: tek bir rastgele soru getirip soru
   * ekranına atıyor, orada "başka soru" düğmesiyle döngü sürüyor.
   *
   * Kategorinin açık bir pratik oturumu varsa ona devam ediliyor; her basışta
   * yeni oturum açsaydı liste şişer ve "kaç soru çözdüm" sayacı sıfırlanırdı.
   * Model çağrısı yok, bedava ve anında.
   */
  /**
   * Deneme sınavı başlatır. Aynı uç, aynı havuz — farkı tur:"deneme":
   * yalnızca çoktan seçmeli, KPSS'nin o dersteki soru sayısı kadar, süreli.
   * Model çağrısı yok, bedava.
   */
  const [denemeKuruluyor, setDenemeKuruluyor] = useState<string | null>(null);
  /** Kategori -> o kategorideki çoktan seçmeli sayısı (deneme havuzu) */
  const [havuzlar, setHavuzlar] = useState<Map<string, number>>(new Map());
  /** Deneme kurulum penceresi hangi kategori için açık */
  const [denemeKurulum, setDenemeKurulum] = useState<string | null>(null);
  const [denemeSoru, setDenemeSoru] = useState(DENEME_VARSAYILAN_SORU);
  const [denemeTempo, setDenemeTempo] = useState(DENEME_VARSAYILAN_TEMPO);
  // Esc ile kapanma ve odak tuzağı. Çağrı state'lerin ALTINDA: yukarıda olsaydı
  // denemeKurulum tanımlanmadan okunurdu (TDZ).
  const denemeRef = useModal<HTMLDivElement>(denemeKurulum !== null, () => setDenemeKurulum(null));
  /** Kurulum penceresini açar; son seçimler hatırlanıyor */
  const denemeKurulumAc = (kategori: string) => {
    const havuz = havuzlar.get(kategori) ?? 0;
    let soru = Math.min(DENEME_VARSAYILAN_SORU, havuz);
    let tempo = DENEME_VARSAYILAN_TEMPO;
    try {
      const kayit = JSON.parse(localStorage.getItem("ablam-deneme-ayar") ?? "{}");
      if (kayit.soru) soru = Math.min(Number(kayit.soru), havuz);
      if (kayit.tempo) tempo = Number(kayit.tempo);
    } catch {
      // Bozuk kayıt varsa varsayılanlarla devam
    }
    setDenemeSoru(Math.max(DENEME_EN_AZ_SORU, soru));
    setDenemeTempo(tempo);
    setDenemeKurulum(kategori);
  };

  const denemeBaslat = async (kategori: string) => {
    if (denemeKuruluyor) return;
    setDenemeKuruluyor(kategori);
    try {
      localStorage.setItem(
        "ablam-deneme-ayar",
        JSON.stringify({ soru: denemeSoru, tempo: denemeTempo })
      );
    } catch {
      // Depolama kapalıysa ayar hatırlanmaz, deneme yine kurulur
    }
    try {
      const res = await fetch("/api/ders/tekrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kategori,
          tur: "deneme",
          soruSayisi: denemeSoru,
          sureSn: denemeSoru * denemeTempo,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.hata ?? "Deneme hazırlanamadı.");
      router.push(`/ders/${data.sessionId}`);
    } catch (err) {
      addToast((err as Error).message, "error");
      setDenemeKuruluyor(null);
    }
  };

  /** Dersin yanlış tekrarı: bugün başlanmışsa ona devam, yoksa yeni oturum */
  const yanlisBaslat = async (kategori: string) => {
    const y = yanlislar[kategori];
    if (y?.bugunOturum) {
      router.push(`/ders/${y.bugunOturum.id}`);
      return;
    }
    if (!y || y.bekleyen === 0) {
      addToast(`${kategori}: bugün tekrar edecek yanlışın yok.`, "info");
      return;
    }
    if (yanlisKuruluyor) return;
    setYanlisKuruluyor(kategori);
    try {
      const res = await fetch("/api/ders/yanlislar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kategori, adet: 1 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.hata ?? "Tekrar başlatılamadı.");
      if (data.bitti || !data.sessionId) {
        addToast(`${kategori}: bugün tekrar edecek yanlışın kalmadı.`, "info");
        setYanlisKuruluyor(null);
        return;
      }
      router.push(`/ders/${data.sessionId}`);
    } catch (err) {
      addToast((err as Error).message, "error");
      setYanlisKuruluyor(null);
    }
  };

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

  const oturumSil = async (id: string, deneme = false) => {
    const { error } = await supabase.from("ders_sessions").delete().eq("id", id);
    if (error) {
      addToast("Silinemedi: " + error.message, "error");
      return;
    }
    setOturumlar((o) => o.filter((x) => x.id !== id));
    setSilinecek(null);
    addToast(deneme ? "Deneme silindi" : "Ders silindi", "delete");
    // Notu duruyorsa artık kategorisi çözülemez; "Kategorisiz" kovasına düşsün
    // diye eşleme yenileniyor. Not silinmiyor: ders gitti diye çalışma
    // materyalini de atmak ablamın istediği şey değil.
    dersNotlariniGetir();
  };

  /**
   * SÜREN DENEME. Denemenin sayacı ablam ekrana bakmasa da işliyor (sunucu
   * saatinden hesaplanıyor, bkz. DenemeView). Bu, yenileyerek süre kazanmayı
   * engelliyor ama bir açık bırakmıştı: sekmeyi kapatıp giden ablam denemenin
   * hâlâ sürdüğünü hiçbir yerde görmüyordu. Şerit bunu görünür kılıyor.
   */
  const [simdi, setSimdi] = useState(() => Date.now());
  const surenDeneme = useMemo(() => {
    for (const o of oturumlar) {
      if (o.tur !== "deneme" || o.denemeBitti) continue;
      const sure = (o.denemeSure ?? o.soruSayisi * DENEME_VARSAYILAN_TEMPO) * 1000;
      const kalan = new Date(o.created_at).getTime() + sure - simdi;
      if (kalan > 0) return { oturum: o, kalanSn: Math.round(kalan / 1000) };
    }
    return null;
  }, [oturumlar, simdi]);

  // Sayaç yalnızca süren bir deneme varken işliyor; yoksa saniyelik render yok.
  useEffect(() => {
    if (!surenDeneme) return;
    const z = setInterval(() => setSimdi(Date.now()), 1000);
    return () => clearInterval(z);
  }, [surenDeneme]);

  /** Yayın tarihi bilinmeyen ders sayısı — doldurma düğmesi buna bakıyor */
  const tarihsizSayisi = oturumlar.filter((o) => !o.tekrarMi && !o.metin && !o.yayin).length;
  const [tarihDolduruluyor, setTarihDolduruluyor] = useState(false);

  const yayinTarihleriniDoldur = async () => {
    if (tarihDolduruluyor) return;
    setTarihDolduruluyor(true);
    try {
      const res = await fetch("/api/ders/yayin-tarihi", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.hata ?? "Tarihler alınamadı.");
      addToast(
        data.dolduruldu
          ? `${data.dolduruldu} dersin yayın tarihi alındı`
          : "Eksik tarih kalmadı",
        "success"
      );
      await oturumlariGetir();
    } catch (err) {
      addToast((err as Error).message, "error");
    } finally {
      setTarihDolduruluyor(false);
    }
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

      {/* Ders notlarına giriş sağ üst köşedeydi ve TÜM notları tek listede
          gösteriyordu. Kategori sayısı arttıkça o liste karışıyor: Tarih
          çalışırken Coğrafya notları arada duruyordu. Giriş artık kategori
          başlığında, "Soru Gönder"in yanında — not zaten bir dersin notu,
          ders de bir kategorinin içinde. */}

      <div className="relative z-10 mx-auto max-w-3xl px-5 pb-20 pt-24 sm:pt-28">
        {/* Başlık */}
        <div className="animate-fade-in mb-10 flex flex-col items-center text-center">
          {/* Bahçe logosu (components/BahceLogo): yazı açılışta kendiliğinden yazılır,
              harflerden güller açar. Başlığın kendisi ekran okuyucu için duruyor. */}
          <h1 className="sr-only">Ablam Ders</h1>
          <BahceLogo metin="Ablam Ders" palet={MODUL_PALETLERI.ders} yukseklik={200} className="-mt-10 w-full max-w-xl sm:-mt-16" />
        </div>

        {/* Süren deneme şeridi — sayaç ablam bakmasa da işlediği için en üstte */}
        {surenDeneme && (
          <Link
            href={`/ders/${surenDeneme.oturum.id}`}
            className="animate-fade-in mb-4 flex items-center justify-between gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3 transition-colors hover:border-amber-400/50"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <Clock size={15} className="flex-shrink-0 animate-pulse text-amber-300" />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-amber-100/90">
                  {surenDeneme.oturum.title ?? "Deneme"} sürüyor
                </span>
                <span className="block text-[11.5px] text-amber-200/50">
                  sayaç sen bakmasan da işliyor
                </span>
              </span>
            </span>
            <span className="flex flex-shrink-0 items-center gap-2">
              <span className="font-mono text-[16px] tabular-nums text-amber-100">
                {sayacMetni(surenDeneme.kalanSn)}
              </span>
              <ArrowRight size={15} className="text-amber-200/60" />
            </span>
          </Link>
        )}

        {/* Link / metin girişi */}
        <div
          className="animate-slide-up glass rounded-2xl border border-[var(--border)] p-5"
          style={{ animationDelay: "80ms" }}
        >
          <div className="mb-3 flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1">
            {(
              [
                ["link", "YouTube linki", Youtube],
                ["metin", "Metin", FileText],
              ] as const
            ).map(([mod, etiket, Ikon]) => (
              <button
                key={mod}
                onClick={() => setGirisModu(mod)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] transition-colors ${
                  girisModu === mod ? "bg-[var(--accent)]/15 text-[var(--accent-light)]" : "text-white/45 hover:text-white/75"
                }`}
              >
                <Ikon size={13} />
                {etiket}
              </button>
            ))}
          </div>

          {girisModu === "metin" ? (
            <div>
              <textarea
                value={dersMetni}
                onChange={(e) => setDersMetni(e.target.value)}
                rows={7}
                placeholder="Ders notunu ya da konu özetini buraya yapıştır. Sorular yalnızca bu metinden üretilir; metindeki bilgiler doğru kabul edilir."
                className="focus-ring w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[13.5px] leading-relaxed text-white/90 placeholder-white/25"
              />
              <div className="mt-1.5 flex justify-between gap-3 px-1 text-[11px] tabular-nums text-white/30">
                <span>
                  {dersMetni.trim().length > 0 && dersMetni.trim().length < METIN_EN_AZ
                    ? `En az ${METIN_EN_AZ} karakter`
                    : dersMetni.trim().length > METIN_EN_FAZLA
                      ? "Çok uzun — ikiye bölüp ayrı ekle"
                      : ""}
                </span>
                <span className={dersMetni.trim().length > METIN_EN_FAZLA ? "text-red-300/80" : ""}>
                  {dersMetni.trim().length.toLocaleString("tr-TR")} / {METIN_EN_FAZLA.toLocaleString("tr-TR")}
                </span>
              </div>
              <button
                onClick={() => {
                  ekleMetin(dersMetni);
                  setDersMetni("");
                }}
                disabled={dersMetni.trim().length < METIN_EN_AZ || dersMetni.trim().length > METIN_EN_FAZLA}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3.5 text-sm font-medium text-[var(--background)] shadow-lg shadow-[var(--accent)]/10 transition-all hover:bg-[var(--accent-light)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
              >
                {calisanIs + bekleyenIs > 0 ? "Sıraya ekle" : "Metinden soru üret"}
                <ArrowRight size={15} />
              </button>
            </div>
          ) : (
          <>
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
              {oynatmaListesiKimligi(link.trim()) ? (
                <>
                  <ListChecks size={15} />
                  Listeden seç
                </>
              ) : (
                <>
                  {calisanIs + bekleyenIs > 0 ? "Sıraya ekle" : "Derse başla"}
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          )}
          </>
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
                  {is.videoId && is.tur !== "metin" && !metinDersiMi(is.videoId) ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`https://img.youtube.com/vi/${is.videoId}/mqdefault.jpg`}
                      alt=""
                      className="h-11 w-[74px] flex-shrink-0 rounded-lg border border-white/[0.06] object-cover"
                    />
                  ) : (
                    <div className="flex h-11 w-[74px] flex-shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-black/20">
                      {is.tur === "paragraf" ? (
                        <Pilcrow size={16} className="text-[var(--accent)]/50" />
                      ) : is.tur === "metin" || metinDersiMi(is.videoId) ? (
                        <FileText size={16} className="text-[var(--accent)]/50" />
                      ) : (
                        <Youtube size={16} className="text-white/20" />
                      )}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-white/85">
                      {is.baslik || is.url || "Ders"}
                    </p>
                    <p
                      className={`mt-0.5 flex items-center gap-1.5 text-[11px] ${
                        is.durum === "hata"
                          ? "text-red-300/80"
                          : is.durum === "elle" || is.durum === "mevcut"
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
                      {(is.durum === "hata" || is.durum === "elle" || is.durum === "mevcut") && (
                        <CircleAlert size={10} />
                      )}
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
                    {is.durum === "mevcut" && is.mevcutDersId && (
                      <>
                        <Link
                          href={`/ders/${is.mevcutDersId}`}
                          className="rounded-lg bg-[var(--accent)]/15 px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--accent-light)] transition-colors hover:bg-[var(--accent)]/25"
                        >
                          Aç
                        </Link>
                        <button
                          onClick={() => yinedeUret(is.id)}
                          title="Aynı videodan ikinci bir ders üretir (~$0,12)"
                          className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11.5px] text-white/60 transition-colors hover:border-[var(--border-hover)] hover:text-white/90"
                        >
                          Yine de üret
                        </button>
                      </>
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
                              href={metinDersiMi(d.videoId) ? undefined : videoLinki(d.videoId, v.saniye)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.04]"
                            >
                              {!metinDersiMi(d.videoId) && (
                                <span className="mt-px flex-shrink-0 font-mono text-[11px] text-[var(--accent)]/70">
                                  {formatSure(v.saniye)}
                                </span>
                              )}
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
          {/* Bölüm başlığıyla aynı satırda: düğme tek başına kartların üstünde havada kalıyordu */}
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <h2 className="text-[12px] font-medium uppercase tracking-wider text-white/30">
              Geçmiş dersler
            </h2>
            {!yukleniyor && gruplar.length > 1 && (
              <button
                onClick={() => setKategoriSiralama((s) => !s)}
                aria-pressed={kategoriSiralama}
                title="Kategorilerin sırasını değiştir"
                className={`-my-1 flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] transition-colors ${
                  kategoriSiralama
                    ? "bg-[var(--accent)]/15 text-[var(--accent-light)]"
                    : "text-white/35 hover:bg-white/[0.06] hover:text-white/75"
                }`}
              >
                <ArrowUpDown size={12} />
                {kategoriSiralama ? "Bitti" : "Sırala"}
              </button>
            )}
          </div>

          {/* Yayın tarihi eksik dersler varsa doldurma düğmesi. KENDİ KENDİNİ
              GİZLİYOR: yeni işlenen videoların tarihi zaten transkript adımında
              yazılıyor, bu yalnızca kolon eklenmeden önce işlenmiş dersler için.
              Kalıcı bir düğme, bir kereliğine yapılacak iş için gürültü olurdu. */}
          {!yukleniyor && tarihsizSayisi > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
              <p className="text-[11.5px] leading-relaxed text-white/40">
                {tarihsizSayisi} dersin video yayın tarihi bilinmiyor; sıralamada sona
                düşüyorlar.
              </p>
              <button
                onClick={yayinTarihleriniDoldur}
                disabled={tarihDolduruluyor}
                className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11.5px] text-white/55 transition-colors hover:border-[var(--border-hover)] hover:text-white/90 disabled:opacity-50"
              >
                {tarihDolduruluyor && <Loader2 size={12} className="animate-spin" />}
                {tarihDolduruluyor ? "Alınıyor…" : "Tarihleri al"}
              </button>
            </div>
          )}

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
              {gruplar.map((g, gi) => {
                const acik = kategoriAcikMi(g.kategori);
                return (
                <div
                  key={g.kategori}
                  className="glass overflow-hidden rounded-2xl border border-[var(--border)]"
                >
                  {/* KATEGORİ BAŞLIĞI, İKİ SATIR. Üstte kimlik (ad, sayılar, nadir
                      kullanılan not ve liste ikonları), altta üç çalışma eylemi.
                      Eskiden beş düğme aynı ağırlıkta tek sıradaydı ve "son deneme ·
                      son pratik" cümlesi düğmelerden kopuk ayrı bir satırdaydı;
                      her sayı artık ait olduğu eylemin üstünde. Eylemler başlığın
                      içinde: kategori kapalıyken de erişilebilirler. */}
                  <div className="p-3.5">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => kategoriCevir(g.kategori)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      >
                        {acik ? (
                          <ChevronDown size={15} className="flex-shrink-0 text-white/35" />
                        ) : (
                          <ChevronRight size={15} className="flex-shrink-0 text-white/35" />
                        )}
                        <span className="text-[12px] font-medium uppercase tracking-wider text-white/70">
                          {g.kategori}
                        </span>
                        <span className="truncate text-[11.5px] text-white/30">
                          {g.dersSayisi} ders<span className="hidden sm:inline"> · {g.soruSayisi} soru</span>
                        </span>
                        {g.yarimSayisi > 0 && (
                          <span className="flex flex-shrink-0 items-center gap-1 text-[11px] text-amber-300/80">
                            <CircleAlert size={10} />
                            {g.yarimSayisi} yarım
                          </span>
                        )}
                      </button>

                      {/* Nadir kullanılanlar: yalnızca ikon. Not yoksa not ikonu da yok. */}
                      {g.notSayisi > 0 && (
                        <button
                          onClick={() => setNotKategorisi(g.kategori)}
                          title={`${g.kategori} ders notları`}
                          aria-label={`${g.kategori} ders notları (${g.notSayisi})`}
                          className="flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[11.5px] text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white/85"
                        >
                          <NotebookPen size={13} />
                          {g.notSayisi}
                        </button>
                      )}
                      {kategoriSiralama && (
                        <div className="flex flex-shrink-0 items-center">
                          <button
                            onClick={() => kategoriyiTasi(gi, -1)}
                            disabled={gi === 0}
                            aria-label={`${g.kategori} kategorisini yukarı taşı`}
                            className="rounded-lg p-1.5 text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white/95 disabled:opacity-20"
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            onClick={() => kategoriyiTasi(gi, 1)}
                            disabled={gi === gruplar.length - 1}
                            aria-label={`${g.kategori} kategorisini aşağı taşı`}
                            className="rounded-lg p-1.5 text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white/95 disabled:opacity-20"
                          >
                            <ArrowDown size={14} />
                          </button>
                        </div>
                      )}
                      <button
                        onClick={() => listePaneliAc(g.kategori)}
                        title={`${g.kategori} derslerini bir YouTube listesiyle karşılaştır`}
                        aria-label={`${g.kategori} derslerini bir YouTube listesiyle karşılaştır`}
                        className="flex flex-shrink-0 items-center rounded-lg px-2 py-1.5 text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white/85"
                      >
                        <ListChecks size={13} />
                      </button>
                    </div>

                    {g.dersSayisi > 0 &&
                      (() => {
                        const havuz = havuzlar.get(g.kategori) ?? 0;
                        const denemeYok = havuz < DENEME_EN_AZ_HAVUZ;
                        const y = yanlislar[g.kategori];
                        // Günlük hedef yok: kutu doğrudan vadesi gelen sayıyı gösteriyor.
                        // Bugün başlanıp hepsi bitirildiyse "tamam", hiç yoksa sönük.
                        const bekleyen = y?.bekleyen ?? 0;
                        const yanlisTamam = bekleyen === 0 && !!y?.bugunOturum;
                        // Türkçe'de dördüncü eylem (Paragraf): geniş ekranda tek satır,
                        // telefonda 2×2 — dört dar sütun etiketleri kırpıyordu
                        const paragrafVar = g.kategori === "Türkçe";
                        return (
                          <div className={`mt-3 grid gap-2 ${paragrafVar ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
                            <KategoriEylemi
                              onClick={() => tekrarBaslat(g.kategori)}
                              disabled={!!tekrarKuruluyor}
                              yukleniyor={tekrarKuruluyor === g.kategori}
                              Ikon={Dices}
                              etiket="Soru Gönder"
                              alt={
                                g.pratik && g.pratik.cevapSayisi > 0
                                  ? `son: ${g.pratik.dogruSayisi}/${g.pratik.cevapSayisi} doğru`
                                  : "rastgele soru"
                              }
                              ton="vurgu"
                              title={`${g.kategori} derslerinden rastgele bir soru`}
                            />
                            <KategoriEylemi
                              onClick={() => yanlisBaslat(g.kategori)}
                              disabled={!!yanlisKuruluyor}
                              yukleniyor={yanlisKuruluyor === g.kategori}
                              Ikon={yanlisTamam ? CircleCheck : RotateCcw}
                              etiket="Yanlışlar"
                              alt={bekleyen > 0 ? `${bekleyen} soru` : yanlisTamam ? "bugün tamam" : "bugün yok"}
                              ton={bekleyen > 0 ? "uyari" : yanlisTamam ? "tamam" : "sonuk"}
                              title={
                                y
                                  ? `${g.kategori} yanlışları: ${y.bekleyen} soru tekrar zamanında, ${y.aktif} soru sistemde` +
                                    (y.ogrenilen ? `, ${y.ogrenilen} soruyu öğrendin` : "") +
                                    `. ${yanlisKuraliMetni()}`
                                  : `${g.kategori}: tekrar edecek yanlışın yok.`
                              }
                            />
                            <KategoriEylemi
                              onClick={() => denemeKurulumAc(g.kategori)}
                              disabled={!!denemeKuruluyor || denemeYok}
                              yukleniyor={denemeKuruluyor === g.kategori}
                              Ikon={Timer}
                              etiket="Deneme"
                              alt={
                                g.deneme && g.deneme.cevapSayisi > 0
                                  ? `son: ${netHesapla(g.deneme.dogruSayisi, g.deneme.cevapSayisi - g.deneme.dogruSayisi)
                                      .toFixed(2)
                                      .replace(".", ",")} net`
                                  : denemeYok
                                    ? `${havuz}/${DENEME_EN_AZ_HAVUZ} soru`
                                    : "süreli sınav"
                              }
                              ton="notr"
                              title={
                                denemeYok
                                  ? `Deneme için en az ${DENEME_EN_AZ_HAVUZ} çoktan seçmeli gerekiyor; bu kategoride ${havuz} var.`
                                  : `${g.kategori}: süreli deneme kur`
                              }
                            />
                            {/* Yalnız Türkçe: paragrafları model yazıyor, her basış yeni bir
                                10 soruluk ders (bkz. lib/paragraf.ts) */}
                            {paragrafVar && (
                              <KategoriEylemi
                                onClick={() => {
                                  ekleParagraf();
                                  addToast("Paragraf soruları yazılıyor; hazır olunca açılacak.", "info");
                                }}
                                disabled={paragrafCalisiyor}
                                yukleniyor={paragrafCalisiyor}
                                Ikon={Pilcrow}
                                etiket="Paragraf"
                                alt={paragrafCalisiyor ? "yazılıyor…" : "10 yeni soru"}
                                ton="notr"
                                title="ÖSYM tarzında 10 yeni paragraf sorusu yazılır; her soru ikinci bir modelce kontrol edilir"
                              />
                            )}
                          </div>
                        );
                      })()}
                  </div>

                  {acik && (
                  <div className="space-y-2 border-t border-[var(--border)] p-2.5">
                    {/* GEÇMİŞ DENEMELER. Denemeler bilerek silinmiyor ama bir
                        açık bırakmıştım: kaydedilen sonuçlara ulaşmanın hiçbir
                        yolu yoktu — başlıktaki net yalnızca metindi ve ders
                        listesi denemeleri elemişti. Burada hem erişiliyorlar hem
                        de netler alt alta gelince gelişim görünüyor. */}
                    {g.denemeler.length > 0 && (
                      <div className="mb-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5">
                        <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-white/30">
                          Denemeler
                        </p>
                        <div className="space-y-0.5">
                          {g.denemeler.slice(0, DENEME_LISTE_TAVANI).map((d) => {
                            const yanlis = d.cevapSayisi - d.dogruSayisi;
                            const bos = Math.max(0, d.soruSayisi - d.cevapSayisi);
                            return (
                              // Silme düğmesi Link'in İÇİNDE değil KARDEŞİ:
                              // iç içe olsaydı hem geçersiz HTML olurdu hem de
                              // silmeye basınca denemeyi açardı.
                              <div key={d.id} className="group/dn flex items-center gap-1">
                                <Link
                                  href={`/ders/${d.id}`}
                                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.04]"
                                >
                                  <Timer size={12} className="flex-shrink-0 text-white/25" />
                                  <span className="min-w-0 flex-1 truncate text-[12px] text-white/60">
                                    {tarihMetni(d.created_at)}
                                    <span className="ml-2 text-white/30">
                                      {d.soruSayisi} soru
                                      {bos > 0 ? ` · ${bos} boş` : ""}
                                    </span>
                                  </span>
                                  <span className="flex-shrink-0 font-mono text-[12px] tabular-nums text-[var(--accent-light)]">
                                    {netHesapla(d.dogruSayisi, yanlis).toFixed(2).replace(".", ",")}
                                    <span className="ml-1 text-[10px] text-white/30">net</span>
                                  </span>
                                </Link>
                                <button
                                  onClick={() => setSilinecek({ id: d.id, deneme: true })}
                                  aria-label="Denemeyi sil"
                                  className="flex-shrink-0 rounded-lg p-1.5 text-white/20 opacity-0 transition-all hover:bg-red-400/10 hover:text-red-400 focus:opacity-100 group-hover/dn:opacity-100"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        {g.denemeler.length > DENEME_LISTE_TAVANI && (
                          <p className="px-2 pt-1 text-[11px] text-white/25">
                            en yeni {DENEME_LISTE_TAVANI} deneme gösteriliyor
                          </p>
                        )}
                      </div>
                    )}

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
                        // Videonun tam adı üstüne gelince görünüyor: ders adı
                        // modelin verdiği ad, video adı ise serideki karşılığı.
                        title={o.videoBaslik ?? undefined}
                        className="flex min-w-0 flex-1 items-center gap-3"
                      >
                        {/* Bu liste yalnızca dersleri taşıyor — pratik oturumu
                            kategori başlığında gösteriliyor, o yüzden küçük resim
                            koşulsuz basılıyor. */}
                        {o.metin ? (
                          <div className="flex h-12 w-20 flex-shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-black/20">
                            {o.paragraf ? (
                              <Pilcrow size={18} className="text-[var(--accent)]/55" />
                            ) : (
                              <FileText size={18} className="text-[var(--accent)]/55" />
                            )}
                          </div>
                        ) : (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={`https://img.youtube.com/vi/${o.video_id}/mqdefault.jpg`}
                            alt=""
                            className="h-12 w-20 flex-shrink-0 rounded-lg border border-white/[0.06] object-cover"
                            loading="lazy"
                          />
                        )}
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
                            {o.metin ? (
                              // Metnin "süresi" parça hesabı için sahte bir sayı; gösterilmiyor
                              <span className="flex items-center gap-1">
                                {o.paragraf ? <Pilcrow size={10} /> : <FileText size={10} />}
                                {o.paragraf ? "Paragraf" : "Metin"}
                              </span>
                            ) : (
                              !o.tekrarMi &&
                              o.sure > 0 && (
                                <span className="flex items-center gap-1">
                                  <Clock size={10} />
                                  {formatSure(o.sure)}
                                </span>
                              )
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
                        onClick={() => arsivle(o)}
                        aria-label="Dersi arşive kaldır"
                        title="Arşive kaldır"
                        className="flex-shrink-0 rounded-lg p-2 text-white/20 opacity-0 transition-all hover:bg-white/[0.08] hover:text-white/80 group-hover:opacity-100"
                      >
                        <Archive size={14} />
                      </button>
                      <button
                        onClick={() => setSilinecek({ id: o.id, deneme: false })}
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

              {/* ARŞİV — kapalı gelir; açılınca kategori kategori, derse girilebilir ve geri alınabilir */}
              {arsiv.length > 0 && (
                <div className="glass overflow-hidden rounded-2xl border border-[var(--border)]">
                  <button
                    onClick={() => setArsivAcik((a) => !a)}
                    aria-expanded={arsivAcik}
                    className="flex w-full items-center gap-2 p-3.5 text-left"
                  >
                    {arsivAcik ? (
                      <ChevronDown size={15} className="flex-shrink-0 text-white/35" />
                    ) : (
                      <ChevronRight size={15} className="flex-shrink-0 text-white/35" />
                    )}
                    <Archive size={13} className="flex-shrink-0 text-white/35" />
                    <span className="text-[12px] font-medium uppercase tracking-wider text-white/55">Arşiv</span>
                    <span className="text-[11.5px] text-white/30">{arsiv.length} ders</span>
                  </button>
                  {arsivAcik && (
                    <div className="space-y-3 border-t border-[var(--border)] p-2.5">
                      {[...new Set(arsiv.map((a) => a.kategori))].map((kat) => {
                        const kattakiler = arsiv.filter((a) => a.kategori === kat);
                        return (
                          <div key={kat}>
                            <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-white/30">
                              {kat} · {kattakiler.length}
                            </p>
                            <div className="space-y-0.5">
                              {kattakiler.map((a) => (
                                <div key={a.id} className="flex items-center gap-1">
                                  <Link
                                    href={`/ders/${a.id}`}
                                    className="min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-[12.5px] text-white/55 transition-colors hover:bg-white/[0.04] hover:text-white/85"
                                  >
                                    {a.title ?? "Ders"}
                                  </Link>
                                  <button
                                    onClick={() => arsivdenCikar(a)}
                                    className="flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/85"
                                  >
                                    <ArchiveRestore size={12} />
                                    Geri al
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Dersi silinmiş notlar — normalde hiç görünmez */}
              {kategorisizNotlar.length > 0 && (
                <div className="glass flex items-center gap-3 rounded-2xl border border-[var(--border)] p-3.5">
                  <div className="min-w-0 flex-1">
                    <span className="text-[12px] font-medium uppercase tracking-wider text-white/55">
                      {NOT_KATEGORISIZ}
                    </span>
                    <p className="mt-1 text-[11.5px] text-white/35">
                      dersi silinmiş {kategorisizNotlar.length} not
                    </p>
                  </div>
                  <button
                    onClick={() => setNotKategorisi(NOT_KATEGORISIZ)}
                    className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11.5px] text-white/55 transition-colors hover:border-[var(--border-hover)] hover:text-white/90"
                  >
                    <NotebookPen size={12} className="text-[var(--accent)]/70" />
                    {kategorisizNotlar.length} not
                  </button>
                </div>
              )}

              {oturumlar.length >= LISTE_TAVANI && (
                <p className="px-1 pt-2 text-center text-[11.5px] text-white/25">
                  En yeni {LISTE_TAVANI} ders gösteriliyor. Daha eskileri listede yok.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Ders notları paneli — sayfadan çıkmadan, soldan. Tek kategorinin
          notlarını gösteriyor; hangi kategori olduğu notKategorisi'nde.
          Ana sayfadaki notlar kenar çubuğuyla aynı desen (left-0, border-r,
          aynı yatay kaydırma geçişi) ama ondan GENİŞ: oradaki notların adını
          ablam kendi koyuyor ve kısa oluyor, buradaki başlıklar ise dersin
          kendi adı — "II. Viyana Kuşatması ve Osmanlı'nın Siyasi Üstünlüğünü
          Kaybetmesi" gibi 60+ karakter. Genişlik tek başına yetmediği için
          başlık iki satıra kadar sarıyor; tamamı ayrıca title'da duruyor. */}
      {notKategorisi !== null && (
        <div
          className="animate-overlay fixed inset-0 z-[var(--z-overlay)] bg-black/50"
          onClick={() => setNotKategorisi(null)}
        />
      )}

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${gosterilenNotKategorisi ?? ""} ders notları`}
        className={`glass-strong fixed left-0 top-0 z-[var(--z-panel)] flex h-screen w-80 flex-col border-r border-[var(--border)] shadow-2xl shadow-black/40 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] sm:w-96 ${
          notKategorisi !== null ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={notKategorisi === null}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10">
              <NotebookPen size={13} className="text-[var(--accent)]" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-[13.5px] font-medium text-white/90">
                {gosterilenNotKategorisi ?? "Ders notları"}
              </h2>
              <p className="text-[11px] text-white/30">ders notları</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setNotKategorisi(null)}
            aria-label="Kapat"
            tabIndex={notKategorisi !== null ? 0 : -1}
            className="-mr-1.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/70"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {dersNotlari === null ? (
            <div className="flex justify-center py-12">
              <Loader2 size={18} className="animate-spin text-[var(--accent)]/50" />
            </div>
          ) : panelNotlari.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-3 py-14 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06]">
                <NotebookPen size={18} className="text-white/20" />
              </div>
              <p className="text-[12.5px] leading-relaxed text-white/30">
                Bu kategoride ders notun yok. Bir dersin özet ekranında &quot;Özeti ders
                notlarına kaydet&quot; dediğinde burada görünecek.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {panelNotlari.map((n) => (
                <Link
                  key={n.id}
                  href={`/note/${n.id}`}
                  tabIndex={notKategorisi !== null ? 0 : -1}
                  title={n.baslik}
                  className="group flex items-start gap-2.5 rounded-xl px-3 py-2 transition-colors hover:bg-[var(--accent)]/[0.06]"
                >
                  <FileText size={14} className="mt-0.5 flex-shrink-0 text-white/25" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[13px] leading-snug text-white/85">
                      {n.baslik}
                    </p>
                    <p className="mt-1 text-[11px] text-white/30">{tarihMetni(n.updated_at)}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Oynatma listesi paneli — kategori kartından açılır */}
      {listePaneli !== null && (
        <div
          className="animate-overlay fixed inset-0 z-[var(--z-panel)] flex items-center justify-center bg-black/40 px-5"
          onClick={() => !listeYukleniyor && setListePaneli(null)}
        >
          <div
            ref={listeRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="liste-paneli-basligi"
            className="animate-fade-in-scale flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface-popup)] p-5 shadow-2xl shadow-black/40"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10">
                  <ListChecks size={15} className="text-[var(--accent)]" />
                </div>
                <div>
                  <h2 id="liste-paneli-basligi" className="text-[14px] font-medium text-white/90">
                    {listePaneli
                      ? `${listePaneli} derslerini listeyle karşılaştır`
                      : "Listeden ders seç"}
                  </h2>
                  <p className="text-[11.5px] text-white/35">
                    Eksikleri işaretle; Shift ile aralık seçebilirsin
                  </p>
                </div>
              </div>
              <button
                onClick={() => setListePaneli(null)}
                aria-label="Kapat"
                className="-mr-1.5 -mt-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/70"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="url"
                value={listeUrl}
                onChange={(e) => setListeUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") listeyiKarsilastir();
                }}
                disabled={listeYukleniyor}
                placeholder="https://www.youtube.com/playlist?list=…"
                className="focus-ring min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[13px] text-white/95 placeholder-white/25 disabled:opacity-50"
              />
              <button
                onClick={() => listeyiKarsilastir()}
                disabled={listeYukleniyor || !listeUrl.trim()}
                className="flex flex-shrink-0 items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-[13px] font-medium text-[var(--background)] transition-colors hover:bg-[var(--accent-light)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {listeYukleniyor ? <Loader2 size={14} className="animate-spin" /> : "Tara"}
              </button>
            </div>

            {liste && (
              <div className="mt-4 flex min-h-0 flex-1 flex-col">
                <p className="mb-2 text-[12px] text-white/50">
                  <span className="font-medium text-white/80">{liste.baslik ?? "Liste"}</span>
                  <span className="text-white/35">
                    {" "}
                    · {liste.toplam} video · {liste.ozet.ders} eklendi
                    {liste.ozet.eksik + liste.ozet.transkript > 0 &&
                      ` · ${liste.ozet.eksik + liste.ozet.transkript} eksik`}
                    {liste.ozet.yarim > 0 && ` · ${liste.ozet.yarim} yarım`}
                    {liste.ozet.mukerrer > 0 && ` · ${liste.ozet.mukerrer} mükerrer`}
                    {liste.ozet.baska > 0 && ` · ${liste.ozet.baska} başka kategoride`}
                    {liste.atlanan > 0 && ` · ${liste.atlanan} gizli/silinmiş atlandı`}
                    {liste.kirpildi && " · liste 500'den uzun, ilk 500'ü okundu"}
                  </span>
                </p>

                <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
                  {liste.satirlar.map((v, i) => (
                    <div
                      key={v.videoId}
                      onClick={(e) => secimiCevir(i, e.shiftKey)}
                      className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12px] ${
                        secilebilir(v)
                          ? "cursor-pointer select-none hover:bg-white/[0.04]"
                          : ""
                      } ${
                        secilenler.has(v.videoId)
                          ? "bg-[var(--accent)]/[0.08] text-white/90"
                          : v.durum === "ders" && v.dersSayisi === 1
                            ? "text-white/40"
                            : "text-white/80"
                      }`}
                    >
                      {/* Seçim kutusu yalnızca sıraya alınabilecek satırlarda;
                          diğerlerinde aynı genişlikte boşluk, hizalama bozulmasın */}
                      {secilebilir(v) ? (
                        <input
                          type="checkbox"
                          checked={secilenler.has(v.videoId)}
                          onChange={() => undefined}
                          onClick={(e) => {
                            e.stopPropagation();
                            secimiCevir(i, (e as React.MouseEvent).shiftKey);
                          }}
                          aria-label={`${v.baslik} — sıraya al`}
                          className="h-3.5 w-3.5 flex-shrink-0 cursor-pointer accent-[var(--accent)]"
                        />
                      ) : (
                        <span className="w-3.5 flex-shrink-0" />
                      )}
                      <span className="w-6 flex-shrink-0 text-right font-mono text-[11px] text-white/25">
                        {v.sira + 1}
                      </span>
                      {/* Küçük resim: 157 satırlık listede tembel yükleme şart.
                          default.jpg 120×90; 16:9'a kırpılıyor. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`https://img.youtube.com/vi/${v.videoId}/default.jpg`}
                        alt=""
                        loading="lazy"
                        className={`h-[22px] w-10 flex-shrink-0 rounded border border-white/[0.06] object-cover ${
                          v.durum === "ders" && v.dersSayisi === 1 ? "opacity-50" : ""
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate" title={v.baslik}>
                        {v.baslik}
                      </span>
                      {v.dersSayisi > 1 ? (
                        <Link
                          href={`/ders/${v.dersId}`}
                          className="flex-shrink-0 rounded-md border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10.5px] text-amber-200 transition-colors hover:bg-amber-400/20"
                          title="Bu video birden fazla kez eklenmiş; derslerden birini silebilirsin"
                        >
                          {v.dersSayisi} kez eklenmiş
                        </Link>
                      ) : v.durum === "ders" ? (
                        <span className="flex-shrink-0 text-[10.5px] text-[var(--accent)]/60">
                          {LISTE_DURUM_METNI.ders}
                        </span>
                      ) : v.durum === "yarim" ? (
                        <Link
                          href={`/ders/${v.dersId}`}
                          className="flex-shrink-0 rounded-md border border-amber-400/30 px-1.5 py-0.5 text-[10.5px] text-amber-200/80"
                        >
                          {LISTE_DURUM_METNI.yarim}
                        </Link>
                      ) : v.durum === "baska" ? (
                        <Link
                          href={`/ders/${v.dersId}`}
                          className="flex-shrink-0 rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[10.5px] text-white/50"
                          title={`Bu video "${v.kategori}" kategorisinde ekli`}
                        >
                          {v.kategori}
                        </Link>
                      ) : (
                        <span className="flex-shrink-0 rounded-md border border-red-400/30 bg-red-400/[0.06] px-1.5 py-0.5 text-[10.5px] text-red-200/80">
                          {LISTE_DURUM_METNI[v.durum]}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {liste.ozet.eksik + liste.ozet.transkript > 0 ? (
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={secilenler.size ? () => setSecilenler(new Set()) : tumunuSec}
                      className="flex-shrink-0 rounded-xl border border-[var(--border)] px-3 py-2.5 text-[12px] text-white/55 transition-colors hover:border-[var(--border-hover)] hover:text-white/85"
                    >
                      {secilenler.size
                        ? "Seçimi kaldır"
                        : `Tümünü seç (${liste.ozet.eksik + liste.ozet.transkript})`}
                    </button>
                    <button
                      onClick={eksikleriSirayaAl}
                      disabled={!secilenler.size}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-[13px] font-medium text-[var(--background)] transition-colors hover:bg-[var(--accent-light)] disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <ArrowRight size={14} />
                      {secilenler.size
                        ? `Seçili ${secilenler.size} dersi sıraya al`
                        : "Sıraya almak için ders seç"}
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 text-center text-[11.5px] text-[var(--accent)]/70">
                    {listePaneli ? "Listedeki her video bu kategoride ekli." : "Listedeki her video zaten ekli."}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Deneme kurulumu. Soru sayısı ve tempo BURADA seçiliyor: ablam sistemi
          hem KPSS hem YKS için kullanıyor, aynı ders iki sınavda farklı
          ağırlıkta ve farklı tempoda. Sabit bir sayı ikisinden birine yanlış
          gelirdi. */}
      {denemeKurulum !== null && (
        <div
          className="animate-overlay fixed inset-0 z-[var(--z-panel)] flex items-center justify-center bg-black/40 px-5"
          onClick={() => !denemeKuruluyor && setDenemeKurulum(null)}
        >
          <div
            ref={denemeRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="deneme-kurulum-basligi"
            className="animate-fade-in-scale w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface-popup)] p-5 shadow-2xl shadow-black/40"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)]/10">
                <Timer size={15} className="text-[var(--accent)]" />
              </div>
              <div>
                <h2 id="deneme-kurulum-basligi" className="text-[14px] font-medium text-white/90">
                  {denemeKurulum} denemesi
                </h2>
                <p className="text-[11.5px] text-white/35">
                  havuzda {havuzlar.get(denemeKurulum) ?? 0} çoktan seçmeli var
                </p>
              </div>
            </div>

            <label className="mb-1.5 block text-[12px] font-medium text-white/55">
              Soru sayısı
            </label>
            <div className="mb-1 flex items-center gap-3">
              <input
                type="range"
                min={DENEME_EN_AZ_SORU}
                max={Math.min(DENEME_EN_FAZLA_SORU, havuzlar.get(denemeKurulum) ?? DENEME_EN_AZ_SORU)}
                value={denemeSoru}
                onChange={(e) => setDenemeSoru(Number(e.target.value))}
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/[0.08] accent-[var(--accent)]"
              />
              <span className="w-10 text-right font-mono text-[14px] tabular-nums text-white/85">
                {denemeSoru}
              </span>
            </div>

            <label className="mb-1.5 mt-4 block text-[12px] font-medium text-white/55">
              Tempo — soru başına süre
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {DENEME_TEMPOLARI.map((t) => (
                <button
                  key={t.ad}
                  onClick={() => setDenemeTempo(t.sn)}
                  title={`${t.ad}: ${t.aciklama}`}
                  className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    denemeTempo === t.sn
                      ? "border-[var(--accent)]/45 bg-[var(--accent)]/[0.10]"
                      : "border-[var(--border)] hover:border-[var(--border-hover)]"
                  }`}
                >
                  <span
                    className={`block text-[12.5px] ${
                      denemeTempo === t.sn ? "text-[var(--accent-light)]" : "text-white/70"
                    }`}
                  >
                    {t.ad}
                  </span>
                  <span className="text-[11px] text-white/30">{t.sn} sn/soru</span>
                </button>
              ))}
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
              <Clock size={13} className="text-white/30" />
              <span className="text-[12.5px] text-white/60">
                Toplam süre{" "}
                <span className="font-mono text-white/90">
                  {Math.floor((denemeSoru * denemeTempo) / 60)} dk{" "}
                  {(denemeSoru * denemeTempo) % 60 > 0
                    ? `${(denemeSoru * denemeTempo) % 60} sn`
                    : ""}
                </span>
              </span>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-white/35">
              Süre deneme başlar başlamaz işlemeye başlar ve durdurulamaz. Sekmeyi
              kapatsan da sayaç işlemeye devam eder.
            </p>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => denemeBaslat(denemeKurulum)}
                disabled={!!denemeKuruluyor}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-[13px] font-medium text-[var(--background)] transition-colors hover:bg-[var(--accent-light)] disabled:opacity-50"
              >
                {denemeKuruluyor ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Hazırlanıyor…
                  </>
                ) : (
                  "Denemeyi başlat"
                )}
              </button>
              <button
                onClick={() => setDenemeKurulum(null)}
                disabled={!!denemeKuruluyor}
                className="rounded-xl border border-[var(--border)] px-4 py-3 text-[13px] text-white/55 transition-colors hover:border-[var(--border-hover)] hover:text-white/85 disabled:opacity-50"
              >
                Vazgeç
              </button>
            </div>
          </div>
        </div>
      )}

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
              {silinecek.deneme ? "Bu deneme silinsin mi?" : "Bu ders silinsin mi?"}
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/45">
              {silinecek.deneme
                ? "Denemenin soruları, cevapların ve neti silinir. Sorular kaynak derslerden kopyalandığı için dersler etkilenmez. Geri alınamaz."
                : "Sorular ve verdiğin cevaplar da silinir. Geri alınamaz."}
            </p>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setSilinecek(null)}
                className="flex-1 rounded-xl border border-[var(--border)] px-4 py-2.5 text-[13px] text-white/60 transition-colors hover:text-white/90"
              >
                Vazgeç
              </button>
              <button
                onClick={() => oturumSil(silinecek.id, silinecek.deneme)}
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

/**
 * Kategori başlığındaki çalışma eylemi: üstte ad, altta o eylemin sayısı.
 * Ton hiyerarşiyi taşıyor — vurgu (asıl iş), uyarı (bekleyen yanlış),
 * tamam (günün hedefi bitti), nötr (ara sıra), sönük (bugün yapacak yok).
 */
function KategoriEylemi({
  onClick,
  disabled,
  yukleniyor,
  Ikon,
  etiket,
  alt,
  ton,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  yukleniyor?: boolean;
  Ikon: typeof Dices;
  etiket: string;
  alt: string;
  ton: "vurgu" | "uyari" | "tamam" | "notr" | "sonuk";
  title: string;
}) {
  const renk = {
    vurgu: "border-[var(--accent)]/30 bg-[var(--accent)]/[0.08] text-[var(--accent-light)] hover:border-[var(--accent)]/55 hover:bg-[var(--accent)]/[0.13]",
    uyari: "border-amber-400/30 bg-amber-400/[0.07] text-amber-100/90 hover:border-amber-400/55 hover:bg-amber-400/[0.11]",
    tamam: "border-[var(--accent)]/25 text-[var(--accent-light)]/80 hover:border-[var(--accent)]/50",
    notr: "border-[var(--border)] text-white/75 hover:border-[var(--border-hover)] hover:text-white/95",
    sonuk: "border-[var(--border)] text-white/40 hover:border-[var(--border-hover)] hover:text-white/65",
  }[ton];
  const ikonRengi = ton === "uyari" ? "text-amber-300/85" : ton === "notr" || ton === "sonuk" ? "text-[var(--accent)]/70" : "";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`min-w-0 rounded-xl border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:px-3 ${renk}`}
    >
      <span className="flex items-center gap-1.5 text-[12px] font-medium sm:text-[12.5px]">
        {yukleniyor ? <Loader2 size={13} className="flex-shrink-0 animate-spin" /> : <Ikon size={13} className={`flex-shrink-0 ${ikonRengi}`} />}
        <span className="truncate">{etiket}</span>
      </span>
      <span className="mt-0.5 block truncate text-[11px] tabular-nums opacity-70">{alt}</span>
    </button>
  );
}
