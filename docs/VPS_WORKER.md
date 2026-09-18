# Mevcut VPS için iş takip zamanlayıcısı

18 Eylül 2026'da SSH ile doğrulanan ortam: Ubuntu 22.04.5, 2 işlemci çekirdeği, yaklaşık 4 GB RAM, 2,3 GB kullanılabilir RAM, 2,4 GB boş disk. Docker üzerinde mevcut uygulamalar çalışıyor. Host üzerinde Python 3.10 var; Node kurulu değil. Zamanlayıcı standart Python kütüphanesiyle çalışır, paket veya Docker imajı indirmez.

ablamablam.com Vercel üzerinden yanıt veriyor. Kullanıcının yayın yöntemi GitHub push → otomatik Vercel dağıtımı. İnceleme anında `/is` ve `/api/jobs/scan` HTTP 404 döndürdü. Bu nedenle canlı tarama henüz başlatılamaz. VPS zamanlayıcısı Vercel'deki endpoint'i çağırır; işin kendisi Vercel'de yürür ve o ortamın fonksiyon süre sınırına tabidir.

## Bu çalışma sonunda durum

- SSH bağlantısı ve kapasite kontrolü başarılı.
- Yerel Python zamanlayıcısı ve systemd servis/timer dosyaları hazır.
- Altı yerel HTTP senaryosu geçti: başarılı tarama, bekleme yanıtı, kaynak hatası, HTTP 401, beklenmeyen yanıt biçimi ve yönlendirme reddi. Anahtar veya ham kaynak hata metni günlükte görünmedi.
- Codex'e eklenen `my-vps` SSH bağlantısıyla kurulum tamamlandı. `/opt/ablam/scripts/jobs-scan.py`, `ablam-jobs-scan.service` ve `ablam-jobs-scan.timer` sunucuda mevcut; systemd iki birimi de yükledi.
- Zamanlayıcı anahtarı doğrudan VPS üzerinde `/etc/ablam/jobs-worker.env` dosyasında oluşturuldu. Dosya root'a ait ve izinleri `0600`; anahtar çıktılara veya pakete eklenmedi.
- Gerçek systemd ortamında DynamicUser, EnvironmentFile ve dosya sistemi kısıtlarıyla yapılandırma kontrolü başarılı oldu (çıkış kodu 0). Bu kontrol tarama, AI çağrısı veya e-posta gönderimi yapmadı.
- Son kontrolde canlı `/is` ve `/api/jobs/scan` hâlâ 404. Timer `disabled/inactive`; yayın ve Vercel ortamı tamamlanana kadar etkinleştirilmedi. Uygulama anahtarlarının Vercel'de tanımlanmış olduğu varsayılmıyor.

## Kurulum

Mevcut VPS'de aşağıdaki kurucu **zaten çalıştırıldı**. Yeniden çalıştırmaya gerek yok; sonraki adım üretilen `CRON_SECRET` değerini Vercel Production ortamına eklemek, uygulamayı yayımlamak ve aşağıdaki ilk tarama kontrolünü yapmak. Kurulum adımları yeniden kurulum/yeni sunucu için saklanmıştır.

`ablam-vps-worker.zip` paketini VPS'ye yükleyip bir dizine açın. Paket yalnızca `scripts/jobs-scan.py`, systemd dosyaları, kurucu ve bu kılavuzu içerir; parola veya API anahtarı içermez. Tam site kaynaklarıyla da aynı işlem yapılabilir.

Paket kökünde:

```bash
sudo bash deploy/install-vps-worker.sh
```

Kurucu mevcut hedef dosyaların üzerine yazmayı reddeder. Python dosyasını `/opt/ablam/scripts/` altına, servisleri `/etc/systemd/system/` altına kurar. `/etc/ablam/jobs-worker.env` dosyasını yalnızca root'un okuyabileceği izinlerle oluşturur. systemd bu ortamı servis sürecine aktarır; süreç geçici ve yetkisiz kullanıcıyla çalışır. Kurucu zamanlayıcıyı etkinleştirmez.

Vercel projesinin Production ortamına `/etc/ablam/jobs-worker.env` içindeki **aynı** `CRON_SECRET` değerini ekleyin. Dosyayı kendi SSH terminalinizde `sudo cat /etc/ablam/jobs-worker.env` ile okuyabilirsiniz. Bu dosyayı GitHub'a veya `push` klasörüne koymayın. Ortam değişikliği için yeniden dağıtım gerekir.

GitHub'a uygulama değişiklikleri gönderilip Vercel dağıtımı tamamlanmalı. [Genel kurulum](JOBS_SETUP.md) uyarınca Supabase tabloları, iş alanı parolası, ilan sağlayıcıları ve e-posta bağlantısı da hazırlanmalı. Yerel ortam incelemesinde `JOBS_PASSWORD`, `JOOBLE_API_KEY`, `SERPAPI_API_KEY`, `RESEND_API_KEY` ve `CRON_SECRET` boştu; Vercel ortam değişkenleri bu çalışmada incelenmedi. İşbul.net adaptörü ve gelen alarm e-postası bağlantısı henüz geliştirilmedi.

İlk denemeyi profil takibi kapalıyken yapmak ücretli kaynak/AI çağrısı veya e-posta gerektirmez. Veritabanı ve Vercel ortamı hazır olduktan sonra:

```bash
sudo systemctl start ablam-jobs-scan.service
sudo journalctl -u ablam-jobs-scan.service -n 10 --no-pager
```

Beklenen yanıt `paused` olmalıdır. 404 dağıtımın eksik olduğunu, 401 anahtarların uyuşmadığını gösterir. 5xx için uygulama/veritabanı günlüklerini inceleyin. İlk deneme başarılı olunca:

```bash
sudo systemctl enable --now ablam-jobs-scan.timer
systemctl list-timers ablam-jobs-scan.timer
```

Bu timer açılıştan yaklaşık iki dakika sonra ve biten çalışmadan beş dakika sonra tetikler. Aynı systemd servisi üst üste çalıştırılmaz. İşlemin üst süresi 300 saniyedir; kaynak tarama aralıkları ve günlük bütçeler uygulamada ayrıca uygulanır. Profil tamamlanıp takip açılınca ilan toplama ve e-posta akışı başlar.

## İşletim

```bash
sudo journalctl -u ablam-jobs-scan.service -n 30 --no-pager
sudo systemctl status ablam-jobs-scan.timer
sudo systemctl disable --now ablam-jobs-scan.timer
```

Son komut gelecekteki taramaları durdurur; hâlen çalışan bir tur varsa ayrıca `sudo systemctl stop ablam-jobs-scan.service` kullanılır. Python zamanlayıcısı, mevcut Node worker ve Vercel cron seçeneklerinden yalnızca biri etkin olmalıdır. Yeni kaynak adaptörleri daha sonra uygulamaya eklendiğinde VPS zamanlayıcısını değiştirmek gerekmez.
