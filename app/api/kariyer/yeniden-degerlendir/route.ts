import { NextResponse } from "next/server";
import { hataCevabi, kapiKontrol } from "@/lib/ders-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

const GUN = 7;

/**
 * Son 7 günde modelle puanlanmış ilanları yeni profile göre yeniden puanlatır.
 *
 * Profil değişince eski puanlar eski profile aittir; ama yeniden puanlamak
 * paralı (~$0,003/ilan), o yüzden otomatik değil, düğmeyle. Filtre elemeleri
 * ise profil kaydında otomatik sıfırlanıyor (PATCH /profil) — onlar bedava.
 *
 * Yapılan: eşleşme satırı silinir; tarayıcının "yarım kalanlar" adımı her
 * koşuda 25'ini yeni prompt'la puanlar. Geri bildirim verilmiş ilanlara
 * dokunulmaz — ablamın kararı modelin puanından değerli.
 *
 * GET: kaç ilanın etkileneceği (düğme sayıyı ve tahmini ücreti gösterir).
 * POST: sil.
 */
async function adaylar() {
  const db = createServerSupabaseClient();
  const sinir = new Date(Date.now() - GUN * 86_400_000).toISOString();
  return db
    .from("kariyer_eslesmeler")
    .select("ilan_id")
    .gte("degerlendirildi", sinir)
    .not("gerekce", "like", "Filtre:%")
    .is("geri_bildirim", null);
}

export async function GET() {
  const engel = await kapiKontrol();
  if (engel) return engel;
  try {
    const { data, error } = await adaylar();
    if (error) throw new Error(error.message);
    return NextResponse.json({ sayi: data?.length ?? 0, gun: GUN });
  } catch (err) {
    return hataCevabi(err);
  }
}

export async function POST() {
  const engel = await kapiKontrol();
  if (engel) return engel;
  try {
    const { data, error } = await adaylar();
    if (error) throw new Error(error.message);
    const ids = (data ?? []).map((r) => r.ilan_id);
    if (ids.length) {
      const db = createServerSupabaseClient();
      const { error: silme } = await db.from("kariyer_eslesmeler").delete().in("ilan_id", ids);
      if (silme) throw new Error(silme.message);
    }
    return NextResponse.json({ sifirlanan: ids.length });
  } catch (err) {
    return hataCevabi(err);
  }
}
