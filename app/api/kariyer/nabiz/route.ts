import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * Nabız — tarayıcının kendisi ölürse haber verecek tek şey.
 *
 * worker/bildir.ts'teki kırılma uyarısı bir KAYNAK düşünce gidiyor; sunucu
 * durursa (disk dolar, servis düşer, VPS kapanır) onu gönderecek süreç de
 * yok. Bu uç nokta sunucudan bağımsız: Vercel cron'u saat başı çağırır
 * (vercel.json), son taramaya SESSIZLIK_SAATI'nden uzun süre geçtiyse e-posta
 * atar. Günde bir kez: uyarıyı kariyer_taramalar'a "nabiz" satırı olarak
 * yazar, 24 saat içinde tekrar atmaz. Arayüz "nabiz" satırlarını son tarama
 * sayarken atlıyor.
 *
 * Kapı şifresi yerine CRON_SECRET: Vercel cron isteğe Authorization: Bearer
 * <CRON_SECRET> ekler. Tanımlı değilse uç nokta hiç çalışmaz.
 */
const SESSIZLIK_SAATI = 6;

export async function GET(request: Request) {
  const gizli = process.env.CRON_SECRET;
  if (!gizli || request.headers.get("authorization") !== `Bearer ${gizli}`) {
    return NextResponse.json({ hata: "yetkisiz" }, { status: 401 });
  }

  const db = createServerSupabaseClient();
  // Başlangıç değil BAŞARILI BİTİŞ: her koşuda düşen bir tarayıcı da satır açar
  const { data: son, error: okumaHatasi } = await db
    .from("kariyer_taramalar")
    .select("bitis")
    .not("kaynak", "in", "(nabiz,ozet)")
    .is("hata", null)
    .not("bitis", "is", null)
    .order("bitis", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (okumaHatasi) return NextResponse.json({ durum: "sağlık bilinmiyor", hata: okumaHatasi.message }, { status: 500 });

  // Hiç tarama yoksa sistem daha kurulmamıştır; uyaracak bir şey yok
  if (!son?.bitis) return NextResponse.json({ durum: "tarama yok" });

  const sessizSaat = (Date.now() - new Date(son.bitis).getTime()) / 3600_000;
  if (sessizSaat < SESSIZLIK_SAATI) {
    return NextResponse.json({ durum: "canlı", sonTaramaSaatOnce: Number(sessizSaat.toFixed(1)) });
  }

  const { data: sonUyari } = await db
    .from("kariyer_taramalar")
    .select("baslangic")
    .eq("kaynak", "nabiz")
    .order("baslangic", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sonUyari && Date.now() - new Date(sonUyari.baslangic).getTime() < 24 * 3600_000) {
    return NextResponse.json({ durum: "sessiz, bugün uyarıldı", sonTaramaSaatOnce: Number(sessizSaat.toFixed(1)) });
  }

  const { data: p } = await db.from("kariyer_profil").select("bildirim_eposta").eq("id", 1).maybeSingle();
  const adres = process.env.UYARI_EPOSTA || p?.bildirim_eposta;
  const anahtar = process.env.RESEND_API_KEY;
  if (!adres || !anahtar) {
    return NextResponse.json({ durum: "sessiz ama uyarı adresi/anahtarı yok", sonTaramaSaatOnce: Number(sessizSaat.toFixed(1)) });
  }

  const metin =
    `Ablam Kariyer tarayıcısı ${Math.round(sessizSaat)} saattir tarama yapmadı.\n\n` +
    `Son başarılı tarama: ${new Date(son.bitis).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}\n\n` +
    `Sunucuda bakılacaklar:\n` +
    `  systemctl status ablam-kariyer\n  journalctl -u ablam-kariyer -n 50\n  df -h /\n\n` +
    `Bu uyarı günde bir kez gelir.`;
  const { error } = await new Resend(anahtar).emails.send({
    from: process.env.RESEND_FROM || "Ablam Kariyer <onboarding@resend.dev>",
    to: adres,
    subject: `Ablam Kariyer: tarayıcı ${Math.round(sessizSaat)} saattir sessiz`,
    text: metin,
  });
  if (error) return NextResponse.json({ hata: `Resend: ${error.message}` }, { status: 502 });

  await db.from("kariyer_taramalar").insert({
    kaynak: "nabiz",
    bitis: new Date().toISOString(),
    hata: `tarayıcı ${Math.round(sessizSaat)} saattir sessiz — uyarı gönderildi`,
  });
  return NextResponse.json({ durum: "uyarı gönderildi", sonTaramaSaatOnce: Number(sessizSaat.toFixed(1)) });
}
