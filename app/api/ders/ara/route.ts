import { NextResponse } from "next/server";
import type { Segment } from "@/lib/ders";
import { hataCevabi, kapiKontrol } from "@/lib/ders-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 30;

// Ders içi arama: kayıtlı transkriptlerde terim arar, geçtiği ANI döndürür.
//
// MODEL ÇAĞRISI YOK. Transkriptler zaten veritabanında duruyor ve üretimden
// sonra neredeyse hiç kullanılmıyordu — yalnızca değerlendirmede ±90 saniyelik
// dilim okunuyor. Bu uç, o veriyi ablamın "bunu nerede anlatmıştı?" sorusuna
// cevap verecek şekilde kullanıyor.
//
// Arama sunucuda yapılıyor çünkü transkriptlerin tamamı ~1 MB; tarayıcıya
// indirmek gereksiz. Ders sayısı çok artarsa (yüzlerce) burası Postgres tam
// metin aramasına taşınmalı — o zaman şema işi gerekir.

/** Aranan en az karakter — daha kısası bütün transkripti eşleştirir */
const EN_AZ_UZUNLUK = 3;
const EN_FAZLA_DERS = 12;
/**
 * Aranan transkript sayısı tavanı. Yalnızca LİSTEDEKİ derslerin videoları
 * sayıldığı için tavan silinmiş derslerle dolmuyor; 73 derslik kategoride
 * 100'ün üstüne çıkmak uzak ama çıkarsa en yeni dersler kalıyor.
 */
const EN_FAZLA_VIDEO = 200;
const DERS_BASINA_VURGU = 5;
/** Bu kadar saniye içindeki iki eşleşme tek anma sayılır */
const BIRLESTIRME_SN = 20;

/**
 * UZUNLUĞU KORUYAN sadeleştirme. Eşleşmenin indeksini orijinal metinde
 * kullanabilmek için karakter sayısı değişmemeli:
 *   - normalize("NFD") kullanılmıyor, o uzunluğu değiştiriyor
 *   - toLowerCase() de kullanılmıyor: Türkçe "İ" iki karaktere açılıyor
 * Bunun yerine harf harf eşleme + yalnızca A-Z için küçültme.
 */
const HARF_ESLEME: Record<string, string> = {
  ç: "c", Ç: "c", ğ: "g", Ğ: "g", ı: "i", I: "i", İ: "i", i: "i",
  ö: "o", Ö: "o", ş: "s", Ş: "s", ü: "u", Ü: "u",
  â: "a", Â: "a", î: "i", Î: "i", û: "u", Û: "u",
};

function sade(metin: string): string {
  let cikti = "";
  for (const h of metin) {
    const esle = HARF_ESLEME[h];
    if (esle) {
      cikti += esle;
    } else if (h >= "A" && h <= "Z") {
      cikti += h.toLowerCase();
    } else {
      cikti += h;
    }
  }
  return cikti;
}

interface Vurgu {
  saniye: number;
  metin: string;
  /** Eşleşmenin `metin` içindeki başlangıcı ve uzunluğu — arayüz burayı vurguluyor */
  bas: number;
  uzunluk: number;
}

/** Bir anın çevresindeki parçaları okunabilir tek satıra çevirir */
function baglam(segments: Segment[], indeks: number, komsu = 3): { metin: string; ofset: number } {
  const bas = Math.max(0, indeks - komsu);
  const oncesi = segments.slice(bas, indeks).map((s) => s.t).join(" ");
  const sonrasi = segments.slice(indeks + 1, indeks + 1 + komsu).map((s) => s.t).join(" ");
  const ofset = oncesi ? oncesi.length + 1 : 0;
  return {
    metin: [oncesi, segments[indeks].t, sonrasi].filter(Boolean).join(" "),
    ofset,
  };
}

/** Gövde: { q } -> { sorgu, dersSayisi, toplam, sonuclar } */
export async function POST(request: Request) {
  const engel = await kapiKontrol();
  if (engel) return engel;

  try {
    let govde: Record<string, unknown>;
    try {
      govde = await request.json();
    } catch {
      return NextResponse.json({ hata: "Geçersiz istek gövdesi." }, { status: 400 });
    }
    const sorgu = typeof govde.q === "string" ? govde.q.trim() : "";
    if (sorgu.length < EN_AZ_UZUNLUK) {
      return NextResponse.json({ hata: `En az ${EN_AZ_UZUNLUK} karakter yaz.` }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();

    // Önce LİSTEDEKİ dersler. ders_videos bir önbellek: ders silinince
    // transkript kalıyor (aynı video yeniden eklenirse Supadata kredisi
    // harcanmasın diye). Doğrudan ders_videos taranınca silinmiş derslerin
    // transkriptleri de sonuçlara karışıyordu ve 100'lük tavan silinmişlerle
    // doluyordu. Ölçüt ders listesiyle aynı: tur=ders, hazir/hazirlaniyor.
    const { data: dersler, error: dersHatasi } = await supabase
      .from("ders_sessions")
      .select("video_id, created_at")
      .eq("tur", "ders")
      .in("status", ["hazir", "hazirlaniyor"])
      .order("created_at", { ascending: false })
      .limit(EN_FAZLA_VIDEO);
    if (dersHatasi) throw new Error(dersHatasi.message);

    const videoKimlikleri = [...new Set((dersler ?? []).map((d) => d.video_id as string))];
    if (!videoKimlikleri.length) {
      return NextResponse.json({ sorgu, dersSayisi: 0, toplam: 0, sonuclar: [] });
    }

    const { data: videolar, error } = await supabase
      .from("ders_videos")
      .select("video_id, title, duration_seconds, segments")
      .in("video_id", videoKimlikleri);

    if (error) throw new Error(error.message);

    const sadeSorgu = sade(sorgu);
    const sonuclar: {
      videoId: string;
      baslik: string | null;
      toplam: number;
      vurgular: Vurgu[];
    }[] = [];

    for (const v of videolar ?? []) {
      const segments = (Array.isArray(v.segments) ? v.segments : []) as Segment[];
      if (!segments.length) continue;

      const vurgular: Vurgu[] = [];
      let toplam = 0;
      let sonSaniye = -Infinity;

      for (let i = 0; i < segments.length; i++) {
        const yer = sade(segments[i].t).indexOf(sadeSorgu);
        if (yer === -1) continue;

        toplam++;
        const saniye = Math.round(segments[i].o / 1000);
        // Otomatik altyazı parçaları çok kısa; aynı anmanın birkaç parçaya
        // yayılması normal. Yakın eşleşmeler tek anma sayılıyor.
        if (saniye - sonSaniye < BIRLESTIRME_SN) continue;
        sonSaniye = saniye;

        if (vurgular.length < DERS_BASINA_VURGU) {
          const { metin, ofset } = baglam(segments, i);
          vurgular.push({ saniye, metin, bas: ofset + yer, uzunluk: sorgu.length });
        }
      }

      if (toplam) {
        sonuclar.push({ videoId: v.video_id, baslik: v.title, toplam, vurgular });
      }
    }

    // Çok geçen ders üstte
    sonuclar.sort((a, b) => b.toplam - a.toplam);

    return NextResponse.json({
      sorgu,
      dersSayisi: sonuclar.length,
      toplam: sonuclar.reduce((t, s) => t + s.toplam, 0),
      sonuclar: sonuclar.slice(0, EN_FAZLA_DERS),
    });
  } catch (err) {
    return hataCevabi(err);
  }
}
