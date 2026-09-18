import { NextResponse } from "next/server";
import { chatJsonOlculu } from "@/lib/ai";
import { hataCevabi, kapiKontrol } from "@/lib/ders-server";
import { onerileriDogrula, profilDogrula, profilBosMu, sehirleriDogrula } from "@/lib/kariyer";
import { PROFIL_PROMPT } from "@/lib/kariyer-prompts";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Serbest metin -> yapılandırılmış profil + yakın iş önerileri.
 *
 * Gövde: { serbestMetin: string }
 * Döner: { profil, oneriler, olcum }
 *
 * KAYDETMEZ. Önceki sürüm burada kaydediyordu ve ekranda ayrıca "Kaydet" vardı;
 * iki kayıt noktası kafa karıştırdı ("çıkardım ama kaydettim mi?"). Şimdi tek
 * kayıt noktası var: PATCH. Bu uç nokta yalnızca gösterir, ablam beğenip
 * kaydeder. Tek kişilik sistem: profil satırı her zaman id=1.
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
    const serbestMetin =
      typeof govde.serbestMetin === "string" ? govde.serbestMetin.trim() : "";

    if (serbestMetin.length < 20) {
      return NextResponse.json(
        { hata: "Biraz daha anlat — en az birkaç cümle gerekiyor." },
        { status: 400 }
      );
    }
    if (serbestMetin.length > 8000) {
      return NextResponse.json({ hata: "Metin çok uzun (en fazla 8000 karakter)." }, { status: 400 });
    }

    const { veri, olcum } = await chatJsonOlculu<{ profil?: unknown; oneriler?: unknown }>({
      mesajlar: [
        { role: "system", content: PROFIL_PROMPT },
        { role: "user", content: serbestMetin },
      ],
      maxTokens: 4000,
      rol: "profil",
    });

    // Model iki katmanlı nesne döndürür; eski düz biçim gelirse de kırılmasın
    const profil = profilDogrula(veri?.profil ?? veri);
    if (profilBosMu(profil)) {
      throw new Error("Profil çıkarılamadı — metin iş aramayla ilgili görünmüyor.");
    }
    const oneriler = onerileriDogrula(veri?.oneriler);

    return NextResponse.json({ profil, oneriler, olcum });
  } catch (err) {
    return hataCevabi(err);
  }
}

/**
 * Tek kayıt noktası: serbest metin, (düzeltilmiş) profil ve sert filtre alanları.
 * Gövde: { serbestMetin?, profil?, sehirler?, uzaktanOlur?, asgariMaas?, bildirimEposta? }
 * Model çağrısı yok. Satır yoksa oluşturur (upsert) — ilk kurulumda POST artık
 * satır açmıyor.
 */
export async function PATCH(request: Request) {
  const engel = await kapiKontrol();
  if (engel) return engel;

  try {
    let govde: Record<string, unknown>;
    try {
      govde = await request.json();
    } catch {
      return NextResponse.json({ hata: "Geçersiz istek gövdesi." }, { status: 400 });
    }

    const guncelleme: Record<string, unknown> = {};
    if (typeof govde.serbestMetin === "string") guncelleme.serbest_metin = govde.serbestMetin.trim() || null;
    if (govde.profil !== undefined) guncelleme.profil = profilDogrula(govde.profil);
    if (Array.isArray(govde.sehirler)) guncelleme.sehirler = sehirleriDogrula(govde.sehirler);
    if (typeof govde.uzaktanOlur === "boolean") guncelleme.uzaktan_olur = govde.uzaktanOlur;
    if (govde.asgariMaas === null || typeof govde.asgariMaas === "number") {
      guncelleme.asgari_maas = govde.asgariMaas;
    }
    if (typeof govde.bildirimEposta === "string") {
      const e = govde.bildirimEposta.trim();
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
        return NextResponse.json({ hata: "E-posta adresi geçersiz görünüyor." }, { status: 400 });
      }
      guncelleme.bildirim_eposta = e || null;
    }
    if (!Object.keys(guncelleme).length) {
      return NextResponse.json({ hata: "Güncellenecek alan yok." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { error } = await supabase.from("kariyer_profil").upsert({ id: 1, ...guncelleme }, { onConflict: "id" });
    if (error) throw new Error(`Kaydedilemedi: ${error.message}`);

    // Şehir/uzaktan değiştiyse eski FİLTRE elemeleri artık geçersiz: "Ankara"
    // ile elenen İstanbul ilanı, İstanbul eklenince yeniden görülmeli. Eşleşme
    // satırı silinir, tarayıcının "yarım kalanlar" adımı yeni şartlarla yeniden
    // süzer (filtreye takılan yine takılır, model çağrısı yok; geçen puanlanır).
    // Modelle puanlanmış olanlara dokunulmaz — o ayrı, paralı ve isteğe bağlı
    // (POST /api/kariyer/yeniden-degerlendir).
    let sifirlanan = 0;
    if (guncelleme.sehirler !== undefined || guncelleme.uzaktan_olur !== undefined) {
      const sinir = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data } = await supabase
        .from("kariyer_eslesmeler")
        .delete()
        .like("gerekce", "Filtre:%")
        .gte("degerlendirildi", sinir)
        .select("ilan_id");
      sifirlanan = data?.length ?? 0;
    }

    return NextResponse.json({ tamam: true, sifirlanan });
  } catch (err) {
    return hataCevabi(err);
  }
}
