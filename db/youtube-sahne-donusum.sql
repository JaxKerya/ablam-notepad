-- Ablam YouTube: sahne dönüşümü.
-- youtube_seriler.sahne_idler : serinin dönüşüm havuzu (stüdyo her bölümde kurallara göre birini seçer).
--                               Eski tek sahne (sahne_id) varsayılan olarak havuza konur.
-- youtube_bolumler.sahne_elle : true = sahneyi kullanıcı bu bölüm için elle seçti, dönüşüm dokunmaz.
alter table youtube_seriler add column if not exists sahne_idler uuid[] not null default '{}';
update youtube_seriler set sahne_idler = array[sahne_id]
where sahne_id is not null and cardinality(sahne_idler) = 0;

alter table youtube_bolumler add column if not exists sahne_elle boolean not null default false;
