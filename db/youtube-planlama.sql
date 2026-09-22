-- Ablam YouTube: yayın planlama.
-- yayin_zamani: dolu ise video "gizli" yüklenir ve YouTube o anda (publishAt) herkese açık yapar — stüdyonun o saatte
--               açık olması gerekmez. Boş = yüklenir yüklenmez seçilen gizlilikle yayında.
-- otomatik_yukle: video hazır olunca "YouTube'a yükle" düğmesini beklemeden yükle.
alter table youtube_bolumler add column if not exists yayin_zamani timestamptz;
alter table youtube_bolumler add column if not exists otomatik_yukle boolean not null default false;
