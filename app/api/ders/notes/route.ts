import { NextResponse } from "next/server";
import { chatJson } from "@/lib/ai";
import { kavramVurgulariniSuz } from "@/lib/ders";
import type { DersNotIcerigi, NotBolumu, NotTerimi, Segment } from "@/lib/ders";
import { hataCevabi, kapiKontrol } from "@/lib/ders-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { damgaBelirle, kelimeDizini, transkriptMetni } from "@/lib/youtube";

export const runtime = "nodejs";
export const maxDuration = 300;

// Ders notu, soru üretiminden AYRI ve İSTEK ÜZERİNE çıkarılıyor. İki sebep var:
// notu her derste üretmek, kaydetmediği derslerde boşuna token yakardı; ve soru
// üretimi zaten süre bütçesinin sınırında çalışıyor, aynı çağrıya bir de not
// çıkarma yüklemek uzun derslerde ikisini birden riske atardı.
//
// Üretilen not oturuma yazılıyor (ders_sessions.notlar). Kolon yoksa istek yine
// çalışır, sadece her kaydetmede yeniden üretilir — SQL'i çalıştırmayı unutmak
// özelliği bozmasın diye.

const NOT_PROMPT = `Sen bir ders videosunun transkriptinden ÇALIŞMA NOTU çıkaran bir asistansın.

Transkript YouTube'un otomatik altyazısından geliyor:
- İmla hataları, bozuk özel isimler ve yanlış yazılmış terimler içerebilir.
- Eğitmenin tahtaya yazdıkları metinde görünmez.

Bu bir ÖZET DEĞİL, ÇALIŞMA NOTU. Öğrenci sınav öncesi bu nota bakıp konuyu hatırlayabilmeli.

BİÇİM — kısa tut, göz yormasın:
- Maddeler CÜMLE DEĞİL, NOT olsun. "Şehzadeler sancağa gönderilmemeye başlandı ve sarayda
  kafes denilen bölümde tutuldu" değil; "Sancak yerine kafes: şehzade sarayda tutuluyor" gibi.
- Her madde en fazla 15 kelime ve TEK bir bilgi taşısın.
- Her bölümde 3-6 madde olsun; daha fazlasına bölme, önemsizi at.
- Bölüm sayısını ders belirlesin, 4-8 arası doğaldır.
- Başlıklar kısa olsun (2-5 kelime).

VURGULAMA — notun asıl işi bu, öğrenci sayfaya bakınca ezberleyeceğini görsün.
Üç işaret var, her biri bir renge dönüşüyor:
- [t]...[/t]  tarih, sayı, süre, yüzde     -> "[t]1683[/t] Viyana Kuşatması"
- [i]...[/i]  kişi, yer, kurum, eser adı   -> "[i]Kösem Sultan[/i] yönetimde etkili"
- [k]...[/k]  dersin anahtar kavramı       -> "Tımar bozulunca [k]iltizam[/k] yayıldı"

Vurgulama kuralları:
- SADECE ezberlenecek parçayı işaretle, cümlenin tamamını değil. Vurgu 1-3 kelime olsun.
- Bir maddede en fazla 2 vurgu olsun. Her şey vurguluysa hiçbir şey vurgulu değildir.
- [k] YALNIZCA aşağıdaki "terimler" listesine koyacağın kavramlar için kullanılır.
  Vurguladığın kavramlarla sözlüğün aynı küme olmalı. "israf", "rüşvet", "liyakat" gibi
  sıradan kelimeleri [k] ile işaretleme — onlar kavram değil.
- İşaretleri her zaman kapat; açtığın etiketle aynısıyla kapat ([t]...[/t]).
- Vurgu işaretleri yalnızca "maddeler" içinde kullanılır; başlıkta, girişte ve
  terim açıklamalarında KULLANMA.

İÇERİK:
- Somut ol: tarihleri, isimleri, sayıları, kavramları yaz.
- Neden-sonuç ilişkilerini koru: ne, neden oldu; neye yol açtı.
- Dersin kendi anlatım sırasını koru.
- Derste geçmeyen hiçbir bilgiyi ekleme; kendi bilgini karıştırma.
- Bir sayıdan ya da özel isimden emin değilsen o ayrıntıyı yazma.

"saniye": o bölümün videoda anlatılmaya BAŞLADIĞI an (transkriptteki [dk:sn] işaretinden).
"giris": tek cümle, dersin ne anlattığı.
"terimler": derste TANIMI VERİLEN kavramlar, en fazla 8 tane, açıklaması tek cümle.
Herkesin bildiği kelimeleri (ziraat, zanaat gibi) yazma. Böyle kavram yoksa boş bırak.

TEKRAR ETME: Sözlükte tanımladığın bir kavramı maddede yeniden TANIMLAMA. Madde o kavramın
ne yaptığını, neye yol açtığını ya da neyle ilişkili olduğunu söylesin; tanım sözlükte kalsın.
Yanlış: "[k]Büyük Kaçgun[/k]: halkın köyleri bırakıp şehirlere göçmesi" (bu zaten sözlükte)
Doğru:  "[k]Büyük Kaçgun[/k] köyleri boşalttı, tımar geliri kesildi"

Şema:
{
  "giris": "tek cümle",
  "bolumler": [{"baslik": "kısa başlık", "maddeler": ["...", "..."], "saniye": 123}],
  "terimler": [{"terim": "...", "aciklama": "tek cümle"}]
}

SADECE geçerli JSON döndür, başka hiçbir şey yazma, kod bloğu işareti kullanma.`;

// Notun olgu denetimi. Sorulardaki denetimin (bkz. generate/route.ts) not
// karşılığı; paylaşılmıyor çünkü denetlenen birim farklı — orada bir sorunun
// cevap parçaları, burada tek tek maddeler.
//
// Not, soruya göre DAHA yüksek riskli: soru bir kez cevaplanıp geçiliyor, not
// ezberleniyor. Bozuk bir altyazı tarihi ("1453" yerine "1683") nota girerse
// ablam onu öğreniyor. Denetim ucuz modelle tek çağrı, ~5 saniye.
const OLGU_DENETIMI = `Sen bir KPSS ders notu olgu denetçisisin. Sana bir dersten çıkarılmış
not maddeleri veriliyor. Görevin: maddede GERÇEKTE YANLIŞ olan bir bilgi var mı bulmak.

Bu notlar ders videolarının otomatik altyazısından üretiliyor. Öğretmen doğru söylemiş olsa
bile altyazı tarihleri, sayıları ve özel isimleri bozabiliyor. En sık bozulan yerler bunlardır.

Kurallar:
- Tarihler, kişi adları, yer adları ve sayılar özellikle şüpheli noktalardır.
- Yalnızca gerçekten yanlış olduğundan EMİN olduğun maddeleri bildir.
- Eksik ya da basitleştirilmiş anlatım yanlış DEĞİLDİR; bildirme.
- Yorum farkı ya da üslup yanlış DEĞİLDİR; bildirme.
- ŞÜPHE YETERLİ DEĞİLDİR. Emin değilsen bildirme. Boş liste dönmek tamamen normaldir.

Maddelerde [t]...[/t], [i]...[/i], [k]...[/k] biçiminde vurgu işaretleri var.
Düzeltilmiş metinde bu işaretleri AYNEN KORU, yerlerini değiştirme.

Her hata için maddenin DÜZELTİLMİŞ tam hâlini yaz: yalnızca hatalı bilgiyi düzelt,
maddenin geri kalanını olduğu gibi bırak.

SADECE geçerli JSON döndür, kod bloğu işareti kullanma:
{"hatalar": [{"no": 3, "gerekce": "1683 değil 1453", "duzeltilmis": "..."}]}`;

interface DenetimYaniti {
  hatalar?: { no?: unknown; gerekce?: unknown; duzeltilmis?: unknown }[];
}

/**
 * Maddeleri denetimden geçirir ve düzeltilmiş hâllerini döndürür.
 *
 * Sorulardaki denetimle aynı iki güvenlik kuralı: maddelerin yarısından fazlası
 * işaretlenirse hatalı olan büyük ihtimalle denetimin kendisidir, hiçbirine
 * dokunulmaz; denetim çağrısı düşerse not yine üretilir, sadece denetlenmemiş olur.
 * Eleme yok — bir maddeyi atmak yerine düzeltiyoruz; düzeltme gelmediyse o madde
 * düşer, çünkü doğruluğundan şüphelenilen tek satırı bırakmanın anlamı yok.
 */
async function maddeleriDenetle(
  maddeler: string[]
): Promise<{ sonuc: (string | null)[]; degisen: number; notlar: string[] }> {
  const bos = { sonuc: maddeler as (string | null)[], degisen: 0, notlar: [] as string[] };
  if (maddeler.length < 4) return bos;

  let yanit: DenetimYaniti;
  try {
    yanit = await chatJson<DenetimYaniti>({
      mesajlar: [
        { role: "system", content: OLGU_DENETIMI },
        { role: "user", content: maddeler.map((m, i) => `${i + 1}. ${m}`).join("\n") },
      ],
      maxTokens: 8000,
      rol: "denetim",
    });
  } catch {
    return bos;
  }

  const bulgular = new Map<number, { gerekce: string; duzeltilmis: string }>();
  for (const h of yanit.hatalar ?? []) {
    const no = h?.no;
    if (typeof no !== "number" || no < 1 || no > maddeler.length) continue;
    bulgular.set(no - 1, {
      gerekce: metin(h?.gerekce) || "gerekçe belirtilmedi",
      duzeltilmis: metin(h?.duzeltilmis),
    });
  }

  if (bulgular.size > maddeler.length / 2) return bos;

  const notlar: string[] = [];
  const sonuc: (string | null)[] = maddeler.map((madde, i) => {
    const b = bulgular.get(i);
    if (!b) return madde;
    if (b.duzeltilmis) {
      notlar.push(`düzeltildi: ${madde.slice(0, 50)} — ${b.gerekce}`);
      return b.duzeltilmis;
    }
    notlar.push(`elendi (düzeltme gelmedi): ${madde.slice(0, 50)}`);
    return null;
  });

  return { sonuc, degisen: bulgular.size, notlar };
}

interface UretilenNot {
  giris?: unknown;
  bolumler?: { baslik?: unknown; maddeler?: unknown; saniye?: unknown }[];
  terimler?: { terim?: unknown; aciklama?: unknown }[];
}

const metin = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const dizi = (v: unknown) =>
  Array.isArray(v) ? v.map(metin).filter(Boolean) : [];

/**
 * Modelin verdiği zaman damgası güvenilmez (soru üretiminde ölçüldü: değerlerin
 * yarısı aralık dışıydı). Bölümün kendi metnindeki kelimeleri transkriptte
 * tarayıp gerçek anı buluyoruz; modelin değeri yalnızca ipucu olarak giriyor.
 */
function bolumleriDuzelt(
  ham: UretilenNot["bolumler"],
  dizin: Map<string, number[]>,
  sure: number
): NotBolumu[] {
  return (ham ?? [])
    .map((b) => ({ baslik: metin(b?.baslik), maddeler: dizi(b?.maddeler), saniye: b?.saniye }))
    .filter((b) => b.baslik && b.maddeler.length)
    .map((b) => ({
      baslik: b.baslik,
      maddeler: b.maddeler,
      saniye: damgaBelirle([b.baslik, ...b.maddeler].join(" "), dizin, b.saniye, sure),
    }));
}

function terimleriDuzelt(ham: UretilenNot["terimler"]): NotTerimi[] {
  return (ham ?? [])
    .map((t) => ({ terim: metin(t?.terim), aciklama: metin(t?.aciklama) }))
    .filter((t) => t.terim && t.aciklama);
}

/** Gövde: { sessionId } -> { notlar, onbellekten } */
export async function POST(request: Request) {
  const engel = await kapiKontrol();
  if (engel) return engel;

  try {
    let govde: Record<string, unknown>;
    try {
      govde = await request.json();
    } catch {
      return NextResponse.json({ hata: "Geçersiz istek gövdesi." }, { status: 400 });
    }
    const sessionId = typeof govde.sessionId === "string" ? govde.sessionId : "";
    if (!sessionId) {
      return NextResponse.json({ hata: "sessionId gerekli." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();

    const { data: oturum, error: oturumHatasi } = await supabase
      .from("ders_sessions")
      .select("id, video_id, title")
      .eq("id", sessionId)
      .maybeSingle();

    if (oturumHatasi) throw new Error(oturumHatasi.message);
    if (!oturum) return NextResponse.json({ hata: "Ders bulunamadı." }, { status: 404 });

    // Daha önce çıkarıldıysa yeniden üretme (kolon yoksa sessizce atla)
    try {
      const { data } = await supabase
        .from("ders_sessions")
        .select("notlar")
        .eq("id", sessionId)
        .maybeSingle();
      const kayitli = data?.notlar as DersNotIcerigi | null | undefined;
      if (kayitli?.bolumler?.length) {
        return NextResponse.json({ notlar: kayitli, onbellekten: true });
      }
    } catch {
      // kolon yok — her seferinde yeniden üretilir
    }

    const { data: video, error: videoHatasi } = await supabase
      .from("ders_videos")
      .select("title, duration_seconds, segments")
      .eq("video_id", oturum.video_id)
      .maybeSingle();

    if (videoHatasi) throw new Error(videoHatasi.message);
    if (!video || !Array.isArray(video.segments) || !video.segments.length) {
      return NextResponse.json(
        { hata: "Bu dersin transkripti bulunamadı." },
        { status: 404 }
      );
    }

    const segments = video.segments as Segment[];
    const sure = video.duration_seconds ?? 0;

    const uretilen = await chatJson<UretilenNot>({
      mesajlar: [
        { role: "system", content: NOT_PROMPT },
        {
          role: "user",
          content:
            (video.title ? `Video başlığı: ${video.title}\n` : "") +
            `Ders süresi: ${Math.round(sure / 60)} dakika\n\n` +
            `Ders transkripti:\n\n${transkriptMetni(segments)}`,
        },
      ],
      maxTokens: 32000,
      rol: "uretim",
    });

    const terimler = terimleriDuzelt(uretilen.terimler);
    let bolumler = bolumleriDuzelt(uretilen.bolumler, kelimeDizini(segments), sure);

    // Kavram vurgusu sözlükle sınırlanıyor — prompt tek başına tutmuyordu
    bolumler = bolumler.map((b) => ({
      ...b,
      maddeler: kavramVurgulariniSuz(b.maddeler, terimler),
    }));

    // Olgu denetimi: bütün maddeler tek çağrıda, sonra bölümlerine geri dağıtılıyor
    const duz = bolumler.flatMap((b) => b.maddeler);
    const denetim = await maddeleriDenetle(duz);
    if (denetim.notlar.length) console.warn("[ders] not denetimi:", denetim.notlar);

    let imlec = 0;
    bolumler = bolumler
      .map((b) => {
        const dilim = denetim.sonuc.slice(imlec, imlec + b.maddeler.length);
        imlec += b.maddeler.length;
        return { ...b, maddeler: dilim.filter((m): m is string => !!m) };
      })
      .filter((b) => b.maddeler.length);

    const notlar: DersNotIcerigi = {
      giris: metin(uretilen.giris),
      bolumler,
      terimler,
    };

    if (!notlar.bolumler.length) {
      throw new Error(
        "Bu dersten not çıkarılamadı. Altyazı çok bozuk olabilir; özeti elle yazman gerekebilir."
      );
    }

    try {
      await supabase.from("ders_sessions").update({ notlar }).eq("id", sessionId);
    } catch {
      // kolon yoksa sessizce geç — not yine döndü, sadece önbelleğe alınamadı
    }

    return NextResponse.json({ notlar, onbellekten: false });
  } catch (err) {
    return hataCevabi(err);
  }
}
