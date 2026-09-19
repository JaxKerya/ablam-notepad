import { NextResponse } from "next/server";
import { hataCevabi, kapiKontrol } from "@/lib/ders-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * Bütün ilanları siler — eşleşmeler ve geri bildirimler onlarla birlikte gider
 * (kariyer_eslesmeler.ilan_id on delete cascade). Profil ve tarama geçmişi kalır.
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
    const { count } = await db.from("kariyer_ilanlar").select("id", { count: "exact", head: true });
    const { error } = await db.from("kariyer_ilanlar").delete().not("id", "is", null);
    if (error) throw new Error(error.message);
    return NextResponse.json({ silinen: count ?? 0 });
  } catch (err) {
    return hataCevabi(err);
  }
}
