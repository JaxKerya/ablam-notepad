// Ablam Ders — API uçlarının paylaştığı sunucu yardımcıları

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { GATE_COOKIE, gateTokenGecerli } from "@/lib/gate";
import { GUNLUK_URETIM_LIMITI } from "@/lib/ders";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/** Kapıyı geçmemiş istekleri reddeder. Geçtiyse null döner. */
export async function kapiKontrol(): Promise<NextResponse | null> {
  const cerezler = await cookies();
  if (!gateTokenGecerli(cerezler.get(GATE_COOKIE)?.value)) {
    return NextResponse.json(
      { hata: "Bu işlem için siteye giriş yapmış olmanız gerekiyor. Sayfayı yenileyin." },
      { status: 401 }
    );
  }
  return null;
}

/**
 * Günlük soru üretimi tavanı. Bugün açılan oturumları sayar — ayrı bir sayaç
 * tablosu tutmaya gerek yok.
 *
 * Sınır kapalıyken (0) sayım hiç yapılmıyor: her ders üretiminin başındaki
 * gereksiz bir veritabanı turu, hem de hiçbir şeye yaramayacak olan.
 */
export async function gunlukLimitAsildiMi(): Promise<boolean> {
  if (GUNLUK_URETIM_LIMITI <= 0) return false;

  const supabase = createServerSupabaseClient();
  const gunBasi = new Date();
  gunBasi.setHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from("ders_sessions")
    .select("id", { count: "exact", head: true })
    // Yalnızca gerçek üretimler sayılıyor. Tekrar oturumları model çağırmıyor,
    // maliyeti sıfır; sayıya katılsalardı 40 tekrar, ders üretimini kilitlerdi.
    .eq("tur", "ders")
    .gte("created_at", gunBasi.toISOString());

  if (error) return false; // sayamıyorsak engelleme, sadece logla
  return (count ?? 0) >= GUNLUK_URETIM_LIMITI;
}

export function hataCevabi(err: unknown, durum = 500) {
  const mesaj = err instanceof Error ? err.message : "Bilinmeyen hata.";
  return NextResponse.json({ hata: mesaj }, { status: durum });
}
