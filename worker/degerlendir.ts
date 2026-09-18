// Toplanan ilanları kaydeder, filtreler, modelle puanlar.
//
// Sıra önemli ve her adım bir öncekinden ucuz:
//   1. parmak izi -> zaten kayıtlıysa hiç dokunma (ücretsiz)
//   2. sert filtre -> şehir uyuşmuyorsa model çağrılmaz (ücretsiz)
//   3. model -> puan + gerekçe (~$0,003)
// Elenenler de kaydediliyor (karar = "ele", puan 0) ki aynı ilan bir sonraki
// koşuda tekrar gelmesin ve "neden bildirilmedi" sorusunun cevabı dursun.
//
// Bir koruma daha var, modelden önce: GÜNLÜK TAVAN. Bugünkü model harcaması
// GUNLUK_MALIYET_USD'yi aştıysa ilan kaydedilir ama puanlanmaz; ertesi gün
// yarımKalanlar tamamlar. Profil değişince ya da bir kaynak patlayınca fatura
// sınırsız büyümesin.
//
// Kaynaklar arası "benzer başlık" tekilleştirmesi DENENDİ ve KALDIRILDI: ilk
// koşuda iki yanlış pozitif verdi (aynı üniversitenin "Araştırma Görevlisi" ile
// "Öğretim Üyesi" ilanı). Yanlış eleme yanlış bildirimden kötü — gizlenen ilan
// bir daha görülmüyor. Aynı ilanın iki kaynaktan gelmesi ara sıra çift e-posta
// demek; kabul edildi. Tam parmak izi tekilleştirmesi (lib/kariyer.ts) duruyor.

import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJsonOlculu } from "../lib/ai";
import {
  kararVer,
  parmakIzi,
  profilBosMu,
  sertFiltre,
  type FiltreProfili,
  type HamIlan,
  type KariyerProfili,
  type Kaynak,
} from "../lib/kariyer";
import { degerlendirmePrompt, ilanMetni } from "../lib/kariyer-prompts";

export interface DegerlendirmeOzeti {
  yeni: number;
  filtreElenen: number;
  /** Günlük tavan yüzünden puanlanmadan bekleyen */
  tavanBekleyen: number;
  degerlendirilen: number;
  bildir: number;
  ozet: number;
  maliyetUsd: number;
  hatalar: string[];
}

export const bosOzet = (): DegerlendirmeOzeti => ({
  yeni: 0, filtreElenen: 0, tavanBekleyen: 0, degerlendirilen: 0, bildir: 0, ozet: 0, maliyetUsd: 0, hatalar: [],
});

const GUNLUK_TAVAN_USD = Number(process.env.GUNLUK_MALIYET_USD) || 1;

/** Bugün (UTC) kaydedilmiş eşleşmelerin toplam model ücreti */
async function bugunkuHarcama(db: SupabaseClient): Promise<number> {
  const gun = new Date().toISOString().slice(0, 10);
  const { data, error } = await db
    .from("kariyer_eslesmeler")
    .select("olcum->maliyetUsd")
    .gte("degerlendirildi", `${gun}T00:00:00Z`)
    .limit(2000);
  // Okunamıyorsa "sıfır harcandı" değil "bilinmiyor": tavan dolu say, toplama sürsün
  if (error) return Number.POSITIVE_INFINITY;
  return (data ?? []).reduce((t, r) => t + (Number((r as { maliyetUsd?: unknown }).maliyetUsd) || 0), 0);
}

interface ModelCevabi {
  puan?: unknown;
  gerekce?: unknown;
  uyusan?: unknown;
  uyusmayan?: unknown;
  /** Modelin ilan metninden okuduğu son başvuru tarihi, YYYY-AA-GG; yoksa null */
  sonBasvuru?: unknown;
}

/**
 * Modelin çıkardığı tarih makul mü: biçim doğru, geçmişte değil, iki yıldan
 * uzak değil. ilan.gov.tr yapılandırılmış tarih vermiyor; metindeki tarihi
 * model okuyor (denetim önerisi). Kaynak zaten tarih verdiyse dokunulmaz.
 */
function makulTarih(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(v + "T12:00:00Z");
  if (Number.isNaN(t)) return null;
  const gun = (t - Date.now()) / 86_400_000;
  return gun >= -1 && gun <= 730 ? v : null;
}

const metin = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const dizi = (v: unknown) =>
  Array.isArray(v) ? v.map(metin).filter(Boolean).slice(0, 6) : [];

/**
 * Ablamın "ilgilenmedim" dedikleri — modele olumsuz örnek. En yeni 12 tanesi
 * yeter: liste uzadıkça prompt büyür, sinyal büyümez.
 */
async function olumsuzOrnekler(db: SupabaseClient): Promise<string[]> {
  const { data } = await db
    .from("kariyer_eslesmeler")
    .select("geri_bildirim_notu, kariyer_ilanlar(baslik, sirket, sehir)")
    .eq("geri_bildirim", "ilgilenmedim")
    .order("geri_bildirim_ts", { ascending: false })
    .limit(12);
  // "Başvurdum" ilgisizlik değil, tersi; olumsuz örnek olarak modele gitmesin
  return (data ?? []).filter((e) => !/ba[sş]vurdu/i.test(e.geri_bildirim_notu ?? "")).map((e) => {
    const i = (Array.isArray(e.kariyer_ilanlar) ? e.kariyer_ilanlar[0] : e.kariyer_ilanlar) as
      | { baslik: string; sirket: string | null; sehir: string | null }
      | null;
    const parcalar = [i?.baslik, i?.sirket, i?.sehir].filter(Boolean).join(", ");
    return e.geri_bildirim_notu ? `${parcalar} — "${e.geri_bildirim_notu}"` : parcalar;
  });
}

/** Sistem prompt'u bir koşuda bir kez kuruluyor; her ilan için yeniden değil. */
export async function degerlendiriciKur(db: SupabaseClient, profil: KariyerProfili, filtre?: FiltreProfili) {
  return degerlendirmePrompt(profil, await olumsuzOrnekler(db), filtre);
}

/** 2. ve 3. adım: filtre + model + eşleşme kaydı. Kayıtlı bir ilan için çalışır. */
async function puanlaVeKaydet(
  db: SupabaseClient,
  ilanId: string,
  ham: HamIlan,
  sistem: string,
  filtre: FiltreProfili,
  ozet: DegerlendirmeOzeti,
  log: (m: string) => void,
  baglam: { kalanUsd: number }
) {
  const elenme = sertFiltre(ham, filtre);
  if (elenme) {
    ozet.filtreElenen++;
    await db.from("kariyer_eslesmeler").upsert(
      { ilan_id: ilanId, puan: 0, karar: "ele", gerekce: `Filtre: ${elenme}` },
      { onConflict: "ilan_id" }
    );
    return;
  }

  if (baglam.kalanUsd <= 0) {
    // Eşleşme yazılmıyor: ilan "yarım kalan" olarak durur, tavan sıfırlanınca puanlanır
    ozet.tavanBekleyen++;
    return;
  }

  try {
    const { veri, olcum } = await chatJsonOlculu<ModelCevabi>({
      mesajlar: [
        { role: "system", content: sistem },
        { role: "user", content: ilanMetni(ham) },
      ],
      maxTokens: 2000,
      rol: "degerlendirme",
    });
    // Puan yoksa/sayı değilse bu bir cevap değil, hata: "ele" diye kalıcılaşmasın,
    // yarım kalan olarak yeniden denensin (denetim: {} cevabı puan 0 olmuştu)
    if (typeof veri.puan !== "number" || !Number.isFinite(veri.puan)) {
      throw new Error(`model puan vermedi (${JSON.stringify(veri).slice(0, 80)})`);
    }
    let puan = Math.max(0, Math.min(100, Math.round(veri.puan)));
    // Açıklamasız ilanda tavan 80 — prompt'ta da yazıyor ama kural kodda dursun
    if (!ham.aciklama && puan > 80) puan = 80;
    const karar = kararVer(puan);
    ozet.degerlendirilen++;
    ozet.maliyetUsd += olcum.maliyetUsd ?? 0;
    baglam.kalanUsd -= olcum.maliyetUsd ?? 0;
    if (karar === "bildir") ozet.bildir++;
    if (karar === "ozet") ozet.ozet++;

    const { error } = await db.from("kariyer_eslesmeler").upsert(
      {
        ilan_id: ilanId,
        puan,
        gerekce: metin(veri.gerekce) || null,
        uyusan: dizi(veri.uyusan),
        uyusmayan: dizi(veri.uyusmayan),
        karar,
        olcum,
      },
      { onConflict: "ilan_id" }
    );
    if (error) ozet.hatalar.push(`eşleşme: ${ham.baslik} — ${error.message}`);

    const sonBasvuru = !ham.sonBasvuru ? makulTarih(veri.sonBasvuru) : null;
    if (sonBasvuru) {
      await db.from("kariyer_ilanlar").update({ son_basvuru: sonBasvuru }).eq("id", ilanId);
    }
    log(`  ${String(puan).padStart(3)}  ${karar.padEnd(7)}  ${ham.baslik} (${ham.sehir ?? "-"})${sonBasvuru ? ` son başvuru ${sonBasvuru}` : ""}`);
  } catch (e) {
    // Model düşerse ilan kayıtlı kalıyor ama eşleşmesi yok; bir sonraki koşu
    // yarimKalanlariTamamla ile yeniden dener.
    ozet.hatalar.push(`model: ${ham.baslik} — ${(e as Error).message}`);
  }
}

/** Yeni toplanan ilanlar: kaydet (tekilleştirerek), sonra puanla. */
export async function ilanlariDegerlendir(
  db: SupabaseClient,
  ilanlar: HamIlan[],
  profil: KariyerProfili,
  filtre: FiltreProfili,
  log: (m: string) => void
): Promise<DegerlendirmeOzeti> {
  const ozet = bosOzet();
  if (profilBosMu(profil)) {
    ozet.hatalar.push("profil boş — önce arayüzden profil oluşturulmalı");
    return ozet;
  }
  const sistem = await degerlendiriciKur(db, profil, filtre);
  const butce = await butceyiKur(db, log);

  for (const ham of ilanlar) {
    const { data: kayit, error: kayitHatasi } = await db
      .from("kariyer_ilanlar")
      .insert({
        kaynak: ham.kaynak,
        kaynak_id: ham.kaynakId ?? null,
        parmak_izi: parmakIzi(ham),
        baslik: ham.baslik,
        sirket: ham.sirket ?? null,
        sehir: ham.sehir ?? null,
        aciklama: ham.aciklama ?? null,
        url: ham.url ?? null,
        yayin_tarihi: ham.yayinTarihi?.slice(0, 10) ?? null, // sütun date; ISO zaman damgası da gelebiliyor
        son_basvuru: ham.sonBasvuru?.slice(0, 10) ?? null,
        ham: ham.ham ?? null,
      })
      .select("id")
      .single();

    if (kayitHatasi) {
      if (kayitHatasi.code === "23505") continue; // unique ihlali = zaten görülmüş
      ozet.hatalar.push(`kayıt: ${ham.baslik} — ${kayitHatasi.message}`);
      continue;
    }
    ozet.yeni++;
    await puanlaVeKaydet(db, kayit.id, ham, sistem, filtre, ozet, log, butce);
  }
  if (ozet.tavanBekleyen) log(`günlük tavan ($${GUNLUK_TAVAN_USD}) doldu: ${ozet.tavanBekleyen} ilan yarın puanlanacak`);
  return ozet;
}

/** Koşu başında bir kez: bugün ne harcandı, tavana ne kaldı */
async function butceyiKur(db: SupabaseClient, log: (m: string) => void) {
  const harcanan = await bugunkuHarcama(db);
  const kalanUsd = GUNLUK_TAVAN_USD - harcanan;
  if (!Number.isFinite(harcanan)) log("günlük harcama okunamadı — puanlama bu koşuda durdu, toplama sürüyor");
  else if (kalanUsd <= 0) log(`günlük tavan dolu ($${harcanan.toFixed(2)} / $${GUNLUK_TAVAN_USD}) — bu koşuda puanlama yok`);
  return { kalanUsd };
}

/**
 * Eşleşmesi olmayan kayıtlı ilanlar: önceki koşuda model düşmüşse ya da
 * profil o sırada boşsa burada kalırlar. Her koşunun başında yeniden denenir.
 */
export async function yarimKalanlariTamamla(
  db: SupabaseClient,
  profil: KariyerProfili,
  filtre: FiltreProfili,
  log: (m: string) => void
): Promise<DegerlendirmeOzeti> {
  const ozet = bosOzet();
  if (profilBosMu(profil)) return ozet;

  const { data } = await db
    .from("kariyer_ilanlar")
    .select("id, kaynak, kaynak_id, baslik, sirket, sehir, aciklama, url, son_basvuru, kariyer_eslesmeler(ilan_id)")
    .is("kariyer_eslesmeler", null)
    .order("gorulme", { ascending: false })
    .limit(25);
  if (!data?.length) return ozet;

  const butce = await butceyiKur(db, log);
  if (butce.kalanUsd <= 0) return ozet;
  log(`yarım kalan ${data.length} ilan yeniden değerlendiriliyor`);
  const sistem = await degerlendiriciKur(db, profil, filtre);
  for (const r of data) {
    const ham: HamIlan = {
      kaynak: r.kaynak as Kaynak,
      kaynakId: r.kaynak_id ?? undefined,
      baslik: r.baslik,
      sirket: r.sirket ?? undefined,
      sehir: r.sehir ?? undefined,
      aciklama: r.aciklama ?? undefined,
      url: r.url ?? undefined,
      sonBasvuru: r.son_basvuru ?? undefined,
    };
    await puanlaVeKaydet(db, r.id, ham, sistem, filtre, ozet, log, butce);
  }
  return ozet;
}
