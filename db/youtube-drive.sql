-- Ablam YouTube — Drive yedeği bağlantısı (2026-09-21). Bir kez çalıştırın.
-- Stüdyo yayından sonra ses+senaryoyu Drive'a yedekler; klasör linki burada durur.
alter table youtube_bolumler add column if not exists drive_url text;
