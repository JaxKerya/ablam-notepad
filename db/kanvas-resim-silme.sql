-- Ablam Kanvas: kanvas silinince yapıştırılan resimleri depodan da sil (17.10.2026).
-- Bir kez çalıştırılır; tekrar çalıştırmak zararsız.
--
-- İzin YALNIZCA AblamAblam deposundaki kanvas/ klasörü için. NotePad'in not
-- görselleri (aynı depoda, not kimliği klasörlerinde) ve diğer depolar
-- bundan etkilenmez; onları site anahtarıyla silmek yine mümkün değil.
--
-- Silmeyi /kanvas listesindeki "Kanvası sil" yapıyor (app/kanvas/page.tsx).
-- Tahtada bir resmi silmek dosyaya dokunmuyor: geri alınabilsin diye.
drop policy if exists "kanvas_resimleri_silinebilir" on storage.objects;
create policy "kanvas_resimleri_silinebilir" on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'AblamAblam' and name like 'kanvas/%');
