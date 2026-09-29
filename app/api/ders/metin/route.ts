import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { kapiKontrol, hataCevabi } from "@/lib/ders-server";
import { METIN_EN_AZ, METIN_EN_FAZLA, METIN_KARAKTER_SANIYE, METIN_ONEKI, metniSegmentlere } from "@/lib/ders";

export const runtime = "nodejs";

/**
 * Yapıştırılan metin -> sahte "video" satırı. /api/ders/transcript'in metin
 * karşılığı: aynı cevabı döndürüyor, kuyruk sonra aynı yoldan (çözümleme ->
 * parça parça soru) devam ediyor. Neden sahte video satırı: bkz. lib/ders.ts
 * METIN_ONEKI.
 *
 * Kimlik metnin özetinden (sha1) türetiliyor: aynı metin ikinci kez
 * yapıştırılınca aynı kimlik çıkıyor ve transkript ucundaki mükerrer koruması
 * birebir çalışıyor — kart "zaten var" diyor, ablam isterse yine de üretiyor.
 *
 * Gövde: { metin: string } -> { videoId, baslik, sure, mevcutDers }
 */
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
    const metin = typeof govde.metin === "string" ? govde.metin.trim() : "";
    if (metin.length < METIN_EN_AZ) {
      return NextResponse.json(
        { hata: `Metin çok kısa (${metin.length} karakter). Soru çıkacak kadar metin yapıştır — en az ${METIN_EN_AZ} karakter.` },
        { status: 400 }
      );
    }
    if (metin.length > METIN_EN_FAZLA) {
      return NextResponse.json(
        { hata: `Metin çok uzun (${metin.length.toLocaleString("tr-TR")} karakter). En fazla ${METIN_EN_FAZLA.toLocaleString("tr-TR")} karakter; ikiye bölüp ayrı ayrı ekleyebilirsin.` },
        { status: 400 }
      );
    }

    // Boşluk farkı aynı metni ayrı saymasın
    const sade = metin.replace(/\s+/g, " ").toLocaleLowerCase("tr");
    const videoId = METIN_ONEKI + createHash("sha1").update(sade).digest("hex").slice(0, 16);
    const supabase = createServerSupabaseClient();

    const { data: ders } = await supabase
      .from("ders_sessions")
      .select("id, title")
      .eq("video_id", videoId)
      .eq("tur", "ders")
      .eq("status", "hazir")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const segments = metniSegmentlere(metin);
    const sure = Math.round(metin.length / METIN_KARAKTER_SANIYE);
    // Başlığı çözümleme adımı veriyor (ders_sessions.title); burada ilk satır
    // yalnızca kuyruk kartında "ne işleniyor" görünsün diye.
    const ilkSatir = segments[0]?.t.slice(0, 80) ?? null;

    const { error } = await supabase.from("ders_videos").upsert(
      {
        video_id: videoId,
        url: "",
        title: null,
        duration_seconds: sure,
        lang: "tr",
        source: "metin",
        segments,
      },
      { onConflict: "video_id" }
    );
    if (error) throw new Error(`Metin kaydedilemedi: ${error.message}`);

    return NextResponse.json({
      videoId,
      baslik: ders?.title ?? ilkSatir,
      sure,
      parcaSayisi: segments.length,
      kaynak: "metin",
      mevcutDers: ders ? { id: ders.id, baslik: ders.title } : null,
    });
  } catch (err) {
    return hataCevabi(err);
  }
}
