"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useToast } from "@/components/Toast";
import {
  baslatilacakIs,
  ES_ZAMANLI_URETIM,
  IS_CALISIYOR,
  linkleriAyikla,
  type UretimIsi,
} from "@/lib/ders";

/**
 * DERS ÜRETİM KUYRUĞU.
 *
 * Önceki akışta üretim /ders sayfasının kendi state'indeydi: bir ders işlenirken
 * link kutusu kilitleniyordu, bittiğinde de sayfa doğrudan derse atlıyordu.
 * Ablam beş dersi izleyip hepsini birden işleme koymak istiyor — sıradaki
 * dersler hazırlanırken ilkini çözmeye başlayabilmeli.
 *
 * Kuyruk neden LAYOUT'ta: /ders'ten /ders/<id>'ye geçildiğinde layout ayakta
 * kalıyor, sayfa bileşeni kalmıyor. Kuyruk sayfada olsaydı ablam ilk dersi
 * açtığı anda geri kalan üretimler ölürdü.
 *
 * SINIRI: sekme kapanırsa ya da sayfa yenilenirse çalışan işler kesilir. Bu
 * ölümcül değil çünkü 1. adım sunucuda tamamlanıp oturumu zaten kaydediyor;
 * ders listesinde "yarım" olarak görünüyor ve "Tamamla" düğmesi 2. adımı
 * çalıştırıyor. Sırada BEKLEYEN işler (henüz para harcamamış olanlar)
 * localStorage'a yazılıyor, yenilemeden sonra kaldığı yerden devam ediyor.
 *
 * Gerçek bir sunucu kuyruğu (tablo + arka plan işçisi) sekme kapansa da devam
 * ederdi; şema değişikliği ve bir işçi gerektirdiği için yapılmadı. Sekmenin
 * açık kalması ablamın zaten yaptığı şey.
 */

interface KuyrukDegeri {
  isler: UretimIsi[];
  /** Yapıştırılan metindeki her linki sıraya alır; kaç iş eklendiğini döner */
  ekle: (metin: string) => number;
  /** Yarım kalmış bir oturumun 2. adımını sıraya alır */
  tamamlaEkle: (sessionId: string, videoId: string, baslik: string | null) => void;
  kaldir: (id: string) => void;
  tekrarDene: (id: string) => void;
  /** Elle yapıştırılan transkriptle işi yeniden sıraya alır */
  elleGonder: (id: string, transkript: string) => void;
  /** Bir iş her tamamlandığında artar — ders listesini tazelemek için */
  tamamlananSayac: number;
}

const Baglam = createContext<KuyrukDegeri | null>(null);

export function useKuyruk(): KuyrukDegeri {
  const deger = useContext(Baglam);
  if (!deger) throw new Error("useKuyruk, DersKuyruguSaglayici içinde kullanılmalı.");
  return deger;
}

const DEPO_ANAHTARI = "ablam-ders-kuyruk";

function yeniId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `is-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** fetch + json + hata fırlatma. `kod` alanı çağırana taşınıyor (elle_gerekli). */
async function istek(
  yol: string,
  govde: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(yol, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(govde),
  });
  const veri = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const hata = new Error(
      typeof veri.hata === "string" ? veri.hata : "İşlem tamamlanamadı."
    ) as Error & { kod?: string };
    if (typeof veri.kod === "string") hata.kod = veri.kod;
    throw hata;
  }
  return veri;
}

export function DersKuyruguSaglayici({ children }: { children: React.ReactNode }) {
  // İşlerin tek doğru kopyası ref'te, ekranda görünen kopya state'te.
  // Sebebi yarış: iki iş aynı anda transkript alıp "benimle aynı videoyu işleyen
  // var mı?" diye sorduğunda cevabın en güncel listeden gelmesi gerekiyor;
  // state okuması o anda bir render geride kalabiliyor.
  const islerRef = useRef<UretimIsi[]>([]);
  const [isler, setIsler] = useState<UretimIsi[]>([]);
  const [tamamlananSayac, setTamamlananSayac] = useState(0);
  const baslatilan = useRef(new Set<string>());
  const yuklendi = useRef(false);

  const router = useRouter();
  const pathname = usePathname();
  // Hangi sayfada olduğumuz iş bitince okunuyor; ref'e yazma render sırasında
  // değil effect içinde (bkz. components/useModal.ts'teki aynı gerekçe).
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);
  const { addToast } = useToast();

  const guncelle = useCallback((fn: (liste: UretimIsi[]) => UretimIsi[]) => {
    islerRef.current = fn(islerRef.current);
    setIsler(islerRef.current);
  }, []);

  // --- Yenilemeye dayanıklılık: yalnızca BEKLEYEN işler saklanıyor ----------
  // Çalışan bir iş saklansaydı yenilemeden sonra ikinci kez üretilir, aynı ders
  // için ikinci kez para harcanırdı. Bekleyen iş ise henüz hiçbir çağrı yapmadı.
  useEffect(() => {
    try {
      const ham = localStorage.getItem(DEPO_ANAHTARI);
      if (ham) {
        const liste = JSON.parse(ham) as UretimIsi[];
        if (Array.isArray(liste) && liste.length) {
          const temiz = liste
            .filter((i) => i && typeof i.url === "string" && i.durum === "bekliyor")
            .map((i) => ({ ...i, id: yeniId() }));
          if (temiz.length) guncelle(() => temiz);
        }
      }
    } catch {
      // Bozuk kayıt varsa yok say — kuyruk boş başlar
    }
    yuklendi.current = true;
  }, [guncelle]);

  useEffect(() => {
    if (!yuklendi.current) return;
    try {
      const bekleyen = isler.filter((i) => i.durum === "bekliyor");
      if (bekleyen.length) localStorage.setItem(DEPO_ANAHTARI, JSON.stringify(bekleyen));
      else localStorage.removeItem(DEPO_ANAHTARI);
    } catch {
      // Depolama kapalıysa kuyruk yine çalışır, sadece yenilemeye dayanmaz
    }
  }, [isler]);

  // --- İşin kendisi ---------------------------------------------------------
  const isiCalistir = useCallback(
    async (is: UretimIsi) => {
      const yaz = (yeni: Partial<UretimIsi>) =>
        guncelle((liste) => liste.map((i) => (i.id === is.id ? { ...i, ...yeni } : i)));

      let videoId = is.videoId;
      let sessionId = is.sessionId;
      let baslik = is.baslik;

      try {
        if (is.tur === "yeni") {
          yaz({ durum: "transkript", hata: null });
          let tr: Record<string, unknown>;
          try {
            tr = await istek("/api/ders/transcript", {
              url: is.url,
              elleTranskript: is.elleTranskript,
            });
          } catch (err) {
            // Otomatik yollar düştü: ablam transkripti kendi tarayıcısından
            // yapıştırabilir. İş silinmiyor, "elle" durumunda bekliyor.
            if ((err as { kod?: string }).kod === "elle_gerekli") {
              yaz({ durum: "elle", hata: (err as Error).message });
              return;
            }
            throw err;
          }

          videoId = String(tr.videoId ?? "");
          baslik = typeof tr.baslik === "string" ? tr.baslik : null;
          yaz({ videoId, baslik, sure: typeof tr.sure === "number" ? tr.sure : 0 });

          // Aynı videoyu işleyen başka bir iş var mı? (Kuyruğa iki kez yapıştırılan
          // link, ya da "Tamamla" ile aynı anda başlatılan yarım oturum.) Video
          // kimliği ancak burada bilindiği için kontrol burada.
          const cakisan = islerRef.current.find(
            (i) => i.id !== is.id && i.videoId === videoId && IS_CALISIYOR.includes(i.durum)
          );
          if (cakisan) {
            yaz({ durum: "hata", hata: "Bu ders şu anda zaten hazırlanıyor." });
            return;
          }

          yaz({ durum: "acik" });
          const acik = await istek("/api/ders/generate", { videoId, adim: "acik" });
          sessionId = String(acik.sessionId ?? "");
          yaz({ sessionId });
        }

        if (!videoId || !sessionId) throw new Error("Oturum kimliği alınamadı.");

        yaz({ durum: "coktan" });
        await istek("/api/ders/generate", { videoId, adim: "coktan", sessionId });
        yaz({ durum: "hazir", hata: null });

        setTamamlananSayac((n) => n + 1);

        // Tek iş varsa ve ablam hâlâ ders listesindeyse doğrudan derse geç —
        // eski davranış buydu, tek ders yapıştırınca beklediği şey bu.
        // Kuyrukta başka iş varken ya da ablam başka bir dersi çözerken
        // ASLA sayfa değiştirilmiyor; çözdüğü sorudan koparmak olur.
        const tekIs = islerRef.current.length === 1;
        if (tekIs && pathRef.current === "/ders") {
          guncelle((liste) => liste.filter((i) => i.id !== is.id));
          router.push(`/ders/${sessionId}`);
        } else {
          addToast(`${baslik ?? "Ders"} hazır`, "success");
        }
      } catch (err) {
        const mesaj = (err as Error).message;
        yaz({ durum: "hata", hata: mesaj });
        addToast(mesaj, "error");
      }
    },
    [addToast, guncelle, router]
  );

  // Sıradaki işi başlatan tek yer. Her state değişiminde en fazla bir iş
  // başlatılıyor; o iş durumunu yazınca effect yeniden çalışıp sonrakine bakıyor.
  useEffect(() => {
    const sirada = baslatilacakIs(isler, ES_ZAMANLI_URETIM);
    if (!sirada || baslatilan.current.has(sirada.id)) return;
    baslatilan.current.add(sirada.id);
    void isiCalistir(sirada);
  }, [isler, isiCalistir]);

  // --- Dışarıya açılan işlemler --------------------------------------------
  const ekle = useCallback(
    (metin: string) => {
      const linkler = linkleriAyikla(metin);
      if (!linkler.length) return 0;

      const mevcut = new Set(
        islerRef.current.filter((i) => i.durum !== "hata").map((i) => i.url)
      );
      const yeniler = linkler
        .filter((url) => !mevcut.has(url))
        .map<UretimIsi>((url) => ({
          id: yeniId(),
          tur: "yeni",
          url,
          videoId: null,
          sessionId: null,
          baslik: null,
          sure: 0,
          durum: "bekliyor",
          hata: null,
        }));

      if (yeniler.length < linkler.length) {
        addToast("Zaten sırada olan linkler atlandı.", "info");
      }
      if (!yeniler.length) return 0;

      guncelle((liste) => [...liste, ...yeniler]);
      return yeniler.length;
    },
    [addToast, guncelle]
  );

  const tamamlaEkle = useCallback(
    (sessionId: string, videoId: string, baslik: string | null) => {
      if (islerRef.current.some((i) => i.sessionId === sessionId && i.durum !== "hata")) return;
      guncelle((liste) => [
        ...liste,
        {
          id: yeniId(),
          tur: "tamamla",
          url: "",
          videoId,
          sessionId,
          baslik,
          sure: 0,
          durum: "bekliyor",
          hata: null,
        },
      ]);
    },
    [guncelle]
  );

  const kaldir = useCallback(
    (id: string) => {
      baslatilan.current.delete(id);
      guncelle((liste) => liste.filter((i) => i.id !== id));
    },
    [guncelle]
  );

  // Yeniden denemede iş YENİ bir kimlik alıyor: başlatılanlar kümesi kimliğe
  // bakıyor, aynı kimlikle geri konsa zamanlayıcı onu bir daha başlatmaz.
  const tekrarDene = useCallback(
    (id: string) => {
      guncelle((liste) =>
        liste.map((i) =>
          i.id === id ? { ...i, id: yeniId(), durum: "bekliyor", hata: null } : i
        )
      );
    },
    [guncelle]
  );

  const elleGonder = useCallback(
    (id: string, transkript: string) => {
      guncelle((liste) =>
        liste.map((i) =>
          i.id === id
            ? { ...i, id: yeniId(), durum: "bekliyor", hata: null, elleTranskript: transkript }
            : i
        )
      );
    },
    [guncelle]
  );

  return (
    <Baglam.Provider
      value={{ isler, ekle, tamamlaEkle, kaldir, tekrarDene, elleGonder, tamamlananSayac }}
    >
      {children}
    </Baglam.Provider>
  );
}

/**
 * Ders çözerken kuyruğun çalıştığını gösteren küçük rozet. /ders sayfasında
 * gizli — orada kuyruğun tamamı zaten listeleniyor. Sol altta duruyor çünkü
 * sağ alt köşe bildirimlerin (toast) yeri.
 */
export function KuyrukRozeti() {
  const { isler } = useKuyruk();
  const pathname = usePathname();

  const calisan = isler.filter((i) => IS_CALISIYOR.includes(i.durum)).length;
  const bekleyen = isler.filter((i) => i.durum === "bekliyor").length;
  const toplam = calisan + bekleyen;

  if (!toplam || pathname === "/ders") return null;

  return (
    <Link
      href="/ders"
      className="glass fixed bottom-6 left-6 z-20 animate-fade-in flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-[12px] text-white/55 transition-all duration-200 hover:border-[var(--border-hover)] hover:text-white/85"
    >
      <Loader2 size={13} className="animate-spin text-[var(--accent)]/70" />
      {toplam} ders hazırlanıyor
    </Link>
  );
}
