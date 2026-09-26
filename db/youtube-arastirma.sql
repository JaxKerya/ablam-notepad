-- Ablam YouTube: senaryodan önce yapılan web araştırmasının bilgi dosyası.
-- Stüdyo yazar; sitede senaryo onayında "Araştırma notları" olarak görünür.
alter table youtube_bolumler add column if not exists arastirma_md text;
