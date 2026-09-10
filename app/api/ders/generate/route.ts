import { NextResponse } from "next/server";
import { chatJsonOlculu } from "@/lib/ai";
import {
  DENETIM_KAYIT_SINIRI,
  EN_AZ_SORU,
  gerekceKirp,
  hamKirp,
  KATEGORI_DIGER,
  kategoriDogrula,
  KATEGORILER,
  hedefSoruSayisi,
  hukumOneksizAciklama,
  sikSetiniDogrula,
  soruKirp,
  type DenetimAdimi,
  type DenetimGecisi,
  type DenetimKatmani,
  type DenetimKaydi,
  type DenetimOzeti as DenetimOzetiKaydi,
  type Segment,
} from "@/lib/ders";
import { gunlukLimitAsildiMi, hataCevabi, kapiKontrol } from "@/lib/ders-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { damgaBelirle, kelimeDizini, transkriptMetni } from "@/lib/youtube";
import {
  acikPrompt,
  coktanPrompt,
  SIK_SAYISI,
  SORU_OLGU_DENETIMI,
  SORU_TRANSKRIPT_DENETIMI,
} from "@/lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 300;

// Üretim iki isteğe bölünmüş durumda. Sebebi ölçüm: soru sayısı derse göre
// arttığı için tek çağrı 46 dakikalık bir derste 149 saniye sürüyordu, 78
// dakikalıkta 250 saniyeye çıkıyor. İki ayrı HTTP isteği demek, her birinin
// kendi süre bütçesi demek — hem sunucu tavanına takılma riski yarıya iniyor
// hem de ablam ilk adım biter bitmez ders özetini görebiliyor.
//
//   adim "acik"   -> oturumu açar, özet + konular + açık uçlu sorular
//   adim "coktan" -> çoktan seçmelileri ekler, oturumu "hazir" yapar

/**
 * Denetim bulgularının UYGULANMASI. Denetim yönergelerinin kendisi ve iki
 * katmanın neden ayrı olduğu lib/prompts.ts'te (SORU_TRANSKRIPT_DENETIMI,
 * SORU_OLGU_DENETIMI); burada yalnızca bulguyla ne yapıldığı var.
 *
 * ELEME SON ÇARE. Bir soruyu atmak ablamı bir soru eksik bırakır; oysa çoğu
 * durumda bozuk olan soru değil, içindeki tek bir değer. O yüzden varsayılan
 * davranış DÜZELTMEK. Eleme yalnızca iki durumda:
 *   - Ders o konuyu hiç anlatmamış (tur: "yok"). Cevabı düzeltmek adaletsiz
 *     soruyu adil yapmaz, ablamın izlemediği konudan sorulmuş olur.
 *   - Çoktan seçmelide düzeltilmiş şık başka bir şıkla çakışıyor; soru artık
 *     iki doğru cevaplı olur, kurtarılamaz.
 */

/** Şık harfleri — denetime giden metinde ve dönen cevapta aynı harfler kullanılır */
const HARF = ["A", "B", "C", "D", "E"];

/**
 * Şık karşılaştırması için sadeleştirme. Önceden karşılaştırma birebir küçük harf
 * eşitliğiydi; "Merkezî otorite." ile "merkezi otorite" farklı sayılıyor, yani iki
 * şık aynı cevabı verse bile çakışma yakalanmıyor ve soru iki doğru cevaplı olarak
 * kaydediliyordu.
 *
 * Bu dosyadaki harf katlaması, projenin başka yerlerindeki altı harflik eşleme
 * tablosunu (slugla, icerikKelimeleri) KULLANMIYOR: o tablo şapkalı harfleri
 * (â, î, û) tanımıyor ve onlar "a-z değil" diye tamamen siliniyor — "millî" -> "mill",
 * "milli" -> "milli", yani karşılaştırma tutmuyor. Unicode ayrıştırması bütün
 * aksanları katlıyor; tabloda ayrıca ele alınması gereken tek harf, ayrışmayan
 * noktasız "ı".
 */
const sadelestir = (metin: string): string =>
  metin
    .toLowerCase()
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

type Nerede = "anahtar" | "sik" | "aciklama" | "dogru_sik";

interface DenetimBulgusu {
  tur: "yok" | "celiski";
  nerede: Nerede;
  gerekce: string;
  duzeltilmis: string;
  /** nerede === "dogru_sik" iken denetimin doğru bulduğu şıkkın indeksi; yoksa null */
  dogruIndeks: number | null;
}

interface DenetimYaniti {
  sorunlular?: Record<string, unknown>[];
  hatalar?: Record<string, unknown>[];
}

/**
 * Denetime gönderilen soru: parçaları ayrı ayrı etiketli.
 *
 * Çoktan seçmelide ŞIKLARIN TAMAMI gönderiliyor. Önceden yalnızca işaretli şık
 * gidiyordu ("çeldiricilerin yanlış olması zaten beklenen şey") ama bu, denetimin
 * göremediği bir hata sınıfı bırakıyordu: doğru şıkkın YANLIŞ İŞARETLENMESİ.
 * Denetime giden üçlü (soru + işaretli şık + açıklama) kendi içinde tutarlı
 * olduğu için iki katman da geçiyordu — transkript denetimi "iddia derste var"
 * diyor (iyi bir çeldirici zaten derste geçer), olgu denetimi "iddia yanlış
 * değil" diyor (çeldirici genelde doğru bir önermedir, sadece bu sorunun cevabı
 * değildir). Şıkların tamamı olmadan bu ikisi yapısal olarak karar veremez.
 */
interface DenetimGirdisi {
  question: string;
  anahtar?: string;
  secenekler?: string[];
  isaretli?: number;
  aciklama?: string;
}

/** Denetimin sonucu: uygulanacak bulgular + o geçişin kaydı (aiview için) */
interface DenetimSonucu {
  bulgular: Map<number, DenetimBulgusu>;
  gecis: DenetimGecisi;
}

async function denetimCalistir(
  katman: "transkript" | "olgu",
  sistem: string,
  girdiler: DenetimGirdisi[],
  transkript?: string
): Promise<DenetimSonucu> {
  const bos = (): DenetimSonucu => ({
    bulgular: new Map(),
    gecis: { katman, bulgu: 0, valf: false, sn: 0, girdiToken: 0, ciktiToken: 0 },
  });
  if (!girdiler.length) return bos();

  const liste = girdiler
    .map((g, i) => {
      const parcalar = [`${i + 1}. SORU: ${g.question}`];
      if (g.anahtar) parcalar.push(`   anahtar: ${g.anahtar}`);
      if (g.secenekler?.length) {
        g.secenekler.forEach((o, j) => parcalar.push(`   ${HARF[j] ?? j + 1}) ${o}`));
        parcalar.push(`   İŞARETLİ DOĞRU CEVAP: ${HARF[g.isaretli ?? 0] ?? "?"}`);
      }
      if (g.aciklama) parcalar.push(`   aciklama: ${g.aciklama}`);
      return parcalar.join("\n");
    })
    .join("\n\n");

  let yanit: DenetimYaniti;
  let olcum = { girdiToken: 0, ciktiToken: 0, sn: 0, model: "" };
  let hamCevap = "";
  try {
    const sonuc = await chatJsonOlculu<DenetimYaniti>({
      mesajlar: [
        { role: "system", content: sistem },
        {
          role: "user",
          content: transkript
            ? `${transkript}\n\n--- DENETLENECEK SORULAR ---\n\n${liste}`
            : liste,
        },
      ],
      maxTokens: 8000,
      rol: "denetim",
    });
    yanit = sonuc.veri;
    olcum = sonuc.olcum;
    hamCevap = sonuc.ham;
  } catch {
    // Denetim bir güvenlik ağı; kendisi düşerse üretimi engellemesin.
    return bos();
  }

  const gecerliNerede = (v: unknown): Nerede =>
    v === "sik" || v === "aciklama" || v === "dogru_sik" ? v : "anahtar";

  const bulgular = new Map<number, DenetimBulgusu>();
  for (const h of yanit.sorunlular ?? yanit.hatalar ?? []) {
    const no = h?.no;
    if (typeof no !== "number" || no < 1 || no > girdiler.length) continue;
    const harf = metin(h?.dogru).toUpperCase();
    bulgular.set(no - 1, {
      tur: h?.tur === "yok" ? "yok" : "celiski",
      nerede: gecerliNerede(h?.nerede),
      gerekce: metin(h?.gerekce) || "gerekçe belirtilmedi",
      duzeltilmis: metin(h?.duzeltilmis),
      dogruIndeks: HARF.indexOf(harf) >= 0 ? HARF.indexOf(harf) : null,
    });
  }

  // Soruların yarısından fazlası işaretlendiyse hatalı olan büyük ihtimalle
  // denetimin kendisidir; o durumda hiçbirine dokunmuyoruz.
  //
  // Bu olay AYRICA kaydediliyor (valf: true). Kaydedilmezse dışarıdan
  // "denetim hiçbir şey bulmadı" ile ayırt edilemiyor: ikisinde de sıfır
  // düzeltme görünüyor. Oysa biri "temiz", diğeri "denetim devre dışı kaldı".
  const valf = bulgular.size > girdiler.length / 2;
  return {
    bulgular: valf ? new Map() : bulgular,
    gecis: {
      katman,
      bulgu: bulgular.size,
      valf,
      ...olcum,
      // Atılan bulgular başka hiçbir yerde iz bırakmıyor; ham cevap yalnızca
      // bu durumda saklanıyor.
      hamCevap: valf ? hamKirp(hamCevap) : undefined,
    },
  };
}

/**
 * Bir adımın denetim birikimi. `kayitlar` tek gerçek kaynak: hem oturuma yazılıp
 * /ders/aiview'de gösteriliyor hem de sunucu logu ondan türetiliyor.
 */
interface DenetimBirikimi {
  duzeltilen: number;
  elenen: number;
  kayitlar: DenetimKaydi[];
}

function kaydet(
  ozet: DenetimBirikimi,
  katman: DenetimKatmani,
  soru: string,
  kayit: Omit<DenetimKaydi, "katman" | "soru">
) {
  if (ozet.kayitlar.length >= DENETIM_KAYIT_SINIRI) return;
  ozet.kayitlar.push({ katman, soru: soruKirp(soru), ...kayit });
}

/** Elenen sorunun tam hâli: kök + şıklar + hangisinin işaretli olduğu */
function tamSoruMetni(s: {
  question: string;
  choices?: string[] | null;
  correct_index?: number | null;
  answer_key?: string | null;
  explanation?: string | null;
}): string {
  const parcalar = [s.question];
  if (s.choices?.length) {
    s.choices.forEach((o, j) => {
      parcalar.push(`${HARF[j] ?? j + 1}) ${o}${j === (s.correct_index ?? -1) ? "   ← işaretli" : ""}`);
    });
  }
  if (s.answer_key) parcalar.push(`Beklenen cevap: ${s.answer_key}`);
  if (s.explanation) parcalar.push(`Açıklama: ${s.explanation}`);
  return parcalar.join("\n");
}

/** Sunucu logu için tek satırlık özet — ayrıntı artık veritabanında */
const logSatiri = (k: DenetimKaydi) =>
  `${k.islem}${k.sebep ? ` (${k.sebep})` : ""}: ${k.soru}${k.gerekce ? ` — ${k.gerekce}` : ""}`;

/** Açık uçlu sorulara denetim uygular: "yok" elenir, geri kalanı düzeltilir. */
function acikUygula<T extends { question: string; answer_key: string | null }>(
  sorular: T[],
  katman: "transkript" | "olgu",
  bulgular: Map<number, DenetimBulgusu>,
  ozet: DenetimBirikimi
): T[] {
  return sorular.filter((s, i) => {
    const b = bulgular.get(i);
    // "dogru_sik" yalnızca çoktan seçmeli için anlamlı; açık uçluda gelirse yok say.
    if (!b || b.nerede === "dogru_sik") return true;

    if (b.tur === "yok") {
      ozet.elenen++;
      kaydet(ozet, katman, s.question, {
        islem: "elendi",
        sebep: "derste yok",
        gerekce: gerekceKirp(b.gerekce),
        tamMetin: tamSoruMetni(s),
      });
      return false;
    }
    if (!b.duzeltilmis) {
      ozet.elenen++;
      kaydet(ozet, katman, s.question, {
        islem: "elendi",
        sebep: "düzeltme gelmedi",
        tamMetin: tamSoruMetni(s),
      });
      return false;
    }
    kaydet(ozet, katman, s.question, {
      islem: "anahtar-duzeltildi",
      eski: gerekceKirp(s.answer_key ?? ""),
      yeni: gerekceKirp(b.duzeltilmis),
      gerekce: gerekceKirp(b.gerekce),
    });
    s.answer_key = b.duzeltilmis;
    ozet.duzeltilen++;
    return true;
  });
}

/**
 * Çoktan seçmeliye denetim uygular. Açıklama düzeltmek her zaman güvenli;
 * doğru şıkkın metnini düzeltmek de güvenli, tek istisna düzeltilmiş metnin
 * başka bir şıkla çakışması — o zaman soru iki doğru cevaplı olur, elenir.
 *
 * "dogru_sik" bulgusunda (işaretli şık sorunun cevabı değil) soru ELENMEZ, cevap
 * anahtarı denetimin verdiği harfe göre DÜZELTİLİR. Sebep: soru zaten üretildi ve
 * parası ödendi; atmak hem ablamı bir soru eksik bırakır hem de bu dosyanın kendi
 * kuralına ("eleme son çare") aykırı. Yanlış anahtarlı bir soruyu göstermek ile
 * denetimin verdiği anahtara geçmek arasında seçim yapılıyor ve ikincisi daha
 * olası doğru: üretim modelinin tek görüşüne karşı, biri transkripti görerek
 * çalışan iki ayrı denetim geçişi var.
 *
 * İki durumda yine de eleniyor:
 *   - Denetim tek bir doğru şık gösteremiyorsa (harf yok) — birden fazla şık
 *     savunulabilir demektir, sorunun tek cevabı yoktur, kurtarılamaz.
 *   - Soru İKİ geçişte birden "dogru_sik" alıyorsa. Birinci geçiş anahtarı
 *     düzeltmiş olur; ikinci geçiş hâlâ itiraz ediyorsa iki denetim aynı fikirde
 *     değildir ve hakem yoktur.
 */
function coktanUygula<
  T extends { question: string; choices: string[] | null; correct_index: number | null; explanation: string | null },
>(
  sorular: T[],
  katman: "transkript" | "olgu",
  bulgular: Map<number, DenetimBulgusu>,
  ozet: DenetimBirikimi,
  /** Birinci geçişte anahtarı düzeltilen sorular; ikinci geçiş bunlara itiraz ederse elenir */
  anahtariDuzeltilen: Set<unknown>
): T[] {
  return sorular.filter((s, i) => {
    const b = bulgular.get(i);
    if (!b) return true;
    const gerekce = gerekceKirp(b.gerekce);
    const sikMetni = (j: number) => `${HARF[j]}) ${(s.choices ?? [])[j] ?? ""}`;

    if (b.tur === "yok") {
      ozet.elenen++;
      kaydet(ozet, katman, s.question, {
        islem: "elendi", sebep: "derste yok", gerekce, tamMetin: tamSoruMetni(s),
      });
      return false;
    }
    if (b.nerede === "dogru_sik") {
      const secenekSayisi = (s.choices ?? []).length;
      if (anahtariDuzeltilen.has(s)) {
        ozet.elenen++;
        kaydet(ozet, katman, s.question, {
          islem: "elendi",
          sebep: "iki denetim anahtarda anlaşamadı",
          gerekce,
          tamMetin: tamSoruMetni(s),
        });
        return false;
      }
      if (b.dogruIndeks === null || b.dogruIndeks >= secenekSayisi) {
        ozet.elenen++;
        kaydet(ozet, katman, s.question, {
          islem: "elendi",
          sebep: "tek doğru şık gösterilemedi",
          gerekce,
          tamMetin: tamSoruMetni(s),
        });
        return false;
      }
      if (b.dogruIndeks === s.correct_index) return true; // zaten o şık işaretli
      kaydet(ozet, katman, s.question, {
        islem: "anahtar",
        eski: gerekceKirp(sikMetni(s.correct_index ?? 0)),
        yeni: gerekceKirp(sikMetni(b.dogruIndeks)),
        gerekce,
      });
      s.correct_index = b.dogruIndeks;
      anahtariDuzeltilen.add(s);
      ozet.duzeltilen++;
      return true;
    }
    if (!b.duzeltilmis) {
      // Açıklamada hata bulunmuş ama düzeltmesi gelmemişse soruyu atmak gereksiz:
      // soru kökü ve şıklar sağlam, sorunlu olan yalnızca geri bildirim metni.
      // Açıklamayı düşürüp soruyu tutuyoruz — grade ucu boş açıklamayı zaten
      // kaldırıyor, ablam soruyu çözer, sadece ek yorumu görmez.
      if (b.nerede === "aciklama") {
        kaydet(ozet, katman, s.question, {
          islem: "aciklama-dusuruldu",
          eski: gerekceKirp(s.explanation ?? ""),
          gerekce,
        });
        s.explanation = null;
        ozet.duzeltilen++;
        return true;
      }
      ozet.elenen++;
      kaydet(ozet, katman, s.question, {
        islem: "elendi", sebep: "düzeltme gelmedi", gerekce, tamMetin: tamSoruMetni(s),
      });
      return false;
    }

    if (b.nerede === "sik") {
      const secenekler = s.choices ?? [];
      const dogruIndeks = s.correct_index ?? 0;
      const duzeltilmisSade = sadelestir(b.duzeltilmis);
      const carpisma = secenekler.some(
        (o, j) => j !== dogruIndeks && sadelestir(o) === duzeltilmisSade
      );
      if (carpisma) {
        ozet.elenen++;
        kaydet(ozet, katman, s.question, {
          islem: "elendi", sebep: "şık çakışması", gerekce, tamMetin: tamSoruMetni(s),
        });
        return false;
      }
      kaydet(ozet, katman, s.question, {
        islem: "sik",
        eski: gerekceKirp(secenekler[dogruIndeks] ?? ""),
        yeni: gerekceKirp(b.duzeltilmis),
        gerekce,
      });
      s.choices = secenekler.map((o, j) => (j === dogruIndeks ? b.duzeltilmis : o));
    } else {
      kaydet(ozet, katman, s.question, {
        islem: "aciklama",
        eski: gerekceKirp(s.explanation ?? ""),
        yeni: gerekceKirp(b.duzeltilmis),
        gerekce,
      });
      s.explanation = b.duzeltilmis;
    }

    ozet.duzeltilen++;
    return true;
  });
}

interface UretilenAcik {
  soru?: string;
  anahtar?: string;
  kilit_kavramlar?: string[];
  konu?: string;
  saniye?: number;
}

interface UretilenCoktan {
  soru?: string;
  secenekler?: string[];
  dogru?: number;
  aciklama?: string;
  konu?: string;
  saniye?: number;
}

const metin = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const dizi = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];

// Modelin verdiği "saniye" güvenilmez (bkz. lib/youtube.ts -> damgaBelirle).
// Sorunun kavramlarının transkriptte en yoğun geçtiği anı kendimiz buluyoruz.
type Dizin = Map<string, number[]>;

/**
 * Hedef sayıya kırpma burada YAPILMIYOR, denetimden sonraya bırakıldı. Önce
 * kırpılınca modelin ürettiği fazla sorular daha denetim çalışmadan atılıyor,
 * sonra denetim birkaç soru eleyince nihai sayı hedefin altına düşüyordu — oysa
 * atılan fazlalıklar o boşluğu doldurabilirdi. Fazlalıklar için ödeme zaten
 * yapılmış durumda; yedek olarak tutuluyorlar.
 */
function acikDogrula(ham: UretilenAcik[], sure: number, dizin: Dizin) {
  return (ham ?? [])
    .filter((s) => metin(s.soru) && metin(s.anahtar))
    .map((s) => ({
      kind: "acik" as const,
      question: metin(s.soru),
      answer_key: metin(s.anahtar),
      key_points: dizi(s.kilit_kavramlar),
      choices: null,
      correct_index: null,
      explanation: null,
      topic: metin(s.konu) || null,
      start_seconds: damgaBelirle(
        [metin(s.soru), metin(s.anahtar), dizi(s.kilit_kavramlar).join(" ")].join(" "),
        dizin,
        s.saniye,
        sure
      ),
    }));
}

function coktanDogrula(ham: UretilenCoktan[], sure: number, dizin: Dizin) {
  const gelen = ham ?? [];
  // Hangi şartın kaç soruyu düşürdüğü ayrı ayrı sayılıyor: "12 soru geldi 9 kaldı"
  // bilgisi tek başına ne yapılacağını söylemiyor, "3 tanesi 4 şıklıydı" söylüyor.
  const bicimElenen: Record<string, number> = {};
  const dus = (sebep: string) => {
    bicimElenen[sebep] = (bicimElenen[sebep] ?? 0) + 1;
    return false;
  };
  // Şık kuralının kendisi lib/ders.ts'te (sikSetiniDogrula) — tekrar varyantları
  // da aynı kapıdan geçiyor, kural iki yere kopyalanmasın diye.
  const karisiklar = new Map<UretilenCoktan, { secenekler: string[]; dogruIndeks: number }>();
  const gecerli = gelen.filter((s) => {
    if (!metin(s.soru)) return dus("soru metni boş");
    const k = sikSetiniDogrula(s.secenekler, s.dogru, SIK_SAYISI);
    if (!k) {
      const ham = dizi(s.secenekler).length;
      return dus(ham !== SIK_SAYISI ? `şık sayısı ${ham}` : "boş/tekrar eden şık ya da geçersiz indeks");
    }
    karisiklar.set(s, k);
    return true;
  });

  // Şık şartı kayıpla uygulanıyor: kuralı çiğneyen soru düzeltilmiyor, atılıyor.
  // Sebep kırılımı çağırana dönüyor ve oturuma yazılıyor; sessiz kayıp yok.
  if (gecerli.length < gelen.length) {
    console.warn(
      `[ders] ${gelen.length - gecerli.length} çoktan seçmeli biçim şartına takıldı`,
      bicimElenen
    );
  }

  // Kırpma yok — gerekçesi acikDogrula'nın başında.
  const sorular = gecerli
    .map((s) => {
      // Doğru şıkkın konumu modele bırakılmıyor — bkz. siklariKaristir
      const karisik = karisiklar.get(s)!;
      return {
        kind: "coktan" as const,
        question: metin(s.soru),
        answer_key: null,
        key_points: [] as string[],
        choices: karisik.secenekler,
        correct_index: karisik.dogruIndeks,
        explanation: metin(s.aciklama) ? hukumOneksizAciklama(metin(s.aciklama)) : null,
        topic: metin(s.konu) || null,
        start_seconds: damgaBelirle(
          [metin(s.soru), karisik.secenekler.join(" "), metin(s.aciklama)].join(" "),
          dizin,
          s.saniye,
          sure
        ),
      };
    });

  return { sorular, bicimElenen, uretilen: gelen.length };
}

/**
 * Denetim sayılarını oturuma yazar. Bu yalnızca şeffaflık içindir — `denetim`
 * kolonu eklenmemişse ders üretimi bundan etkilenmemeli, o yüzden hata yutuluyor.
 * `ekle` true ise mevcut sayıların üstüne ekler (iki adımın toplamı).
 */
async function denetimOzetiYaz(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  sessionId: string,
  ozet: DenetimBirikimi,
  adim: DenetimAdimi,
  ekle: boolean
) {
  try {
    let taban: DenetimOzetiKaydi = { duzeltilen: 0, elenen: 0, adimlar: [] };
    if (ekle) {
      const { data } = await supabase
        .from("ders_sessions")
        .select("denetim")
        .eq("id", sessionId)
        .maybeSingle();
      const onceki = (data?.denetim ?? {}) as Partial<DenetimOzetiKaydi>;
      taban = {
        duzeltilen: onceki.duzeltilen ?? 0,
        elenen: onceki.elenen ?? 0,
        adimlar: Array.isArray(onceki.adimlar) ? onceki.adimlar : [],
      };
    }
    const yeni: DenetimOzetiKaydi = {
      duzeltilen: taban.duzeltilen + ozet.duzeltilen,
      elenen: taban.elenen + ozet.elenen,
      adimlar: [...(taban.adimlar ?? []), adim],
    };
    await supabase.from("ders_sessions").update({ denetim: yeni }).eq("id", sessionId);
  } catch {
    // kolon yoksa sessizce geç
  }
}

async function videoGetir(videoId: string) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("ders_videos")
    .select("video_id, title, duration_seconds, segments")
    .eq("video_id", videoId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || !Array.isArray(data.segments) || !data.segments.length) return null;
  return data;
}

/**
 * Gövde: { videoId, adim: "acik" } -> { sessionId, ... }
 *        { videoId, adim: "coktan", sessionId } -> { soruSayisi }
 */
export async function POST(request: Request) {
  const engel = await kapiKontrol();
  if (engel) return engel;

  try {
    let govde: Record<string, unknown>;
    try {
      govde = await request.json();
    } catch {
      return NextResponse.json({ hata: "Geçersiz istek gövdesi." }, { status: 400 });
    }
    const videoId = typeof govde.videoId === "string" ? govde.videoId : "";
    const adim = typeof govde.adim === "string" ? govde.adim : "acik";
    const sessionId = typeof govde.sessionId === "string" ? govde.sessionId : undefined;

    if (!videoId) {
      return NextResponse.json({ hata: "videoId gerekli." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const video = await videoGetir(videoId);
    if (!video) {
      return NextResponse.json(
        { hata: "Bu videonun transkripti bulunamadı. Baştan başlar mısın?" },
        { status: 404 }
      );
    }

    const segments = video.segments as Segment[];
    const sure = video.duration_seconds ?? 0;
    const hedef = hedefSoruSayisi(sure);
    const dizin = kelimeDizini(segments);
    // Video başlığı modele dönemi ve özel isimleri veriyor. Otomatik altyazıda
    // özel isimler bozuluyor ("ahlak" -> "Aylak" gibi); başlık bunu azaltıyor.
    const transkript =
      (video.title ? `Video başlığı: ${video.title}\n` : "") +
      `Ders süresi: ${Math.round(sure / 60)} dakika\n\n` +
      `Ders transkripti:\n\n${transkriptMetni(segments)}`;

    // ------------------------------------------------------------ 1. adım
    if (adim === "acik") {
      if (await gunlukLimitAsildiMi()) {
        return NextResponse.json(
          { hata: "Bugünlük ders hazırlama sınırına ulaşıldı. Yarın devam edebilirsin." },
          { status: 429 }
        );
      }

      // Yarım kalmış ESKİ denemeleri temizle.
      //
      // "Eski" şartı paralel üretim için şart: artık aynı anda birden çok ders
      // hazırlanabiliyor ve ablam aynı linki iki kez sıraya alabilir. Zaman
      // sınırı olmasaydı ikinci deneme, o an 2. adımı çalışan oturumu silerdi —
      // birincinin soruları sahipsiz kalır, üretim boşa giderdi. Gerçek çöp
      // (sekme kapanmış, istek düşmüş) zaten dakikalar öncesinden kalıyor.
      const TAZE_SAYILAN_DK = 15;
      await supabase
        .from("ders_sessions")
        .delete()
        .eq("video_id", videoId)
        .eq("status", "hazirlaniyor")
        .lt("created_at", new Date(Date.now() - TAZE_SAYILAN_DK * 60_000).toISOString());

      const {
        veri: uretilen,
        olcum: uretimOlcum,
        ham: uretimHam,
      } = await chatJsonOlculu<{
        baslik?: string;
        kategori?: string;
        ozet?: string;
        konular?: string[];
        acik_uclu?: UretilenAcik[];
      }>({
        mesajlar: [
          {
            role: "system",
            // Kategori listesi lib/ders.ts'te tek kaynak; prompt'a parametre
            // olarak giriyor ki prompts.ts hiçbir şey import etmesin
            // (ölçüm betikleri onu doğrudan Node ile açıyor).
            content: acikPrompt(hedef.acik, KATEGORILER, KATEGORI_DIGER),
          },
          { role: "user", content: transkript },
        ],
        // Akıl yürüten modellerde düşünme tokenları da bu bütçeden düşüyor.
        // Dar bırakılınca model bütçeyi düşünmeye harcayıp boş cevap dönüyordu
        // (glm-5.3 ve kimi-k3 ölçümü). max_tokens yalnızca tavan — kullanılmayan
        // token ücretlendirilmediği için cömert olmak bedava.
        maxTokens: 32000,
      });

      const ozet: DenetimBirikimi = { duzeltilen: 0, elenen: 0, kayitlar: [] };
      const girdi = (s: { question: string; answer_key: string | null }) => ({
        question: s.question,
        anahtar: s.answer_key ?? "",
      });

      // 1. katman: derste var mı? 2. katman: gerçekte doğru mu?
      // İkisi de önce düzeltmeye çalışır, eleme son çare.
      const hamAcik = (uretilen.acik_uclu ?? []).length;
      let acik = acikDogrula(uretilen.acik_uclu ?? [], sure, dizin);

      const gecis1 = await denetimCalistir(
        "transkript", SORU_TRANSKRIPT_DENETIMI, acik.map(girdi), transkript
      );
      acik = acikUygula(acik, "transkript", gecis1.bulgular, ozet);

      const gecis2 = await denetimCalistir("olgu", SORU_OLGU_DENETIMI, acik.map(girdi));
      acik = acikUygula(acik, "olgu", gecis2.bulgular, ozet);

      acik = acik.slice(0, hedef.acik);
      if (ozet.kayitlar.length) {
        console.warn("[ders] denetim (açık uçlu):", ozet.kayitlar.map(logSatiri));
      }

      // Ham çıktı yalnızca bir şey ters gittiyse saklanıyor: her derste saklamak
      // oturum başına ~25 KB demekti. Ters giden = soru elendi ya da valf devrede.
      const acikTers =
        ozet.elenen > 0 || gecis1.gecis.valf || gecis2.gecis.valf;
      const acikAdimi: DenetimAdimi = {
        adim: "acik",
        uretilen: hamAcik,
        hedef: hedef.acik,
        nihai: acik.length,
        uretimSn: uretimOlcum.sn,
        uretimGirdiToken: uretimOlcum.girdiToken,
        uretimCiktiToken: uretimOlcum.ciktiToken,
        uretimModeli: uretimOlcum.model,
        hamUretim: acikTers ? hamKirp(uretimHam) : undefined,
        gecisler: [gecis1.gecis, gecis2.gecis],
        kayitlar: ozet.kayitlar,
      };

      const { data: oturum, error: oturumHatasi } = await supabase
        .from("ders_sessions")
        .insert({
          video_id: videoId,
          title: metin(uretilen.baslik) || video.title || "Ders",
          // Kapalı listeye oturtuluyor; model liste dışı bir ad verirse "Diğer"
          kategori: kategoriDogrula(uretilen.kategori),
          tur: "ders",
          summary: metin(uretilen.ozet) || null,
          topics: dizi(uretilen.konular),
          status: "hazirlaniyor",
        })
        .select("id")
        .single();

      if (oturumHatasi || !oturum) {
        throw new Error(`Oturum oluşturulamadı: ${oturumHatasi?.message ?? "bilinmiyor"}`);
      }

      // Denetim özeti şeffaflık için; kolon henüz eklenmemişse ders üretimi
      // bundan etkilenmesin diye ayrı ve hatası yutulan bir güncelleme.
      await denetimOzetiYaz(supabase, oturum.id, ozet, acikAdimi, false);

      if (acik.length) {
        const { error } = await supabase
          .from("ders_questions")
          .insert(
            acik.map((s, i) => ({ ...s, session_id: oturum.id, video_id: videoId, position: i }))
          );
        if (error) throw new Error(`Sorular kaydedilemedi: ${error.message}`);
      }

      return NextResponse.json({
        sessionId: oturum.id,
        acikSayisi: acik.length,
        coktanHedef: hedef.coktan,
      });
    }

    // ------------------------------------------------------------ 2. adım
    if (adim === "coktan") {
      if (!sessionId) {
        return NextResponse.json({ hata: "sessionId gerekli." }, { status: 400 });
      }

      const { data: oturum } = await supabase
        .from("ders_sessions")
        .select("id, topics, status")
        .eq("id", sessionId)
        .maybeSingle();

      if (!oturum) {
        return NextResponse.json({ hata: "Oturum bulunamadı." }, { status: 404 });
      }

      const { data: mevcut } = await supabase
        .from("ders_questions")
        .select("question, kind, position")
        .eq("session_id", sessionId)
        .order("position");

      const acikSorular = (mevcut ?? []).filter((s) => s.kind === "acik").map((s) => s.question);
      const sonrakiPozisyon = (mevcut ?? []).length;

      const {
        veri: uretilen,
        olcum: uretimOlcum,
        ham: uretimHam,
      } = await chatJsonOlculu<{
        coktan_secmeli?: UretilenCoktan[];
      }>({
        mesajlar: [
          {
            role: "system",
            content: coktanPrompt(
              hedef.coktan,
              (oturum.topics as string[]) ?? [],
              acikSorular
            ),
          },
          { role: "user", content: transkript },
        ],
        maxTokens: 32000,
      });

      const ozet: DenetimBirikimi = { duzeltilen: 0, elenen: 0, kayitlar: [] };
      // Şıkların TAMAMI ve hangisinin işaretlendiği gönderiliyor; şık metni ile
      // açıklama yine ayrı etiketli, çünkü denetimin hangisini düzelttiğini
      // söyleyebilmesi gerekiyor. Çeldiricilerin de gönderilme sebebi
      // DenetimGirdisi'nde açıklanıyor: onlar olmadan denetim yanlış
      // anahtarlanmış bir soruyu göremez.
      const girdi = (s: {
        question: string;
        choices: string[] | null;
        correct_index: number | null;
        explanation: string | null;
      }) => ({
        question: s.question,
        secenekler: s.choices ?? [],
        isaretli: s.correct_index ?? 0,
        aciklama: s.explanation ?? "",
      });

      // İki geçiş arasında paylaşılıyor: birinci geçişte anahtarı düzeltilen soruya
      // ikinci geçiş de itiraz ederse hakem yok demektir, o soru elenir.
      const anahtariDuzeltilen = new Set<unknown>();

      const dogrulama = coktanDogrula(uretilen.coktan_secmeli ?? [], sure, dizin);
      let coktan = dogrulama.sorular;

      const gecis1 = await denetimCalistir(
        "transkript", SORU_TRANSKRIPT_DENETIMI, coktan.map(girdi), transkript
      );
      coktan = coktanUygula(coktan, "transkript", gecis1.bulgular, ozet, anahtariDuzeltilen);

      const gecis2 = await denetimCalistir("olgu", SORU_OLGU_DENETIMI, coktan.map(girdi));
      coktan = coktanUygula(coktan, "olgu", gecis2.bulgular, ozet, anahtariDuzeltilen);

      coktan = coktan.slice(0, hedef.coktan);
      if (ozet.kayitlar.length) {
        console.warn("[ders] denetim (çoktan seçmeli):", ozet.kayitlar.map(logSatiri));
      }

      // Biçim şartına takılanlar denetime hiç girmedi; aiview'de görünmeleri için
      // kayıt listesine sebep etiketleriyle ekleniyor.
      for (const [sebep, adet] of Object.entries(dogrulama.bicimElenen)) {
        kaydet(ozet, "bicim", `${adet} soru`, { islem: "bicim-elendi", sebep });
      }

      const coktanTers =
        ozet.elenen > 0 ||
        Object.keys(dogrulama.bicimElenen).length > 0 ||
        gecis1.gecis.valf ||
        gecis2.gecis.valf;
      const coktanAdimi: DenetimAdimi = {
        adim: "coktan",
        uretilen: dogrulama.uretilen,
        bicimElenen: dogrulama.bicimElenen,
        hedef: hedef.coktan,
        nihai: coktan.length,
        uretimSn: uretimOlcum.sn,
        uretimGirdiToken: uretimOlcum.girdiToken,
        uretimCiktiToken: uretimOlcum.ciktiToken,
        uretimModeli: uretimOlcum.model,
        hamUretim: coktanTers ? hamKirp(uretimHam) : undefined,
        gecisler: [gecis1.gecis, gecis2.gecis],
        kayitlar: ozet.kayitlar,
      };

      if (coktan.length) {
        const { error } = await supabase.from("ders_questions").insert(
          coktan.map((s, i) => ({
            ...s,
            session_id: sessionId,
            video_id: videoId,
            position: sonrakiPozisyon + i,
          }))
        );
        if (error) throw new Error(`Sorular kaydedilemedi: ${error.message}`);
      }

      const toplam = sonrakiPozisyon + coktan.length;

      if (toplam < EN_AZ_SORU) {
        await supabase.from("ders_sessions").delete().eq("id", sessionId);
        throw new Error(
          "Bu videodan güvenilir soru üretilemedi. Altyazı çok bozuk olabilir; " +
            "başka bir video deneyebilir misin?"
        );
      }

      await supabase.from("ders_sessions").update({ status: "hazir" }).eq("id", sessionId);
      await denetimOzetiYaz(supabase, sessionId, ozet, coktanAdimi, true);

      return NextResponse.json({ sessionId, soruSayisi: toplam, coktanSayisi: coktan.length });
    }

    return NextResponse.json({ hata: "Geçersiz adım." }, { status: 400 });
  } catch (err) {
    return hataCevabi(err);
  }
}
