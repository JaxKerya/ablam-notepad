// Ablam Kariyer — tarayıcı. VPS'te çalışır, arayüzle yalnızca veritabanı üzerinden konuşur.
//
//   npm run kariyer:tara            tek koşu, çıkar
//   npm run kariyer:tara -- --dongu  sürekli (TARAMA_ARALIGI_DK, varsayılan 60)
//
// Her koşu:
//   1. profil ve filtreleri oku
//   2. önceki koşudan yarım kalan değerlendirmeleri tamamla
//   3. kaynakları sırayla tara (aşağıdaki KAYNAKLAR listesi)
//   4. yeni ilanları kaydet, filtrele, puanla
//   5. bildirimleri gönder
//   6. her kaynağın koşusunu kariyer_taramalar'a yaz — kırılırsa hata satırı ve uyarı
//
// Kaynaklar birbirinden bağımsız: biri düşerse diğerleri koşar. Anahtar
// isteyenler (Jooble, Careerjet) anahtar yoksa sessizce atlanır — loga düşer,
// hata sayılmaz. LinkedIn günde iki kez taranır (engellenme riski).
//
// Ortam değişkenleri Next.js ile aynı .env.local'dan geliyor:
//   node --env-file=.env.local  (bkz. package.json)

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "../lib/supabase-server";
import { BOS_PROFIL, profilDogrula, sehirleriDogrula, type FiltreProfili, type HamIlan, type KariyerProfili, type Kaynak } from "../lib/kariyer";
import { iskurTara } from "./kaynaklar/iskur";
import { ilangovTara } from "./kaynaklar/ilangov";
import { kariyerKapisiTara } from "./kaynaklar/kariyerkapisi";
import { linkedinTara } from "./kaynaklar/linkedin";
import { joobleHazir, joobleTara } from "./kaynaklar/jooble";
import { careerjetHazir, careerjetTara } from "./kaynaklar/careerjet";
import { bosOzet, ilanlariDegerlendir, yarimKalanlariTamamla, type DegerlendirmeOzeti } from "./degerlendir";
import { bildirimleriGonder, kirilmaUyarisi } from "./bildir";

const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

type Db = SupabaseClient;

interface Profil {
  profil: KariyerProfili;
  filtre: FiltreProfili;
  bildirimEposta: string | null;
}

interface TaramaBaglami {
  aramaTerimleri: string[];
  /** Boş = her yer. Kaynaklar her şehri ayrı arar. */
  sehirler: string[];
  bilinenKimlikler: Set<string>;
  log: (m: string) => void;
}

interface KaynakSonucu {
  ilanlar: HamIlan[];
  gorulen: number;
}

interface KaynakTanimi {
  ad: Kaynak;
  etiket: string;
  /** Koşamayacaksa sebebi (anahtar yok gibi); null = hazır */
  hazir?: () => string | null;
  /** İki başarılı tarama arası en az kaç dakika geçmeli (boş = her koşuda) */
  enAzAralikDk?: number;
  tara: (b: TaramaBaglami) => Promise<KaynakSonucu>;
}

/** İŞKUR il listesi büyük harf: "İstanbul" -> "İSTANBUL" */
const iskurIlleri = (sehirler: string[]) => sehirler.map((s) => s.toLocaleUpperCase("tr"));

const KAYNAKLAR: KaynakTanimi[] = [
  {
    ad: "iskur",
    etiket: "İŞKUR",
    // Chromium sürüyor, terim x şehir kadar arama; İŞKUR günde bir-iki kez değişir
    enAzAralikDk: Number(process.env.ISKUR_ARALIK_DK) || 360,
    tara: (b) => iskurTara({ aramaTerimleri: b.aramaTerimleri, iller: iskurIlleri(b.sehirler), bilinenKimlikler: b.bilinenKimlikler, log: b.log }),
  },
  {
    ad: "ilangov",
    etiket: "ilan.gov.tr",
    tara: (b) => ilangovTara({ sehirler: b.sehirler, bilinenKimlikler: b.bilinenKimlikler, log: b.log }),
  },
  {
    ad: "kariyerkapisi",
    etiket: "Kariyer Kapısı",
    tara: (b) => kariyerKapisiTara({ sehirler: b.sehirler, bilinenKimlikler: b.bilinenKimlikler, log: b.log }),
  },
  {
    ad: "linkedin",
    etiket: "LinkedIn",
    enAzAralikDk: Number(process.env.LINKEDIN_ARALIK_DK) || 720,
    tara: (b) => linkedinTara({ aramaTerimleri: b.aramaTerimleri, sehirler: b.sehirler, bilinenKimlikler: b.bilinenKimlikler, log: b.log }),
  },
  {
    ad: "jooble",
    etiket: "Jooble",
    hazir: joobleHazir,
    tara: (b) => joobleTara({ aramaTerimleri: b.aramaTerimleri, sehirler: b.sehirler, bilinenKimlikler: b.bilinenKimlikler, log: b.log }),
  },
  {
    ad: "careerjet",
    etiket: "Careerjet",
    hazir: careerjetHazir,
    tara: (b) => careerjetTara({ aramaTerimleri: b.aramaTerimleri, sehirler: b.sehirler, bilinenKimlikler: b.bilinenKimlikler, log: b.log }),
  },
];

async function profiliOku(db: Db): Promise<Profil> {
  const { data, error } = await db
    .from("kariyer_profil")
    .select("profil, sehirler, uzaktan_olur, asgari_maas, bildirim_eposta")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`profil okunamadı: ${error.message}`);
  return {
    profil: data?.profil ? profilDogrula(data.profil) : BOS_PROFIL,
    filtre: {
      sehirler: sehirleriDogrula(data?.sehirler),
      uzaktan_olur: data?.uzaktan_olur ?? true,
      asgari_maas: typeof data?.asgari_maas === "number" && data.asgari_maas > 0 ? data.asgari_maas : null,
    },
    bildirimEposta: data?.bildirim_eposta ?? null,
  };
}

function ozetBirlestir(a: DegerlendirmeOzeti, b: DegerlendirmeOzeti): DegerlendirmeOzeti {
  return {
    yeni: a.yeni + b.yeni,
    filtreElenen: a.filtreElenen + b.filtreElenen,
    tavanBekleyen: a.tavanBekleyen + b.tavanBekleyen,
    degerlendirilen: a.degerlendirilen + b.degerlendirilen,
    bildir: a.bildir + b.bildir,
    ozet: a.ozet + b.ozet,
    maliyetUsd: a.maliyetUsd + b.maliyetUsd,
    hatalar: [...a.hatalar, ...b.hatalar],
  };
}

/** Kaynağın son başarılı taraması şu kadar dakikadan yeniyse atla */
async function yakinZamandaTarandiMi(db: Db, kaynak: Kaynak, dk: number): Promise<boolean> {
  const { data } = await db
    .from("kariyer_taramalar")
    .select("bitis")
    .eq("kaynak", kaynak)
    .is("hata", null)
    .not("bitis", "is", null)
    .order("bitis", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.bitis) return false;
  return Date.now() - new Date(data.bitis).getTime() < dk * 60_000;
}

/** Kaynakta daha önce görülen kimlikler — detayı yeniden çekilmesin */
async function bilinenKimlikleriOku(db: Db, kaynak: Kaynak): Promise<Set<string>> {
  const { data } = await db
    .from("kariyer_ilanlar")
    .select("kaynak_id")
    .eq("kaynak", kaynak)
    .not("kaynak_id", "is", null)
    .order("gorulme", { ascending: false })
    .limit(2000);
  return new Set((data ?? []).map((r) => r.kaynak_id as string));
}

/**
 * Tek kaynağın koşusu: kariyer_taramalar satırı, tarama, değerlendirme, satırı
 * kapatma. Hata burada yakalanır — kaynak düşünce koşu değil, o kaynak düşer.
 */
async function kaynagiKos(db: Db, k: KaynakTanimi, profil: KariyerProfili, filtre: FiltreProfili): Promise<DegerlendirmeOzeti> {
  const engel = k.hazir?.();
  if (engel) {
    log(`${k.etiket}: atlandı (${engel})`);
    return bosOzet();
  }
  if (k.enAzAralikDk && (await yakinZamandaTarandiMi(db, k.ad, k.enAzAralikDk))) {
    log(`${k.etiket}: son ${k.enAzAralikDk} dk içinde tarandı, atlandı`);
    return bosOzet();
  }

  const { data: tarama } = await db.from("kariyer_taramalar").insert({ kaynak: k.ad }).select("id").single();
  const kapat = (alanlar: Record<string, unknown>) =>
    tarama ? db.from("kariyer_taramalar").update({ bitis: new Date().toISOString(), ...alanlar }).eq("id", tarama.id) : Promise.resolve();

  try {
    const sonuc = await k.tara({
      aramaTerimleri: profil.aramaTerimleri,
      sehirler: filtre.sehirler,
      bilinenKimlikler: await bilinenKimlikleriOku(db, k.ad),
      log,
    });
    log(`${k.etiket}: ${sonuc.gorulen} görüldü, ${sonuc.ilanlar.length} yeni`);

    const ozet = await ilanlariDegerlendir(db, sonuc.ilanlar, profil, filtre, log);
    await kapat({
      bulunan: sonuc.gorulen,
      yeni: ozet.yeni,
      hata: ozet.hatalar.length ? ozet.hatalar.slice(0, 5).join(" | ") : null,
    });
    return ozet;
  } catch (e) {
    const mesaj = (e as Error).message;
    log(`${k.etiket} taraması DÜŞTÜ: ${mesaj}`);
    await kapat({ hata: mesaj });
    // Kaynak kırılması sessiz kalmasın: arka arkaya düşüyorsa uyarı e-postası
    await kirilmaUyarisi(db, k.ad, mesaj).catch((h) => log(`uyarı gönderilemedi: ${h}`));
    const ozet = bosOzet();
    ozet.hatalar.push(`${k.etiket}: ${mesaj}`);
    return ozet;
  }
}

export async function tekKosu(): Promise<void> {
  const db = createServerSupabaseClient();
  const { profil, filtre, bildirimEposta } = await profiliOku(db);

  if (!profil.aramaTerimleri.length) {
    log("profil yok ya da arama terimi boş — arayüzden profil oluşturulmalı. Koşu atlandı.");
    return;
  }
  log(`profil: ${profil.aramaTerimleri.length} arama terimi, şehir: ${filtre.sehirler.join(", ") || "(hepsi)"}`);

  let toplam = await yarimKalanlariTamamla(db, profil, filtre, log);

  const secilen = process.env.KAYNAKLAR?.split(",").map((s) => s.trim()).filter(Boolean);
  for (const k of KAYNAKLAR) {
    if (secilen?.length && !secilen.includes(k.ad)) continue;
    toplam = ozetBirlestir(toplam, await kaynagiKos(db, k, profil, filtre));
  }

  // --- Bildirim ------------------------------------------------------------
  if (bildirimEposta) {
    const gonderilen = await bildirimleriGonder(db, bildirimEposta, log).catch((h) => {
      log(`bildirim hatası: ${(h as Error).message}`);
      return 0;
    });
    if (gonderilen) log(`${gonderilen} bildirim gönderildi`);
  } else {
    log("bildirim e-postası ayarlı değil — bildirim gönderilmiyor");
  }

  log(
    `bitti: ${toplam.yeni} yeni, ${toplam.filtreElenen} filtrede elendi, ` +
      `${toplam.degerlendirilen} puanlandı (${toplam.bildir} güçlü, ${toplam.ozet} özet)` +
      (toplam.tavanBekleyen ? `, ${toplam.tavanBekleyen} tavanda bekliyor` : "") +
      `, ` +
      `$${toplam.maliyetUsd.toFixed(4)}` +
      (toplam.hatalar.length ? `, ${toplam.hatalar.length} hata` : "")
  );
  for (const h of toplam.hatalar.slice(0, 5)) log(`  ! ${h}`);
}

async function main() {
  const dongu = process.argv.includes("--dongu");
  const aralikDk = Number(process.env.TARAMA_ARALIGI_DK) || 60;

  if (!dongu) {
    await tekKosu();
    return;
  }

  log(`döngü modu: her ${aralikDk} dakikada bir`);
  for (;;) {
    try {
      await tekKosu();
    } catch (e) {
      // Döngü hiçbir hatada durmamalı; hata loglanır, sonraki tur bekler.
      log(`koşu düştü: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, aralikDk * 60_000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
