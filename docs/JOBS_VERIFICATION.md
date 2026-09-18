# İş Fırsatları doğrulama kaydı

18 Eylül 2026, yerel Windows ortamı; Node 24 ve Chrome.

- `npm run test:jobs`: **22/22 geçti**. Gerçek PostgreSQL motorunda SQL kurulumu (pgcrypto dahil), tekrar kurulum, RLS, kilit, atomik günlük sınırlar, atomik profil geçişleri ve giriş deneme sınırı; kaynak yanıtları, kuyruk kurtarma, AI/e-posta hataları ve oturum koruması.
- `npm run test:jobs:ui`: **6/6 geçti**. Yetkisiz API erişimi, özel giriş ekranı, profil kaydı, sekmeler arasında taslak koruma, ilan araması/başvuru durumu, hata ekranı, 1440px masaüstü ve 390px mobil görünüm. Ana sayfa, Sheets ve Ders için regresyon kontrolü.
- `npm run build`: Next.js 16.3.5 üzerinde başarılı; TypeScript kontrolü dahil.
- `npm run lint`: hata yok. Önceden mevcut NoteEditor ve Toolbar dosyalarında toplam 4 kullanılmayan değişken uyarısı bulunuyor; yeni dosyalarda uyarı yok.
- `npm audit` ve `npm audit --omit=dev`: **0 güvenlik açığı**. Next.js / eslint-config-next 16.3.5'e yükseltildi; uyumlu bağımlılık güvenlik düzeltmeleri lockfile'a işlendi.

Tarayıcı testlerindeki ilan ve profil verileri açıkça test verisidir. Kaynak, AI ve e-posta sözleşme testleri sahte servis yanıtları kullanır. Gerçek e-posta gönderilmedi; canlı ilan sağlayıcılarıyla uçtan uca tarama yapılmadı. Mevcut ortamda iş takibinin Supabase service role, ilan ve e-posta servis anahtarları yoktu. Bu servislerin gerçek bağlantısı ve zamanlayıcının canlı çalışması kurulum sonrasında doğrulanmalıdır.

Yeni profil/ilan tabloları canlı Supabase projesine uygulanmadı. Canlı siteye dağıtım yapılmadı. `/push` yerel dağıtım kopyası olarak senkronize edildi; gerçek `.env` dosyaları, node_modules, Git geçmişi, derleme önbelleği ve test çıktıları dağıtım kopyasına dahil edilmez.
