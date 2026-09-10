import { NextResponse } from "next/server";
import { hataCevabi, kapiKontrol } from "@/lib/ders-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { yayinTarihleriGetir } from "@/lib/youtube";

export const runtime = "nodejs";
export const maxDuration = 60;

// Eksik yayın tarihlerini tek seferde doldurur.
//
// Yeni işlenen videoların tarihi transkript ucunda yazılıyor; bu uç, o alan
// eklenmeden önce işlenmiş videolar için var. Tek bir düğmeye bağlı olması
// yerel bir betiğe göre daha iyi: canlıda da çalışıyor ve anahtar oradaki
// ortam değişkeninden okunuyor.
//
// MODEL ÇAĞRISI YOK, PARA HARCAMAZ. YouTube Data API'nin günlük 10.000 birimlik
// ücretsiz kotasından 50 video başına 1 birim harcar.

export async function POST() {
  const engel = await kapiKontrol();
  if (engel) return engel;

  try {
    const supabase = createServerSupabaseClient();

    const { data: videolar, error } = await supabase
      .from("ders_videos")
      .select("video_id")
      .is("published_at", null)
      .limit(500);

    if (error) {
      // Ham Postgres hatası ("column ... does not exist") ne yapılacağını
      // söylemiyor; kolon eklenmemişse yapılacak şey bellidir.
      if (/published_at/.test(error.message)) {
        return NextResponse.json(
          {
            hata:
              "ders_videos.published_at kolonu yok. Supabase SQL Editor'da " +
              "db/ders.sql dosyasının sonundaki alter table satırını çalıştırman gerekiyor.",
          },
          { status: 400 }
        );
      }
      throw new Error(error.message);
    }
    const idler = (videolar ?? []).map((v) => v.video_id);
    if (!idler.length) {
      return NextResponse.json({ eksik: 0, dolduruldu: 0, mesaj: "Eksik tarih yok." });
    }

    const tarihler = await yayinTarihleriGetir(idler);
    if (!tarihler.size) {
      return NextResponse.json(
        {
          hata:
            "Yayın tarihi alınamadı. YOUTUBE_API_KEY tanımlı mı ve YouTube Data API v3 " +
            "o anahtar için açık mı?",
        },
        { status: 503 }
      );
    }

    // Tek tek güncelleniyor: PostgREST'te farklı satıra farklı değer yazmanın
    // toplu yolu upsert, o da bütün satırı isterdi (segments dahil, ~1 MB).
    let dolduruldu = 0;
    for (const [videoId, tarih] of tarihler) {
      const { error: yazmaHatasi } = await supabase
        .from("ders_videos")
        .update({ published_at: tarih })
        .eq("video_id", videoId);
      if (yazmaHatasi) {
        console.warn(`[ders] ${videoId} tarihi yazılamadı:`, yazmaHatasi.message);
        continue;
      }
      dolduruldu++;
    }

    return NextResponse.json({
      eksik: idler.length,
      dolduruldu,
      bulunamayan: idler.length - tarihler.size,
    });
  } catch (err) {
    return hataCevabi(err);
  }
}
