// İŞKUR toplayıcı — esube.iskur.gov.tr/Istihdam/AcikIsIlanAra.aspx
//
// Girişsiz erişilebiliyor (doğrulandı), ama sayfa eski usul ASP.NET WebForms:
// her arama ve her sayfa geçişi __doPostBack ile ViewState taşıyor. Düz HTTP
// ile taklit etmek kırılgan; gerçek bir tarayıcı sürüyoruz (playwright-core).
//
// Bilinen sınırlar:
// - İşyeri adı giriş yapmadan görünmüyor. Boş bırakıyoruz; parmak izi bu
//   yüzden kaynak+ilan numarasından kuruluyor (lib/kariyer.ts).
// - Detay sayfası yeni pencerede açılıyor; her ilan için bir sekme demek.
//   Yalnızca DAHA ÖNCE GÖRÜLMEMİŞ ilanların detayı açılıyor — eskiler zaten
//   veritabanında.
//
// Sayfa yapısı değişirse burası kırılır. Sessiz kırılmasın diye: seçici
// bulunamayınca hata fırlatılıyor, döngü bunu kariyer_taramalar'a yazıyor ve
// uyarı gönderiyor (bkz. worker/ana.ts).

import { chromium, type Browser, type Page } from "playwright-core";
import type { HamIlan } from "../../lib/kariyer";

const ARAMA_SAYFASI = "https://esube.iskur.gov.tr/Istihdam/AcikIsIlanAra.aspx";
const DETAY_SAYFASI = "https://esube.iskur.gov.tr/Istihdam/AcikIsIlanDetay.aspx";
const SAYFA_SINIRI = 3; // terim başına en fazla kaç sonuç sayfası

export interface IskurSecenekleri {
  aramaTerimleri: string[];
  /** İŞKUR'un il listesindeki adlar (büyük harf, ör. "İSTANBUL"). Boşsa tüm iller. Her il ayrı arama. */
  iller?: string[];
  /** Kimlikleri bilinen ilanların detayı açılmaz */
  bilinenKimlikler: Set<string>;
  /** Detay açma sınırı — bir koşuda en fazla kaç yeni ilan derinlemesine okunsun */
  detaySiniri?: number;
  log?: (mesaj: string) => void;
}

export interface IskurSonucu {
  ilanlar: HamIlan[];
  /** Kaynakta görülen toplam (bilinenler dahil) */
  gorulen: number;
}

/**
 * Tarayıcıyı açar. Sıra: TARAYICI_YOLU verilmişse o; Windows/macOS'ta kurulu
 * Chrome (geliştirme); Linux'ta Playwright'ın kendi Chromium'u
 * (`npx playwright-core install --with-deps chromium`, konumu
 * PLAYWRIGHT_BROWSERS_PATH ile sabitleniyor — bkz. deploy/).
 */
export async function tarayiciAc(): Promise<Browser> {
  const yol = process.env.TARAYICI_YOLU;
  const masaustu = process.platform === "win32" || process.platform === "darwin";
  return chromium.launch({
    headless: true,
    ...(yol ? { executablePath: yol } : masaustu ? { channel: "chrome" } : {}),
    args: ["--disable-gpu", "--no-sandbox"],
  });
}

export async function iskurTara(secenekler: IskurSecenekleri): Promise<IskurSonucu> {
  const { aramaTerimleri, iller = [], bilinenKimlikler, detaySiniri = 30 } = secenekler;
  const log = secenekler.log ?? (() => {});
  const tarayici = await tarayiciAc();
  const baglam = await tarayici.newContext({ locale: "tr-TR" });
  const sayfa = await baglam.newPage();

  const toplanan = new Map<string, HamIlan>();
  let gorulen = 0;
  let detayAcilan = 0;

  /** Tek terimi (bir ilde) baştan sona tarar. goto geçici ağ hatasında bir kez yeniden denenir. */
  async function terimTara(terim: string, il: string | null) {
    log(`İŞKUR: "${terim}" aranıyor${il ? ` (${il})` : ""}`);
    await gotoDayanikli(sayfa, ARAMA_SAYFASI);

    const kutu = sayfa.locator('input[name="ctl04$ctlArananMetin2"]');
    await kutu.waitFor({ timeout: 30_000 });
    await kutu.fill(terim);

    if (il) {
      // select2 ile giydirilmiş bir <select>; asıl seçeneğe değerle ulaşıyoruz
      const secildi = await sayfa
        .locator('select[name="ctl04$ctlIl"]')
        .selectOption({ label: il })
        .then(() => true)
        .catch(() => false);
      if (!secildi) log(`İŞKUR: il listesinde "${il}" bulunamadı, tüm iller taranıyor`);
    }

    await Promise.all([
      sayfa.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {}),
      sayfa.locator("#ctl04_ctlAcikIsPageCommand_CommandItem_Search").click(),
    ]);

    let oncekiIlkKimlik = "";
    for (let sayfaNo = 1; sayfaNo <= SAYFA_SINIRI; sayfaNo++) {
      const satirlar = await listeyiOku(sayfa);
      if (!satirlar.length) {
        if (sayfaNo === 1) log(`İŞKUR: "${terim}" için sonuç yok`);
        break;
      }
      // Son sayfada "Sonraki" tıklanınca sayfa değişmiyor ama düğme duruyor;
      // aynı listeyi ikinci kez okumamak için ilk kimliği karşılaştırıyoruz.
      if (satirlar[0].kimlik === oncekiIlkKimlik) break;
      oncekiIlkKimlik = satirlar[0].kimlik;
      gorulen += satirlar.length;

      for (const s of satirlar) {
        if (toplanan.has(s.kimlik) || bilinenKimlikler.has(s.kimlik)) continue;
        const ilan: HamIlan = {
          kaynak: "iskur",
          kaynakId: s.kimlik,
          baslik: s.baslik,
          sehir: s.sehir,
          url: `${DETAY_SAYFASI}?uiID=${s.kimlik}`,
          sonBasvuru: tarihCevir(s.sonBasvuru),
          ham: s,
        };
        if (detayAcilan < detaySiniri) {
          const aciklama = await detayOku(sayfa, s.kimlik, s.tur.startsWith("Kamu") ? "Kamu" : "Özel").catch((e) => {
            log(`İŞKUR: ${s.kimlik} detayı okunamadı: ${(e as Error).message}`);
            return null;
          });
          detayAcilan++;
          if (aciklama) ilan.aciklama = aciklama;
        }
        toplanan.set(s.kimlik, ilan);
      }

      const sonraki = await sonrakiSayfayaGec(sayfa);
      if (!sonraki) break;
    }
  }

  try {
    // İŞKUR arama formu tek il alıyor; birden fazla şehir = terim x il arama.
    const aramalar = (iller.length ? iller : [null]).flatMap((il) => aramaTerimleri.map((terim) => ({ terim, il })));
    const basarisiz: string[] = [];
    for (const { terim, il } of aramalar) {
      try {
        await terimTara(terim, il);
      } catch (e) {
        // Bir aramanın hatası diğerlerini götürmesin: ilk koşuda "memur"un
        // sonuçları toplanmışken sonraki terimin goto'su düşünce hepsi gitmişti.
        basarisiz.push(il ? `${terim} (${il})` : terim);
        log(`İŞKUR: "${terim}" taraması düştü: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    // Hepsi düştüyse bu gerçek bir kırılmadır; dışarıya hata olarak çık ki
    // kariyer_taramalar'a yazılsın ve uyarı gitsin.
    if (aramalar.length && basarisiz.length === aramalar.length) {
      throw new Error(`bütün aramalar düştü (${basarisiz.join(", ")})`);
    }
  } finally {
    await tarayici.close();
  }

  return { ilanlar: [...toplanan.values()], gorulen };
}

interface ListeSatiri {
  kimlik: string;
  baslik: string;
  sehir: string;
  sonBasvuru: string;
  tur: string;
}

/**
 * Sonuç tablosunu okur. Kimlik, başlık bağlantısının postback hedefinden
 * çıkıyor: ctl04$ctlGridAcikIslerListeDetail$ctl02$flag_00009814453 -> 00009814453
 */
async function listeyiOku(sayfa: Page): Promise<ListeSatiri[]> {
  return sayfa.evaluate(() => {
    const sonuc: ListeSatiri[] = [];
    const baglantilar = document.querySelectorAll<HTMLAnchorElement>('a[href*="flag_"]');
    for (const a of baglantilar) {
      const eslesme = a.getAttribute("href")?.match(/flag_(\d+)/);
      if (!eslesme) continue;
      const satir = a.closest("tr");
      if (!satir) continue;
      const metin = satir.innerText.replace(/\s+/g, " ").trim();
      const sehir = metin.match(/Çalışma Yeri:\s*([^)]+)\)/)?.[1]?.trim() ?? "";
      const tarih = metin.match(/(\d{2}\.\d{2}\.\d{4})/)?.[1] ?? "";
      const tur = metin.match(/(Özel|Kamu)\s*\/\s*[^\d]+?(?=\s+\d|$)/)?.[0]?.trim() ?? "";
      sonuc.push({ kimlik: eslesme[1], baslik: a.textContent?.trim() ?? "", sehir, sonBasvuru: tarih, tur });
    }
    return sonuc;
  });
}

/**
 * İlan detayını okur. Bağlantı yeni pencere açıyor ama hedefi sabit bir
 * URL (AcikIsIlanDetay.aspx?uiID=...); pencere yakalamak yerine doğrudan
 * gidiyoruz — daha az kırılgan, daha hızlı.
 *
 * Sayfada giriş yapmadan da "İş Tanımı" ve "Nitelik ve Beceriler" görünüyor
 * (doğrulandı); yalnızca işyeri adı gizli. Giriş formu ve altbilgi metinden
 * atılıyor, gerisi olduğu gibi modele gidiyor.
 */
async function detayOku(sayfa: Page, kimlik: string, isyeriTuru: string): Promise<string | null> {
  const detay = await sayfa.context().newPage();
  try {
    await detay.goto(
      `${DETAY_SAYFASI}?uiID=${encodeURIComponent(kimlik)}&isyeriTuru=${encodeURIComponent(isyeriTuru)}`,
      { waitUntil: "domcontentloaded", timeout: 30_000 }
    );
    await detay.waitForTimeout(600);
    const metin = await detay.evaluate(() => document.body.innerText);
    return temizle(metin);
  } finally {
    await detay.close().catch(() => {});
  }
}

/**
 * ERR_ABORTED: bir önceki postback hâlâ uçuştayken yeni navigasyon başlayınca
 * tarayıcı ilkini kesiyor ve hata fırlatıyor. Kısa bekleyip bir kez daha denemek
 * yetiyor; ikinci de düşerse gerçek bir sorundur, yukarı fırlatılır.
 */
async function gotoDayanikli(sayfa: Page, url: string) {
  try {
    await sayfa.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } catch (e) {
    if (!/ERR_ABORTED|net::/.test((e as Error).message)) throw e;
    await sayfa.waitForTimeout(1500);
    await sayfa.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  }
}

async function sonrakiSayfayaGec(sayfa: Page): Promise<boolean> {
  // Gerçek hedef: ctl04$ctlDataPagerDetay$btnNext ("Sonraki Sayfa >")
  const sonraki = sayfa.locator('a[href*="ctlDataPagerDetay$btnNext"]').first();
  if (!(await sonraki.count())) return false;
  await Promise.all([
    sayfa.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {}),
    sonraki.click(),
  ]);
  return true;
}

/**
 * Detay metninden gürültüyü atar: giriş formu satırları ve altbilgi.
 * Kırpma DAR tutuluyor — bir önceki sürüm "Meslek Bilgileri"nden başlatıp
 * üstündeki iş tanımını yiyordu. Bilinmeyen satır atılmaz, modele gider.
 */
const GURULTU = [
  /^İşgücü İstemi$/,
  /sisteme giriş yapınız/i,
  /^T\.C\. Kimlik No$/,
  /^Şifre$/,
  /^Yeni Üye/,
  /^Türkiye İş Kurumu ©/,
];

function temizle(metin: string): string {
  const satirlar = metin
    .split("\n")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s && !GURULTU.some((g) => g.test(s)));
  // "İş Tanımı" ile "Nitelik ve Beceriler" çoğu ilanda birebir aynı metin;
  // ikisini de göndermek token israfı. Aynıysa ikincisini atıyoruz.
  const tanim = satirlar.indexOf("İş Tanımı");
  const nitelik = satirlar.indexOf("Nitelik ve Beceriler");
  if (tanim !== -1 && nitelik > tanim + 1 && satirlar[tanim + 1] === satirlar[nitelik + 1]) {
    satirlar.splice(nitelik, 2);
  }
  return satirlar.join("\n").slice(0, 8000);
}

/** "16.10.2026" -> "2026-10-16" */
function tarihCevir(tr: string): string | undefined {
  const m = tr.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
}
