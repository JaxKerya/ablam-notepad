// Yanlışlarım — aralıklı tekrar (Leitner kutuları).
//
// Neden: ölçüldü (28.09.2026), 2046 cevabın içinde yalnızca 1 soru ikinci kez
// cevaplanmıştı. Ablamın yanlış yaptığı ~500 soru bir daha karşısına hiç
// çıkmıyordu; pratik de soruyu "en uzun süredir görülmeyene" göre seçiyor,
// doğru/yanlış geçmişine bakmıyor.
//
// Kural (sade, ekranda anlatılabilir):
//   yanlış / pas      -> ertesi gün tekrar
//   doğru             -> ertesi gün yine sorulur
//   üçüncü doğru      -> ÖĞRENİLDİ, sistemden çıkar
//   herhangi bir yanlış -> sayaç başa döner
// Yani bir soru üst üste üç kez, her biri ayrı günde doğru yapılınca öğrenilmiş
// sayılıyor. Aralıklar YANLIS_ARALIK_GUN'de; ekrandaki cümleler oradan üretiliyor.
//
// DURUM SAKLANMIYOR, CEVAP GEÇMİŞİNDEN HESAPLANIYOR. Ayrı bir "kutu" kolonu,
// cevaplarla senkron tutulması gereken ikinci bir doğru kaynağı olurdu. Cevap
// nereden gelirse gelsin (ders, pratik, deneme, yanlış tekrarı) kutuyu etkiler:
// ablam denemede o soruyu doğru yaparsa bu da bir tekrar sayılır.
//
// "Kök" soru: kopyalar kaynak_soru_id ile asıl soruya bağlı; aynı sorunun ders,
// pratik ve deneme cevapları tek geçmişte birleşiyor.

/** 1., 2. ve 3. kutunun bekleme süresi (gün) */
// 1-3-7 idi, sonra 1-2-3; kullanıcı isteğiyle her gün (28.09.2026): üst üste üç
// günde üç doğru yeter. Sayı değişirse ekran metinleri aşağıdaki fonksiyonlardan
// kendiliğinden uyar.
export const YANLIS_ARALIK_GUN = [1, 1, 1] as const;

const hepsiBirGun = YANLIS_ARALIK_GUN.every((g) => g === 1);

/** Kuralın tek cümlelik anlatımı (kategori başlığındaki açıklama, oturum özeti) */
export function yanlisKuraliMetni(): string {
  const n = YANLIS_ARALIK_GUN.length;
  return hepsiBirGun
    ? `Yanlış yaptığın soru ertesi gün gelir ve her gün yeniden sorulur; üst üste ${n} kez, her biri ayrı günde doğru yapınca öğrenilmiş sayılır.`
    : `Yanlış yaptığın soru ertesi gün, sonra ${YANLIS_ARALIK_GUN.slice(1).join(" ve ")} gün arayla geri gelir; üst üste ${n} kez doğru yapınca öğrenilmiş sayılır.`;
}

/** Doğru cevaptan sonra sorunun ne zaman döneceği ("yarın" / "2 ya da 3 gün sonra") */
export function dogruSonrasiMetni(): string {
  return hepsiBirGun ? "yarın" : `${YANLIS_ARALIK_GUN.slice(1).join(" ya da ")} gün sonra`;
}

export type Verdict = "dogru" | "yanlis" | "pas" | "eksik";

export interface KokCevap {
  /** Kök soru kimliği (kopyada kaynak_soru_id, asıl soruda kendi id'si) */
  kok: string;
  verdict: string | null;
  /** ms */
  zaman: number;
}

export interface YanlisDurumu {
  kok: string;
  /** 1, 2 ya da 3 */
  kutu: number;
  /** Son cevabın zamanı (ms) */
  son: number;
  /** Türkiye günü indeksi: bu günden itibaren tekrar zamanı gelmiş */
  vadeGunu: number;
  /** Bu sorunun toplam yanlış sayısı (öncelik için) */
  yanlisSayisi: number;
}

export interface YanlisOzeti {
  /** Hâlâ sistemde (1-3. kutu) olanlar */
  aktif: Map<string, YanlisDurumu>;
  /** En az bir kez yanlış yapılıp sonra öğrenilenler */
  ogrenilen: Set<string>;
}

/**
 * Türkiye günü: UTC+3, yaz saati yok. "Ertesi gün" = gece yarısından itibaren,
 * 24 saat sonra değil — akşam 23'te yapılan yanlış sabah karşısında olsun.
 */
export const turkiyeGunu = (ms: number) => Math.floor((ms + 3 * 3_600_000) / 86_400_000);

const bilemedi = (v: string | null) => v === "yanlis" || v === "pas" || v === "eksik";

/** Cevap geçmişinden her kök sorunun kutusunu çıkarır. Sıra önemli değil; burada sıralanıyor. */
export function yanlisDurumlari(cevaplar: KokCevap[]): YanlisOzeti {
  const kokler = new Map<string, KokCevap[]>();
  for (const c of cevaplar) {
    if (!c.verdict || !Number.isFinite(c.zaman)) continue;
    const l = kokler.get(c.kok);
    if (l) l.push(c);
    else kokler.set(c.kok, [c]);
  }

  const aktif = new Map<string, YanlisDurumu>();
  const ogrenilen = new Set<string>();
  for (const [kok, liste] of kokler) {
    liste.sort((a, b) => a.zaman - b.zaman);
    let kutu = 0;
    let son = 0;
    let yanlisSayisi = 0;
    let hicYanlis = false;
    for (const c of liste) {
      if (bilemedi(c.verdict)) {
        kutu = 1;
        son = c.zaman;
        yanlisSayisi++;
        hicYanlis = true;
      } else if (c.verdict === "dogru" && kutu > 0) {
        kutu++;
        son = c.zaman;
        if (kutu > YANLIS_ARALIK_GUN.length) kutu = 0; // öğrenildi
      }
      // Hiç yanlışı olmayan sorunun doğrusu sistemi ilgilendirmiyor
    }
    if (kutu > 0) {
      aktif.set(kok, {
        kok,
        kutu,
        son,
        vadeGunu: turkiyeGunu(son) + YANLIS_ARALIK_GUN[kutu - 1],
        yanlisSayisi,
      });
    } else if (hicYanlis) {
      ogrenilen.add(kok);
    }
  }
  return { aktif, ogrenilen };
}

/** Bugün (ya da daha önce) tekrar zamanı gelmişler, öncelik sırasıyla */
export function vadesiGelenler(aktif: Map<string, YanlisDurumu>, simdi: number): YanlisDurumu[] {
  const bugun = turkiyeGunu(simdi);
  return [...aktif.values()]
    .filter((d) => d.vadeGunu <= bugun)
    .sort(
      (a, b) =>
        // Önce en çok gecikmiş, sonra taze yanlış (düşük kutu), sonra çok yanlışlanan
        a.vadeGunu - b.vadeGunu || a.kutu - b.kutu || b.yanlisSayisi - a.yanlisSayisi
    );
}
