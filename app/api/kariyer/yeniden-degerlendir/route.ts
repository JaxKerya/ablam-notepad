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
 * Yapılan: eşleşme satırı SİLİNMEZ, olcum.yeniden = true ile işaretlenir;
 * tarayıcının "yarım kalanlar" adımı her koşuda 25'ini yeni prompt'la puanlar.
 * Silmek bildirildi'yi ve eski ücreti de götürüyordu: aynı ilan ikinci kez
 * e-postalanıyor, günlük tavan eski harcamayı görmüyordu (inceleme bulgusu).
 * Geri bildirim verilmiş ilanlara dokunulmaz — ablamın kararı modelin
 * puanından değerli.
 *
 * GET: kaç ilanın etkileneceği (düğme sayıyı ve tahmini ücreti gösterir).
 * POST: işaretle.
 */
async function adaylar() {
  const db = createServerSupabaseClient();
  const sinir = new Date(Date.now() - GUN * 86_400_000).toISOString();
  return db
    .from("kariyer_eslesmeler")
    .select("ilan_id, olcum")
    .gte("degerlendirildi", sinir)
    .not("gerekce", "like", "Filtre:%")
    .is("geri_bildirim", null)
    // zaten işaretli olan tekrar sayılmasın (anahtar yoksa ->> null döner; "not.eq" null'u da elerdi)
    .or("olcum->>yeniden.is.null,olcum->>yeniden.neq.true");
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
    const satirlar = (data ?? []).map((r) => ({
      ilan_id: r.ilan_id,
      olcum: { ...((r.olcum as Record<string, unknown> | null) ?? {}), yeniden: true },
    }));
    if (satirlar.length) {
      const db = createServerSupabaseClient();
      // Satır satır update: upsert insert yolundan geçtiği için puan/karar gibi
      // zorunlu kolonları isterdi. 20'şerlik demetler; puan, bildirildi, geri bildirim yerinde kalır
      for (let i = 0; i < satirlar.length; i += 20) {
        const sonuclar = await Promise.all(
          satirlar.slice(i, i + 20).map((r) => db.from("kariyer_eslesmeler").update({ olcum: r.olcum }).eq("ilan_id", r.ilan_id))
        );
        const hata = sonuclar.find((x) => x.error)?.error;
        if (hata) throw new Error(hata.message);
      }
    }
    return NextResponse.json({ sifirlanan: satirlar.length });
  } catch (err) {
    return hataCevabi(err);
  }
}
