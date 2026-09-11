import { NextResponse } from "next/server";
import { KATEGORI_DIGER, oynatmaListesiKimligi } from "@/lib/ders";
import { hataCevabi, kapiKontrol } from "@/lib/ders-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { oynatmaListesiVideolari } from "@/lib/youtube";

export const runtime = "nodejs";
export const maxDuration = 30;

// Oynatma listesi ile sistemdeki dersleri karşılaştırır.
//
// Ablam dersleri bir YouTube listesinden tek tek seçip ekliyor. 65 videoluk
// bir seride ikisini atlamış, birini iki kez eklemişti ve bunu listeye bakarak
// bulmak mümkün değildi — ders adları modelin verdiği ad, videonun adı değil.
// Bu uç listeyi okuyup her video için sistemdeki durumu söylüyor; arayüz
// eksikleri tek tıkla üretim kuyruğuna alıyor.
//
// MODEL ÇAĞRISI YOK. YouTube Data API'den 50 video başına 1 birim.

/**
 * "baska": video sistemde var ama BAŞKA kategoride. Karşılaştırma kategori
 * kartından yapıldığı için "bu kategoride eksik" ile "hiç yok" ayrılmalı —
 * ikincisi sıraya alınır, birincisi alınmaz (aynı ders iki kez üretilirdi).
 */
export type ListeDurumu = "ders" | "yarim" | "transkript" | "eksik" | "baska";

export interface ListeSatiri {
  videoId: string;
  baslik: string;
  sira: number;
  durum: ListeDurumu;
  /** Bu videodan kaç ders oturumu var — 1'den fazlası mükerrer */
  dersSayisi: number;
  /** Varsa ilk dersin kimliği ve kategorisi */
  dersId: string | null;
  kategori: string | null;
}

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
    const url = typeof govde.url === "string" ? govde.url : "";
    const kategori = typeof govde.kategori === "string" ? govde.kategori.trim() : "";
    const listeId = oynatmaListesiKimligi(url);
    if (!listeId) {
      return NextResponse.json(
        { hata: "Bu bir oynatma listesi linkine benzemiyor (youtube.com/playlist?list=…)." },
        { status: 400 }
      );
    }

    const { videolar, baslik, atlanan, kirpildi } = await oynatmaListesiVideolari(listeId);
    if (!videolar.length) {
      return NextResponse.json({ hata: "Listede okunabilir video bulunamadı." }, { status: 404 });
    }

    const supabase = createServerSupabaseClient();
    const idler = videolar.map((v) => v.videoId);

    const [{ data: oturumlar }, { data: transkriptler }] = await Promise.all([
      supabase
        .from("ders_sessions")
        .select("id, video_id, status, kategori, created_at")
        .eq("tur", "ders")
        .in("video_id", idler)
        .order("created_at", { ascending: true }),
      supabase.from("ders_videos").select("video_id").in("video_id", idler),
    ]);

    const dersler = new Map<string, { id: string; status: string; kategori: string | null }[]>();
    for (const o of oturumlar ?? []) {
      const liste = dersler.get(o.video_id) ?? [];
      liste.push({ id: o.id, status: o.status, kategori: o.kategori });
      dersler.set(o.video_id, liste);
    }
    const transkriptVar = new Set((transkriptler ?? []).map((t) => t.video_id));

    const kategorisi = (x: { kategori: string | null }) =>
      (x.kategori ?? "").trim() || KATEGORI_DIGER;

    const satirlar: ListeSatiri[] = videolar.map((v) => {
      const hepsi = dersler.get(v.videoId) ?? [];
      // Kategori verildiyse yalnızca o kategorideki dersler "eklendi" sayılır
      const d = kategori ? hepsi.filter((x) => kategorisi(x) === kategori) : hepsi;
      const baskaKategoride = kategori ? hepsi.find((x) => kategorisi(x) !== kategori) : undefined;
      const hazir = d.filter((x) => x.status === "hazir");
      let durum: ListeDurumu = "eksik";
      if (hazir.length) durum = "ders";
      else if (d.length) durum = "yarim";
      else if (baskaKategoride) durum = "baska";
      else if (transkriptVar.has(v.videoId)) durum = "transkript";
      const ilk = d[0] ?? baskaKategoride;
      return {
        videoId: v.videoId,
        baslik: v.baslik,
        sira: v.sira,
        durum,
        dersSayisi: d.length,
        dersId: ilk?.id ?? null,
        kategori: ilk ? kategorisi(ilk) : null,
      };
    });

    const say = (durum: ListeDurumu) => satirlar.filter((s) => s.durum === durum).length;
    return NextResponse.json({
      listeId,
      baslik,
      atlanan,
      kirpildi,
      toplam: satirlar.length,
      ozet: {
        ders: say("ders"),
        yarim: say("yarim"),
        transkript: say("transkript"),
        eksik: say("eksik"),
        baska: say("baska"),
        mukerrer: satirlar.filter((s) => s.dersSayisi > 1).length,
      },
      satirlar,
    });
  } catch (err) {
    return hataCevabi(err);
  }
}
