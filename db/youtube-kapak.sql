-- Ablam YouTube: kapak (küçük resim) otomatik üretimi.
-- Site "yeniden üret" deyince true olur; stüdyo kapağı üretip thumbnail_url'i yazar ve bayrağı kapatır.
alter table youtube_bolumler add column if not exists kapak_istek boolean not null default false;
