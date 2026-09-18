# Türkiye odaklı iş ilanı takibi — kaynak ve VPS araştırması

Araştırma tarihi: 18 Eylül 2026. Kullanım: tek aday, ablamablam.com üzerindeki mevcut arayüz, e-posta bildirimi, kullanıcının mevcut VPS'si.

## Sonuç

Türkiye kapsamı için tek bir arama servisine güvenmek yeterli değil. Önerilen yapı: doğrudan kullanılabilen ilan API'leri, adayın açtığı iş alarmlarının e-postaları, kamu ilanları ve kurumların kendi kariyer sayfaları. Exa, bu kaynaklar dışındaki fırsatları keşfetmek için tamamlayıcı olmalı. Greenhouse ve Lever, yalnızca profille ilgili şirketler bu altyapıları kullanıyorsa yararlı ek kaynaklardır.

Mevcut VPS zamanlayıcıyı ve uygun kapasite varsa Next.js uygulamasını çalıştırabilir. Yeni sunucu satın almak zorunlu değil. VPS erişimi, işletim sistemi ve kapasitesi bu araştırmada incelenmedi; canlı dağıtım yapılmadı.

## Araştırma yöntemi ve kanıt düzeyi

Exa ile altı başlıkta 20 arama yapıldı: LinkedIn, Kariyer.net, İŞKUR, diğer yerel platformlar, kamu/yerel istihdam, keşif servisleri. Aramalarda toplam 104 sonuç istendi. Bu sayı tekrarlı sonuçları içerir; 104 bağımsız ve doğrulanmış kaynak anlamına gelmez. Kritik bulgular resmî yardım sayfaları ve geliştirici belgeleriyle kontrol edildi; bazı sayfaların tam içerikleri Exa ile ayrıca alındı.

İşbul.net'in API dizini, bir sonuçluk ilan araması ve o ilanın detay adresi yerel ortamdan doğrudan HTTP isteğiyle de sınandı: üçü de HTTP 200 ve JSON döndürdü. Diğer kaynaklarda oturum açılarak canlı alarm kurulmadı veya anahtarlı API denemesi yapılmadı. Exa üzerinden içerik okunabilmesi VPS'den aynı adresin sürekli erişilebilir olduğunu tek başına kanıtlamaz.

## Kaynak karşılaştırması

| Kaynak | Doğrulanan özellik / kapsam | Önerilen toplama yolu | Kanıt ve sınır |
|---|---|---|---|
| LinkedIn | Günlük/haftalık iş alarmı; e-posta veya uygulama; en fazla 20 alarm | Adayın yetkilendirdiği alarm posta kutusu, gerektiğinde şirketin kendi ilan sayfası | [İş alarmları](https://www.linkedin.com/help/linkedin/answer/a511279/job-alerts-on-linkedin?lang=en). Dakikalık yeni ilan akışı değildir. |
| Kariyer.net | Arama/pozisyon tercihleri ve e-posta iş alarmı | Aday hesabında bir kez kurulan alarmları içe alma | [Resmî yardım](https://www.kariyer.net/yardim/). Yardım, üyelik tercihlerinde üç pozisyon sınırından söz ediyor; bu bütün alarm türlerinin toplam sınırı diye genellenmemeli. |
| İŞKUR e-Şube | Kamu/özel işyeri, il/ilçe, meslek, çalışma türü, eğitim, son 24 saat gibi filtreler | Resmî açık ilan sayfasına özel, erişimi doğrulanmış bağlantı | [Açık ilan arama](https://esube.iskur.gov.tr/Istihdam/AcikIsIlanAra.aspx?il=1&mid=4114). Form Exa'da okunabildi; bazı ana sayfa istekleri reddedildi. Canlı VPS erişim denemesi gerekli. |
| İşbul.net | Anahtarsız arama API'si, sayfalama, ilan detayı ve son geçerlilik tarihi | Doğrudan REST bağlantısı; ilk yeni adaptör adayı | [API dizini](https://www.isbul.net/api/agent), [OpenAPI](https://www.isbul.net/api/agent/openapi.json). Arama ve detay doğrudan denemede çalıştı; örnek açıklama boştu. |
| Eleman.net | Özellikle mavi yaka ve ara kademe ilanları; eşleşen adaylara e-posta/SMS/uygulama bildirimleri | Adaya ulaşan ilan e-postaları; ek erişim için belgelenmiş yöntem/sağlayıcı anlaşması | [İlanlar](https://www.eleman.net/is-ilanlari), [bildirim açıklaması](https://www.eleman.net/is-rehberi/ik-surecleri/is-arayanlara-nasil-ulasilir-h8925). Özel kayıtlı arama alarmının sıklığı doğrulanmadı. |
| Secretcv | Çok sektörlü ilanlar; uygun adaylara e-posta ve mobil bildirim açıklaması | Mevcut aday bildirimlerini içe alma | [Resmî hizmet açıklaması](https://www.secretcv.com/is-ilani-ver), [ilanlar](https://www.secretcv.com/is-ilanlari). Kamuya açık ilan okuma API'si doğrulanmadı. |
| Yenibiriş | Çok sektörlü ilanlar; yeni ilanlar için mobil bildirim | Keşif ve şirket ilan sayfaları; e-posta alarmı ayrıca doğrulanmalı | [Kurumsal açıklama](https://kurumsal.yenibiris.com/), [ilanlar](https://www.yenibiris.com/). Mobil bildirimi e-posta alarmı gibi değerlendirmedik. |
| İşin Olsun | Konuma yakın işler ve yerel işe alım | Profil uygunsa keşif kapsamı; desteklenen erişim yolu ayrıca doğrulanmalı | [Resmî site](https://isinolsun.com/). İlan arama API'si ve e-posta alarmı bu araştırmada doğrulanmadı. |
| Indeed Türkiye | Hesapla e-posta iş alarmları | Adayın açtığı iş alarmları | [Resmî alarm yardımı](https://support.indeed.com/hc/tr/articles/204488890-%C4%B0%C5%9F-Alarmlar%C4%B1n%C4%B1-Ba%C5%9Flatma-Durdurma-ve-Y%C3%B6netme). Bazı ülke dışı aramalarda alarm sunulmayabilir. |
| Kariyer Kapısı | Kamu işe alımları | Kamu duyurularını keşif; kurumun asıl duyurusu ve son başvuru tarihi | [Resmî portal](https://kariyerkapisi.gov.tr/). İlan arama API'si doğrulanmadı; başvuru tarafındaki e-Devlet akışı ayrı. |
| İŞKUR kurum dışı kamu ilanları / ilan.gov.tr | Kamu işçi ve personel duyuruları | Duyuru sayfası/PDF takibi; kaynak ve tarih doğrulaması | [İŞKUR İstanbul](https://istanbul.iskur.gov.tr/), [Basın İlan Kurumu](https://www.ilan.gov.tr/). Kurum dışı ilan listesinin uçtan uca otomatik alınması henüz sınanmadı. |
| İBB Bölgesel İstihdam Ofisi | İstanbul'da özel sektör iş eşleştirmesi | Şehir uygunsa ek yerel kaynak | [BİO açıklaması](https://kariyer.ibb.istanbul/bio), [ofisler ve çevrimiçi kanal](https://bio.ibb.istanbul/offices). Yalnızca belediyenin kendi kadroları olarak düşünülmemeli. |
| Jooble Türkiye | Türkiye bölgesine ait REST araması | Mevcut adaptör, Türkiye anahtarıyla | [Türkiye API başvurusu](https://tr.jooble.org/api/about), [bölgesel bağlantı belgesi](https://help.jooble.org/tr/support/solutions/articles/60000922689-jooble-rest-api-ye-nas-l-ba%C4%9Flan-l-r). Başka ülkenin anahtarı Türkiye anahtarı yerine kullanılamaz. |

Bu tablodaki öncelikler adayın mesleği henüz bilinmediği için erişim uygulanabilirliğine göredir. Meslek, şehir, çalışma biçimi ve zorunlu şartlar profilden gelince kaynakların önceliği değişmelidir. İstanbul dışında BİO yerine ilgili yerel kaynak ayrıca araştırılmalıdır.

## LinkedIn, Kariyer.net ve İŞKUR için kritik ayrımlar

LinkedIn'in belgelenmiş [Job Posting API'si](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview?view=li-lts-2025-04) iş ilanı yayınlama entegrasyonudur. Bütün ilanları arayabileceğimiz açık bir okuma API'sinin kanıtı değildir. [Otomatik yazılım açıklaması](https://www.linkedin.com/help/linkedin/answer/a1341387) izinsiz bot ve kazıma kullanımına kısıtlar koyuyor. Giriş yapan tarayıcı botunu sistemin temel veri kaynağı olarak önermiyorum.

Kariyer.net'in [webapi alan adı](https://webapi.kariyer.net/) mevcut, ancak kamuya açık, belgelenmiş ve bizim kullanımımıza açılmış bir ilan arama sözleşmesi doğrulanmadı. Bu nedenle “API yok” da “doğrudan bağlanabiliriz” de diyemeyiz. E-posta alarmı doğrulanmış ürün özelliği; posta içe aktarma ise bizim geliştireceğimiz ek bağlantıdır, Kariyer.net tarafından sağlanan resmî entegrasyon diye sunulmamalı.

İŞKUR'da açık ilan araması ile kamu kurumlarının ayrı duyuru/PDF ilanları birlikte düşünülmeli. Bir formun okunması sonuç sayfalarının sorunsuz ve sürekli toplanabileceğini kanıtlamıyor. Otomatik erişim denemesi sırasında hata, engel ve boş sonuç ayrı durumlar olarak kaydedilmeli. Kimlik numarası/parola gerektiren üçüncü taraf kazıyıcı hizmetleri temel çözüm olarak seçilmedi.

## İşbul.net: somut teknik bulgu

18 Eylül'deki doğrudan denemede şu adresler JSON döndürdü:

- `GET https://www.isbul.net/api/agent`
- `GET https://www.isbul.net/api/agent/jobs?per_page=1`
- `GET https://www.isbul.net/api/agent/jobs/861b85da-cba2-4588-9d6b-be41b1c83dc5`

Arama kaydında kimlik, pozisyon, firma, şehir, yayın ve bitiş tarihi, asıl ilan bağlantısı vardı. Detay yanıtında eğitim ve deneyim bilgileri geldi; `description` değeri `null` idi. Bu yüzden detay API'si çalışsa bile tam ilan metni her kayıtta var sayılamaz.

[OpenAPI belgesi](https://www.isbul.net/api/agent/openapi.json) `q`, `city`, `category`, `page`, `per_page` alanlarını açıklıyor; sayfa üst sınırı 25. [Ayrıntılı belge](https://www.isbul.net/llms-full.txt) yanıtların en az 60 saniye önbelleğe alınmasını, toplu paralel taramadan kaçınılmasını belirtiyor. Sayısal istek/dakika garantisi yok. API dizini detay adresini listelerken OpenAPI dosyasında bu yol bulunmuyor; entegrasyon testi bu belge farkını dikkate almalı.

Belgedeki büyük toplam ilan sayıları canlı yanıttaki toplamla örtüşmedi; pazarlama sayıları kapsam hesabına alınmadı. Tek başarılı deneme hizmet sürekliliği garantisi değildir. Entegrasyonda boş açıklama, 429/5xx, bilinmeyen şehir, sayfalama ve süresi dolmuş ilan sınanmalı.

## VPS üzerinde önerilen çalışma düzeni

1. Mevcut site ve profil ekranı korunur. Uygulama ile zamanlayıcı mümkünse VPS'de ayrı servisler olarak çalışır; işletim sistemi başlangıcında açılır ve hata sonrası yeniden başlar. Mevcut Supabase kalıcı kuyruk olarak kullanılabilir; tek kullanıcı için Redis zorunlu değil.
2. API bağlantıları, posta alarmları, resmî duyurular ve Exa keşfi ayrı toplayıcılar olur. Bir kaynak hata verince diğerleri çalışır. Her kaynağın son başarılı erişimi, yeni ilan sayısı ve hatası panelde ayrı gösterilir.
3. İlanın yayıncısı ile edinme kanalı ayrı tutulur: örneğin yayıncı Kariyer.net, kanal e-posta. Jooble veya Exa üzerinden görülen bir ilan, kaynağın bütün ilanlarının tarandığı anlamına gelmez.
4. Toplanan ilanlar URL/kimlikle tekilleştirilir; farklı kaynaklardaki aynı iş için ek karşılaştırma yapılır. Aynı başlıklı farklı işler otomatik birleştirilmemeli. Yayın, güncelleme, ilk görülme ve son doğrulama tarihleri ayrı tutulmalı.
5. Önce konum ve açık zorunlu şartlar, sonra AI uygunluğu değerlendirilir. Meslek ve sektörün yanında aktarılabilir beceriler değerlendirilir. Eksik metin veya şartlar açıkça belirtilir; yapay zekâ bunları tamamlamış gibi davranmaz.
6. Uygun ilan için kısa gerekçe, belirsizlikler, son tarih ve başvuru bağlantısı e-postayla gönderilir. Gönderim kimliği tekrar bildirimleri sınırlar; kaynakta kapanan ilanlar için ayrıca güncellik denetimi gerekir.

Başlangıç için mühendislik önerisi: posta webhook'u varsa geliş anında, yoksa sağlayıcının izin verdiği aralıkla kontrol; API'lerde 15–60 dakika; kamu duyurularında 1–3 saat; Exa keşfinde günde birkaç tur. Bunlar sağlayıcıların onayladığı limitler değildir, denemeyle ayarlanacak başlangıç değerleridir. Kaynak ve AI bütçeleriyle gerçek kuyruk gecikmesi birlikte ölçülmelidir. Mevcut sürümün tur başına beş AI değerlendirmesi geniş kaynak listesinde darboğaz olabilir.

7/24 çalışan süreç, her kaynağın anlık veri verdiği anlamına gelmez. Örneğin günlük LinkedIn e-postası daha sık kontrol edilerek günlük yayın gecikmesinden kurtarılamaz. Hedef, uygun fırsatları yüksek kapsamayla ve ölçülen gecikmeyle bulmaktır; bütün internet için sıfır kaçırma garantisi verilemez.

## Gelen e-posta bağlantısı

Mevcut Resend bağlantısı ablana bildirim göndermek içindir. LinkedIn/Kariyer.net alarmlarını almak için ayrıca yetkilendirilmiş özel posta kutusu veya yalnızca iş alarmı klasörü gerekir. Gmail/Outlook OAuth, IMAP veya gelen posta webhook'u kullanılan posta hizmetine göre seçilebilir; bu araştırmada ablanın posta sağlayıcısı varsayılmadı.

İlk kurulumda dış platformlardaki alarmlar bir kez açılır. Profil değişince bu alarmların otomatik güncellendiği varsayılmamalı. İçe alma mesaj kimliğiyle tekrarı önlemeli, yalnızca beklenen gönderenleri işlemeli ve e-postadaki keyfî bağlantıları sunucudan takip etmemeli. İlan metni AI için veri olmalı; metnin içindeki talimatlar uygulanmamalı. Ayrıntısız alarm e-postasının tam ilanı sağladığı varsayılmamalı.

## Exa'nın sistemdeki rolü

Exa'yı Türkiye alan adları, meslek eşanlamlıları, şehirler ve şirket kariyer sayfaları üzerinde tamamlayıcı keşif için öneriyorum. [Arama belgeleri](https://exa.ai/docs/reference/search-api-guide-for-coding-agents) alan adı ve tarih filtrelerini açıklıyor. [Güncellik seçenekleri](https://exa.ai/docs/reference/search-best-practices) bilinen sayfanın tekrar alınmasına yardımcı olur; henüz keşfedilmemiş her ilanın anında bulunacağını garanti etmez.

Bu araştırmada kullanılan bağlı Exa eklentisi ile VPS uygulamasının API erişimi ayrıdır. Uygulamaya Exa eklenirse sunucu tarafında ayrıca API erişimi ve kullanım bütçesi gerekir. Özel aday profilinin tamamı arama servisine gönderilmemeli; yalnızca gereken meslek/şehir sorguları kullanılmalı. Bu turda Exa uygulama adaptörü veya API anahtarı eklenmedi.

## Uygulama sırası ve bu turda yapılanlar

Önerilen sıra: (1) İşbul.net doğrudan adaptörü ve mevcut Jooble Türkiye bağlantısı; (2) LinkedIn, Kariyer.net ve Indeed alarm e-postası içe alma; (3) İŞKUR ve kamu duyuruları için erişim denemeleriyle bağlantı; (4) profilin gerektirdiği Eleman.net, Secretcv ve yerel kaynaklar; (5) Exa ile tamamlayıcı şirket/ilan keşfi. Kaynak sayısından çok yeni ve uygun ilan katkısı ölçülmeli. İlk canlı denemede gecikme, yinelenen ilanlar, açıklama doluluğu ve yanlış eşleşmeler karşılaştırılmalı.

Bu araştırma turunda Jooble çağrısı `jooble.org` yerine `tr.jooble.org` olarak düzeltildi; adaptör testi, kurulum bağlantısı, ortam değişkeni açıklaması ve VPS belgesi güncellendi. `npm run test:jobs` içindeki 22 test geçti. İşbul.net, gelen posta ve kamu bağlantıları bu raporla tamamlanmış entegrasyon sayılmaz. Canlı anahtar kurulumu, VPS dağıtımı veya gerçek alıcıya e-posta gönderimi yapılmadı.
