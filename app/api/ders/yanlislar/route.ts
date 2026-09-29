import { NextResponse } from "next/server";
import { onculluSiklarMi, siklariKaristir } from "@/lib/ders";
import { hataCevabi, hepsiniCek, kapiKontrol } from "@/lib/ders-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { turkiyeGunu, vadesiGelenler, yanlisDurumlari, yanlisKuraliMetni, type KokCevap, type YanlisDurumu } from "@/lib/yanlislar";

export const runtime = "nodejs";
export const maxDuration = 60;

// Yanlışlarım — aralıklı tekrar. Kural ve gerekçe lib/yanlislar.ts'te.
//
// DERS BAZLI: her kategorinin (Tarih, Coğrafya…) kendi yanlış kutusu var, pratik
// ve deneme gibi. Kök sorunun kategorisi, sorunun ait olduğu ders oturumundan.
//
//   GET   -> { kategoriler: { Tarih: { bekleyen, aktif, ogrenilen, bugunOturum } } }
//   POST  -> { kategori | sessionId, adet? } sıradaki vadesi gelmiş soruyu kopyalar
//
// Oturum türü "yanlis". Pratikten (tur "tekrar") AYRI tutulmasının sebebi:
// pratik oturumları kategori başına 5'ten fazlaysa siliniyor ve cevapları da
// onlarla gidiyor (bkz. /api/ders/tekrar SAKLANAN_PRATIK). Tekrar geçmişi
// silinirse kutular sıfırlanır; "yanlis" oturumlarına dokunulmuyor.
//
// Kategori başına günde tek oturum: aynı gün tekrar girilince o günün oturumuna
// devam edilir, gün boyu çözülenler tek yerde toplanır.

interface SoruSatiri {
  id: string;
  session_id: string;
  kaynak_soru_id: string | null;
  kind: string;
  flagged: boolean | null;
}

type Supa = ReturnType<typeof createServerSupabaseClient>;

/**
 * Bütün cevapları kök soruya bağlayıp kutuları hesaplar. Tek istekte değil,
 * sayfalı okunuyor: soru ve cevap tabloları 1000 satırı çoktan geçti.
 */
async function durumuHesapla(supabase: Supa) {
  const [sorular, cevaplar, oturumlar] = await Promise.all([
    hepsiniCek<SoruSatiri>(() =>
      supabase.from("ders_questions").select("id, session_id, kaynak_soru_id, kind, flagged").order("id")
    ),
    hepsiniCek<{ question_id: string; verdict: string | null; created_at: string }>(() =>
      supabase.from("ders_answers").select("question_id, verdict, created_at").order("id")
    ),
    hepsiniCek<{ id: string; kategori: string | null; tur: string | null }>(() =>
      supabase.from("ders_sessions").select("id, kategori, tur").order("id")
    ),
  ]);

  const soruHaritasi = new Map(sorular.map((s) => [s.id, s]));
  const oturumHaritasi = new Map(oturumlar.map((o) => [o.id, o]));

  // Geçerli kök: asıl ders sorusu, çoktan seçmeli, itirazla emekliye ayrılmamış.
  // Eski açık uçlular dışarıda: değerlendirmeleri model çağırıyor, tekrarı bedava olmazdı.
  const gecerliKok = (id: string) => {
    const s = soruHaritasi.get(id);
    if (!s || s.kind !== "coktan" || s.flagged) return false;
    return oturumHaritasi.get(s.session_id)?.tur === "ders";
  };

  const kokCevaplar: KokCevap[] = [];
  for (const c of cevaplar) {
    const soru = soruHaritasi.get(c.question_id);
    if (!soru) continue;
    const kok = soru.kaynak_soru_id ?? soru.id;
    if (!gecerliKok(kok)) continue;
    kokCevaplar.push({ kok, verdict: c.verdict, zaman: new Date(c.created_at).getTime() });
  }

  const ozet = yanlisDurumlari(kokCevaplar);
  const kategorisi = (kok: string) => {
    const s = soruHaritasi.get(kok);
    return (s && oturumHaritasi.get(s.session_id)?.kategori?.trim()) || "Diğer";
  };
  return { ...ozet, kategorisi, soruHaritasi };
}

interface KategoriOzeti {
  bekleyen: number;
  aktif: number;
  ogrenilen: number;
  bugunOturum: { id: string; cozulen: number } | null;
}

/** Kategori başına sayılar */
function kategoriOzetleri(aktif: Map<string, YanlisDurumu>, ogrenilen: Set<string>, kategorisi: (k: string) => string, simdi: number) {
  const sonuc: Record<string, KategoriOzeti> = {};
  const al = (k: string) => (sonuc[k] ??= { bekleyen: 0, aktif: 0, ogrenilen: 0, bugunOturum: null });
  for (const d of aktif.values()) al(kategorisi(d.kok)).aktif++;
  for (const d of vadesiGelenler(aktif, simdi)) al(kategorisi(d.kok)).bekleyen++;
  for (const kok of ogrenilen) al(kategorisi(kok)).ogrenilen++;
  return sonuc;
}

/** Bugün açılmış yanlış oturumları, kategori -> oturum (en yenisi) */
async function bugunkuOturumlar(supabase: Supa, simdi: number) {
  const gun = turkiyeGunu(simdi);
  const { data } = await supabase
    .from("ders_sessions")
    .select("id, kategori, created_at")
    .eq("tur", "yanlis")
    .order("created_at", { ascending: false })
    .limit(50);
  const harita = new Map<string, string>();
  for (const o of data ?? []) {
    if (turkiyeGunu(new Date(o.created_at).getTime()) !== gun) continue;
    const k = (o.kategori as string | null)?.trim() || "Diğer";
    if (!harita.has(k)) harita.set(k, o.id);
  }
  return harita;
}

export async function GET() {
  const engel = await kapiKontrol();
  if (engel) return engel;
  try {
    const supabase = createServerSupabaseClient();
    const simdi = Date.now();
    const [{ aktif, ogrenilen, kategorisi }, bugunku] = await Promise.all([
      durumuHesapla(supabase),
      bugunkuOturumlar(supabase, simdi),
    ]);
    const kategoriler = kategoriOzetleri(aktif, ogrenilen, kategorisi, simdi);

    // Bugün başlanmış kategorilerde "devam et" ve kaç soru çözüldüğü
    if (bugunku.size) {
      const { data: cevaplar } = await supabase
        .from("ders_answers")
        .select("session_id")
        .in("session_id", [...bugunku.values()])
        .limit(2000);
      const sayac = new Map<string, number>();
      for (const c of cevaplar ?? []) sayac.set(c.session_id, (sayac.get(c.session_id) ?? 0) + 1);
      for (const [k, id] of bugunku) {
        (kategoriler[k] ??= { bekleyen: 0, aktif: 0, ogrenilen: 0, bugunOturum: null }).bugunOturum = {
          id,
          cozulen: sayac.get(id) ?? 0,
        };
      }
    }

    return NextResponse.json({ kategoriler });
  } catch (err) {
    return hataCevabi(err);
  }
}

export async function POST(request: Request) {
  const engel = await kapiKontrol();
  if (engel) return engel;
  try {
    let govde: Record<string, unknown> = {};
    try {
      govde = await request.json();
    } catch {
      // gövdesiz istek: yeni ya da bugünkü oturum
    }
    const adet = Math.min(Math.max(Number(govde.adet) || 1, 1), 10);
    const supabase = createServerSupabaseClient();
    const simdi = Date.now();

    // Oturum: verilen, yoksa bu kategorinin bugünkü oturumu, o da yoksa aşağıda yenisi
    let oturumId = typeof govde.sessionId === "string" ? govde.sessionId : "";
    let kategori = typeof govde.kategori === "string" ? govde.kategori.trim() : "";
    if (oturumId) {
      const { data } = await supabase.from("ders_sessions").select("id, tur, kategori").eq("id", oturumId).maybeSingle();
      if (!data || data.tur !== "yanlis") {
        return NextResponse.json({ hata: "Yanlış tekrarı oturumu bulunamadı." }, { status: 404 });
      }
      kategori = (data.kategori as string | null)?.trim() || "Diğer";
    } else {
      if (!kategori) return NextResponse.json({ hata: "kategori gerekli." }, { status: 400 });
      oturumId = (await bugunkuOturumlar(supabase, simdi)).get(kategori) ?? "";
    }

    const { aktif, ogrenilen, kategorisi } = await durumuHesapla(supabase);

    // Bu oturumda zaten sorulmuş kökler tekrar gelmesin. Cevaplanıp doğru
    // yapılanın vadesi zaten ileri kaydı; cevaplanmamış (ekranda duran) kopya
    // için ikinci kopya açılmasın diye bu süzgeç şart.
    let oturumdakiler = new Set<string>();
    if (oturumId) {
      const { data } = await supabase.from("ders_questions").select("kaynak_soru_id").eq("session_id", oturumId).limit(2000);
      oturumdakiler = new Set((data ?? []).map((q) => q.kaynak_soru_id).filter(Boolean) as string[]);
    }
    const siradakiler = vadesiGelenler(aktif, simdi).filter(
      (d) => kategorisi(d.kok) === kategori && !oturumdakiler.has(d.kok)
    );
    const secilen = siradakiler.slice(0, adet);

    const ozet = kategoriOzetleri(aktif, ogrenilen, kategorisi, simdi)[kategori] ?? { aktif: 0, ogrenilen: 0 };
    if (!secilen.length) {
      // Hata değil: bu dersin bugünlük tekrarı bitti. Arayüz bitti ekranına çeviriyor.
      return NextResponse.json({
        sessionId: oturumId || null,
        sorular: [],
        bitti: true,
        aktif: ozet.aktif,
        ogrenilen: ozet.ogrenilen,
        bekleyen: 0,
      });
    }

    const { data: kaynaklar, error: kaynakHatasi } = await supabase
      .from("ders_questions")
      .select("id, session_id, video_id, kind, question, answer_key, key_points, choices, correct_index, explanation, topic, start_seconds")
      .in("id", secilen.map((d) => d.kok));
    if (kaynakHatasi) throw new Error(kaynakHatasi.message);
    // Seçim sırası korunsun (en gecikmiş önce)
    const sira = new Map(secilen.map((d, i) => [d.kok, i]));
    const sirali = (kaynaklar ?? []).sort((a, b) => (sira.get(a.id) ?? 0) - (sira.get(b.id) ?? 0));
    if (!sirali.length) {
      return NextResponse.json({ sessionId: oturumId || null, sorular: [], bitti: true, bekleyen: 0 });
    }

    if (!oturumId) {
      // video_id NOT NULL: oturum tek videoya ait değil, alan yalnızca kısıtı
      // karşılıyor (pratikteki gibi). Soru-video bağı ders_questions.video_id'de.
      let videoId = sirali[0].video_id as string | null;
      if (!videoId) {
        const { data: kaynakOturum } = await supabase.from("ders_sessions").select("video_id").eq("id", sirali[0].session_id).maybeSingle();
        videoId = (kaynakOturum?.video_id as string | null) ?? null;
      }
      const { data: oturum, error: oturumHatasi } = await supabase
        .from("ders_sessions")
        .insert({
          video_id: videoId,
          title: `${kategori} yanlışları`,
          kategori,
          tur: "yanlis",
          summary: `Daha önce yanlış yaptığın sorular. ${yanlisKuraliMetni()}`,
          topics: [],
          status: "hazir",
        })
        .select("id")
        .single();
      if (oturumHatasi || !oturum) throw new Error(`Oturum açılamadı: ${oturumHatasi?.message ?? "bilinmiyor"}`);
      oturumId = oturum.id;
    }

    const { count: mevcut } = await supabase
      .from("ders_questions")
      .select("id", { count: "exact", head: true })
      .eq("session_id", oturumId);

    // Kopya kuralları /api/ders/tekrar ile aynı: şıklar karışıyor (harf ezberi
    // olmasın), öncüllü sorular karışmıyor (okunamaz olur), işaret taşınmıyor.
    const { data: eklenen, error: kopyaHatasi } = await supabase
      .from("ders_questions")
      .insert(
        sirali.map((s, i) => {
          const secenekler = Array.isArray(s.choices) ? (s.choices as string[]) : null;
          const karisik =
            secenekler?.length && typeof s.correct_index === "number" && !onculluSiklarMi(secenekler)
              ? siklariKaristir(secenekler, s.correct_index)
              : null;
          return {
            session_id: oturumId,
            kaynak_soru_id: s.id,
            video_id: s.video_id,
            position: (mevcut ?? 0) + i,
            kind: s.kind,
            question: s.question,
            answer_key: s.answer_key,
            key_points: (s.key_points as string[] | null) ?? [],
            choices: karisik?.secenekler ?? s.choices,
            correct_index: karisik?.dogruIndeks ?? s.correct_index,
            explanation: s.explanation,
            topic: s.topic,
            start_seconds: s.start_seconds ?? 0,
            flagged: false,
          };
        })
      )
      .select(
        "id, session_id, video_id, kaynak_soru_id, position, kind, question, answer_key, key_points, choices, correct_index, explanation, topic, start_seconds, flagged"
      );
    if (kopyaHatasi) throw new Error(`Soru hazırlanamadı: ${kopyaHatasi.message}`);

    // Soru kopyası kaydedildi; ekranda kaç kutuda olduğu da görünsün
    const kutular = Object.fromEntries(secilen.map((d) => [d.kok, d.kutu]));
    return NextResponse.json({
      sessionId: oturumId,
      sorular: eklenen ?? [],
      kutular,
      bitti: false,
      aktif: ozet.aktif,
      ogrenilen: ozet.ogrenilen,
      // Az önce verilenler hâlâ "vadesi gelmiş" sayılıyor; kalan sayı onları düşerek
      bekleyen: Math.max(0, siradakiler.length - secilen.length),
    });
  } catch (err) {
    return hataCevabi(err);
  }
}
