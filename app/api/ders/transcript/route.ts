import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { kapiKontrol, hataCevabi } from "@/lib/ders-server";
import {
  baslikGetir,
  elleYapistirilaniCozumle,
  oynatmaListesiMi,
  toplamSure,
  transkriptGetir,
  videoIdCozumle,
} from "@/lib/youtube";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Link -> transkript. Video daha önce işlendiyse veritabanından döner,
 * yeniden çekilmez.
 *
 * Gövde: { url: string, elleTranskript?: string }
 * Otomatik yollar düşerse 422 + kod:"elle_gerekli" döner; arayüz o zaman
 * yapıştırma panelini açar.
 */
export async function POST(request: Request) {
  const engel = await kapiKontrol();
  if (engel) return engel;

  try {
    const govde = await request.json();
    const url: string = govde?.url ?? "";
    const elleTranskript: string | undefined = govde?.elleTranskript;

    const videoId = videoIdCozumle(url);
    if (!videoId) {
      // Oynatma listesinin kendi adresi — ne yapması gerektiğini söyleyelim
      if (oynatmaListesiMi(url)) {
        return NextResponse.json(
          {
            hata:
              "Bu bir oynatma listesi linki, tek bir videonun linki değil. " +
              "Listeden çalışmak istediğin dersi aç, sonra o videonun linkini yapıştır.",
          },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { hata: "Bu bir YouTube video linkine benzemiyor. Linki kontrol eder misin?" },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();

    // Elle yapıştırma gelmediyse önbelleğe bak
    if (!elleTranskript) {
      const { data: mevcut } = await supabase
        .from("ders_videos")
        .select("video_id, title, duration_seconds, source, segments")
        .eq("video_id", videoId)
        .maybeSingle();

      if (mevcut && Array.isArray(mevcut.segments) && mevcut.segments.length) {
        return NextResponse.json({
          videoId,
          baslik: mevcut.title,
          sure: mevcut.duration_seconds,
          parcaSayisi: mevcut.segments.length,
          kaynak: mevcut.source,
          onbellekten: true,
        });
      }
    }

    // Transkripti al
    let segments;
    let kaynak: "supadata" | "manuel";

    if (elleTranskript && elleTranskript.trim()) {
      segments = elleYapistirilaniCozumle(elleTranskript);
      kaynak = "manuel";
    } else {
      try {
        const sonuc = await transkriptGetir(videoId);
        segments = sonuc.segments;
        kaynak = sonuc.source;
      } catch (e) {
        return NextResponse.json(
          {
            hata:
              "Bu videonun altyazısı otomatik olarak alınamadı. " +
              "YouTube'da videonun altındaki ⋯ menüsünden \"Transkripti göster\"e basıp " +
              "metni kopyalayabilir misin?",
            kod: "elle_gerekli",
            ayrinti: (e as Error).message,
          },
          { status: 422 }
        );
      }
    }

    const baslik = await baslikGetir(videoId);
    const sure = toplamSure(segments);

    const { error } = await supabase.from("ders_videos").upsert(
      {
        video_id: videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: baslik,
        duration_seconds: sure,
        lang: "tr",
        source: kaynak,
        segments,
      },
      { onConflict: "video_id" }
    );

    if (error) throw new Error(`Transkript kaydedilemedi: ${error.message}`);

    return NextResponse.json({
      videoId,
      baslik,
      sure,
      parcaSayisi: segments.length,
      kaynak,
      onbellekten: false,
    });
  } catch (err) {
    return hataCevabi(err);
  }
}
