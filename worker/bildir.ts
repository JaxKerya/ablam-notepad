// Bildirimler — e-posta, Resend ile. Telegram istenmedi; SMTP de gereksiz:
// Resend tek API anahtarıyla çalışıyor, Gmail uygulama şifresi derdi yok.
//
// İki tür bildirim:
//   - GÜÇLÜ eşleşme (karar = bildir): her koşuda, hemen. Genelde tek ilan.
//   - ÖZET (karar = ozet): günde bir kez, 18'den sonraki ilk koşuda tek e-posta.
// Ayrım bildirim yorgunluğuna karşı: "belki"leri anında gönderirsen bir haftada
// susturulur, sonra güçlü eşleşme de ulaşmaz.
//
// .env.local: RESEND_API_KEY, isteğe bağlı RESEND_FROM.
// Alan adı doğrulanmadan Resend yalnızca hesap sahibinin adresine gönderir —
// hesabı ablamın e-postasıyla açmak bu sistem için yeterli (tek alıcı o).

import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kalanGun, kaynakEtiketi, sonBasvuruMetni, takipGerekli, type BasvuruDurumu } from "../lib/kariyer";

const OZET_SAATI = 18; // Türkiye saati — bu saatten sonra, günde bir kez

function posta() {
  const anahtar = process.env.RESEND_API_KEY;
  if (!anahtar) throw new Error("RESEND_API_KEY tanımlı değil.");
  return new Resend(anahtar);
}

/** Alan adı doğrulanmamışsa Resend'in kendi adresi; doğrulanmışsa kendi adresin */
const gonderen = () => process.env.RESEND_FROM || "Ablam Kariyer <onboarding@resend.dev>";

async function gonder(alici: string, konu: string, metin: string, html: string) {
  const { error } = await posta().emails.send({
    from: gonderen(),
    to: alici,
    subject: konu,
    text: metin,
    html,
  });
  if (error) throw new Error(`Resend: ${error.message}`);
}

function turkiyeSaati(): number {
  return Number(
    new Intl.DateTimeFormat("tr-TR", { hour: "numeric", hour12: false, timeZone: "Europe/Istanbul" })
      .format(new Date())
  );
}

/** "2026-09-18" biçiminde Türkiye günü */
const turkiyeGunu = (t: Date = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(t);

/**
 * Bugün özet gitti mi? Gönderim kariyer_taramalar'a "ozet" satırı olarak
 * yazılıyor (arayüz ve nabız bu satırları tarama saymıyor). İlk sürüm yalnızca
 * 18:xx koşusunda gönderiyordu; koşu uzayıp o saati kaçırınca özet ertesi güne
 * kalıyordu (denetim bulgusu).
 */
async function bugunOzetGittiMi(db: SupabaseClient): Promise<boolean> {
  const { data } = await db
    .from("kariyer_taramalar")
    .select("baslangic")
    .eq("kaynak", "ozet")
    .order("baslangic", { ascending: false })
    .limit(1)
    .maybeSingle();
  return !!data && turkiyeGunu(new Date(data.baslangic)) === turkiyeGunu();
}

interface EslesmeSatiri {
  ilan_id: string;
  puan: number;
  gerekce: string | null;
  uyusan: string[];
  uyusmayan: string[];
  risk?: string | null;
  uyarilar?: string[];
  kariyer_ilanlar: {
    baslik: string;
    sirket: string | null;
    sehir: string | null;
    url: string | null;
    kaynak: string;
    son_basvuru: string | null;
  } | null;
}

function kacis(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ilanHtml(e: EslesmeSatiri): string {
  const i = e.kariyer_ilanlar!;
  const alt = [i.sirket, i.sehir].filter(Boolean).join(" · ");
  return `
    <div style="margin:0 0 22px;padding:0 0 18px;border-bottom:1px solid #e5e7eb">
      <div style="font-size:17px;font-weight:600;color:#111">
        ${i.url ? `<a href="${kacis(i.url)}" style="color:#1d4ed8;text-decoration:none">${kacis(i.baslik)}</a>` : kacis(i.baslik)}
      </div>
      ${alt ? `<div style="color:#6b7280;font-size:14px;margin-top:2px">${kacis(alt)}</div>` : ""}
      <div style="margin-top:8px;font-size:15px;color:#111">${kacis(e.gerekce ?? "")}</div>
      ${e.uyusan.length ? `<div style="margin-top:6px;font-size:13px;color:#166534">+ ${kacis(e.uyusan.join(", "))}</div>` : ""}
      ${e.uyusmayan.length ? `<div style="font-size:13px;color:#991b1b">− ${kacis(e.uyusmayan.join(", "))}</div>` : ""}
      ${e.uyarilar?.length ? `<div style="margin-top:6px;font-size:13px;font-weight:600;color:#b91c1c">⚠ Dikkat: ${kacis(e.uyarilar.join(", "))}</div>` : ""}
      ${sonBasvuruSatiri(i.son_basvuru)}
      <div style="margin-top:6px;font-size:12px;color:#9ca3af">uygunluk ${e.puan}/100 · ${kacis(kaynakEtiketi(i.kaynak))}</div>
    </div>`;
}

/** Kamu ilanında hayati: 2 gün kalmışla 15 gün kalmış aynı görünmesin. 3 gün ve altı kırmızı. */
function sonBasvuruSatiri(sonBasvuru: string | null): string {
  const metin = sonBasvuruMetni(sonBasvuru);
  if (!metin) return "";
  const kalan = kalanGun(sonBasvuru) ?? 99;
  const renk = kalan <= 3 ? "#b91c1c" : "#6b7280";
  const agirlik = kalan <= 3 ? "font-weight:600;" : "";
  return `<div style="margin-top:6px;font-size:13px;${agirlik}color:${renk}">${kacis(metin)}</div>`;
}

const AYRAC = "\n\n---\n\n";

function ilanMetin(e: EslesmeSatiri): string {
  const i = e.kariyer_ilanlar!;
  return [
    i.baslik,
    [i.sirket, i.sehir].filter(Boolean).join(" · "),
    e.gerekce ?? "",
    e.uyarilar?.length ? `DİKKAT: ${e.uyarilar.join(", ")}` : "",
    sonBasvuruMetni(i.son_basvuru) ?? "",
    i.url ?? "",
    `uygunluk ${e.puan}/100`,
  ]
    .filter(Boolean)
    .join("\n");
}

const sarmala = (icerik: string) =>
  `<div style="font-family:system-ui,sans-serif;max-width:560px">${icerik}</div>`;

async function bekleyenler(db: SupabaseClient, karar: "bildir" | "ozet"): Promise<EslesmeSatiri[]> {
  const { data, error } = await db
    .from("kariyer_eslesmeler")
    .select("ilan_id, puan, gerekce, uyusan, uyusmayan, risk, uyarilar, kariyer_ilanlar(baslik, sirket, sehir, url, kaynak, son_basvuru)")
    .eq("karar", karar)
    .is("bildirildi", null)
    .order("puan", { ascending: false })
    .limit(30);
  if (error) throw new Error(`bekleyen eşleşmeler okunamadı: ${error.message}`);
  return (data ?? []).map((r) => ({
    ...r,
    kariyer_ilanlar: (Array.isArray(r.kariyer_ilanlar) ? r.kariyer_ilanlar[0] : r.kariyer_ilanlar) ?? null,
  })) as EslesmeSatiri[];
}

async function isaretle(db: SupabaseClient, ids: string[], zaman: string | null = new Date().toISOString()) {
  if (!ids.length) return;
  const { error } = await db.from("kariyer_eslesmeler").update({ bildirildi: zaman }).in("ilan_id", ids);
  if (error) throw new Error(`bildirildi işaretlenemedi: ${error.message}`);
}

/**
 * Önce işaretle, sonra gönder; gönderim düşerse işareti geri al. Tersi
 * (gönder, sonra işaretle) işaretleme düşünce aynı e-postayı her koşuda
 * yeniden yolluyordu (denetim bulgusu). Geri alma da düşerse ilan bildirilmemiş
 * ama işaretli kalır — çift e-postadan daha kabul edilebilir, loga düşer.
 */
async function isaretleyipGonder(db: SupabaseClient, ids: string[], gonderim: () => Promise<void>, log: (m: string) => void) {
  await isaretle(db, ids);
  try {
    await gonderim();
  } catch (e) {
    await isaretle(db, ids, null).catch((h) => log(`UYARI: gönderilemeyen ${ids.length} ilanın işareti geri alınamadı: ${(h as Error).message}`));
    throw e;
  }
}

/** Bekleyen bildirimleri gönderir, gönderilen ilan sayısını döndürür. */
export async function bildirimleriGonder(
  db: SupabaseClient,
  adres: string,
  log: (m: string) => void
): Promise<number> {
  let gonderilen = 0;

  // Süresi geçmiş ilan bildirilmez; "bildirildi" işaretlenir ki bir daha bakılmasın
  const gecmisleriAyikla = async (liste: EslesmeSatiri[]) => {
    const gecmis = liste.filter((e) => (kalanGun(e.kariyer_ilanlar?.son_basvuru) ?? 0) < 0);
    if (gecmis.length) {
      await isaretle(db, gecmis.map((e) => e.ilan_id));
      log(`${gecmis.length} ilanın son başvurusu geçmiş, bildirilmedi`);
    }
    return liste.filter((e) => !gecmis.includes(e));
  };

  // Güçlü eşleşmeler — hemen, tek e-postada
  const guclu = await gecmisleriAyikla((await bekleyenler(db, "bildir")).filter((e) => e.kariyer_ilanlar));
  if (guclu.length) {
    const konu =
      guclu.length === 1
        ? `İş ilanı: ${guclu[0].kariyer_ilanlar!.baslik}`
        : `${guclu.length} yeni iş ilanı — sana uygun görünüyor`;
    await isaretleyipGonder(
      db,
      guclu.map((e) => e.ilan_id),
      () => gonder(adres, konu, guclu.map(ilanMetin).join(AYRAC), sarmala(guclu.map(ilanHtml).join(""))),
      log
    );
    gonderilen += guclu.length;
    log(`güçlü eşleşme e-postası: ${guclu.length} ilan`);
  }

  // Akşam özeti — 18'den sonra, bugün gitmediyse. İçinde iki bölüm olabilir:
  // bakmaya değer ilanlar ve başvuru takip hatırlatmaları; ikisi de boşsa gitmez.
  if (turkiyeSaati() >= OZET_SAATI && !(await bugunOzetGittiMi(db))) {
    const ozet = await gecmisleriAyikla((await bekleyenler(db, "ozet")).filter((e) => e.kariyer_ilanlar));
    const takip = await takipBekleyenler(db);
    if (ozet.length || takip.length) {
      const konu = ozet.length
        ? `Bugünün özeti: bakmaya değer ${ozet.length} ilan${takip.length ? ` · ${takip.length} başvuru takibi` : ""}`
        : `Başvuru takibi: ${takip.length} ilana cevap bekliyorsun`;
      const metin = [...ozet.map(ilanMetin), ...(takip.length ? [takipMetin(takip)] : [])].join(AYRAC);
      const html = sarmala(
        (ozet.length
          ? `<p style="color:#6b7280;font-size:14px">Bunlar güçlü eşleşme değil ama bakmaya değer olabilir.</p>` + ozet.map(ilanHtml).join("")
          : "") + (takip.length ? takipHtml(takip) : "")
      );
      // Önce ilanlar işaretlenir (gönderim düşerse geri alınır); takip damgası gönderim sonrası
      await isaretleyipGonder(db, ozet.map((e) => e.ilan_id), () => gonder(adres, konu, metin, html), log);
      if (takip.length) {
        const { error } = await db
          .from("kariyer_eslesmeler")
          .update({ basvuru_hatirlatma: new Date().toISOString() })
          .in("ilan_id", takip.map((t) => t.ilan_id));
        if (error) log(`UYARI: takip hatırlatma damgası yazılamadı: ${error.message}`);
      }
      await db.from("kariyer_taramalar").insert({ kaynak: "ozet", bitis: new Date().toISOString(), bulunan: ozet.length, yeni: ozet.length });
      gonderilen += ozet.length;
      log(`akşam özeti: ${ozet.length} ilan, ${takip.length} takip hatırlatması`);
    }
  }

  return gonderilen;
}

// --- Başvuru takibi -------------------------------------------------------------
//
// Ablam "Başvurdum" dediği ilanlara cevap gelmediyse 10. günden itibaren 7 günde
// bir akşam özetinde hatırlatılır (career-ops'un cadence fikri). Görüşme/olumsuz/
// kabul durumlarında hatırlatma yok. Hatırlatma "başvurunu sor" demek; sistem
// kimseye e-posta yazmaz, ablamın kendisi arar/yazar.

interface TakipSatiri {
  ilan_id: string;
  gun: number;
  baslik: string;
  sirket: string | null;
  url: string | null;
}

async function takipBekleyenler(db: SupabaseClient): Promise<TakipSatiri[]> {
  const { data, error } = await db
    .from("kariyer_eslesmeler")
    .select("ilan_id, basvuru_durumu, basvuru_ts, basvuru_hatirlatma, kariyer_ilanlar(baslik, sirket, url)")
    .eq("basvuru_durumu", "basvurdu")
    .limit(50);
  if (error) {
    // Takip, özetin ikincil parçası; düşerse özet yine gitsin
    console.warn("[kariyer] takip listesi okunamadı:", error.message);
    return [];
  }
  const simdi = new Date();
  return (data ?? [])
    .map((r) => {
      const i = (Array.isArray(r.kariyer_ilanlar) ? r.kariyer_ilanlar[0] : r.kariyer_ilanlar) as { baslik: string; sirket: string | null; url: string | null } | null;
      const gun = takipGerekli(r.basvuru_durumu as BasvuruDurumu, r.basvuru_ts, r.basvuru_hatirlatma, simdi);
      return i && gun !== null ? { ilan_id: r.ilan_id, gun, baslik: i.baslik, sirket: i.sirket, url: i.url } : null;
    })
    .filter((x): x is TakipSatiri => x !== null)
    .sort((a, b) => b.gun - a.gun);
}

function takipHtml(liste: TakipSatiri[]): string {
  return `
    <div style="margin-top:8px;padding:14px 16px;border-radius:12px;background:#fffbeb;border:1px solid #fde68a">
      <div style="font-size:15px;font-weight:600;color:#92400e">Başvuru takibi</div>
      <div style="font-size:13px;color:#78350f;margin-top:2px">Bu başvurulara henüz cevap gelmemiş görünüyor. Kurumu arayıp durumu sorabilir ya da uygulamada durumu güncelleyebilirsin.</div>
      ${liste
        .map(
          (t) => `<div style="margin-top:10px;font-size:14px;color:#111">
            ${t.url ? `<a href="${kacis(t.url)}" style="color:#1d4ed8;text-decoration:none">${kacis(t.baslik)}</a>` : kacis(t.baslik)}
            ${t.sirket ? `<span style="color:#6b7280"> · ${kacis(t.sirket)}</span>` : ""}
            <div style="font-size:12.5px;color:#b45309">${t.gun} gün önce başvurdun, cevap yok</div>
          </div>`
        )
        .join("")}
    </div>`;
}

function takipMetin(liste: TakipSatiri[]): string {
  return ["BAŞVURU TAKİBİ — cevap gelmemiş görünüyor:", ...liste.map((t) => `- ${t.baslik}${t.sirket ? ` · ${t.sirket}` : ""} — ${t.gun} gün önce başvurdun`)].join("\n");
}

/**
 * Bir kaynak arka arkaya 3 koşu düşerse uyarı gönderir — tam üçüncüde, bir
 * kez. Sonrakiler tekrar uyarmaz; kaynak düzelip bir kez başarılı olunca
 * sayaç sıfırlanır. Alıcı UYARI_EPOSTA, yoksa bildirim adresi.
 */
export async function kirilmaUyarisi(db: SupabaseClient, kaynak: string, sonHata: string) {
  // Son 4 satır: ilk üçü hatalı VE dördüncüsü hatasız (ya da yok) — yani tam
  // üçüncü ardışık hata. Yalnız son üçe bakınca 4., 5. hatada da uyarıyordu.
  const { data } = await db
    .from("kariyer_taramalar")
    .select("hata")
    .eq("kaynak", kaynak)
    .order("baslangic", { ascending: false })
    .limit(4);
  const satirlar = data ?? [];
  const ucuncu = satirlar.length >= 3 && satirlar.slice(0, 3).every((r) => r.hata) && !satirlar[3]?.hata;
  if (!ucuncu) return;

  const { data: p } = await db.from("kariyer_profil").select("bildirim_eposta").eq("id", 1).maybeSingle();
  const adres = process.env.UYARI_EPOSTA || p?.bildirim_eposta;
  if (!adres) return;

  const metin =
    `${kaynak} kaynağı arka arkaya 3 koşuda hata verdi. Muhtemelen sayfa yapısı değişti.\n\n` +
    `Son hata:\n${sonHata}\n\nSistem diğer kaynaklarla çalışmaya devam ediyor.`;
  await gonder(
    adres,
    `Ablam Kariyer: ${kaynak} taraması 3 koşudur düşüyor`,
    metin,
    `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${kacis(metin)}</pre>`
  );
}
