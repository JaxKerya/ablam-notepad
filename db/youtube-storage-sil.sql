-- Ablam YouTube: bir bölüm/sahne silinince Storage'daki dosyaları da temizleyebilmek için
-- (onizleme/, thumbnail/, kapak/). Bucket zaten herkese açık; silme izni de aynı seviyede.
drop policy if exists "youtube_public_delete" on storage.objects;
create policy "youtube_public_delete" on storage.objects for delete using (bucket_id = 'youtube');
