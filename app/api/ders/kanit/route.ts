import { NextResponse } from "next/server";
import type { Segment } from "@/lib/ders";
import { hataCevabi, kapiKontrol } from "@/lib/ders-server";
import { kanitBul } from "@/lib/kanit";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 30;

// "Hoca ne demişti?" — cevabın transkriptteki dayanağı.
//
// MODEL ÇAĞRISI YOK, PARA HARCAMAZ. Eşleştirme sözcüksel (bkz. lib/kanit.ts).
//
// Neden sunucuda: transkriptler ~1 MB, tarayıcıya indirmek gereksiz. Yanıt ise
// yalnızca birkaç cümle.
//
// Ölçüm: 72 gerçek soruda %53'ünde kanıt bulundu, kalanında hiçbir şey
// gösterilmiyor. Kapsamayı zorlamak yanlış cümleyi kanıt diye sunmak demek —
// ablam ona güvenir, o yüzden eşik yüksek tutuldu.

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
    const questionId = typeof govde.questionId === "string" ? govde.questionId : "";
    if (!questionId) {
      return NextResponse.json({ hata: "questionId gerekli." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { data: soru, error } = await supabase
      .from("ders_questions")
      .select(
        "id, session_id, video_id, kind, choices, correct_index, explanation, answer_key, key_points, start_seconds"
      )
      .eq("id", questionId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!soru) return NextResponse.json({ hata: "Soru bulunamadı." }, { status: 404 });

    // Sorunun kendi videosu yoksa oturumunkine düşülüyor (eski satırlar)
    let videoId = soru.video_id as string | null;
    if (!videoId) {
      const { data: oturum } = await supabase
        .from("ders_sessions")
        .select("video_id")
        .eq("id", soru.session_id)
        .maybeSingle();
      videoId = oturum?.video_id ?? null;
    }
    if (!videoId) return NextResponse.json({ kanit: null });

    const { data: video } = await supabase
      .from("ders_videos")
      .select("segments")
      .eq("video_id", videoId)
      .maybeSingle();

    const segments = (Array.isArray(video?.segments) ? video?.segments : []) as Segment[];
    if (!segments.length) return NextResponse.json({ kanit: null });

    // Kanıt CEVABIN dayanağı; soru kökü aranmıyor. Kök, dersin her yerinde
    // geçen konu kelimelerinden oluşuyor ve aramayı konunun tamamına yayıyor.
    const secenekler = Array.isArray(soru.choices) ? (soru.choices as string[]) : [];
    const kilit = Array.isArray(soru.key_points) ? (soru.key_points as string[]) : [];
    const hedef =
      soru.kind === "coktan"
        ? [secenekler[soru.correct_index ?? -1] ?? "", soru.explanation ?? ""].join(" ")
        : [soru.answer_key ?? "", kilit.join(" ")].join(" ");

    const kanit = kanitBul(segments, soru.start_seconds ?? 0, hedef);
    return NextResponse.json({ kanit, videoId });
  } catch (err) {
    return hataCevabi(err);
  }
}
