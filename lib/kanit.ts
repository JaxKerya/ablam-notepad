// Ablam Ders — "Hoca ne demişti?": cevabın transkriptteki kanıtını bulur.
//
// Sistemin en büyük riski yanlış cevap anahtarı: ablama doğrudan yanlış bilgi
// öğretir. İki katmanlı denetim bunu azaltıyor ama sıfırlamıyor ve ablamın
// elinde doğrulama yolu yok — cevaba inanmak zorunda. Bu modül o boşluğu
// kapatıyor: cevabın dayandığı cümleleri dersin kendi transkriptinden çıkarıp
// gösteriyor.
//
// MODEL ÇAĞRISI YOK. Eşleştirme tamamen sözcüksel; maliyeti sıfır ve gecikmesi
// milisaniye. Model kullanmak burada zaten yanlış olurdu: kanıtı üreten model,
// kanıtladığı cevabı da üretmiş olur.
//
// TEMEL KURAL: EMİN DEĞİLSEN GÖSTERME. Yanlış bir cümleyi "hoca böyle demişti"
// diye sunmak, hiçbir şey göstermemekten kötüdür — ablam ona güvenir.

import type { Segment } from "@/lib/ders";

/** Aramada işe yaramayan, her cümlede geçen kelimeler */
const ETKISIZ = new Set([
  "için", "gibi", "daha", "olan", "olarak", "sonra", "önce", "kadar", "fakat",
  "yani", "şey", "vardı", "oldu", "olur", "eden", "diye", "ancak", "böyle",
  "şöyle", "burada", "orada", "bunu", "şunu", "onun", "bunun", "kendi", "büyük",
  "küçük", "yeni", "eski", "başka", "bütün", "hem", "veya", "ise", "iken",
  "arkadaşlar", "tamam", "evet", "hayır", "bakın", "mesela", "yani",
]);

/**
 * Türkçe için sadeleştirme: küçük harf + aksan katlama.
 * Uzunluk korunmuyor; vurgu indeksleri ayrı hesaplanıyor (bkz. vurgulariBul).
 */
function sade(metin: string): string {
  return metin
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Metni anlamlı kelimelere ayırır. En az 4 harf: daha kısaları hem etkisiz
 * kelimeler hem de yanlış eşleşme kaynağı.
 */
export function anahtarKelimeler(metin: string): string[] {
  return [
    ...new Set(
      sade(metin)
        .split(/[^a-z0-9]+/)
        .filter((k) => k.length >= 4 && !ETKISIZ.has(k))
    ),
  ];
}

/**
 * İki kelime aynı kökten mi? Türkçe sondan eklemeli olduğu için birebir
 * karşılaştırma "iltizam" ile "iltizamın"ı kaçırır. Biri diğerinin başlangıcı
 * ise ve ortak kısım en az 5 harfse (kısa kelimelerde 4) eşleşmiş sayılıyor.
 */
function ayniKok(a: string, b: string): boolean {
  if (a === b) return true;
  const kisa = a.length <= b.length ? a : b;
  const uzun = a.length <= b.length ? b : a;
  if (!uzun.startsWith(kisa)) return false;
  return kisa.length >= (uzun.length - kisa.length > 4 ? 6 : 4);
}

export interface Kanit {
  /** Kanıtın videodaki başlangıç anı (saniye) */
  saniye: number;
  metin: string;
  /** Eşleşen kelimelerin `metin` içindeki yerleri — arayüz burayı vurguluyor */
  vurgular: { bas: number; uzunluk: number }[];
  /** Kaç anahtar kelime tutturuldu / kaç aranıyordu */
  isabet: number;
  aranan: number;
}

/** Bir pencerede geçen anahtar kelimeleri bulur */
function eslesenler(parca: string, hedefler: string[]): Set<string> {
  const kelimeler = sade(parca).split(/[^a-z0-9]+/).filter(Boolean);
  const bulunan = new Set<string>();
  for (const h of hedefler) {
    if (kelimeler.some((k) => ayniKok(k, h))) bulunan.add(h);
  }
  return bulunan;
}

/** Vurgulanacak kelimelerin ORİJİNAL metindeki yerleri */
function vurgulariBul(metin: string, hedefler: string[]): { bas: number; uzunluk: number }[] {
  const sonuc: { bas: number; uzunluk: number }[] = [];
  const desen = /[\p{L}\p{N}]+/gu;
  for (const e of metin.matchAll(desen)) {
    const kelime = sade(e[0]);
    if (kelime.length < 4) continue;
    if (hedefler.some((h) => ayniKok(kelime, h))) {
      sonuc.push({ bas: e.index ?? 0, uzunluk: e[0].length });
    }
  }
  return sonuc;
}

/**
 * Kelime ağırlıkları: derste SIK geçen kelime ayırt edici değildir.
 *
 * Ölçüm sırasında çıktı: "deniz meltemi gündüzleri" sorusuna, dersin GECE
 * anlatan bölümü kanıt olarak geliyordu. Sebebi kelime sayısıyla puanlamaktı —
 * iki bölüm de "deniz", "kara", "basınç", "rüzgar" kelimelerini paylaşıyor.
 * Ayıran kelime "gündüz"; o da derste birkaç kez geçiyor, yani NADİR. Ağırlık
 * nadirliğe göre veriliyor (klasik ters belge frekansı).
 */
function agirliklar(
  segments: Segment[],
  hedefler: string[]
): { agirlik: Map<string, number>; gecis: Map<string, number> } {
  const gecis = new Map<string, number>();
  for (const h of hedefler) gecis.set(h, 0);
  for (const s of segments) {
    const kelimeler = sade(s.t).split(/[^a-z0-9]+/).filter(Boolean);
    for (const h of hedefler) {
      if (kelimeler.some((k) => ayniKok(k, h))) gecis.set(h, (gecis.get(h) ?? 0) + 1);
    }
  }
  const agirlik = new Map<string, number>();
  for (const h of hedefler) {
    agirlik.set(h, 1 / Math.log(2 + (gecis.get(h) ?? 0)));
  }
  return { agirlik, gecis };
}

/**
 * Kanıt penceresi. Otomatik altyazı parçaları çok kısa (2-4 saniye), tek parça
 * bir cümle bile taşımıyor; bu yüzden ardışık parçalar birleştirilerek taranıyor.
 */
const PENCERE_PARCA = 8;
/** Damganın etrafında kaç saniye taranacak — damga modelden geliyor, kayabilir */
const ONCE_SN = 90;
const SONRA_SN = 120;

/**
 * Eşiğin altındaki en iyi pencere KANIT SAYILMIYOR. Ölçülerek belirlendi:
 * 2 kelimenin altında kalan eşleşmeler konuyla ilgisiz cümleler çıkarıyordu.
 */
export const EN_AZ_ISABET = 2;
export const EN_AZ_ORAN = 0.34;

export function kanitBul(
  segments: Segment[],
  damga: number,
  hedefMetin: string
): Kanit | null {
  const hedefler = anahtarKelimeler(hedefMetin);
  if (!segments.length || hedefler.length < 2) return null;

  const bas = (damga - ONCE_SN) * 1000;
  const son = (damga + SONRA_SN) * 1000;
  const pencere = segments.filter((s) => s.o >= bas && s.o <= son);
  if (!pencere.length) return null;

  const { agirlik, gecis } = agirliklar(segments, hedefler);
  // En ayırt edici üç kelime: doğru bölüm bunlardan en az birini içermeli.
  // "Gündüz" ile "gece" bölümlerini ancak bu ayırıyor.
  //
  // DERSTE HİÇ GEÇMEYEN kelimeler bu sıralamanın DIŞINDA. İlk sürümde
  // değillerdi ve en yüksek ağırlığı onlar alıyordu (geçiş sayısı sıfır =
  // en nadir); şart hiçbir pencerede sağlanamayınca kanıt oranı %44'ten
  // %3'e düştü. Eşleşmesi mümkün olmayan kelime ayırt edici olamaz.
  const ayirtEdiciler = hedefler
    .filter((h) => (gecis.get(h) ?? 0) > 0)
    .sort((a, b) => (agirlik.get(b) ?? 0) - (agirlik.get(a) ?? 0))
    .slice(0, 3);

  let enIyi: { i: number; j: number; isabet: Set<string>; puan: number } | null = null;

  for (let i = 0; i < pencere.length; i++) {
    for (let j = i; j < Math.min(i + PENCERE_PARCA, pencere.length); j++) {
      const dilimler = pencere.slice(i, j + 1);
      const parca = dilimler.map((s) => s.t).join(" ");
      const bulunan = eslesenler(parca, hedefler);
      if (!bulunan.size) continue;

      // Puan = ağırlıklı isabet / uzunluk cezası. Uzunluk cezası olmadan
      // "hepsini kapsayan en uzun pencere" kazanıyor ve içine alakasız
      // cümleler doluyordu.
      const agirlikliIsabet = [...bulunan].reduce((t, k) => t + (agirlik.get(k) ?? 0), 0);
      const kelimeSayisi = parca.split(/\s+/).length;
      const puan = agirlikliIsabet / Math.sqrt(Math.max(kelimeSayisi, 12));

      if (!enIyi || puan > enIyi.puan) enIyi = { i, j, isabet: bulunan, puan };
    }
  }

  if (!enIyi) return null;

  // AYIRT EDİCİ ŞARTI: pencere, en nadir üç kelimeden en az birini içermeli.
  if (ayirtEdiciler.length && !ayirtEdiciler.some((k) => enIyi!.isabet.has(k))) return null;
  if (enIyi.isabet.size < EN_AZ_ISABET) return null;
  // ORAN, EŞLEŞMESİ MÜMKÜN kelimeler üzerinden. Cevabın kelimelerinin bir kısmı
  // derste hiç geçmiyor (model kendi cümlesiyle yazıyor); onları paydaya koymak
  // uzun açıklamalı soruları haksız yere eliyordu — kapsama %17'de kalıyordu.
  const eslesebilir = hedefler.filter((h) => (gecis.get(h) ?? 0) > 0);
  if (!eslesebilir.length) return null;
  if (enIyi.isabet.size / eslesebilir.length < EN_AZ_ORAN) return null;

  // KENARLARI BUDA: eşleşme içermeyen baştaki ve sondaki parçalar atılıyor.
  // Buda(n)madan "bakırları sattırmış" gibi alakasız cümlelerle başlıyordu.
  let bastan = enIyi.i;
  let sondan = enIyi.j;
  const eslesiyorMu = (s: Segment) => eslesenler(s.t, hedefler).size > 0;
  while (bastan < sondan && !eslesiyorMu(pencere[bastan])) bastan++;
  while (sondan > bastan && !eslesiyorMu(pencere[sondan])) sondan--;

  // Kenarlara birer parça daha: budanmış metin cümlenin ortasında başlayıp
  // ortasında bitiyordu ("…o raporlara ne"). Bir parça ~3 saniye, yani bağlam
  // katıyor ama alakasız bölüm getirmiyor.
  const secilen = pencere.slice(Math.max(0, bastan - 1), Math.min(pencere.length, sondan + 2));
  const metin = secilen.map((s) => s.t).join(" ").replace(/\s+/g, " ").trim();

  return {
    saniye: Math.round(secilen[0].o / 1000),
    metin,
    vurgular: vurgulariBul(metin, hedefler),
    isabet: enIyi.isabet.size,
    aranan: eslesebilir.length,
  };
}
