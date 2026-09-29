import { NextResponse } from "next/server";
import { hataCevabi, kapiKontrol } from "@/lib/ders-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { Harcama, MaliyetCevabi, Sistem } from "@/lib/maliyet";

export const runtime = "nodejs";

/**
 * Üç sistemin harcamasını tek biçime çevirir (bkz. lib/maliyet.ts).
 *
 * Neden sunucuda: Ders'in maliyeti ders_sessions.denetim içinde duruyor ve o
 * kolon denetim kayıtlarıyla birlikte 1,6 MB; tarayıcıya indirmek anlamsız.
 * Burada okunup birkaç yüz satırlık özet dönüyor. Kariyer 2500+ satır olduğu
 * için sayfalanıyor (PostgREST bir istekte en çok 1000 satır verir) ve GÜNLÜK
 * toplanıyor — ilan ilan göndermenin ekranda karşılığı yok.
 *
 * Bir kaynak düşerse diğerleri yine dönüyor; düşen "hatalar" içinde bildiriliyor.
 */

interface DenetimGecisi {
  katman?: string;
  maliyetUsd?: number;
}
interface DenetimAdimi {
  adim?: string;
  uretimMaliyetUsd?: number;
  gecisler?: DenetimGecisi[];
}

/** Ders adımı -> kalem anahtarı */
const DERS_KALEMI: Record<string, string> = { cozumleme: "cozumleme", coktan: "soru", acik: "soru", not: "not" };

async function dersHarcamalari(db: ReturnType<typeof createServerSupabaseClient>): Promise<Harcama[]> {
  const { data, error } = await db
    .from("ders_sessions")
    .select("id, title, created_at, denetim")
    .not("denetim", "is", null)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);

  const cikti: Harcama[] = [];
  for (const s of data ?? []) {
    const adimlar = ((s.denetim as { adimlar?: DenetimAdimi[] } | null)?.adimlar ?? []) as DenetimAdimi[];
    // Aynı dersin aynı kalemi tek satır: 10 parçalı derste 10 ayrı "soru üretimi" satırı gereksiz
    const kalemler = new Map<string, number>();
    for (const a of adimlar) {
      const uretim = Number(a.uretimMaliyetUsd) || 0;
      if (uretim) {
        const k = DERS_KALEMI[a.adim ?? ""] ?? "soru";
        kalemler.set(k, (kalemler.get(k) ?? 0) + uretim);
      }
      for (const g of a.gecisler ?? []) {
        const tutar = Number(g.maliyetUsd) || 0;
        if (!tutar) continue;
        const k = g.katman === "gelistirme" ? "gelistirme" : "denetim";
        kalemler.set(k, (kalemler.get(k) ?? 0) + tutar);
      }
    }
    for (const [kalem, tutar] of kalemler) {
      cikti.push({ sistem: "ders", kalem, ad: (s.title as string) || "Adsız ders", tutar, zaman: s.created_at as string, grup: s.id as string });
    }
  }
  return cikti;
}

async function kariyerHarcamalari(db: ReturnType<typeof createServerSupabaseClient>): Promise<Harcama[]> {
  // Gün + kalem kovaları: { "2026-09-27|puanlama": { tutar, adet } }
  const kova = new Map<string, { tutar: number; adet: number }>();
  const SAYFA = 1000;
  for (let sayfa = 0; sayfa < 20; sayfa++) {
    const { data, error } = await db
      .from("kariyer_eslesmeler")
      .select("degerlendirildi, olcum")
      .not("olcum", "is", null)
      .order("degerlendirildi", { ascending: false })
      .range(sayfa * SAYFA, sayfa * SAYFA + SAYFA - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const o = (r.olcum ?? {}) as { maliyetUsd?: number; oncekiMaliyetUsd?: number; kapi?: boolean };
      const tutar = (Number(o.maliyetUsd) || 0) + (Number(o.oncekiMaliyetUsd) || 0);
      if (!tutar || !r.degerlendirildi) continue;
      const gun = (r.degerlendirildi as string).slice(0, 10);
      const kalem = o.kapi ? "oneleme" : "puanlama";
      const anahtar = `${gun}|${kalem}`;
      const g = kova.get(anahtar) ?? { tutar: 0, adet: 0 };
      g.tutar += tutar;
      g.adet += 1;
      kova.set(anahtar, g);
    }
    if ((data?.length ?? 0) < SAYFA) break;
  }
  return [...kova.entries()].map(([anahtar, g]) => {
    const [gun, kalem] = anahtar.split("|");
    return {
      sistem: "kariyer" as const,
      kalem,
      ad: `${g.adet} ilan`,
      tutar: g.tutar,
      // Günün ortası: yerel güne düşsün, dönem süzgecinde sınırda kaymasın
      zaman: `${gun}T12:00:00Z`,
      grup: gun,
    };
  });
}

async function youtubeHarcamalari(db: ReturnType<typeof createServerSupabaseClient>): Promise<Harcama[]> {
  const [{ data, error }, bolum] = await Promise.all([
    db.from("youtube_maliyet").select("kalem, tutar, zaman, bolum_id").order("zaman", { ascending: false }).limit(1000),
    db.from("youtube_bolumler").select("id, konu, baslik, yt_baslik"),
  ]);
  if (error) throw new Error(error.message);
  const ad = new Map((bolum.data ?? []).map((b) => [b.id as string, ((b.yt_baslik ?? b.baslik ?? b.konu) as string).split(" | ")[0]]));
  return (data ?? []).map((k) => ({
    sistem: "youtube" as const,
    kalem: k.kalem as string,
    ad: k.bolum_id ? ad.get(k.bolum_id as string) ?? "Silinmiş bölüm" : "Bölüme bağlı olmayan",
    tutar: Number(k.tutar) || 0,
    zaman: k.zaman as string,
    grup: (k.bolum_id as string) ?? "genel",
  }));
}

export async function GET() {
  const engel = await kapiKontrol();
  if (engel) return engel;
  try {
    const db = createServerSupabaseClient();
    const kaynaklar: [Sistem, Promise<Harcama[]>][] = [
      ["ders", dersHarcamalari(db)],
      ["kariyer", kariyerHarcamalari(db)],
      ["youtube", youtubeHarcamalari(db)],
    ];
    const sonuclar = await Promise.allSettled(kaynaklar.map(([, p]) => p));

    const harcamalar: Harcama[] = [];
    const hatalar: MaliyetCevabi["hatalar"] = [];
    sonuclar.forEach((s, i) => {
      const sistem = kaynaklar[i][0];
      if (s.status === "fulfilled") harcamalar.push(...s.value);
      else hatalar.push({ sistem, mesaj: (s.reason as Error).message });
    });

    const cevap: MaliyetCevabi = {
      harcamalar,
      hatalar,
      // Dürüstlük notu: ölçüm kaydedilmeyen çağrılar var, sayfada yazıyor
      kapsamDisi: [
        "Ders: cevap değerlendirme, soru itirazı ve tekrar varyantları ölçüm kaydetmiyor",
        "Kariyer: profil çıkarma çağrısı kaydedilmiyor",
        "Sunucu, alan adı ve Supabase gibi sabit giderler burada değil",
      ],
    };
    return NextResponse.json(cevap);
  } catch (err) {
    return hataCevabi(err);
  }
}
