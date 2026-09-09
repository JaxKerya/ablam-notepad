import { NextResponse } from "next/server";
import { chatJson } from "@/lib/ai";
import type { Segment, Verdict } from "@/lib/ders";
import { hataCevabi, kapiKontrol } from "@/lib/ders-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { cevresindekiBolum } from "@/lib/youtube";
import { DEGERLENDIRME_PROMPT } from "@/lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Degerlendirme {
  sonuc?: string;
  geri_bildirim?: string;
  eksik_kavramlar?: string[];
}

const GECERLI: Verdict[] = ["dogru", "eksik", "yanlis"];

/**
 * Gövde: { questionId, cevap?: string, secim?: number, pas?: boolean }
 *
 * Çoktan seçmeli sorular ve pas geçmeler yerel değerlendirilir — AI çağrısı
 * yapılmaz, anında ve bedava sonuçlanır.
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
    const questionId = typeof govde.questionId === "string" ? govde.questionId : "";
    const cevap = typeof govde.cevap === "string" ? govde.cevap.trim() : "";
    const secim = typeof govde.secim === "number" ? govde.secim : null;
    const pas = govde.pas === true;

    if (!questionId) {
      return NextResponse.json({ hata: "questionId gerekli." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();

    const { data: soru, error: soruHatasi } = await supabase
      .from("ders_questions")
      .select(
        "id, session_id, video_id, kind, question, answer_key, key_points, choices, correct_index, explanation, start_seconds"
      )
      .eq("id", questionId)
      .maybeSingle();

    if (soruHatasi) throw new Error(soruHatasi.message);
    if (!soru) return NextResponse.json({ hata: "Soru bulunamadı." }, { status: 404 });

    let verdict: Verdict;
    let feedback: string;
    let missing: string[] = [];

    // Çoktan seçmeli ve pas geçmeler yerel değerlendirilir. Buradaki metin de
    // ablamın okuduğu geri bildirim olduğu için ham cevap anahtarını olduğu gibi
    // basmıyoruz — hitap eden bir cümleyle çerçeveliyoruz.
    const sikMetni = (i: number | null) => {
      const secenekler = Array.isArray(soru.choices) ? (soru.choices as string[]) : [];
      return i !== null && secenekler[i] ? `${"ABCDE"[i]}) ${secenekler[i]}` : null;
    };

    if (pas) {
      verdict = "pas";
      if (soru.kind === "coktan") {
        const dogruSik = sikMetni(soru.correct_index);
        feedback = [
          dogruSik ? `Bu soruyu pas geçtin. Doğru cevap ${dogruSik}.` : "Bu soruyu pas geçtin.",
          soru.explanation,
        ]
          .filter(Boolean)
          .join(" ");
      } else {
        feedback = "Bu soruyu pas geçtin. Beklenen cevabı aşağıda görebilirsin.";
      }
    } else if (soru.kind === "coktan") {
      const dogruMu = secim !== null && secim === soru.correct_index;
      verdict = dogruMu ? "dogru" : "yanlis";
      const dogruSik = sikMetni(soru.correct_index);
      feedback = [
        dogruMu
          ? "Doğru bildin."
          : dogruSik
            ? `Doğru cevap ${dogruSik}.`
            : "Doğru şıkkı işaretlemedin.",
        soru.explanation,
      ]
        .filter(Boolean)
        .join(" ");
    } else if (!cevap) {
      verdict = "yanlis";
      feedback = "Cevap boş bırakıldı.";
    } else {
      // Açık uçlu — transkriptin sadece ilgili bölümü gönderiliyor
      const { data: oturum } = await supabase
        .from("ders_sessions")
        .select("video_id, summary")
        .eq("id", soru.session_id)
        .maybeSingle();

      // Transkript SORUNUN videosundan çekiliyor, oturumunkinden değil. Tekrar
      // oturumları birden çok dersten soru taşıyor; oturumun video_id'si orada
      // yalnızca ilk kaynağı gösterir ve buna güvenmek değerlendiriciye YANLIŞ
      // dersin transkriptini okuturdu — hata vermeden yanlış hüküm üretirdi.
      // Eski satırlarda soru düzeyinde video yoksa oturumunkine düşülüyor.
      const soruVideoId = soru.video_id ?? oturum?.video_id ?? null;
      let bolum = "";
      if (soruVideoId) {
        const { data: video } = await supabase
          .from("ders_videos")
          .select("segments")
          .eq("video_id", soruVideoId)
          .maybeSingle();

        if (video && Array.isArray(video.segments)) {
          bolum = cevresindekiBolum(video.segments as Segment[], soru.start_seconds ?? 0);
        }
      }

      const kilit = Array.isArray(soru.key_points) ? (soru.key_points as string[]) : [];

      const sonuc = await chatJson<Degerlendirme>({
        mesajlar: [
          { role: "system", content: DEGERLENDIRME_PROMPT },
          {
            role: "user",
            content: [
              // Değerlendiriciye yalnızca ±90 sn'lik dilim gidiyor. İki yönlü bir
              // soruda (5. dakikadaki X ile 30. dakikadaki Y'yi karşılaştır) bu
              // dilim tek yarıyı gösterir; ders özeti diğer yarıyı hatırlatır.
              oturum?.summary ? `Dersin genel özeti:\n${oturum.summary}` : "",
              bolum ? `Dersin ilgili bölümü:\n${bolum}` : "",
              `Soru:\n${soru.question}`,
              `Beklenen cevap:\n${soru.answer_key ?? "-"}`,
              kilit.length ? `Kilit kavramlar: ${kilit.join(", ")}` : "",
              `Öğrencinin cevabı:\n${cevap}`,
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
        // Akıl yürüten bir model seçilirse düşünme tokenları da buradan düşer;
        // dar bütçe boş cevaba yol açıyor.
        maxTokens: 8000,
        rol: "degerlendirme", // bu uç en sık çağrılan uç
      });

      const ham = typeof sonuc.sonuc === "string" ? sonuc.sonuc.trim().toLowerCase() : "";
      verdict = (GECERLI as string[]).includes(ham) ? (ham as Verdict) : "eksik";
      feedback =
        typeof sonuc.geri_bildirim === "string" && sonuc.geri_bildirim.trim()
          ? sonuc.geri_bildirim.trim()
          : "Değerlendirme alınamadı.";
      missing = Array.isArray(sonuc.eksik_kavramlar)
        ? sonuc.eksik_kavramlar.filter((k): k is string => typeof k === "string" && !!k.trim())
        : [];
    }

    const { error: kayitHatasi } = await supabase.from("ders_answers").upsert(
      {
        session_id: soru.session_id,
        question_id: soru.id,
        user_answer: soru.kind === "coktan" ? (secim !== null ? String(secim) : null) : cevap,
        verdict,
        feedback,
        missing,
      },
      { onConflict: "question_id" }
    );

    if (kayitHatasi) throw new Error(`Cevap kaydedilemedi: ${kayitHatasi.message}`);

    return NextResponse.json({
      verdict,
      feedback,
      missing,
      answerKey: soru.answer_key,
      explanation: soru.explanation,
      correctIndex: soru.correct_index,
      startSeconds: soru.start_seconds,
    });
  } catch (err) {
    return hataCevabi(err);
  }
}
