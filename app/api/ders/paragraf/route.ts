import { NextResponse } from "next/server";
import { EN_AZ_SORU, PARAGRAF_DERS_ADET, PARAGRAF_VIDEO } from "@/lib/ders";
import { gunlukLimitAsildiMi, hataCevabi, kapiKontrol } from "@/lib/ders-server";
import { paragrafSorulariUret, paragrafVideosunuHazirla } from "@/lib/paragraf";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
// Üretim (~10 paragraf, akıl yürüten model) + çözücü tek istekte: ölçümde 60-120 sn
export const maxDuration = 300;

/**
 * YEREL TEST MODU. Yerel sunucu ablamın gerçek veritabanına bağlı; düğmeyi
 * denemek sitesine ders eklerdi. DERS_TEST_MODU=1 iken (yalnızca geliştiricinin
 * .env.local'ında, Vercel'de YOK) ders "test" türünde açılıyor: ders listesi,
 * Soru Gönder, Deneme ve Yanlışlarım yalnızca "ders" türüne baktığı için hiçbir
 * yerde görünmüyor ve verilen cevaplar hiçbir sayıma girmiyor. Ders sayfası
 * kimlikle açıldığı için kuyruk yine doğrudan derse götürüyor.
 */
const TEST_MODU = process.env.DERS_TEST_MODU === "1";

/**
 * Türkçe kartındaki "Paragraf" düğmesi: model paragrafları kendisi yazıyor,
 * yeni bir Türkçe dersi açılıyor (bkz. lib/paragraf.ts). Kaynak metin yok;
 * dersin sahte video satırı her seferinde yeni ("metin-paragraf-<rastgele>"),
 * çünkü bazı ekranlar dersi video kimliğiyle tanıyor.
 *
 *   POST {} -> { sessionId, soruSayisi }
 */
export async function POST() {
  const engel = await kapiKontrol();
  if (engel) return engel;

  const supabase = createServerSupabaseClient();
  const videoId = `${PARAGRAF_VIDEO}-${crypto.randomUUID().slice(0, 8)}`;
  try {
    if (await gunlukLimitAsildiMi()) {
      return NextResponse.json(
        { hata: "Bugünlük ders hazırlama sınırına ulaşıldı. Yarın devam edebilirsin." },
        { status: 429 }
      );
    }

    await paragrafVideosunuHazirla(supabase, videoId);
    const zaman = new Date().toLocaleString("tr-TR", {
      timeZone: "Europe/Istanbul",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
    const { data: oturum, error: oturumHatasi } = await supabase
      .from("ders_sessions")
      .insert({
        video_id: videoId,
        title: `${TEST_MODU ? "Test · " : ""}Paragraf · ${zaman}`,
        kategori: "Türkçe",
        tur: TEST_MODU ? "test" : "ders",
        summary:
          "ÖSYM tarzında yazılmış paragraf soruları. Paragrafları yapay zekâ yazdı; her soru ikinci bir " +
          "model tarafından cevap anahtarı görülmeden çözüldü, farklı cevap bulunanlar atıldı.",
        topics: [],
        status: "hazirlaniyor",
      })
      .select("id")
      .single();
    if (oturumHatasi || !oturum) throw new Error(`Oturum açılamadı: ${oturumHatasi?.message ?? "bilinmiyor"}`);

    const { sorular, adim, elenen } = await paragrafSorulariUret(supabase, { adet: PARAGRAF_DERS_ADET });
    if (sorular.length < EN_AZ_SORU) {
      throw new Error("Yeterli sağlam paragraf sorusu çıkmadı. Bir kez daha dener misin?");
    }

    const { error } = await supabase.from("ders_questions").insert(
      sorular.map((s, i) => ({ ...s, session_id: oturum.id, video_id: videoId, position: i }))
    );
    if (error) throw new Error(`Sorular kaydedilemedi: ${error.message}`);

    // Konular: hangi paragraf türleri geldi (ders satırında ve aramada görünüyor)
    const turler = [...new Set(sorular.map((s) => (s.topic ?? "").replace(/^Paragraf:\s*/, "")).filter(Boolean))];
    const { error: hazirHatasi } = await supabase
      .from("ders_sessions")
      .update({ status: "hazir", topics: turler, denetim: { duzeltilen: 0, elenen, adimlar: [adim] } })
      .eq("id", oturum.id);
    if (hazirHatasi) throw new Error(`Oturum hazır işaretlenemedi: ${hazirHatasi.message}`);

    return NextResponse.json({ sessionId: oturum.id, soruSayisi: sorular.length });
  } catch (err) {
    // Yarım ders listede kalmasın: sahte video satırı silinince oturum da gidiyor (cascade)
    await supabase.from("ders_videos").delete().eq("video_id", videoId);
    return hataCevabi(err);
  }
}
