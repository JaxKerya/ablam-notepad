import { createServerSupabaseClient } from "@/lib/supabase-server";
import AiView, {
  type AiViewCevap,
  type AiViewIsaretli,
  type AiViewOturum,
} from "@/components/ders/AiView";

export const dynamic = "force-dynamic";

/**
 * /ders/aiview — denetimin karar defteri.
 *
 * Bu kararlar eskiden yalnızca console.warn'a gidiyordu ve API kayıtlarıyla
 * ~24 saatte siliniyordu; oturumda iki sayı kalıyordu. Artık ders_sessions.denetim
 * içinde duruyorlar ve burada okunuyor. Sayfa ablamın akışında değil, bilerek
 * bağlantısız: bu bir denetim aracı, ders arayüzünün parçası değil.
 *
 * Kapı: bütün site ClientLayout içindeki SiteGate'in arkasında, ayrıca bir
 * koruma gerekmiyor.
 */
export default async function AiViewSayfasi() {
  const supabase = createServerSupabaseClient();

  const { data: oturumVerisi } = await supabase
    .from("ders_sessions")
    .select("id, title, created_at, status, video_id, denetim")
    .order("created_at", { ascending: false })
    .limit(50);

  const oturumlar = (oturumVerisi ?? []) as AiViewOturum[];
  const kimlikler = oturumlar.map((o) => o.id);
  const videoIdleri = new Map(oturumlar.map((o) => [o.id, o.video_id]));

  // Yalnızca listelenen oturumların satırları — filtresiz çekilince PostgREST'in
  // satır tavanına takılıp sessizce eksik veri dönüyor.
  const [cevapSonucu, isaretliSonucu] = kimlikler.length
    ? await Promise.all([
        supabase
          .from("ders_answers")
          .select(
            "session_id, verdict, feedback, user_answer, missing, created_at, ders_questions(question, kind, answer_key, start_seconds)"
          )
          .in("session_id", kimlikler)
          .order("created_at", { ascending: false })
          .limit(500),
        // Ablamın "bu soru saçma" işaretledikleri. Bu sütun bugüne kadar
        // yazılıyordu ama hiçbir sorgu geri okumuyordu.
        supabase
          .from("ders_questions")
          .select(
            "id, session_id, question, kind, choices, correct_index, explanation, answer_key, start_seconds"
          )
          .in("session_id", kimlikler)
          .eq("flagged", true)
          .limit(200),
      ])
    : [{ data: [] }, { data: [] }];

  /** İlişki tekil de dizi de dönebiliyor; /ders sayfasındaki desenin aynısı */
  const tekil = <T,>(ham: unknown): T | undefined =>
    (Array.isArray(ham) ? ham[0] : ham) as T | undefined;

  const cevaplar: AiViewCevap[] = (cevapSonucu.data ?? []).map((c) => {
    const soru = tekil<{
      question?: string;
      kind?: string;
      answer_key?: string | null;
      start_seconds?: number;
    }>((c as { ders_questions?: unknown }).ders_questions);
    return {
      session_id: c.session_id,
      video_id: videoIdleri.get(c.session_id) ?? "",
      verdict: c.verdict,
      feedback: c.feedback,
      user_answer: c.user_answer,
      missing: Array.isArray(c.missing) ? (c.missing as string[]) : [],
      created_at: c.created_at,
      soru: soru?.question ?? "(soru bulunamadı)",
      kind: soru?.kind ?? "",
      answer_key: soru?.answer_key ?? null,
      start_seconds: soru?.start_seconds ?? 0,
    };
  });

  const oturumAdlari = new Map(oturumlar.map((o) => [o.id, o.title ?? "Ders"]));
  const isaretliler: AiViewIsaretli[] = (isaretliSonucu.data ?? []).map((q) => ({
    id: q.id,
    session_id: q.session_id,
    oturumAdi: oturumAdlari.get(q.session_id) ?? "Ders",
    video_id: videoIdleri.get(q.session_id) ?? "",
    question: q.question,
    kind: q.kind,
    choices: Array.isArray(q.choices) ? (q.choices as string[]) : null,
    correct_index: q.correct_index,
    explanation: q.explanation,
    answer_key: q.answer_key,
    start_seconds: q.start_seconds ?? 0,
  }));

  return <AiView oturumlar={oturumlar} cevaplar={cevaplar} isaretliler={isaretliler} />;
}
