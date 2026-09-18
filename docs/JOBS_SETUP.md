# Ablam İş Fırsatları

Yeni bölüm `/is`; ana sayfadaki uygulama bağlantılarından açılır. Mevcut yeşil tema, notlar, Sheets ve Ders korunur. **Kodun kurulmuş olması otomatik taramanın canlı olduğu anlamına gelmez.** Aşağıdaki veritabanı, sağlayıcı ve zamanlayıcı bağlantıları gerekir.

## İlk kurulum

1. Mevcut Supabase projesinde `db/jobs.sql` dosyasının tamamını SQL Editor'da çalıştırın. Tekrar çalıştırılabilir; mevcut not/ders tablolarını değiştirmez. Yeni tablolar RLS ile kapalıdır, yalnızca `service_role` erişir.
2. `.env.local.example` dosyasındaki iş takibi değişkenlerini hosting ortamına ekleyin. Yerel geliştirmede `.env.local` kullanın. Gerçek anahtarları git'e, `/push` klasörüne veya istemci koduna kopyalamayın.
3. `SUPABASE_SERVICE_ROLE_KEY`, en az 16 karakterlik benzersiz `JOBS_PASSWORD`, güçlü `SITE_GATE_SECRET` ve rastgele `CRON_SECRET` tanımlayın. İş alanının parolası mevcut sitenin karşılama kelimesinden bağımsızdır. Parola değiştirilince iş alanının eski oturumları geçersizleşir. 15 dakikada 10 giriş denemesi sınırı vardır.
4. Mevcut `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` bağlantısı kullanılır. İsteğe bağlı `JOBS_AI_MODEL` bu bölümün modelini değiştirir. OpenAI uyumlu `chat/completions` ve JSON object çıktısı gerekir. Ad ve e-posta modele gönderilmez; beceri/deneyim metinlerine eklenen bilgiler gönderilir.
5. Kullanılacak arama kaynaklarını bağlayın:
   - [Jooble Türkiye REST API](https://tr.jooble.org/api/about): `JOOBLE_API_KEY`; anahtarı Türkiye portalından alın. Bağlantı `https://tr.jooble.org/api/{key}` adresini kullanır. ABD portalında alınan anahtar Türkiye aramaları için uygun değildir; [bölgesel anahtar açıklaması](https://help.jooble.org/tr/support/solutions/articles/60000922689-jooble-rest-api-ye-nas-l-ba%C4%9Flan-l-r).
   - [SerpApi Google Jobs](https://serpapi.com/google-jobs-api): `SERPAPI_API_KEY`; Türkçe arayüz ve Türkiye arama bölgesi kullanılır.
   - [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html): anahtarsız, şirket panosu kısa adları profilde.
   - [Lever Postings API](https://github.com/lever/postings-api): anahtarsız global (`api.lever.co`) panolar. Lever EU panoları bu sürümde desteklenmez.
6. [Resend](https://resend.com/docs/api-reference/emails/send-email) hesabında gönderen alan adını DNS ile doğrulayın. `RESEND_API_KEY` ve `JOBS_EMAIL_FROM` tanımlayın. Örnek: `Ablam İş Fırsatları <firsatlar@ablamablam.com>`; alan adı sizin hesabınızda doğrulanmış olmalı.
7. Siteyi normal Next.js dağıtım yöntemiyle yayınlayın (`npm ci`, `npm run build`, `npm start`). `/push` dağıtım dosyalarıdır; bu çalışma siteyi otomatik olarak yayınlamaz.
8. Aşağıdaki zamanlayıcı yöntemlerinden **birini** kurun.
9. `/is` üzerinden giriş yapın; profil, şehir, meslekler, kaynaklar ve e-posta adresini doldurun. Profili kaydedin, test e-postasını gönderin, takibi açın. “Şimdi kontrol et” ile ilk turu doğrulayın. Otomatik çalışmanın geldiğini Sistem günlüğünde ayrıca görün.

## Tarayıcı kapalıyken sürekli çalışma

### Sürekli çalışan Node sunucusu / VPS

**Mevcut VPS için hazırlanan hafif seçenek:** [Python + systemd timer kurulum kılavuzu](VPS_WORKER.md). Site GitHub üzerinden Vercel'e yayımlanırken VPS yalnızca zamanlayıcıyı çalıştırabilir; VPS'ye Node kurmak gerekmez. Aşağıdaki Node worker bunun alternatifidir; ikisini birlikte etkinleştirmeyin.

Bu proje için mevcut VPS kullanılacak; ayrı bir VPS veya Vercel cron planı almak gerekmez. Kaynak ve AI servislerinin kendi kullanım ücretleri ayrıca geçerlidir. VPS'nin işletim sistemi ve kapasitesi henüz doğrulanmadığından aşağıdaki Linux servisi bir dağıtım şablonudur. Site başka yerde barınıyorsa VPS yalnızca zamanlayıcıyı da çalıştırabilir; bu durumda tarama isteğinin süre sınırı sitenin hosting ortamına bağlı kalır. Uzun işlemler için Next.js uygulaması ve zamanlayıcının aynı VPS'de çalışması tercih edilir. Web uygulamasının da yeniden başlatma sonrası açılan ayrı bir servis olarak çalıştırılması gerekir; `jobs-worker.service` yalnızca zamanlayıcıyı başlatır.

`scripts/jobs-worker.mjs` sunucuya beş dakika arayla imzalı istek gönderir. Node 22.9+ kullanın. Çalışmalar üst üste binmez; bir tur bittikten beş dakika sonra yenisi başlar. Profildeki tarama aralıkları ayrıca uygulanır.

Yerel komut: `npm run jobs:worker` (`.env.local` varsa yükler).

Linux örneği: `deploy/jobs-worker.service` içindeki kullanıcı, çalışma dizini ve Node yolunu düzenleyin. `/etc/ablam/jobs-worker.env` dosyasına yalnızca `JOBS_SITE_URL=https://ablamablam.com` ve aynı `CRON_SECRET` değerini koyun; dosyayı sadece servis kullanıcısı okuyabilsin. Servis dosyasını `/etc/systemd/system/ablam-jobs.service` olarak kurun, ardından `systemctl enable --now ablam-jobs` çalıştırın. Günlük: `journalctl -u ablam-jobs`.

Windows sunucuda aynı komutu Task Scheduler ile sistem başlangıcında, kullanıcı oturumu açık olmasa da çalışacak şekilde başlatın; başarısızlıkta yeniden başlatmayı etkinleştirin. Yerel bilgisayar uyursa/kapanırsa tarama durur; 7/24 için sürekli açık hosting gerekir.

### Hosting cron / Vercel

`deploy/vercel.jobs.example.json` örneğini mevcut `vercel.json` yapılandırmasına **birleştirin**. Mevcut ayarların üzerine körlemesine yazmayın. Hosting'de `CRON_SECRET` tanımlayın. Endpoint: `GET /api/jobs/scan`, başlık: `Authorization: Bearer <CRON_SECRET>`.

Beş dakikalık cron ve 300 saniyelik Node fonksiyonu desteği hosting planına bağlıdır; [Vercel cron sınırlarını](https://vercel.com/docs/cron-jobs/usage-and-pricing) ve [fonksiyon süresini](https://vercel.com/docs/functions/configuring-functions/duration) dağıtım sırasında doğrulayın. Bu nedenle örnek dosya otomatik olarak etkinleştirilmez. Süre sınırı düşük sunucuda kuyruk kısmen işlenip sonra devam edebilir; 300 saniye destekleyen ortam önerilir. Proxy timeout'u da buna uygun olmalıdır.

## Çalışma akışı

- Profilin meslekleri, ilgi alanları ve AI'ın önerdiği yakın meslekler şehirlerle eşleştirilir. Sorgular kaynak başına sırayla taranır. AI sorgu üretimi hata verirse açıkça yazılan meslek ve ilgilerle devam edilir; hata günlükte görünür.
- Her tur en fazla 4 zamanı gelmiş kaynak panosu işlenir. Jooble 20, Google İşler en fazla 10 ilanlık sayfalar döndürür; sonraki sayfa kalıcı olarak tutulur. Bir sorgunun en fazla 5 sayfası taranır, sonra sıradaki sorguya geçilir. Sınır kaynak ekranında görünür. Şirket panoları tüm açık ilanları döndürür; Lever'da aynı 5 sayfalık sınır uygulanır.
- Kaynak hataları birbirinden ayrıdır. Bir sağlayıcı hata verdiğinde diğerleri ve daha önce toplanmış ilanların değerlendirilmesi devam eder.
- İlanlar temizlenmiş URL'nin SHA-256 özetiyle tekilleştirilir. Aynı URL tekrar gelirse başvuru durumu ve bildirim kaydı korunur. **Farklı platformlarda farklı URL'lerle yayınlanan aynı işin tekilleştirilmesi garanti edilmez**; aynı başlıklı farklı işlerin yanlışlıkla silinmesi tercih edilmedi. Kaydedilen açıklama ilk alındığı andaki kopyadır.
- Her tur en fazla 5 güncel ilan AI tarafından değerlendirilir. Başarısız çağrılar artan aralıklarla yeniden denenir. Anahtar kelimeler yalnızca bulma içindir; uygunluk AI tarafından deneyim, aktarılabilir beceri, konum, dil ve zorunlu şartlarla belirlenir. AI eksik bilgiyi sorulara yazar. Puan işe alınma olasılığı değildir.
- Profilin mesleki bilgileri değişince güncel ilanlar yeniden sıraya girer. Yalnızca bildirim eşiği/ayar değişirse mevcut değerlendirmeler tekrar kullanılır. Profil değişimi PostgreSQL fonksiyonunda atomiktir; eski sekmeden kayıt engellenir.
- AI sonucunu kaydetmek ve bildirim hazırlamak ayrı adımlardır; arada kesinti olsa da sonraki tur eksik bildirimleri bulur. Gönderim öncesi güncel profil, ilan durumu ve alıcı kontrol edilir. Başvurulan/gizlenen ilanlar bildirilmez.
- E-postalar Resend tarafından kabul edilince “Servise iletildi” gösterilir; gelen kutusuna teslim veya açılma teyidi tutulmaz. [Resend idempotency anahtarı](https://resend.com/docs/dashboard/emails/idempotency-keys) kısa aralıklı tekrarları önler. Sağlayıcı anahtarının saklama süresi sınırlıdır (24 saat); ağdaki belirsiz sonuçlardan sonra **mutlak tek gönderim garantisi yoktur**. Gönderimi denenmiş bir mesajın alıcısı/metni değiştirilmez. Profil değişince belirsiz denemeler iptal edilir ve günlükte bırakılır; bu ilan site içinde erişilebilir kalır.
- Takibi duraklatmak hem toplama/değerlendirmeyi hem otomatik gönderimi durdurur. E-posta tercihini kapatmak yalnızca gönderimi durdurur. Başvuru gönderme otomasyonu yoktur; ilanı açıp başvuruyu ablan yapar.
- Beş dakikalık veritabanı kilidi çift çalışan zamanlayıcıları engeller. Kesilen turun kayıtları bir sonraki turda “Kesildi” olur; kuyruk kaybolmaz. İşlemler süre sınırına yaklaşınca durur. Kilit kaydı yalnızca sahibi tarafından silinir.
- Günlük `JOBS_DAILY_AI_LIMIT=100` ve `JOBS_DAILY_SEARCH_LIMIT=100` varsayılanları UTC gece yarısında yenilenir. Sınır çağrı sayısıdır, para cinsinden bütçe değildir. Sağlayıcılarda ayrıca harcama limitleri ayarlayın. Manuel turlar da aynı sınırlara tabidir.

## Kapsam ve işletim sınırları

Türkiye kaynakları için Exa araştırması ve önerilen yeni bağlantılar: [Türkiye kaynak raporu](../exa-results/turkiye-is-kaynaklari-2026-09-18/REPORT.md). Rapordaki İşbul.net, e-posta alarmı içe aktarma ve kamu kaynakları öneridir; mevcut kaynak adaptörlerine henüz eklenmemiştir. E-posta gönderimi, gelen iş alarmı e-postalarının okunması anlamına gelmez.

Hiçbir bağlantı tüm interneti kapsamaz. LinkedIn, Kariyer.net ve İŞKUR doğrudan taranmaz; sadece bağlı sağlayıcıların döndürdüğü ilanları bulunabilir. Oturum açma, CAPTCHA veya erişim engeli aşma yapılmaz. Kaynakların plan, lisans ve güncelleme sınırlarına uyulur.

Yayın tarihi bilinmeyen ilanlar elenmez, arayüzde belirtilir. Jooble/Greenhouse güncelleme tarihini paylaşabilir; bu her zaman ilk yayın tarihi değildir. Kapanan bir ilan için otomatik başvuru engeli/ilanın hâlâ açık olduğuna dair canlı kontrol yoktur. Başvuru öncesi kaynak sayfasını kontrol edin. Ağ, hosting veya sağlayıcı kesintisinde anlık yakalama garanti edilemez.

Panel son otomatik tur 15 dakikadan eskiyse uyarır. Site tamamen kapalıyken kendisi e-posta gönderemez; hosting sağlayıcısının uptime/cron hata uyarılarını ayrıca açın. API anahtarlarını sunucuda değiştirip uygulamayı yeniden başlatın. İlanlar, bildirimler ve çalışma günlükleri kalıcıdır; uzun süreli kullanımda boyutu izleyip eski kayıtlar için yedekli saklama politikası belirleyin.

## Doğrulama

- `npm run test:jobs`: gerçek PostgreSQL motoru (PGlite) üzerinde SQL/RLS/kilit/bütçe/profil geçişleri; doğrulama, kaynak sözleşmeleri, AI veri sınırı, oturum ve e-posta tekrarları. Testler gerçek kişisel veri, API anahtarı veya e-posta kullanmaz.
- `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- Tarayıcı kontrolleri için `npm run test:jobs:ui` (önce Playwright Chromium kurulumu: `npx playwright install chromium`; sistem Chrome için `PLAYWRIGHT_CHANNEL=chrome`). Testler 3100 portundaki yerel build'i kullanır ve dış servis yanıtlarını açıkça test verisiyle taklit eder. Gerçek AI/ilan/e-posta sağlayıcı bağlantıları ayrıca canlı kurulumda denenmelidir.

## Hızlı sorun giderme

- Girişte bağlantı hatası: `db/jobs.sql`, service role, Supabase URL ve `SITE_GATE_SECRET` kontrol edin. Yeni tablolar anon anahtarıyla çalışmaz.
- Takip açık ama otomatik tur yok: zamanlayıcı süreci/cron, `JOBS_SITE_URL`, `CRON_SECRET` ve HTTPS/proxy yönlendirmelerini kontrol edin. Redirect takip edilmez; doğru ana alan adını kullanın.
- Kaynak 401/403: API anahtarı/hesap erişimi; 429: kota veya istek sıklığı. Taramalar kalıcı kuyruk üzerinden sürer.
- Çok az ilan: meslek/şehir sorgularını ve seçili şirketleri genişletin; sırayla tarandıkları için birkaç tur bekleyin. API kapsamını sağlayıcıdan doğrulayın.
- Bildirim yok: e-posta tercihi, eşik, eligible sonucu, AI kuyruğu, gönderici alan adı ve çalışma günlüğünü kontrol edin. Test e-postası da başarısızsa Resend hesabına bakın.
