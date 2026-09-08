# Ablam NotePad

A minimal, real-time collaborative notepad. Dark theme, distraction-free, link-based access. No accounts, no clutter — just notes.

## Tech Stack

- **Next.js** (App Router)
- **Tailwind CSS**
- **TipTap** (rich text editor)
- **Supabase** (database + real-time sync)

## Getting Started

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Once the project is ready, go to **Settings > API** and copy your:
   - **Project URL** (e.g. `https://abcdefg.supabase.co`)
   - **anon/public key**

### 2. Run the Database Schema

Open the **SQL Editor** in your Supabase dashboard and run the following:

```sql
-- Create the notes table (TEXT id for custom note names)
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  content JSONB DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Enable Row Level Security
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- RLS Policies: public read/write by note ID
CREATE POLICY "Allow public read by id"
  ON notes FOR SELECT USING (true);

CREATE POLICY "Allow public insert"
  ON notes FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update by id"
  ON notes FOR UPDATE USING (true);

CREATE POLICY "Allow public delete by id"
  ON notes FOR DELETE USING (true);

-- Required for Supabase Realtime to send full row data on UPDATE
ALTER TABLE notes REPLICA IDENTITY FULL;
```

### 2b. Run Migration SQL (New Features)

If you already have an existing `notes` table, run this migration:

```sql
-- Pin support
ALTER TABLE notes ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT false;

-- Password protection
ALTER TABLE notes ADD COLUMN IF NOT EXISTS password_hash TEXT DEFAULT NULL;
```

### 2c. Setup Supabase Storage (for Image Upload)

1. Go to **Storage** in your Supabase Dashboard
2. Create a new bucket called **`note-images`**
3. Set the bucket to **Public**
4. Add an RLS policy to allow uploads:

```sql
CREATE POLICY "Allow public upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'note-images');

CREATE POLICY "Allow public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'note-images');
```

### 3. Enable Realtime

In your Supabase dashboard:

1. Go to **Database > Replication**
2. Find the `notes` table and **enable Realtime** for it

This is required for live sync between multiple users.

### 4. Configure Environment Variables

Copy the example file and fill in your Supabase credentials:

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 5. Install Dependencies & Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Enter a custom note name (e.g. `my-shopping-list`) to create or open a note.

Share the URL (e.g. `http://localhost:3000/note/my-shopping-list`) with anyone — they'll see live updates in real time.

## Sheets — Animasyon İş Takip Sistemi (`/sheets`)

Link tabanlı, gerçek zamanlı bir animasyon shot takip sistemi. Çok projeli, proje
bazında özelleştirilebilir durumlar/pipeline kolonları ve animatör kadrosu içerir.
Mevcut site geçidi (`helikopter`) arkasında çalışır.

### Kurulum

Supabase **SQL Editor**'da `db/sheets.sql` dosyasının tamamını çalıştırın. Bu dosya
şu tabloları, RLS politikalarını ve Realtime yayınını oluşturur:

- `sheet_projects` — projeler (ad + isimlendirme şablonu)
- `sheet_statuses` — proje bazında özelleştirilebilir durumlar (renk + sıra)
- `sheet_pipeline_columns` — onay kutucuğu kolonları (varsayılan boş, isteğe bağlı eklenir)
- `sheet_animators` — animatör kadrosu (renk + sıra)
- `sheet_shots` — shot'lar (animatör, shot kodu, kare, not, durum, pipeline, revize)

### Kullanım

- `/sheets` → proje listesi (oluştur / aç / sil). Birden fazla proje desteklenir.
  Yeni proje 4 varsayılan durumla (Yapılmadı, Yapılıyor, Hazır, Onay) açılır; pipeline
  kolonları ve isimlendirme şablonu boş başlar, ayarlardan isteğe bağlı eklenir.
- `/sheets/[projectId]` → shot takip tablosu. Hücreler inline düzenlenir, değişiklikler
  otomatik kaydedilir (600ms debounce) ve Realtime ile diğer kullanıcılara senkronlanır.
- **Tablo** sekmesi: shot'lar; **Özet** sekmesi: animatör × durum matrisi + toplam kare.
- **Ayarlar**: animatör / durum / pipeline kolonu yönetimi + isimlendirme şablonu.

## Ablam Ders — video destekli kendini sınama (`/ders`)

İzlenen bir YouTube ders videosunun linkinden, o derste anlatılanları ölçen sorular
üretir. Sorular şıklı değil, açık uçlu cevaplanır; her cevap yapay zeka tarafından
değerlendirilip anında geri bildirim verilir. Yanlış cevapta konunun videoda
anlatıldığı ana giden link gösterilir.

### Kurulum

**1.** Supabase **SQL Editor**'da `db/ders.sql` dosyasının tamamını çalıştırın. Şu
tabloları oluşturur: `ders_videos` (video başına bir kez çekilen transkript),
`ders_sessions`, `ders_questions`, `ders_answers`.

**2.** `.env.local` dosyasına dört değişken ekleyin:

```
AI_BASE_URL=https://yapayzekalab.org/v1
AI_API_KEY=...
AI_MODEL=gemini-3.7-flash-high
AI_GRADE_MODEL=gemini-3.7-flash-high
SUPADATA_API_KEY=...
SITE_GATE_SECRET=rastgele-uzun-bir-metin
```

`SUPADATA_API_KEY` için [supadata.ai](https://supadata.ai/) üzerinden ücretsiz hesap
açmanız yeterli — ücretsiz katman ayda 100 transkript veriyor.

`SITE_GATE_SECRET` giriş çerezini imzalar; rastgele uzun bir metin olmalı
(`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).

### Nasıl çalışıyor

1. **Transkript** (`/api/ders/transcript`) — üç katmanlı: Supadata → YouTube'un kendi
   altyazı ucu → elle yapıştırma. Link çözümlemesi oynatma listesi parametrelerini
   yok sayar (`watch?v=...&list=...&index=...` sorunsuz çalışır); saf liste adresi
   (`/playlist?list=...`) yapıştırılırsa ne yapması gerektiğini söyleyen ayrı bir
   mesaj döner. Otomatik yollar düşerse arayüz, YouTube'un
   "Transkripti göster" panelinden kopyalanan metni kabul eden bir panel açar (zaman
   damgaları da ayrıştırılır). Transkript video başına bir kez çekilir, aynı video
   tekrar girilirse veritabanından gelir.
2. **Soru üretimi** (`/api/ders/generate`) — **iki ayrı istek**, her birinin kendi süre
   bütçesi var:
   - `adim: "acik"` → oturumu açar; ders özeti, konu listesi ve açık uçlu sorular.
   - `adim: "coktan"` → çoktan seçmelileri ekler, oturumu `hazir` yapar.

   İkinci adım düşerse ya da sekme kapanırsa oturum `hazirlaniyor` durumunda kalır. Bu
   oturumlar listede "Tamamlanmadı — devam et" rozetiyle görünür; tıklayınca yalnızca ikinci
   adım çağrılır, birinci adımda üretilen özet ve açık uçlu sorular tekrar üretilmez.

   Bölmenin sebebi ölçüm: tek çağrı 46 dakikalık bir derste 149 saniye sürüyordu
   (bölünce en uzun istek 108 saniye). Her soru için cevap anahtarı, kilit kavramlar
   ve videodaki saniyesi saklanır.

   **Cevap anahtarı denetimi.** Her iki adımın sonunda üretilen sorular ayrı ve ucuz bir
   modele (`AI_AUDIT_MODEL`) tek çağrıda gönderilir: "bu cevap anahtarlarında derste hiç
   geçmeyen ya da derste söylenenle çelişen bir iddia var mı?" Açık çelişki bulunan sorular
   elenir. Sistemin en büyük riski yanlış bir cevap anahtarıdır — hem öğrenciye yanlış bilgi
   öğretir hem de değerlendirici o anahtara baktığı için doğru cevabı "yanlış" sayar.

   Denetim kasten yanılmaya karşı temkinli kurulmuştur: yalnızca açık çelişkiler elenir,
   şüphe yetmez, ve denetim soruların yarısından fazlasını işaretlerse hatalı olanın denetim
   olduğu varsayılıp hiçbiri elenmez. Denetimin kendisi düşerse üretim engellenmez.

   Ölçüm: kasten bozulmuş bir cevap anahtarı (yanlış tarih, yanlış başkent, uydurma sefer)
   `luna` ile 2/2 yakalandı, gerçek sorulara yanlış alarm verilmedi. Çağrı başına
   $0,0007-0,0031 ve ~5 sn; aynı işi `sol` $0,0276'ya yapıyor, o yüzden denetimin kendi
   model yuvası var.

   **İki denetim katmanı, eleme son çare.** Üretilen sorular ayrı ve ucuz bir modele
   (`AI_AUDIT_MODEL`) tek çağrıda gönderilir. İki farklı soru sorulur:

   1. *Transkript denetimi* — bu iddia derste var mı? İki tür sorun ayırt edilir:
      `yok` (ders bu konuyu hiç anlatmamış) ve `celiski` (ders başka türlü söylüyor).
   2. *Olgu denetimi* — bu iddia gerçekte doğru mu? Bu katman transkripte hiç bakmaz.

   İkinci katman birincinin tanımı gereği göremediği hata sınıfı içindir: hoca "1453" der,
   otomatik altyazı "1683" yazar, üretim modeli transkripte sadık kalıp onu tekrarlar. İddia
   transkriptle *tutarlı* olduğu için birinci katman geçirir.

   **Varsayılan davranış düzeltmektir, elemek değil.** Bir soruyu atmak öğrenciyi bir soru
   eksik bırakır; oysa çoğu durumda bozuk olan soru değil, içindeki tek bir değerdir. Açık
   uçlularda cevap anahtarı, çoktan seçmelilerde doğru şıkkın metni veya açıklaması düzeltilir —
   yalnızca hatalı bilgi değişir, metnin geri kalanı korunur. Eleme yalnızca iki durumda:

   - Ders o konuyu hiç anlatmamış (`yok`). Cevabı düzeltmek adaletsiz soruyu adil yapmaz.
   - Çoktan seçmelide düzeltilmiş şık başka bir şıkla çakışıyor; soru iki doğru cevaplı olur.

   Çeldiriciler denetime hiç gönderilmez — onların yanlış olması zaten beklenen şeydir,
   göndermek yanlış alarm üretir. Denetim soruların yarısından fazlasını işaretlerse hatalı
   olanın denetim olduğu varsayılıp hiçbirine dokunulmaz; denetimin kendisi düşerse üretim
   engellenmez.

   Denetimin ne yaptığı `ders_sessions.denetim` alanına yazılır ve ders sonuç ekranında
   görünür ("Bu derste denetim 2 cevabı düzeltti"). Sunucu loglarında kalsa kimse bakmazdı.
   Bu yazma isteğe bağlıdır: kolon eklenmemişse ders üretimi etkilenmez.

   Ölçüm: kasten bozulmuş üç olgu (1683→1453, Sokullu Mehmet Paşa→Gedik Ahmed Paşa,
   Kırım 1512→1475) 2/2 koşuda yakalandı, sağlam sorularda yanlış alarm çıkmadı,
   çağrı başına $0,0003-0,0006.

   **Web araması neden yok.** OpenRouter'ın yerleşik web araması denendi (`:online` eki,
   varsayılan arka ucu zaten Exa; istek başına $0,007). Aramasız model bilgisi üç hatanın
   üçünü de bulduğu için aramaya iş kalmadı — ayrı bir Exa entegrasyonu gereksiz. Gerekirse
   (güncel mevzuat gibi eğitim verisinin eskiyebileceği yerlerde) `AI_AUDIT_MODEL` değerine
   `:online` eklemek yeterli, kod değişmez.

   **Soru sayısı sabit değil**, dersin uzunluğuna göre hesaplanır (`hedefSoruSayisi`):
   kabaca her üç dakikaya bir soru, 8 ile 26 arasında, **%80 çoktan seçmeli**. KPSS'nin
   kendisi çoktan seçmeli olduğu için ağırlık orada; açık uçlular öğrenmeyi asıl
   pekiştiren kısım olduğu için hiç eksilmiyor (en az 2 garanti).

   **Her iki bölüm de gerçek KPSS zorluğundadır; ortak ilke şudur: zorluk sorunun
   derinliğinden gelsin, dolambaçlılığından değil.** Fark yalnızca formattadır:

   - *Açık uçlular KPSS seviyesindedir ama dolambaçlı değildir.* Tek konulu, tek cümlelik
     kök, 2-3 cümlelik beklenen cevap. "X ile Y'yi karşılaştırınız", "üç yönüyle
     değerlendiriniz" gibi birden çok şeyi aynı anda isteyen kalıplar yasaktır. Ezber sorusu
     da yasaktır: yalın tanım yerine "neden / nasıl / hangi sonucu doğurdu" sorulur.
   - *Çoktan seçmeliler gerçek KPSS zorluğundadır.* Zorluk ÇELDİRİCİLERDEN gelir, soru
     kökünün karmaşıklığından değil: iyi çeldirici, konuyu yarım bilen birinin seçebileceği
     şeydir. Sorular tek odaklıdır; "ortak amacı nedir", "neyi gösterir" gibi çok adımlı
     çıkarım zincirleri yine yasaktır — zor olmakla dolambaçlı olmak aynı şey değildir. Bu bir üst sınırdır:
   ders taşımıyorsa model daha az üretir, doğrulama katmanı fazlasını kırpar.
3. **Değerlendirme** (`/api/ders/grade`) — açık uçlu cevaplar için modele transkriptin
   tamamı değil, sorunun geldiği bölüm (±90 sn) + cevap anahtarı gönderilir. Çoktan
   seçmeli sorular ve pas geçmeler sunucuda yerel değerlendirilir, model çağrısı
   yapılmaz.

   **Geri bildirim metninin kaynağına dikkat.** Çoktan seçmeli ağırlığı %70 olduğu için
   öğrencinin okuduğu metnin çoğu değerlendirme modelinden değil, üretim modelinin yazdığı
   `aciklama` alanından gelir. Bu yüzden üretim prompt'u `aciklama`yı öğrenciye hitap
   ederek (sen dili) yazmakla yükümlü, ve `grade` ucu ham metni olduğu gibi basmak yerine
   "Doğru bildin." / "Doğru cevap B) ..." gibi bir cümleyle çerçeveler. Erken bir sürümde
   bu yapılmadığı için ekranda edilgen, ansiklopedi üslubunda geri bildirimler çıkıyordu —
   model kaynaklı sanılan bu sorun aslında koddan geliyordu.

### Sağlayıcı notları

Kod OpenAI uyumlu herhangi bir uca bağlanabilir; değişecek tek dosya `lib/ai.ts`.
Proje yapayzekalab.org ile başlayıp OpenRouter'a taşındı ve tek satır kod değişmedi —
yalnızca `.env.local` güncellendi.

Sağlayıcıdan bağımsız savunmalar:

- `json_schema` (structured outputs) her sağlayıcıda güvenilir değil; bir sağlayıcıda
  şema tamamen yok sayılıyordu. Bu yüzden `json_object` + `parseJsonLoose` ile kendi
  doğrulamamızı yapıyoruz.
- Bazı modeller çıktıyı ` ```json ` bloğuna sarıyor — ayrıştırıcı temizliyor, ilk deneme
  başarısız olursa düz JSON istenerek bir kez daha deneniyor.
- Sağlayıcılar ara sıra **429/503** dönüyor. `chatJson` artan gecikmeyle üç kez deniyor.

**Zaman damgası modelden alınmıyor, transkriptten hesaplanıyor.** Modelin döndürdüğü
`saniye` alanı güvenilmez: `claude-sonnet-5` aynı ders üzerinde üç kez çalıştırıldığında
10 damganın sırasıyla 0'ı, 7'si ve 8'i videonun süresini 2-15 kat aştı. Bu değeri kırpmak
hatayı gizler (link videonun sonuna gider), düzeltmez. `damgaBelirle` (lib/youtube.ts)
sorunun kavramlarının transkriptte en yoğun geçtiği anı süpürme yöntemiyle bulur; modelin
önerisi geçerli ve isabetliyse korunur, değilse hesaplanan an kullanılır. Bozuk koşularda
ortalama isabet 0,20 → 0,57 ve 0,16 → 0,61 yükseldi; sağlam koşuda hiçbir damga değişmedi.

**Model seçimi üçer koşuyla ölçüldü.** Tek koşu yanıltıcı: aynı model aynı derste
0,58 / 0,14 / 0,09 gibi savrulabiliyor. 52 dakikalık bir KPSS dersinde, model başına 3 koşu:

| Model | Dayanak (ort.) | Sapma | Süre | Maliyet |
|---|---|---|---|---|
| `anthropic/claude-sonnet-5` | 0,78 | 0,03 | 48 sn | $0,091 |
| `openai/gpt-5.6-sol-pro` | 0,65 | 0,04 | 63 sn | $0,145 |
| `openai/gpt-5.6-sol` | 0,64 | 0,07 | 39 sn | $0,047 |
| `google/gemini-3.7-flash` | 0,61 | 0,02 | 27 sn | $0,023 |

Dördü de üç koşuda da tam 6+4 soru üretti ve ayrıştırılabilir JSON döndürdü.

**Bu tablonun okunma biçimine dikkat.** "Dayanak", sorudaki kavramların transkriptte geçme
oranı — yani kısmen *uydurma azlığını*, kısmen de *dersin kelimelerine yapışmayı* ölçer.
Birebir kopyalama ölçüldüğünde `claude-sonnet-5`'in transkriptten aynen aldığı 4 kelimelik
dizi oranı 0,064; diğer üçünde 0,010-0,012. Yani sonnet-5'in dayanak üstünlüğünün bir kısmı
kopyalamadan geliyor, "daha az halüsinasyon" olarak okunamaz. **Dört model arasında soru
kalitesi açısından savunulabilir bir fark ölçülememiştir.**

Güvenilir sayılabilecek bulgular:

- `sol` ile `sol-pro` her metrikte eşit (aynı aile olduğu için kopyalama sapması ikisini eşit
  etkiler). `sol` 1,6 kat hızlı, 3 kat ucuz — pro modunun ölçülebilir bir karşılığı yok.
- Değerlendirme doymuş bir iş: 12 zor vakada `gpt-5.6-luna` 12/12 (2,6 sn, $0,003),
  `sol-pro` da 12/12 (7,1 sn, $0,085). Buraya pahalı model koymanın karşılığı yok.
- `claude-sonnet-5` değerlendirmede 10/12 — iki sapması da yarım doğru cevaba "yanlış"
  demek yönünde. Değerlendirici olarak kullanılmamalı.

**Ölçümün kabul edilen sınırları:** tek ders (sözel/hukuk), model başına 3 koşu, cevap
anahtarlarının olgusal doğruluğu elle denetlenmedi, değerlendirme evalinin doğru cevapları
tek kişinin yargısı.

### Maliyet ve sınırlar

Ders başına maliyet soru sayısına göre değişir. 39 dakikalık gerçek bir ders (13 soru:
4 açık uçlu + 9 çoktan seçmeli) üzerinde ölçülen değerler:

| Adım | `sol` (kurulu) | `sol-pro` |
|---|---|---|
| Açık uçlu üretimi | $0,0165 · 32 sn | $0,1067 · 44 sn |
| Çoktan seçmeli üretimi | $0,0584 · 90 sn | $0,2137 · 162 sn |
| 4 açık uçlu değerlendirme | $0,0196 · 17 sn | $0,0181 · 15 sn |
| **Ders başına** | **$0,0945 · 140 sn** | **$0,3384 · 221 sn** |

Farkın kaynağı fiyat değil, `sol-pro`'nun pro modunda aynı istemi birden çok kez işlemesi:
iki adımda 101.515 giriş tokenı faturalandı, gönderilen metin ise ~21 bin token.

**Örnek senaryo — günde 5 ders, 40 dakikalık videolar (ayda 150 ders):**

| | `sol` | `sol-pro` |
|---|---|---|
| OpenRouter | $14,18 | $50,76 |
| Supadata (Basic, 300 kredi) | $5 | $5 |
| **Aylık toplam** | **≈ $19** | **≈ $56** |

Supabase ücretsiz katman yeter (150 video/ay ≈ 7 MB transkript). Vercel'de aylık ~6 saat
fonksiyon süresi oluşur; Hobby planının sınırını aşarsa Pro gerekebilir.

**Ders uzunluğu ve süre tavanı:** çoktan seçmeli adımı soru sayısıyla birlikte uzuyor.
`sol` ile 39 dakikalık derste 90 sn, 78 dakikalıkta tahminen ~200 sn — Vercel'in 300 sn
tavanına rahat sığar. `sol-pro` ile aynı adım 162 sn'den başlar ve 78 dakikalık bir derste
tavanı aşar.
### İşaretlenen sorular

Ablam bir soruyu 👎 ile işaretlediğinde `ders_questions.flagged` alanı `true` olur. Bu veri
prompt'u gerçek örneklerle iyileştirmek için birikir; okumak için Supabase SQL Editor'da:

```sql
select q.question, q.answer_key, q.explanation, s.title
from ders_questions q
join ders_sessions s on s.id = q.session_id
where q.flagged
order by s.created_at desc;
```

Boş dönmesi iyi haberdir. Dolmaya başlarsa, çıkan örnekler `app/api/ders/generate/route.ts`
içindeki üretim prompt'unu düzeltmek için kullanılmalı.

### Maliyet ve sınırlar

`lib/ders.ts` içindeki `GUNLUK_URETIM_LIMITI` günde 40 ders ile sınırlar; sızan bir
linkin faturayı şişirmesini engeller. API uçları ayrıca giriş kapısının verdiği
imzalı çerezi arar (`lib/gate.ts`).

## Deployment (Vercel)

1. Push this project to a GitHub repository.
2. Go to [vercel.com](https://vercel.com) and import the repository.
3. Add your environment variables in the Vercel dashboard:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_GRADE_MODEL` (Ablam Ders)
   - `SUPADATA_API_KEY` (Ablam Ders)
   - `SITE_GATE_SECRET` (Ablam Ders)
4. Deploy. Your app will be live at your Vercel URL.

## Project Structure

```
ablam-notepad/
├── app/
│   ├── layout.tsx            # Root layout, dark theme, Inter font
│   ├── page.tsx              # Landing page with note input + sidebar (pin support)
│   ├── not-found.tsx         # 404 page
│   ├── globals.css           # Global styles + TipTap editor styles
│   └── note/
│       └── [id]/
│           ├── page.tsx      # Note editor page (password gate)
│           └── NotePageClient.tsx  # Client wrapper for locked notes
├── components/
│   ├── NoteEditor.tsx        # TipTap editor with auto-save & real-time sync
│   ├── Toolbar.tsx           # Formatting toolbar (Headings, Bold, Italic, Links, Images...)
│   ├── PasswordGate.tsx      # Password entry screen for locked notes
│   └── PasswordSetup.tsx     # Set/remove password UI
├── lib/
│   ├── supabase-browser.ts   # Browser Supabase client
│   ├── supabase-server.ts    # Server Supabase client
│   ├── crypto.ts             # SHA-256 password hashing
│   └── upload.ts             # Supabase Storage image upload
├── .env.local.example        # Environment variables template
└── README.md
```

## Features

- **Auto-save**: Every change is saved automatically (500ms debounce)
- **Real-time sync**: Multiple users see changes instantly via Supabase Realtime
- **Custom note names**: Choose your own URL slug (e.g. `/note/my-list`)
- **Link-based access**: No accounts needed — just share the URL
- **Rich text**: Bold, Italic, Underline, Headings (H1-H3), Bullet Lists, Numbered Lists, Task Lists
- **Hyperlinks**: Add clickable links to text with a URL popup
- **Image upload**: Upload images via Supabase Storage with drag-and-drop support
- **Pin notes**: Pin important notes to the top of the sidebar
- **Password protection**: Lock notes with a password (SHA-256 hashed)
- **Dark theme**: Clean, modern, distraction-free UI
