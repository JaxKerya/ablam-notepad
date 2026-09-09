import { NextResponse } from "next/server";
import { chatJsonOlculu } from "@/lib/ai";
import {
  DENETIM_KAYIT_SINIRI,
  gerekceKirp,
  hamKirp,
  kavramVurgulariniSuz,
  soruKirp,
} from "@/lib/ders";
import type {
  DenetimAdimi,
  DenetimGecisi,
  DenetimKaydi,
  DenetimOzeti,
  DersNotIcerigi,
  NotBolumu,
  NotTerimi,
  Segment,
} from "@/lib/ders";
import { hataCevabi, kapiKontrol } from "@/lib/ders-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { damgaBelirle, kelimeDizini, transkriptMetni } from "@/lib/youtube";
import { NOT_OLGU_DENETIMI, NOT_PROMPT } from "@/lib/prompts";

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
interface NotDenetimSonucu {
  sonuc: (string | null)[];
  degisen: number;
  kayitlar: DenetimKaydi[];
  gecis: DenetimGecisi;
}

async function maddeleriDenetle(maddeler: string[]): Promise<NotDenetimSonucu> {
  const bosGecis: DenetimGecisi = {
    katman: "olgu", bulgu: 0, valf: false, sn: 0, girdiToken: 0, ciktiToken: 0,
  };
  const bos: NotDenetimSonucu = {
    sonuc: maddeler as (string | null)[], degisen: 0, kayitlar: [], gecis: bosGecis,
  };
  if (maddeler.length < 4) return bos;

  let yanit: DenetimYaniti;
  let olcum = { girdiToken: 0, ciktiToken: 0, sn: 0, model: "" };
  let hamCevap = "";
  try {
    const cevap = await chatJsonOlculu<DenetimYaniti>({
      mesajlar: [
        { role: "system", content: NOT_OLGU_DENETIMI },
        { role: "user", content: maddeler.map((m, i) => `${i + 1}. ${m}`).join("\n") },
      ],
      maxTokens: 8000,
      rol: "denetim",
    });
    yanit = cevap.veri;
    olcum = cevap.olcum;
    hamCevap = cevap.ham;
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

  // Valf devreye girdiyse bulgular UYGULANMIYOR ama olay kaydediliyor: aksi hâlde
  // "denetim temiz buldu" ile "denetim devre dışı kaldı" ayırt edilemiyor.
  const valf = bulgular.size > maddeler.length / 2;
  const gecis: DenetimGecisi = {
    katman: "olgu",
    bulgu: bulgular.size,
    valf,
    ...olcum,
    // Atılan bulgular başka hiçbir yerde iz bırakmıyor
    hamCevap: valf ? hamKirp(hamCevap) : undefined,
  };
  if (valf) return { ...bos, gecis };

  const kayitlar: DenetimKaydi[] = [];
  const sonuc: (string | null)[] = maddeler.map((madde, i) => {
    const b = bulgular.get(i);
    if (!b) return madde;
    if (kayitlar.length < DENETIM_KAYIT_SINIRI) {
      kayitlar.push({
        katman: "olgu",
        soru: soruKirp(madde),
        islem: b.duzeltilmis ? "aciklama" : "elendi",
        sebep: b.duzeltilmis ? undefined : "düzeltme gelmedi",
        eski: b.duzeltilmis ? gerekceKirp(madde) : undefined,
        yeni: gerekceKirp(b.duzeltilmis),
        gerekce: gerekceKirp(b.gerekce),
        tamMetin: b.duzeltilmis ? undefined : madde,
      });
    }
    return b.duzeltilmis ? b.duzeltilmis : null;
  });

  return { sonuc, degisen: bulgular.size, kayitlar, gecis };
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

    const {
      veri: uretilen,
      olcum: uretimOlcum,
      ham: uretimHam,
    } = await chatJsonOlculu<UretilenNot>({
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
    if (denetim.kayitlar.length) {
      console.warn(
        "[ders] not denetimi:",
        denetim.kayitlar.map((k) => `${k.islem}: ${k.soru}${k.gerekce ? ` — ${k.gerekce}` : ""}`)
      );
    }

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

    // Not çıkarmanın denetim kaydı da oturuma ekleniyor; /ders/aiview soru
    // üretimiyle aynı yerden okuyor. Hatası yutuluyor: not zaten üretildi.
    try {
      const elenenNot = denetim.kayitlar.filter((k) => k.islem === "elendi").length;
      const adim: DenetimAdimi = {
        adim: "not",
        uretilen: duz.length,
        hedef: duz.length,
        nihai: bolumler.reduce((a, b) => a + b.maddeler.length, 0),
        uretimSn: uretimOlcum.sn,
        uretimGirdiToken: uretimOlcum.girdiToken,
        uretimCiktiToken: uretimOlcum.ciktiToken,
        uretimModeli: uretimOlcum.model,
        hamUretim:
          elenenNot > 0 || denetim.gecis.valf ? hamKirp(uretimHam) : undefined,
        gecisler: [denetim.gecis],
        kayitlar: denetim.kayitlar,
      };
      const { data } = await supabase
        .from("ders_sessions")
        .select("denetim")
        .eq("id", sessionId)
        .maybeSingle();
      const onceki = (data?.denetim ?? {}) as Partial<DenetimOzeti>;
      await supabase
        .from("ders_sessions")
        .update({
          denetim: {
            duzeltilen: (onceki.duzeltilen ?? 0) + (denetim.kayitlar.length - elenenNot),
            elenen: (onceki.elenen ?? 0) + elenenNot,
            adimlar: [
              ...(Array.isArray(onceki.adimlar) ? onceki.adimlar : []).filter(
                (a) => a.adim !== "not"
              ),
              adim,
            ],
          },
        })
        .eq("id", sessionId);
    } catch {
      // kolon yoksa sessizce geç
    }

    return NextResponse.json({ notlar, onbellekten: false });
  } catch (err) {
    return hataCevabi(err);
  }
}
