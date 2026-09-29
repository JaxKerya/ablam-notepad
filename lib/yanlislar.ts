// Yanlışlarım — aralıklı tekrar (Leitner kutuları).
//
// Neden: ölçüldü (28.09.2026), 2046 cevabın içinde yalnızca 1 soru ikinci kez
// cevaplanmıştı. Ablamın yanlış yaptığı ~500 soru bir daha karşısına hiç
// çıkmıyordu; pratik de soruyu "en uzun süredir görülmeyene" göre seçiyor,
// doğru/yanlış geçmişine bakmıyor.
//
// Kural (sade, ekranda anlatılabilir):
//   yanlış / pas      -> ertesi gün tekrar
//   doğru             -> AYNI GÜN, araya birkaç soru girdikten sonra yine sorulur
//   beşinci doğru     -> ÖĞRENİLDİ, sistemden çıkar
//   herhangi bir yanlış -> sayaç başa döner
// Yani bir soru üst üste beş kez doğru yapılınca öğrenilmiş sayılıyor; beşi aynı
// günde olabilir (kullanıcı isteği, 29.09.2026). Aralıklar YANLIS_ARALIK_GUN'de,
// aynı gün içindeki boşluk YANLIS_ARA_SORU'da.
//
// DURUM SAKLANMIYOR, CEVAP GEÇMİŞİNDEN HESAPLANIYOR. Ayrı bir "kutu" kolonu,
// cevaplarla senkron tutulması gereken ikinci bir doğru kaynağı olurdu. Cevap
// nereden gelirse gelsin (ders, pratik, deneme, yanlış tekrarı) kutuyu etkiler:
// ablam denemede o soruyu doğru yaparsa bu da bir tekrar sayılır.
//
// "Kök" soru: kopyalar kaynak_soru_id ile asıl soruya bağlı; aynı sorunun ders,
// pratik ve deneme cevapları tek geçmişte birleşiyor.

/**
 * Her kutunun bekleme süresi (gün); kutu sayısı = öğrenmek için gereken doğru sayısı.
 * 1. kutu (yanlıştan sonra) 1 gün, doğrudan sonrakiler 0 gün: aynı gün yine vadeli.
 */
// 1-3-7 idi, sonra 1-2-3, sonra her gün üç doğru (28.09.2026). 29.09.2026: beş
// doğru ve beşi aynı gün olabilir.
export const YANLIS_ARALIK_GUN = [1, 0, 0, 0, 0] as const;

/**
 * Aynı gün içinde bir sorunun yeniden sorulması için araya girmesi gereken
 * başka soru sayısı. Hemen arkasından gelirse az önce gördüğü cevabı hatırlar,
 * bildiği için değil. Başka vadeli soru kalmadıysa beklemeden yine gelir.
 */
export const YANLIS_ARA_SORU = 4;

/** Kuralın tek cümlelik anlatımı (kategori başlığındaki açıklama, oturum özeti) */
export function yanlisKuraliMetni(): string {
  return `Yanlış yaptığın soru ertesi gün gelir. Doğru yaparsan aynı gün birkaç soru sonra yine sorulur; üst üste ${YANLIS_ARALIK_GUN.length} kez doğru yapınca öğrenilmiş sayılır. Arada yanlış yaparsan sayaç sıfırlanır.`;
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
  /** 1..YANLIS_ARALIK_GUN.length */
  kutu: number;
  /** Son cevabın zamanı (ms) */
  son: number;
  /** Türkiye günü indeksi: bu günden itibaren tekrar zamanı gelmiş */
  vadeGunu: number;
  /** Bu sorunun toplam yanlış sayısı (öncelik için) */
  yanlisSayisi: number;
}

export interface YanlisOzeti {
  /** Hâlâ sistemde (henüz öğrenilmemiş) olanlar */
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

/**
 * Günün oturumunda sıradaki soru(lar). `vadeli` vadesiGelenler'den (o dersin),
 * `sonSira` kök -> bu oturumda en son sorulduğu sıra, `enSonSira` oturumun son sırası.
 *
 *   1. Bu oturumda sorulmuş ve araya YANLIS_ARA_SORU başka soru girmiş olanlar,
 *      en önce sorulan önde: yeni soru açmadan eldekiler beşe tamamlansın.
 *   2. Bugün hiç sorulmamışlar (vadesiGelenler sırasıyla).
 *   3. İkisi de yoksa boşluk dolmasa da sorulmuşların en eskisi; gün bitmesin.
 */
export function oturumSirasi(
  vadeli: YanlisDurumu[],
  sonSira: Map<string, number>,
  enSonSira: number
): YanlisDurumu[] {
  const eskidenYeniye = (a: YanlisDurumu, b: YanlisDurumu) => (sonSira.get(a.kok) ?? 0) - (sonSira.get(b.kok) ?? 0);
  const donenler = vadeli
    .filter((d) => sonSira.has(d.kok) && enSonSira - sonSira.get(d.kok)! >= YANLIS_ARA_SORU)
    .sort(eskidenYeniye);
  const yeniler = vadeli.filter((d) => !sonSira.has(d.kok));
  const sira = [...donenler, ...yeniler];
  return sira.length ? sira : vadeli.filter((d) => sonSira.has(d.kok)).sort(eskidenYeniye);
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
