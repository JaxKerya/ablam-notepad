import { NextResponse } from "next/server";
import { hataCevabi, kapiKontrol } from "@/lib/ders-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * Bütün ilanları siler — eşleşmeler ve geri bildirimler onlarla birlikte gider
 * (kariyer_eslesmeler.ilan_id on delete cascade). Profil, tarama geçmişi ve
 * BAŞVURULMUŞ ilanlar kalır.
 *
 * Sonrası: tarayıcı "bilinen kimlik" listesi boş kalınca kaynakları sıfırdan
 * çeker ve hepsini yeniden puanlar; ilk koşu profil değişmiş gibi maliyetli
 * olur (günlük tavan yine geçerli). Arayüz bunu onay metninde söylüyor.
 */
export async function DELETE() {
  const engel = await kapiKontrol();
  if (engel) return engel;
  try {
    const db = createServerSupabaseClient();
    // Başvurulmuş ilanlar KALIR: başvuru geçmişi temizlikle silinmemeli (takip hatırlatması, durum)
    const { data: korunan, error: kh } = await db.from("kariyer_eslesmeler").select("ilan_id").not("basvuru_durumu", "is", null);
    if (kh) throw new Error(kh.message);
    const korunanIdler = (korunan ?? []).map((r) => r.ilan_id as string);
    const { count } = await db.from("kariyer_ilanlar").select("id", { count: "exact", head: true });
    let sorgu = db.from("kariyer_ilanlar").delete().not("id", "is", null);
    if (korunanIdler.length) sorgu = sorgu.not("id", "in", `(${korunanIdler.join(",")})`);
    const { error } = await sorgu;
    if (error) throw new Error(error.message);
    return NextResponse.json({ silinen: Math.max(0, (count ?? 0) - korunanIdler.length), korunan: korunanIdler.length });
  } catch (err) {
    return hataCevabi(err);
  }
}
