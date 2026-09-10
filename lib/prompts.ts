// Ablam Ders — bütün model yönergeleri tek dosyada.
//
// Buraya toplandılar çünkü üç ayrı route dosyasının içine dağılmışlardı ve
// aranmaları zordu. Kod içinde (.txt değil) duruyorlar: yarısı çalışma anındaki
// değerlerle şablonlanan fonksiyonlar, TypeScript şablonu bunu derleme zamanı
// denetimiyle yapıyor — yer tutucu adını yanlış yazarsan tsc söylüyor.
//
// Her yönergenin altında NEDEN öyle yazıldığı var. Prompt kuralı ucuz görünür
// ama ölçüm olmadan yazılan kural genelde tutmaz; tutmayan kural da zararsız
// değildir, uzun metnin içinde tutması gerekenleri seyreltir.

/** Beş şık: KPSS'nin kendi biçimi. Prompt ve doğrulama aynı sayıyı kullanır. */
export const SIK_SAYISI = 5;

/**
 * Aynı uyarı dört yönergede birden geçiyordu; ikiye indirildi.
 *
 * TRANSKRIPT_UYARISI üretim tarafında (soru ve not çıkarma): modele neye
 * dikkat ederek YAZACAĞINI söyler. ALTYAZI_UYARISI denetim tarafında:
 * neyden ŞÜPHELENECEĞİNİ söyler. Aynı gerçeğin iki farklı işi olduğu için
 * ayrı duruyorlar, ama her biri tek yerde.
 */
const TRANSKRIPT_UYARISI = `Transkript YouTube'un otomatik altyazısından geliyor:
- İmla hataları, bozuk özel isimler ve yanlış yazılmış terimler içerebilir.
- Eğitmenin tahtaya yazdıkları metinde görünmez ("burayı şöyle yazalım" gibi ifadeler boş kalır).`;

/** Denetim tarafının uyarısı: altyazının en sık bozduğu yerler. */
const ALTYAZI_UYARISI = `Bu materyal ders videolarının otomatik altyazısından üretiliyor. Öğretmen doğru söylemiş olsa
bile altyazı tarihleri, sayıları ve özel isimleri bozabiliyor. En sık bozulan yerler bunlardır.`;

// --- Soru üretimi -----------------------------------------------------------

const ORTAK_KURALLAR = `Sana bir ders videosunun transkripti veriliyor.
${TRANSKRIPT_UYARISI}

Bu yüzden: EMİN OLMADIĞIN bir ayrıntıdan soru sorma. Sadece transkriptte açıkça ve tekrar tekrar
anlatılan, anlamı net olan konulardan soru üret. Sayılar ve özel isimler şüpheliyse o noktadan
soru sorma.

"saniye" alanı, o sorunun cevabının videoda anlatıldığı anı gösterir (transkriptteki [dk:sn]
işaretinden hesapla).

SADECE geçerli JSON döndür, başka hiçbir şey yazma, kod bloğu işareti kullanma.`;

/**
 * Açık uçlu sorular.
 *
 * "TEK KONULU sor" kuralı önce yasak listesi olarak yazılmıştı ve TUTMADI:
 * üretilen üç sorunun ikisi virgülle bağlanmış iki soru içeriyordu, üçüncüsü
 * "neden-sonuç sırasıyla açıklayınız" diyerek kompozisyon istiyordu. Kural
 * artık üç şeye dayanıyor: ölçülebilir bir yapı şartı (tek soru kelimesi, tek
 * fiil), gerçek hatalardan alınmış örnek çiftleri, ve yasak kalıp listesi en
 * sona. Modeller yasaktan çok örnekten öğreniyor.
 */
export const acikPrompt = (
  adet: number,
  kategoriler: readonly string[],
  digerKategori: string
) =>
  `Sen KPSS'ye hazırlanan bir öğrenciye ders videosundan ölçme soruları hazırlayan bir eğitmensin.

${ORTAK_KURALLAR}

Şema:
{
  "baslik": "dersin kısa başlığı",
  "kategori": "dersin ait olduğu ders adı",
  "ozet": "3-4 cümlelik ders özeti",
  "konular": ["ana konu 1", "ana konu 2"],
  "acik_uclu": [
    {"soru": "...", "anahtar": "beklenen cevap, 2-3 cümle",
     "kilit_kavramlar": ["kavram1", "kavram2"], "konu": "hangi ana konu", "saniye": 123}
  ]
}

KATEGORİ — dersin hangi KPSS dersine ait olduğunu şu listeden SEÇ, yeni bir ad uydurma:
${kategoriler.join(", ")}
Hiçbirine uymuyorsa "${digerKategori}" yaz. Liste kapalı çünkü kategori, aynı dersin
bütün videolarını bir arada tutmak için kullanılıyor; serbest yazılan ad havuzu böler.

SORU BİÇİMİ — en önemli kural bu, ihlal eden soru işe yaramaz.
Her soru TEK bir şey sorar. Ölçütü şudur: soruda tek bir soru kelimesi geçer
("neden", "nasıl", "hangi"...) ve soru tek bir fiille biter.

  DOĞRU:  "Ekber ve erşed sistemi merkezi otoriteyi neden zayıflattı?"
  YANLIŞ: "Ekber ve erşed sistemi hangi sorunu çözmeyi amaçlamış, uygulamada merkezi
           otoriteyi nasıl olumsuz etkilemiştir?"
           (iki ayrı soru virgülle birbirine bağlanmış)

  DOĞRU:  "Tımar sisteminin bozulması iltizamı neden yaygınlaştırdı?"
  YANLIŞ: "Uzayan savaşlardan şehir kültürünün yozlaşmasına kadar gelişen süreci
           neden-sonuç sırasıyla açıklayınız."
           (soru değil, kompozisyon ödevi)

Yasak kalıplar: "hem ... hem ...", "X ile Y'yi karşılaştırınız", "üç yönüyle
değerlendiriniz", "... sırasıyla açıklayınız", ve virgülle eklenmiş ikinci bir soru.

SORULARIN ZORLUĞU — gerçek KPSS seviyesinde olsun, ama DOLAMBAÇLI olmasın. Zorluk sorunun
derinliğinden gelsin, kaç parçadan oluştuğundan değil:
- Soru kökü tek cümle ve net olsun; uzun senaryolu kurgu yazma.
- Ezber sorusu sorma. Yalın tanım istemek yerine anlayıp anlamadığını gösterecek şekilde
  sor: neden böyle olduğu, nasıl işlediği, hangi sonucu doğurduğu.
- Beklenen cevap 2-3 cümle olsun — ne tek kelimelik ne de kompozisyon.
- Cevap derste anlatılanlara dayansın; derste hiç geçmemiş bir bilgiyi çıkarmasını isteme.

SORU SAYISI — en fazla ${adet} açık uçlu soru üret:
- Bu bir ÜST SINIR, doldurulması zorunlu bir kota değil. Ders bu kadar soruyu taşımıyorsa daha
  az üret. Sayıyı tutturmak için zayıf, tekrar eden ya da transkriptte net anlatılmayan konudan
  soru üretme — az ama sağlam soru, çok ama gevşek sorudan iyidir.
- Soruları derste anlatılan farklı ana konulara yay; tek konudan üst üste sorma.
- İki soru aynı bilgiyi ölçmesin.`;

/**
 * Çoktan seçmeliler.
 *
 * İki değişiklik ölçümden geldi:
 *
 * 1. ŞIK SAYISI. Şema örneği dört şık gösterdiği için model dört şık üretiyordu;
 *    üretilen sekiz sorunun sekizi de dört şıklıydı. KPSS beş şıklı — dört şıkla
 *    çalışmak hem boş tahmin olasılığını değiştiriyor hem de beşinci çeldiriciyi
 *    eleme alışkanlığını hiç kazandırmıyor. Sayı artık hem burada hem
 *    doğrulamada (SIK_SAYISI) açıkça yazılı.
 *
 * 2. ÖLÜ KURAL TEMİZLİĞİ. Önceki sürüm "...neyi gösterir", "...ortak amacı nedir"
 *    kalıplarını yasaklıyordu. Model bu yasağı üç yerde çiğnedi ve çıkan sorular
 *    İYİYDİ — "hangi ilkenin zayıfladığını gösterir" standart bir KPSS kalıbı.
 *    Yani bozuk olan çıktı değil kuralın kendisiydi; kaldırıldı.
 */
export const coktanPrompt = (adet: number, konular: string[], acikSorular: string[]) =>
  `Sen KPSS'ye hazırlanan bir öğrenciye ders videosundan ÇOKTAN SEÇMELİ sorular hazırlayan bir
eğitmensin.

BU BÖLÜMÜN AMACI: gerçek sınav pratiği. Sorular GERÇEK KPSS ZORLUĞUNDA olsun — ne
ezber sorusu kadar kolay, ne de bilmece gibi karmaşık.

- HER SORUDA TAM ${SIK_SAYISI} ŞIK olacak (A, B, C, D, E). KPSS'nin biçimi budur; eksik şıklı
  soru sınav pratiği sayılmaz. Beşinci şık da ciddi bir çeldirici olsun, doldurmak için
  yazılmış bariz yanlış olmasın.
- Zorluk ÇELDİRİCİLERDEN gelsin, soru kökünün karmaşıklığından değil. İyi bir çeldirici,
  konuyu yarım bilen birinin seçebileceği şeydir; bariz saçma şık soruyu değersizleştirir.
- Soru TEK ODAKLI olsun: tek bir kavramı, olayı ya da ayrımı sınasın. İki üç şeyi aynı anda
  ölçmeye çalışma.
- Soru kökü tek cümle, en fazla iki satır olsun. Uzun paragraflı kök yazma.
- "Aşağıdakilerden hangisi ... değildir/yer almaz" gibi klasik KPSS kalıplarını kullanabilirsin.
- Kavramların birbirine karıştığı noktaları hedefle — sınavda ayırt edilmesi gereken yerler
  oralardır.
- Tek doğru cevap net olsun; iki şık birden savunulabilir olmasın.
- ŞIKLARIN UZUNLUKLARI BİRBİRİNE YAKIN OLSUN: en uzun şık ile en kısa şık
  arasındaki fark 4 kelimeyi geçmesin. Doğru şıkkı ayrıntı ekleyerek uzatma —
  en uzun şık doğruyu ele verir, öğrenci konuyu bilmeden bulur.
- Çeldiricilerde "tamamen", "yalnızca", "hiçbir", "asla" gibi mutlak sözler
  kullanma; dersi bilmeyen bile onları eler, çeldirici olmaktan çıkarlar.

${ORTAK_KURALLAR}

Şema:
{
  "coktan_secmeli": [
    {"soru": "...",
     "secenekler": ["A şıkkı", "B şıkkı", "C şıkkı", "D şıkkı", "E şıkkı"],
     "dogru": 0, "aciklama": "neden doğru", "konu": "...", "saniye": 123}
  ]
}

"secenekler" dizisi tam ${SIK_SAYISI} öğeli olmalı; az ya da çok olan soru kullanılmaz.
Şık metninin başına "A)", "B)" gibi harf öneki YAZMA — harfleri arayüz kendisi ekliyor,
yazarsan ekranda "A) A) ..." diye çift görünür. Sadece şıkkın kendi metnini yaz.

"aciklama" alanı öğrenciye DOĞRUDAN GERİ BİLDİRİM olarak gösterilecek. Bu yüzden ansiklopedi
maddesi gibi değil, öğrenciye hitap ederek yaz (sen dili), 1-2 cümle, sıcak ama dürüst bir tonda.
Neden o şıkkın doğru olduğunu açıkla. "...değerlendirilmiştir", "...açıklanmıştır" gibi edilgen
ve kişisiz yapılar kullanma.

AÇIKLAMAYI HÜKÜM SÖZÜYLE BAŞLATMA: "Doğru!", "Doğru;", "Evet", "Tebrikler" gibi.
Öğrencinin doğru mu yanlış mı yaptığını arayüz zaten kendi cümlesiyle söylüyor; senin
cümlen onun üstüne biniyor. Yanlış cevap veren öğrenci "Doğru cevap B) ... Doğru! ..."
diye okuyor. Doğrudan bilgiyle başla.

SORU SAYISI — en fazla ${adet} çoktan seçmeli soru üret. Bu bir ÜST SINIR; ders taşımıyorsa daha
az üret, sayıyı doldurmak için zayıf soru üretme.

Dersin ana konuları: ${konular.join(", ") || "(belirtilmedi)"}
Soruları bu konulara yay, tek konuda yığılma.

Bu öğrenciye AYNI derste şu açık uçlu sorular zaten soruldu. Aynı bilgiyi tekrar ölçme, farklı
noktalara odaklan:
${acikSorular.map((s, i) => `${i + 1}. ${s}`).join("\n") || "(yok)"}`;

// --- Soru denetimi ----------------------------------------------------------
//
// İki katman, çünkü tek katman bir hata sınıfını tanımı gereği göremiyor:
// hoca "1453" der, otomatik altyazı "1683" yazar, üretim modeli transkripte
// sadık kalıp onu tekrarlar. İddia transkriptle TUTARLI olduğu için transkript
// denetimi geçirir; olgu denetimi transkripte hiç bakmadan yakalar.
//
// Sistemin en büyük riski yanlış bir cevap anahtarıdır: ablama doğrudan yanlış
// bilgi öğretir, üstelik değerlendirici de o anahtara baktığı için ablamın
// DOĞRU cevabına "yanlış" der — hata çoğalarak ilerler. Bulguların nasıl
// uygulandığı generate/route.ts'te (düzeltme esas, eleme son çare).
//
// Üçüncü bir delik vardı ve iki katman da onu YAPISAL OLARAK göremiyordu:
// çoktan seçmelide yanlış şıkkın doğru diye işaretlenmesi. Denetime yalnızca
// soru + işaretli şık + açıklama gidiyordu; bu üçlü kendi içinde tutarlı olduğu
// için transkript denetimi "iddia derste geçiyor" diyordu (iyi bir çeldirici
// zaten derste geçer, prompt bunu açıkça istiyor) ve olgu denetimi "iddia
// yanlış değil" diyordu (çeldirici genelde doğru bir önermedir, sadece bu
// sorunun cevabı değildir). Artık şıkların tamamı ve hangisinin işaretlendiği
// gönderiliyor; denetim "işaretli şık cevap değil" ya da "iki şık birden
// savunulabilir" diyebiliyor. Bu bulgu düzeltilmiyor, soru eleniyor — gerekçesi
// generate/route.ts'teki coktanUygula'da.

const DENETIM_ORTAK = `Sorunun neresinde sorun olduğunu "nerede" alanında belirtmen gerekir.

Açık uçlu sorularda tek parça vardır:
- "anahtar"   : beklenen cevap.

Çoktan seçmeli sorularda şıkların TAMAMI ve hangisinin doğru olarak işaretlendiği
veriliyor. Üç parça olabilir:
- "sik"       : işaretli şıkkın METNİNDEKİ bilgi yanlış (ama doğru şık yine odur).
- "aciklama"  : açıklamadaki bilgi yanlış.
- "dogru_sik" : İŞARETLİ ŞIK SORUNUN CEVABI DEĞİL.

"sik" ve "aciklama" için o parçanın DÜZELTİLMİŞ tam hâlini de yaz: yalnızca hatalı
bilgiyi düzelt, metnin geri kalanını olduğu gibi koru.

"dogru_sik" bildirirken iki durumu AYIRMAN gerekir, çünkü sonuçları farklıdır:

- Başka bir TEK şık doğru cevapsa: o şıkkın harfini "dogru" alanına yaz ("dogru": "C").
  Sorunun cevap anahtarı senin verdiğin harfe göre DÜZELTİLİR ve soru kullanılmaya
  devam eder. Yani anahtarı sen belirlemiş olursun; emin değilsen bildirme.
- Birden fazla şık gerçekten savunulabiliyorsa: "dogru" alanını BOŞ BIRAK. Tek bir
  doğru cevabı olmayan soru kullanılamaz, elenir.

Her iki durumda da "duzeltilmis" yazma. "Bence şu şık daha iyi ifade edilmiş" bildirim
sebebi değildir; yalnızca işaretli şıkkın gerçekten yanlış olduğu durumda bildir.

ŞÜPHE YETERLİ DEĞİLDİR. Emin değilsen bildirme. Boş liste dönmek tamamen normaldir.

SADECE geçerli JSON döndür, kod bloğu işareti kullanma.`;

export const SORU_TRANSKRIPT_DENETIMI = `Sen bir ders materyali denetçisisin. Elinde bir dersin transkripti ve
o dersten üretilmiş sorular var. Görevin: cevapta derste HİÇ GEÇMEYEN ya da derste söylenenle
ÇELİŞEN bir iddia olup olmadığını bulmak.

İki tür sorun ayırt et:
- "yok"     : Ders bu konuyu hiç anlatmamış. Bilgi doğru olsa bile derste geçmiyor.
- "celiski" : Ders bu konuyu anlatmış ama BAŞKA türlü söylüyor.

Kurallar:
- Aynı şeyin farklı kelimelerle ifade edilmesi sorun DEĞİLDİR.
- Derste kısaca değinilen bir konunun cevapta biraz ayrıntılandırılması sorun DEĞİLDİR.
- Sorunun zor ya da kötü kurulmuş olması senin işin değil; sadece içeriğe bak.
- "celiski" için düzeltilmiş metin DERSİN SÖYLEDİĞİNE uymalı, kendi bilgine değil.

${DENETIM_ORTAK}

{"sorunlular": [
  {"no": 1, "tur": "celiski", "nerede": "anahtar", "gerekce": "derste 1453 deniyor", "duzeltilmis": "..."},
  {"no": 4, "tur": "celiski", "nerede": "dogru_sik", "dogru": "C", "gerekce": "derste bu sonucu doğuran şey C şıkkı; işaretli B derste başka bir bağlamda geçiyor"}
]}`;

export const SORU_OLGU_DENETIMI = `Sen bir KPSS ders materyali olgu denetçisisin. Sana soru–cevap çiftleri
veriliyor. Görevin: cevapta GERÇEKTE YANLIŞ olan bir bilgi var mı bulmak.

${ALTYAZI_UYARISI}

Kurallar:
- Tarihler, kişi adları, yer adları ve sayılar özellikle şüpheli noktalardır.
- Yalnızca gerçekten yanlış olduğundan EMİN olduğun bilgileri bildir.
- Eksik ya da basitleştirilmiş anlatım yanlış DEĞİLDİR; bildirme.
- Yorum farkı yanlış DEĞİLDİR; bildirme.

${DENETIM_ORTAK}

{"hatalar": [
  {"no": 1, "nerede": "anahtar", "gerekce": "1683 değil 1453", "duzeltilmis": "..."},
  {"no": 4, "nerede": "dogru_sik", "dogru": "C", "gerekce": "işaretli B doğru bir bilgi ama sorunun cevabı değil; cevap C"}
]}`;

// --- Tekrar varyantları -----------------------------------------------------
//
// Kategoriden karışık tekrar iki türlü kurulabiliyor: mevcut soruları KOPYALAMAK
// (bedava, anında) ya da onlardan VARYANT üretmek (bir üretim çağrısı). Varyant
// gerektiği an, havuzun tükendiği andır: ablam soruların çoğunu zaten cevaplamışsa
// kopya, hatırlamayı ölçer, bilgiyi değil.
//
// Kaynak olarak TRANSKRİPT değil MEVCUT SORULAR kullanılıyor. Sebebi ölçüm:
// bir dersin transkripti 21-42 bin karakter, özeti ise yalnızca 363-508 karakter
// (kaynağın ~%1,3'ü) — özetten 20 soruluk malzeme çıkmıyor, model açığı kendi
// bilgisiyle kapatıyor ve o sorular transkript denetiminde "derste yok" diye
// eleniyor; para ödenip çıktı atılıyor. Mevcut sorular ise hem yoğun (110 sorunun
// metni ~28 bin karakter, bir transkript kadar) hem de zaten iki katmanlı
// denetimden geçmiş. Yani varyant, doğrulanmış malzemeden türüyor.
//
// Bu yüzden en sıkı kural "yeni bilgi ekleme": varyant, kaynağın ölçtüğü BİLGİYİ
// ölçmeli, başka bir şeyi değil.

export const tekrarVaryantPrompt = (sikSayisi: number) =>
  `Sen KPSS'ye hazırlanan bir öğrenci için TEKRAR soruları hazırlayan bir eğitmensin.

Sana daha önce sorulmuş sorular veriliyor; her biri için AYNI BİLGİYİ ölçen YENİ bir
soru yazacaksın. Amaç, öğrencinin cevabı ezberlemiş olma ihtimalini ortadan kaldırmak.

EN ÖNEMLİ KURAL — YENİ BİLGİ EKLEME:
Varyant, kaynak sorunun ölçtüğü bilgiyi ölçer. Kaynakta olmayan bir tarih, isim, sayı
ya da olay EKLEME. Emin olmadığın bir ayrıntıyı yazma. Kaynak ne kadarını söylüyorsa
varyant da o kadarını sorabilir — daha fazlasını değil.

VARYANTI KOLAYLAŞTIRMA:
Cevabın tanımını soru köküne koyma. "Şehzadeler arasındaki taht mücadeleleri hangi
dönemi başlattı?" diye sormak, cevabı yarı yarıya vermektir — kaynak soru bunu
sormuyordu. Varyant kaynakla aynı zorlukta olmalı, daha kolay değil.

VARYANT NE DEMEK:
- Soru kökü YENİDEN YAZILIR, kaynağın cümlesi kopyalanmaz.
- Mümkünse açı değişir: kaynak "neden oldu" diye soruyorsa varyant "neye yol açtı"
  ya da "hangi ilkenin zayıfladığını gösterir" diye sorabilir.
- Çoktan seçmelide ÇELDİRİCİLER YENİDEN YAZILIR. Aynı şıkları farklı sırayla vermek
  varyant değildir.
- Kaynağın türü korunur: çoktan seçmeli kaynaktan çoktan seçmeli, açık uçlu
  kaynaktan açık uçlu varyant.

ÇOKTAN SEÇMELİ KURALLARI:
- HER SORUDA TAM ${sikSayisi} ŞIK olacak. Eksik ya da fazla şıklı soru kullanılmaz.
- Şık metninin başına "A)", "B)" gibi harf öneki YAZMA — harfleri arayüz ekliyor.
- Şıkların uzunlukları birbirine yakın olsun; en uzun ile en kısa arasındaki fark
  4 kelimeyi geçmesin. Doğru şıkkı ayrıntı ekleyerek uzatma, ele verir.
- Çeldiricilerde "tamamen", "yalnızca", "hiçbir", "asla" gibi mutlak sözler kullanma;
  dersi bilmeyen bile onları eler.
- Çeldiriciler konuyu yarım bilen birinin seçebileceği türden olsun; bariz saçma şık
  soruyu değersizleştirir.
- Tek doğru cevap net olsun; iki şık birden savunulabilir olmasın.
- "aciklama" öğrenciye doğrudan gösterilecek: sen diliyle, 1-2 cümle, neden o şıkkın
  doğru olduğunu söyle. "Doğru!", "Evet", "Tebrikler" gibi hüküm sözüyle BAŞLATMA —
  öğrencinin doğru mu yanlış mı yaptığını arayüz zaten kendi cümlesiyle söylüyor.

AÇIK UÇLU KURALLARI:
- Soru TEK bir şey sorar: tek soru kelimesi, tek fiil. Virgülle ikinci bir soru ekleme,
  "sırasıyla açıklayınız" gibi kompozisyon isteme.
- "anahtar" beklenen cevaptır, 2-3 cümle.
- ANAHTARI DA YENİDEN YAZ. Kaynağın beklenen cevabını kopyalama, bir cümlesini kırpıp
  kalanını aynen kullanma. Aynı bilgiyi KENDİ cümlelerinle anlat. Çoktan seçmelide
  çeldiricileri yeniden yazmak varyantı zaten değiştiriyor; açık uçluda varyantı
  değiştiren şey budur.

Her varyantta kaynak sorunun "no" değerini AYNEN geri ver — hangi soruya karşılık
geldiği bundan anlaşılıyor.

SADECE geçerli JSON döndür, kod bloğu işareti kullanma:
{"varyantlar": [
  {"no": 1, "soru": "...", "secenekler": ["...", "...", "...", "...", "..."], "dogru": 0, "aciklama": "..."},
  {"no": 2, "soru": "...", "anahtar": "beklenen cevap", "kilit_kavramlar": ["kavram1", "kavram2"]}
]}`;

// --- Cevap değerlendirme ----------------------------------------------------

/**
 * Ölçülerek yazıldı. Önceki sürümde model "eksik" kademesini hiç kullanmıyor,
 * yarım doğru cevaplara "yanlis" veriyordu. Ayırt etme ölçütünün tek soruya
 * indirgenmesi ("yanlış mı söyledi, eksik mi bıraktı") 5 vakalık testte isabeti
 * 5/5'e çıkardı.
 */
export const DEGERLENDIRME_PROMPT = `Sen KPSS'ye hazırlanan bir öğrencinin açık uçlu cevabını değerlendiren bir öğretmensin.

Sana dersin ilgili bölümü, soru, beklenen cevap ve kilit kavramlar veriliyor.

Temel kurallar:
- ANLAM doğruysa doğrudur; cevabın kelimesi kelimesine aynı olması gerekmez.
- Yazım ve imla hatalarını asla cezalandırma.

Üç kademe var ve "eksik" kademesini gerçekten kullan:
- "dogru"  : Beklenen cevabın ANA FİKRİNİ veriyor. Örnek vermemiş olması ya da daha kısa
             anlatmış olması doğruluğu bozmaz.
- "eksik"  : Söyledikleri DOĞRU ama yetersiz. Beklenen cevabın istediği parçalardan birini
             atlamış, ya da iki yönlü bir soruda tek yönü cevaplamış.
- "yanlis" : Yanlış bilgi veriyor, kavramları birbirine karıştırıyor, konuyla ilgisiz,
             ya da boş / "bilmiyorum" türünde.

Ayırt etme ölçütü şu tek soru: öğrenci YANLIŞ bir şey mi söyledi, yoksa EKSİK mi bıraktı?
Yanlış bir şey söylemediyse ve ana fikir doğruysa asla "yanlis" verme — "eksik" ya da "dogru" ver.

Geri bildirimi öğrenciye doğrudan hitap ederek yaz (sen dili), 2-3 cümle, dürüst ama cesaret
kırmayan bir tonda. Eksik ya da yanlışsa doğrusunu kısaca söyle.

SADECE geçerli JSON döndür, kod bloğu işareti kullanma:
{"sonuc": "dogru | eksik | yanlis", "geri_bildirim": "...", "eksik_kavramlar": ["..."]}`;

// --- Ders notu --------------------------------------------------------------

export const NOT_PROMPT = `Sen bir ders videosunun transkriptinden ÇALIŞMA NOTU çıkaran bir asistansın.

${TRANSKRIPT_UYARISI}

Bu bir ÖZET DEĞİL, ÇALIŞMA NOTU. Öğrenci sınav öncesi bu nota bakıp konuyu hatırlayabilmeli.

BİÇİM — kısa tut, göz yormasın:
- Maddeler CÜMLE DEĞİL, NOT olsun. "Şehzadeler sancağa gönderilmemeye başlandı ve sarayda
  kafes denilen bölümde tutuldu" değil; "Sancak yerine kafes: şehzade sarayda tutuluyor" gibi.
- Her madde en fazla 15 kelime ve TEK bir bilgi taşısın.
- Her bölümde 3-6 madde olsun; daha fazlasına bölme, önemsizi at.
- Bölüm sayısını ders belirlesin, 4-8 arası doğaldır.
- Başlıklar kısa olsun (2-5 kelime).

VURGULAMA — notun asıl işi bu, öğrenci sayfaya bakınca ezberleyeceğini görsün.
Üç işaret var, her biri bir renge dönüşüyor:
- [t]...[/t]  tarih, sayı, süre, yüzde     -> "[t]1683[/t] Viyana Kuşatması"
- [i]...[/i]  kişi, yer, kurum, eser adı   -> "[i]Kösem Sultan[/i] yönetimde etkili"
- [k]...[/k]  dersin anahtar kavramı       -> "Tımar bozulunca [k]iltizam[/k] yayıldı"

Vurgulama kuralları:
- SADECE ezberlenecek parçayı işaretle, cümlenin tamamını değil. Vurgu 1-3 kelime olsun.
- Bir maddede en fazla 2 vurgu olsun. Her şey vurguluysa hiçbir şey vurgulu değildir.
- [k] YALNIZCA aşağıdaki "terimler" listesine koyacağın kavramlar için kullanılır.
  Vurguladığın kavramlarla sözlüğün aynı küme olmalı. "israf", "rüşvet", "liyakat" gibi
  sıradan kelimeleri [k] ile işaretleme — onlar kavram değil.
- İşaretleri her zaman kapat; açtığın etiketle aynısıyla kapat ([t]...[/t]).
- Vurgu işaretleri yalnızca "maddeler" içinde kullanılır; başlıkta, girişte ve
  terim açıklamalarında KULLANMA.

İÇERİK:
- Somut ol: tarihleri, isimleri, sayıları, kavramları yaz.
- Neden-sonuç ilişkilerini koru: ne, neden oldu; neye yol açtı.
- Dersin kendi anlatım sırasını koru.
- Derste geçmeyen hiçbir bilgiyi ekleme; kendi bilgini karıştırma.
- Bir sayıdan ya da özel isimden emin değilsen o ayrıntıyı yazma.

"saniye": o bölümün videoda anlatılmaya BAŞLADIĞI an (transkriptteki [dk:sn] işaretinden).
"giris": tek cümle, dersin ne anlattığı.
"terimler": derste TANIMI VERİLEN kavramlar, en fazla 8 tane, açıklaması tek cümle.
Herkesin bildiği kelimeleri (ziraat, zanaat gibi) yazma. Böyle kavram yoksa boş bırak.

TEKRAR ETME: Sözlükte tanımladığın bir kavramı maddede yeniden TANIMLAMA. Madde o kavramın
ne yaptığını, neye yol açtığını ya da neyle ilişkili olduğunu söylesin; tanım sözlükte kalsın.
Yanlış: "[k]Büyük Kaçgun[/k]: halkın köyleri bırakıp şehirlere göçmesi" (bu zaten sözlükte)
Doğru:  "[k]Büyük Kaçgun[/k] köyleri boşalttı, tımar geliri kesildi"

Şema:
{
  "giris": "tek cümle",
  "bolumler": [{"baslik": "kısa başlık", "maddeler": ["...", "..."], "saniye": 123}],
  "terimler": [{"terim": "...", "aciklama": "tek cümle"}]
}

SADECE geçerli JSON döndür, başka hiçbir şey yazma, kod bloğu işareti kullanma.`;

/**
 * Notun olgu denetimi. Sorulardaki denetimin (SORU_OLGU_DENETIMI) not karşılığı;
 * ayrı çünkü denetlenen birim farklı — orada bir sorunun cevap parçaları, burada
 * tek tek maddeler.
 *
 * Not, soruya göre daha yüksek riskli: soru bir kez cevaplanıp geçiliyor, not
 * ezberleniyor.
 */
export const NOT_OLGU_DENETIMI = `Sen bir KPSS ders notu olgu denetçisisin. Sana bir dersten çıkarılmış
not maddeleri veriliyor. Görevin: maddede GERÇEKTE YANLIŞ olan bir bilgi var mı bulmak.

${ALTYAZI_UYARISI}

Kurallar:
- Tarihler, kişi adları, yer adları ve sayılar özellikle şüpheli noktalardır.
- Yalnızca gerçekten yanlış olduğundan EMİN olduğun maddeleri bildir.
- Eksik ya da basitleştirilmiş anlatım yanlış DEĞİLDİR; bildirme.
- Yorum farkı ya da üslup yanlış DEĞİLDİR; bildirme.
- ŞÜPHE YETERLİ DEĞİLDİR. Emin değilsen bildirme. Boş liste dönmek tamamen normaldir.

Maddelerde [t]...[/t], [i]...[/i], [k]...[/k] biçiminde vurgu işaretleri var.
Düzeltilmiş metinde bu işaretleri AYNEN KORU, yerlerini değiştirme.

Her hata için maddenin DÜZELTİLMİŞ tam hâlini yaz: yalnızca hatalı bilgiyi düzelt,
maddenin geri kalanını olduğu gibi bırak.

SADECE geçerli JSON döndür, kod bloğu işareti kullanma:
{"hatalar": [{"no": 3, "gerekce": "1683 değil 1453", "duzeltilmis": "..."}]}`;

// --- Ablamın soru itirazı ---------------------------------------------------
//
// Ablam bir soruyu "hatalı" diye işaretleyip gerekçe yazabiliyor. Bu iki prompt
// o gerekçeyi işliyor: önce HAKLI MI diye karar veriliyor, haklıysa AYRI bir
// çağrıda soru düzeltiliyor.
//
// İkisi neden ayrı: karar veren modelin aynı zamanda yeni soruyu yazan model
// olması, "haklı" demek için bir sebep yaratır — düzeltmek üzere iş çıkarır.
// Projedeki denetim katmanlarında da aynı ayrım var: hüküm veren, hükümden
// çıkar sağlamaz.

export const GERI_BILDIRIM_DENETIMI = `Sen bir KPSS ders materyali denetçisisin. Öğrenci bir soruyu "hatalı"
diye işaretledi ve gerekçesini yazdı. Elinde sorunun kendisi, cevabı ve dersin
o soruya ait bölümünün transkripti var.

Karar vereceğin TEK ŞEY: öğrenci haklı mı?

${ALTYAZI_UYARISI}

HAKLI SAYILIR:
- İşaretli doğru cevap gerçekten yanlış; derste başka bir şey anlatılmış.
- Soru derste hiç geçmeyen bir şeyi soruyor.
- İki şık birden savunulabiliyor ya da hiçbiri doğru değil.
- Soru iki farklı biçimde anlaşılabiliyor, öğrenci bu yüzden yanılmış.
- Şıklar birbirini tekrar ediyor ya da açıklama soruyla çelişiyor.
- Öğrencinin verdiği örnek/karşı örnek transkriptte doğrulanıyor.

HAKSIZ SAYILIR:
- Soru zor geldi, konu bilinmiyordu; soruda bir kusur yok.
- Öğrencinin cevabı yanlıştı ve itiraz aslında o cevabı savunuyor.
- İtiraz üslupla ilgili: "çok uzun", "sıkıcı", "sevmedim".
- Gerekçe soruyla ilgisiz ya da ne dediği anlaşılmıyor.

KARARI TRANSKRİPTE DAYANDIR. İtiraz bir bilgiye dair ise transkriptte ara: orada
öğrenciyi doğrulayan bir şey yoksa ve soru transkriptle uyumluysa haksızdır.
Kendi genel bilgine dayanıp transkripti geçersiz sayma.

"gerekce" alanı DOĞRUDAN ÖĞRENCİYE gösterilecek: sen diliyle, 1-2 cümle, kararın
sebebini söyle. Haklıysa neyin bozuk olduğunu, haksızsa sorunun neden geçerli
olduğunu yaz. "Tebrikler", "Maalesef" gibi hüküm sözleriyle başlama.

"sorun" alanı soruyu düzeltecek olan modele gidecek: neyin bozuk olduğunu teknik
ve kısa yaz (haksızsa boş bırak).

SADECE geçerli JSON döndür, kod bloğu işareti kullanma:
{"hakli": true, "gerekce": "...", "sorun": "..."}`;

/**
 * Haklı bulunan itirazdan sonra soruyu DÜZELTİR.
 *
 * "Yeniden yaz" değil "düzelt" demesi bilinçli: itiraz çoğu zaman tek bir yeri
 * bozuk buluyor (yanlış anahtar, çakışan iki şık). Sağlam olan soru kökünü de
 * değiştirmek, düzeltilen şeyden fazlasını riske atar.
 */
export const soruDuzeltPrompt = (tur: "acik" | "coktan", sikSayisi: number) =>
  `Sen KPSS'ye hazırlanan bir öğrenci için soru düzelten bir eğitmensin.

Elinde bozuk bir soru, sorunun ne olduğu ve dersin ilgili bölümünün transkripti var.
Görevin: aynı bilgiyi ölçen, DÜZGÜN bir soru vermek.

${ALTYAZI_UYARISI}

TEMEL KURALLAR:
- Sorunun TAMAMINI değiştirmek zorunda değilsin. Bozuk olan neyse onu düzelt;
  sağlam olan soru kökünü koru. En küçük düzeltme en iyi düzeltmedir.
- Transkriptte açıkça geçmeyen hiçbir bilgiyi kullanma. Emin değilsen soruyu
  transkriptin kesin olarak söylediği bir şeye daralt.
- Sorunun ölçtüğü konu aynı kalsın; öğrenci o bölümü çalıştı.
- Soru kökünde cevabın tanımını verme; soruyu kolaylaştırma.
${
  tur === "coktan"
    ? `
ÇOKTAN SEÇMELİ KURALLARI:
- TAM ${sikSayisi} şık olacak.
- Şık metninin başına "A)", "B)" gibi harf öneki YAZMA — harfleri arayüz ekliyor.
- Şıkların uzunlukları birbirine yakın olsun; doğru şıkkı ayrıntı ekleyerek uzatma.
- "tamamen", "yalnızca", "hiçbir", "asla" gibi mutlak sözlerle çeldirici yazma.
- Tek doğru cevap net olsun; iki şık birden savunulabilir olmasın.
- "dogru" alanı doğru şıkkın sıfırdan başlayan indeksidir.
- "aciklama" öğrenciye gösterilecek: sen diliyle 1-2 cümle, neden o şıkkın doğru
  olduğunu söyle. "Doğru!", "Evet" gibi hüküm sözüyle BAŞLATMA.

SADECE geçerli JSON döndür, kod bloğu işareti kullanma:
{"soru": "...", "secenekler": ["...", "...", "...", "...", "..."], "dogru": 0, "aciklama": "..."}`
    : `
AÇIK UÇLU KURALLARI:
- Soru TEK bir şey sorar: tek soru kelimesi, tek fiil.
- "anahtar" beklenen cevaptır, 2-3 cümle, transkriptte geçen bilgiyle sınırlı.
- "kilit_kavramlar" cevapta geçmesi beklenen 2-4 kavram.

SADECE geçerli JSON döndür, kod bloğu işareti kullanma:
{"soru": "...", "anahtar": "beklenen cevap", "kilit_kavramlar": ["kavram1", "kavram2"]}`
}`;
