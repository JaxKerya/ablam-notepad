// Çalıştırma: npx tsx --tsconfig tsconfig.json --test tests/ders/oncul.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aciklamaNumaralariniEsle,
  kombinasyonMaskesi,
  onculBlogunuBul,
  onculDagilimi,
  onculDengele,
  tohumluRastgele,
  type OnculSoru,
} from "../../lib/oncul";

const SIKLAR = ["Yalnız I", "Yalnız II", "I ve II", "I ve III", "I, II ve III"];

const ORNEK: OnculSoru = {
  soru: [
    "Tımar sisteminin bozulmasının;",
    "I. Sipahi sayısının azalması",
    "II. Kırsaldan kente göçün hızlanması",
    "III. Kapıkulu askerlerinin kısıtlanması",
    "gelişmelerinden hangilerine yol açtığı söylenebilir?",
  ].join("\n"),
  secenekler: SIKLAR,
  dogruIndeks: 2,
  aciklama: "Bu yüzden I ve II doğru, III yanlıştır.",
};

/** Bir şıkkın işaret ettiği öncül METİNLERİ: anlam bu kümede duruyor */
function sikMetinleri(soru: string, sik: string): string[] {
  const blok = onculBlogunuBul(soru);
  assert.ok(blok, "öncül bloğu bulunamadı");
  const maske = kombinasyonMaskesi(sik);
  assert.notEqual(maske, null);
  return blok.icerikler.filter((_, i) => (maske as number) & (1 << i)).sort();
}

/** Permütasyonu belirleyen tohumlar: altı permütasyonun her biri için bir tohum */
function permutasyonTohumlari(girdi: OnculSoru = ORNEK): Map<string, string> {
  const harita = new Map<string, string>();
  for (let i = 0; i < 500 && harita.size < 6; i++) {
    const p = onculDengele(girdi, { rastgele: tohumluRastgele(`t${i}`) }).permutasyon;
    if (p && !harita.has(p.join())) harita.set(p.join(), `t${i}`);
  }
  assert.equal(harita.size, 6);
  return harita;
}

test("Blok: marker'a benzeyen ilk satır kök olarak kalır, son üçlü bulunur", () => {
  for (const ilk of ["II. Mahmut'un ıslahatlarıyla ilgili;", "I. Dünya Savaşı'nın sonuçlarıyla ilgili;"]) {
    const soru = `${ilk}\nI. Birinci içerik\nII. İkinci içerik\nIII. Üçüncü içerik\nyargılarından hangileri doğrudur?`;
    const blok = onculBlogunuBul(soru);
    assert.equal(blok?.baslangic, 1);
    assert.deepEqual(blok?.icerikler, ["Birinci içerik", "İkinci içerik", "Üçüncü içerik"]);

    const r = onculDengele({ soru, secenekler: SIKLAR, dogruIndeks: 2, aciklama: null }, { rastgele: tohumluRastgele("a") });
    assert.equal(r.durum, "karistirildi");
    assert.equal(r.soru.split("\n")[0], ilk, "kök satırı yerinde kalmalı");
    const satirlar = r.soru.split("\n");
    assert.match(satirlar[1], /^I\. /);
    assert.match(satirlar[2], /^II\. /);
    assert.match(satirlar[3], /^III\. /);
  }
});

test("Blok: işaret biçimi ve satır sonu noktalaması konumda kalır", () => {
  const soru = "Kök;\nI) Bir,\nII) İki ve\nIII) Üç\nhangileri?";
  const tohum = [...permutasyonTohumlari({ soru, secenekler: SIKLAR, dogruIndeks: 2, aciklama: null }).entries()].find(
    ([p]) => p === "2,0,1"
  )?.[1];
  assert.ok(tohum);
  const r = onculDengele({ soru, secenekler: SIKLAR, dogruIndeks: 2, aciklama: null }, { rastgele: tohumluRastgele(tohum) });
  assert.equal(r.soru, "Kök;\nI) İki,\nII) Üç ve\nIII) Bir\nhangileri?");
});

test('Öncül içindeki "II. Mahmut" taşınır, numarası bozulmaz, gönderme sayılmaz', () => {
  const soru = "Islahatlarla ilgili;\nI. II. Mahmut döneminde başladı\nII. III. Selim döneminde kuruldu\nIII. Tanzimat'la bitti\nhangileri doğrudur?";
  const hepsi = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const r = onculDengele({ soru, secenekler: SIKLAR, dogruIndeks: 0, aciklama: null }, { rastgele: tohumluRastgele(`m${i}`) });
    assert.equal(r.durum, "karistirildi");
    const blok = onculBlogunuBul(r.soru);
    assert.deepEqual([...(blok?.icerikler ?? [])].sort(), ["II. Mahmut döneminde başladı", "III. Selim döneminde kuruldu", "Tanzimat'la bitti"]);
    hepsi.add(r.soru);
  }
  assert.equal(hepsi.size, 6);
});

test("Her permütasyonda anlam korunur: doğru şıkkın gösterdiği öncül metinleri aynı", () => {
  const girdiler = SIKLAR.map((_, dogruIndeks) => ({ ...ORNEK, dogruIndeks, aciklama: null }));
  for (const girdi of girdiler) {
    const beklenen = sikMetinleri(girdi.soru, girdi.secenekler[girdi.dogruIndeks]);
    for (const [, tohum] of permutasyonTohumlari(girdi)) {
      const r = onculDengele(girdi, { rastgele: tohumluRastgele(tohum) });
      assert.deepEqual(sikMetinleri(r.soru, r.secenekler[r.dogruIndeks]), beklenen);
    }
  }
});

test("Şıklar: beş ayrı, kanonik, sınav sırasında; çeldirici doğruya eşit değil", () => {
  const SIRA = ["Yalnız I", "Yalnız II", "Yalnız III", "I ve II", "I ve III", "II ve III", "I, II ve III"];
  for (let i = 0; i < 300; i++) {
    const r = onculDengele(ORNEK, { rastgele: tohumluRastgele(`s${i}`) });
    assert.equal(new Set(r.secenekler).size, 5);
    assert.ok(r.secenekler.every((s) => SIRA.includes(s)));
    const siralar = r.secenekler.map((s) => SIRA.indexOf(s));
    assert.deepEqual(siralar, [...siralar].sort((a, b) => a - b));
    assert.equal(r.secenekler.filter((s) => s === r.secenekler[r.dogruIndeks]).length, 1);
    assert.ok(r.dogruIndeks >= 0 && r.dogruIndeks < 5);
  }
});

test("İstatistik: permütasyon ve çeldirici çekilişi düzgün dağılıyor (tohumlu)", () => {
  const N = 6000;
  const perm = new Map<string, number>();
  const ikili = new Map<string, number>();
  const celdirici = new Map<string, number>();
  const rastgele = tohumluRastgele("istatistik");
  const girdi = { ...ORNEK, aciklama: null };
  for (let i = 0; i < N; i++) {
    const r = onculDengele(girdi, { rastgele });
    const anahtar = (r.permutasyon as number[]).join();
    perm.set(anahtar, (perm.get(anahtar) ?? 0) + 1);
    const dogru = r.secenekler[r.dogruIndeks];
    ikili.set(dogru, (ikili.get(dogru) ?? 0) + 1);
    r.secenekler.forEach((s, j) => {
      if (j !== r.dogruIndeks) celdirici.set(`${dogru}|${s}`, (celdirici.get(`${dogru}|${s}`) ?? 0) + 1);
    });
  }
  // Ki-kare: 5 serbestlik derecesinde %99,9 eşiği 20,5
  const kiKare = [...perm.values()].reduce((t, g) => t + (g - N / 6) ** 2 / (N / 6), 0);
  assert.equal(perm.size, 6);
  assert.ok(kiKare < 20.5, `ki-kare ${kiKare}`);

  // Kaynak iki doğrulu; üç ikili eşit paylaşmalı, başka doğru gelmemeli
  assert.deepEqual([...ikili.keys()].sort(), ["I ve II", "I ve III", "II ve III"]);
  for (const adet of ikili.values()) assert.ok(Math.abs(adet - N / 3) < 200, `ikili ${adet}`);

  // Doğru sabitken her çeldirici 4/6 olasılıkla listede
  for (const [dogru, adet] of ikili) {
    for (const s of ["Yalnız I", "Yalnız II", "Yalnız III", "I ve II", "I ve III", "II ve III", "I, II ve III"]) {
      if (s === dogru) continue;
      const oran = (celdirici.get(`${dogru}|${s}`) ?? 0) / adet;
      assert.ok(Math.abs(oran - 2 / 3) < 0.06, `${dogru} / ${s}: ${oran}`);
    }
  }
});

test("Zorunlu şıklar eşlenerek listeye girer, cevap yeni indeksine taşınır", () => {
  for (let i = 0; i < 200; i++) {
    const r = onculDengele(ORNEK, { rastgele: tohumluRastgele(`z${i}`), zorunluSiklar: ["Yalnız I", "I, II ve III"] });
    assert.equal(r.durum, "karistirildi");
    const birli = r.eskidenYeniye[SIKLAR.indexOf("Yalnız I")];
    const uclu = r.eskidenYeniye[SIKLAR.indexOf("I, II ve III")];
    assert.notEqual(birli, null);
    assert.notEqual(uclu, null);
    assert.deepEqual(sikMetinleri(r.soru, r.secenekler[birli as number]), ["Sipahi sayısının azalması"]);
    assert.equal(r.secenekler[uclu as number], "I, II ve III");
    assert.equal(r.eskidenYeniye[ORNEK.dogruIndeks], r.dogruIndeks);
  }
});

test("Zorunlu şıklar beş yuvaya sığmıyorsa dokunulmaz", () => {
  const r = onculDengele(
    { ...ORNEK, secenekler: ["Yalnız I", "Yalnız II", "Yalnız III", "I ve II", "I, II ve III"], dogruIndeks: 0 },
    { zorunluSiklar: ["Yalnız II", "Yalnız III", "I ve II", "I ve III", "II ve III"] }
  );
  assert.equal(r.durum, "atlandi");
  assert.equal(r.sebep, "zorunlu-sik-fazla");
});

// perm[eski] = yeni: I -> III, II -> I, III -> II
const P = [2, 0, 1];
const es = (m: string, perm: number[] = P) => aciklamaNumaralariniEsle(m, perm);

test("Açıklama: gönderme kalıpları eşlenir", () => {
  const kaliplar: [string, string][] = [
    ["Bu nedenle III. yargı yanlıştır.", "Bu nedenle II. yargı yanlıştır."],
    ["bu yüzden II yanlıştır.", "bu yüzden I yanlıştır."],
    ["Bu yüzden I ve II doğru, III yanlıştır.", "Bu yüzden I ve III doğru, II yanlıştır."],
    ["II ve III'e ulaşamazsın.", "I ve II'ye ulaşamazsın."],
    ["II. öncül bu döneme ait değildir.", "I. öncül bu döneme ait değildir."],
    ["Yalnız I bu döneme aittir.", "Yalnız III bu döneme aittir."],
    ["Doğru cevap Yalnız II.", "Doğru cevap Yalnız I."],
    ["doğru olan I ve II'dir.", "doğru olan I ve III'tür."],
    ["bu da III'ü yanlış yapar.", "bu da II'yi yanlış yapar."],
    ["(I ve III); ancak", "(II ve III); ancak"],
    ["I., II. ve III. yargılar doğrudur.", "I., II. ve III. yargılar doğrudur."],
    ["III. ifade yanlıştır.", "II. ifade yanlıştır."],
    ["II ise bir tuzak.", "I ise bir tuzak."],
    ["I ve III. Çünkü II geçersiz.", "II ve III. Çünkü I geçersiz."],
    ["üçüncü yargı yanlıştır.", "ikinci yargı yanlıştır."],
    ["Üçüncü öncül yanlıştır.", "İkinci öncül yanlıştır."],
  ];
  for (const [girdi, beklenen] of kaliplar) {
    const r = es(girdi);
    assert.equal(r.belirsiz, false, girdi);
    assert.equal(r.metin, beklenen);
  }
});

test("Açıklama: tek geçiş, çift eşleme ve sırasız zincir yok", () => {
  // I -> II, II -> III, III -> I: art arda replace olsaydı hepsi I'de toplanırdı
  const r = aciklamaNumaralariniEsle("I doğru, II yanlış, III de yanlış.", [1, 2, 0]);
  assert.equal(r.metin, "II doğru, III yanlış, I de yanlış.");
  assert.equal(aciklamaNumaralariniEsle("I ve II doğrudur.", [2, 0, 1]).metin, "I ve III doğrudur.");
});

test("Açıklama: Türkçe ek numaraya uyar", () => {
  const altiya = (ek: string, deger: 0 | 1 | 2, hedef: 0 | 1 | 2) => {
    const roma = ["I", "II", "III"];
    const perm = [0, 1, 2];
    perm[deger] = hedef;
    perm[hedef] = deger;
    return aciklamaNumaralariniEsle(`${roma[deger]}'${ek} bak.`, perm).metin;
  };
  assert.equal(altiya("e", 0, 1), "II'ye bak.");
  assert.equal(altiya("ye", 1, 2), "III'e bak.");
  assert.equal(altiya("e", 2, 0), "I'e bak.");
  assert.equal(altiya("dir", 0, 2), "III'tür bak.");
  assert.equal(altiya("tür", 2, 1), "II'dir bak.");
  assert.equal(altiya("i", 0, 1), "II'yi bak.");
  assert.equal(altiya("yi", 1, 2), "III'ü bak.");
  assert.equal(altiya("ü", 2, 0), "I'i bak.");
  assert.equal(altiya("in", 0, 1), "II'nin bak.");
  assert.equal(altiya("de", 1, 2), "III'te bak.");
  assert.equal(altiya("ten", 2, 0), "I'den bak.");
  // Numara değişmeyen yuvada ek olduğu gibi kalır
  assert.equal(aciklamaNumaralariniEsle("II'ye bak.", [1, 0, 2]).metin, "I'e bak.");
  assert.equal(aciklamaNumaralariniEsle("III'e bak.", [1, 0, 2]).metin, "III'e bak.");
});

test("Açıklama: adlar ve sıra sayıları değişmez", () => {
  const adlar = [
    "II. Mahmut döneminde kuruldu.",
    "I. Dünya Savaşı sırasında başladı.",
    "III. Selim döneminde başlamış.",
    "Anayasayı II. TBMM kabul etmiştir.",
    "I. TBMM’nin benimsediği ilke.",
    "I. İnönü zaferinin sonucudur.",
    "II. Meşrutiyet ile açıldı.",
    "I. ve II. Dünya Savaşları arasında.",
    "II. yüzyılda yaşamıştır.",
    "I. derece deprem bölgesidir.",
    "II. grup ülkeler.",
    "III. bölgede yoğundur.",
    "XIII. yüzyılda Anadolu.",
    "XIII yazılmıştır.",
    "III'üncü sırada gelir.",
    "II'nci madde değil.",
    "IV. Murat dönemi.",
    "VI. yüzyıl.",
    "Birinci Dünya Savaşı sırasında başladı.",
    "İkinci Balkan Savaşı sonrasında imzalandı.",
    "Bu beylik ikinci dönem beyliğidir.",
    "Mektup birinci elden kaynaktır.",
    "Tarım birincil, sanayi ikincil sektördedir.",
  ];
  for (const a of adlar) {
    const r = es(a);
    assert.equal(r.belirsiz, false, a);
    assert.equal(r.metin, a);
  }
  const karisik = es("II. Mahmut dönemi nedeniyle III yanlıştır, I. Dünya Savaşı ise sonradır.");
  assert.equal(karisik.metin, "II. Mahmut dönemi nedeniyle II yanlıştır, I. Dünya Savaşı ise sonradır.");
});

test("Açıklama: sınıflandırılamayan numara belirsiz bayrağı verir, metin değişmez", () => {
  for (const a of [
    "II Mahmut döneminde başladı.",
    "III garip bir sözle sürer.",
    "İlk öncül doğrudur.",
    "Son ikisi yanlıştır.",
    "İkincisi ise yanlıştır.",
    "ikinci madde gereğince böyledir.",
    "Doğru cevap C şıkkıdır.",
    "Bu ıslahatı yapan Selim III.",
    "Birinci uygulama yasamayı, ikinci uygulama yürütmeyi birleştirir.",
    "İlk iki hüküm ise doğrudur.",
    "Bu üçüncü gerekçe derste geçmez.",
    "Bu I ve II sırasıyla Osmanlı ve Safevî'dir.",
    "II'lerde görülür.",
  ]) {
    const r = es(a);
    assert.equal(r.belirsiz, true, a);
    assert.equal(r.metin, a);
  }
});

test("Açıklama belirsizse soru karıştırılmaz ve bayrak döner", () => {
  const r = onculDengele({ ...ORNEK, aciklama: "III garip bir sözle sürer." }, { rastgele: tohumluRastgele("b") });
  assert.equal(r.durum, "atlandi");
  assert.equal(r.sebep, "aciklama-belirsiz");
  assert.equal(r.aciklamaBelirsiz, true);
  assert.equal(r.soru, ORNEK.soru);
  assert.deepEqual(r.secenekler, ORNEK.secenekler);
  assert.equal(r.dogruIndeks, ORNEK.dogruIndeks);
});

test("Tam akış: açıklama yeni numaralarla aynı öncülü anlatıyor", () => {
  for (const [, tohum] of permutasyonTohumlari()) {
    const r = onculDengele(ORNEK, { rastgele: tohumluRastgele(tohum) });
    // Açıklamanın "yanlış" dediği numara, kapıkulu öncülünün yeni numarası olmalı
    const blok = onculBlogunuBul(r.soru);
    const kapikulu = blok?.icerikler.findIndex((c) => c.startsWith("Kapıkulu"));
    const roma = ["I", "II", "III"][kapikulu as number];
    assert.match(r.aciklama ?? "", new RegExp(`doğru, ${roma} yanlıştır\\.$`));
  }
});

test("Dokunulmayanlar: girdi aynen döner, durum atlandi", () => {
  const ayni = (g: OnculSoru, sebep: string) => {
    const r = onculDengele(g, { rastgele: tohumluRastgele("x") });
    assert.equal(r.durum, "atlandi", sebep);
    assert.equal(r.sebep, sebep);
    assert.equal(r.soru, g.soru);
    assert.deepEqual(r.secenekler, g.secenekler);
    assert.equal(r.dogruIndeks, g.dogruIndeks);
    assert.equal(r.aciklama, g.aciklama);
    assert.equal(r.permutasyon, null);
  };
  ayni({ soru: "Başkent neresidir?", secenekler: ["Ankara", "İzmir", "Bursa", "Sivas", "Konya"], dogruIndeks: 0, aciklama: "III. Selim." }, "oncullu-degil");
  ayni({ soru: "(I) a (II) b (III) c", secenekler: ["I.", "II.", "III.", "IV.", "V."], dogruIndeks: 1, aciklama: null }, "oncullu-degil");
  ayni({ ...ORNEK, soru: "Kök: I. a II. b III. c hangileri?" }, "uclu-blok-yok");
  ayni({ ...ORNEK, soru: "Kök;\nI. a\nII. b\nhangileri?" }, "uclu-blok-yok");
  ayni({ ...ORNEK, soru: "Kök;\nI. a\nII. b\nIII. c\nIV. d\nhangileri?" }, "dort-oncul");
  ayni({ ...ORNEK, soru: "Kök;\nI. a\nII. b\nIII. c\nI ve II birlikte düşünülürse hangileri?" }, "kokte-gonderme");
  ayni({ ...ORNEK, soru: "Kök;\nI. a\nII. b\nIII. c\nII. öncül hariç hangileri?" }, "kokte-gonderme");
  ayni({ ...ORNEK, soru: "Kök;\nI. a\nII. I ve III'ün sonucudur\nIII. c\nhangileri?" }, "onculde-gonderme");
  ayni({ ...ORNEK, soru: "Kök;\nI. a\nII. Bunun sonucunda b oldu\nIII. c\nhangileri?" }, "oncul-bagimli");
  ayni({ ...ORNEK, secenekler: ["Yalnız I", "Yalnız I", "I ve II", "I ve III", "I, II ve III"] }, "gecersiz-sik");
  ayni({ ...ORNEK, secenekler: ["Yalnız I", "I ve II", "I ve III", "I, II ve III"] }, "gecersiz-sik");
  ayni({ ...ORNEK, dogruIndeks: 7 }, "gecersiz-sik");
});

test("Etiketle ad oluşturan öncül karıştırılmaz: II. TBMM, I. Meşrutiyet", () => {
  const koku = (oncul: string) => `Kök;\nI. Bir şey oldu\nII. ${oncul}\nIII. Başka şey oldu\nhangileri?`;
  for (const oncul of [
    "TBMM'nin ulusal egemenliği benimsemesi",
    "TBMM’ye güvenoyu verilmesi",
    "Meşrutiyet rejimi sona ermiştir",
    "Balkan Savaşlarının başlaması",
    "Dünya Savaşı'nın bitmesi",
    "Abdülaziz'in tahttan indirilmesi",
    "Ordunun yeniden kurulması",
    "Meclisin açılması",
    "Kalkınma Planının uygulanması",
    "Mahmut döneminde başlaması",
    "Selim'in ıslahatları",
  ]) {
    const r = onculDengele({ soru: koku(oncul), secenekler: SIKLAR, dogruIndeks: 2, aciklama: null });
    assert.equal(r.durum, "atlandi", oncul);
    assert.equal(r.sebep, "oncul-ad-bitisik", oncul);
    assert.equal(r.soru, koku(oncul));
  }
  // Ad oluşturmayanlar serbest: sıra numarası içerikte, ya da ardından başka ad geliyor
  for (const oncul of [
    "II. Mahmut döneminde başlaması",
    "Mustafa Kemal'in Samsun'a çıkması",
    "Süleyman Demirel'in başbakanlığı",
    "Balkanlarda ayaklanma çıkması",
    "Osmanlı Devleti'nin küçülmesi",
    "Meşruti yönetime geçilmesi",
    "Dünya'nın küresel şekli",
    "Dönemin koşulları",
    "Meclis-i Âli-i Muhasebatın kurulması",
    "Kalkınma projesi bölgeleri",
    "Cumhuriyet rejimi karşıtı ayaklanmalar",
  ]) {
    const r = onculDengele({ soru: koku(oncul), secenekler: SIKLAR, dogruIndeks: 2, aciklama: null });
    assert.equal(r.durum, "karistirildi", oncul);
  }
});

test('"Her ikisi" diğer öncüllere yaslanıyorsa atlanır, köke yaslanıyorsa serbest', () => {
  const bagimli = "Devletlerle ilgili;\nI. Hazarlar Musevidir\nII. Türgişler İslam'ı engelledi\nIII. Her ikisi Orta Asya'dadır\nhangileri?";
  const r = onculDengele({ soru: bagimli, secenekler: SIKLAR, dogruIndeks: 2, aciklama: null });
  assert.equal(r.durum, "atlandi");
  assert.equal(r.sebep, "oncul-bagimli");
  const kokte = "Hazarlar ve Türgişler ile ilgili;\nI. Hazarlar Musevidir\nII. Türgişler Müslümandır\nIII. Her ikisi Orta Asya'dadır\nhangileri?";
  assert.equal(onculDengele({ soru: kokte, secenekler: SIKLAR, dogruIndeks: 2, aciklama: null }).durum, "karistirildi");
  // "Her ikisi" olmayan "Her yıl" etkilenmez
  const serbest = "Kök;\nI. Bir\nII. İki\nIII. Her yıl tekrarlanır\nhangileri?";
  assert.equal(onculDengele({ soru: serbest, secenekler: SIKLAR, dogruIndeks: 2, aciklama: null }).durum, "karistirildi");
});

test("Açıklama: tanınmayan kalıp artık belirsiz, sessizce bayat kalmıyor", () => {
  for (const a of [
    "Doğru olanlar I ve II. Fırat ise Basra'ya ulaşır.",
    "Yanlış olan III. Fırat ise Basra'ya ulaşır.",
    "I. Sipahilerin azalması doğrudur.",
    "III. Fırat yanlıştır.",
    "Sonuncu yanlıştır.",
    "Sondaki yargı yanlıştır.",
    "Son madde yanlıştır.",
    "Son cümle yanlıştır.",
    "İlkinde tarih yanlıştır.",
    "Üçüncüde tarih yanlıştır.",
    "Baştaki iki yargı doğrudur.",
    "Ortadaki yargı yanlıştır.",
    "En alttaki öncül yanlıştır.",
    "Üstteki iki öncül doğrudur.",
    "Doğru cevap C.",
    "Cevap D olur.",
    "Son hüküm işgallere dayanak olmuştur.",
    "verilen son gerekçe derste belirtilmemiştir",
    "İlk madde doğrudur.",
    "Son seçenek yanlıştır.",
    "1. öncül doğru, 3. öncül yanlıştır.",
    "Napolyon III'ün politikası.",
    "Wilhelm II'nin politikası.",
    "III. Yargı Paketi ile değişti.",
    "II. Madde yürürlükten kalktı.",
  ]) {
    const r = es(a);
    assert.equal(r.belirsiz, true, a);
    assert.equal(r.metin, a);
  }
  // Numara öncül metniyle sürüyorsa gönderme olduğu kesin
  const r = aciklamaNumaralariniEsle("I. Sipahilerin azalması doğrudur.", P, ["Sipahilerin azalması", "B", "C"]);
  assert.equal(r.belirsiz, false);
  assert.equal(r.metin, "III. Sipahilerin azalması doğrudur.");
  // Cümle başı söz özel ad sayılmaz; "ilk" içerikle ilgiliyse serbest
  assert.equal(es("Ancak III'ün yeri farklıdır.").metin, "Ancak II'nin yeri farklıdır.");
  assert.equal(es("Bu ilk devlet Uygurlardır.").belirsiz, false);
});

test("ucIkiliKoru: girdide üç ikili varsa kalır, tek ikili ipucu doğmaz", () => {
  const girdi = { ...ORNEK, secenekler: ["Yalnız I", "I ve II", "I ve III", "II ve III", "I, II ve III"], dogruIndeks: 1, aciklama: null };
  for (let i = 0; i < 200; i++) {
    const r = onculDengele(girdi, { rastgele: tohumluRastgele(`u${i}`), ucIkiliKoru: true });
    for (const ikili of ["I ve II", "I ve III", "II ve III"]) assert.ok(r.secenekler.includes(ikili), r.secenekler.join());
    assert.equal(new Set(r.secenekler).size, 5);
  }
  // Girdide üç ikili yoksa dokunmaz: eşit çekiliş devam eder
  const eksik = new Set<number>();
  for (let i = 0; i < 200; i++) {
    const r = onculDengele(ORNEK, { rastgele: tohumluRastgele(`v${i}`), ucIkiliKoru: true });
    eksik.add(r.secenekler.filter((s) => ["I ve II", "I ve III", "II ve III"].includes(s)).length);
  }
  assert.ok(eksik.size > 1);
});

test("Üç ikili zorunluyken listeye bakarak tahmin şans düzeyine iner", () => {
  // İki doğrulu soruda: listede hep üç ikili, doğru olan üçüne eşit dağılıyor
  const N = 3000;
  const rastgele = tohumluRastgele("uc-ikili");
  const girdi = { ...ORNEK, aciklama: null };
  const dogru = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    const r = onculDengele(girdi, { rastgele, zorunluSiklar: ["I ve II", "I ve III", "II ve III"] });
    assert.equal(r.secenekler.filter((s) => ["I ve II", "I ve III", "II ve III"].includes(s)).length, 3);
    dogru.set(r.secenekler[r.dogruIndeks], (dogru.get(r.secenekler[r.dogruIndeks]) ?? 0) + 1);
  }
  for (const adet of dogru.values()) assert.ok(Math.abs(adet / N - 1 / 3) < 0.04, `${adet}`);
});

test("Verilen permütasyon kullanılır, rastgele çekilmez", () => {
  const r = onculDengele(ORNEK, { rastgele: tohumluRastgele("p"), permutasyon: [2, 0, 1] });
  assert.deepEqual(r.permutasyon, [2, 0, 1]);
  assert.equal(r.secenekler[r.dogruIndeks], "I ve III");
  assert.deepEqual(sikMetinleri(r.soru, r.secenekler[r.dogruIndeks]), sikMetinleri(ORNEK.soru, "I ve II"));
});

test("Art arda uygulama güvenli: anlam ikinci karıştırmada da korunur", () => {
  const beklenen = sikMetinleri(ORNEK.soru, ORNEK.secenekler[ORNEK.dogruIndeks]);
  const rastgele = tohumluRastgele("ikili");
  let g: OnculSoru = ORNEK;
  for (let i = 0; i < 20; i++) {
    const r = onculDengele(g, { rastgele });
    assert.equal(r.durum, "karistirildi");
    assert.deepEqual(sikMetinleri(r.soru, r.secenekler[r.dogruIndeks]), beklenen);
    g = r;
  }
});

test("Dağılım ölçümü", () => {
  const d = onculDagilimi([
    { secenekler: SIKLAR, dogruIndeks: 2 },
    { secenekler: SIKLAR, dogruIndeks: 0 },
    { secenekler: ["Ankara"], dogruIndeks: 0 },
  ]);
  assert.equal(d.toplam, 2);
  assert.equal(d.kombinasyon["I ve II"], 1);
  assert.equal(d.harf.C, 1);
  assert.equal(d.dogruOnculSayisi["2"], 1);
  assert.equal(d.dogruOnculSayisi["1"], 1);
});
