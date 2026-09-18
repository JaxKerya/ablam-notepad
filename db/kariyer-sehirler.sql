-- Ablam Kariyer — tek "sehir" kolonundan çoklu "sehirler" dizisine geçiş.
-- Mevcut kurulumda bir kez çalıştırın; sıfırdan kurulumda gerek yok
-- (db/kariyer.sql zaten sehirler ile kurar). Mevcut şehir korunur.

alter table kariyer_profil add column if not exists sehirler text[] not null default '{}';
update kariyer_profil set sehirler = array[sehir] where sehir is not null and sehir <> '' and sehirler = '{}';
alter table kariyer_profil drop column if exists sehir;

notify pgrst, 'reload schema';
