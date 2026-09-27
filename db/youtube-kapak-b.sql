-- Ablam YouTube: A/B kapak testi. Stüdyo her bölümde ikinci bir kapak üretir (config [kapak] b_varyant);
-- sitede A'nın yanında görünür, YouTube Studio "Test ve karşılaştır"a elle yüklenir.
alter table youtube_bolumler add column if not exists kapak_b_url text;
