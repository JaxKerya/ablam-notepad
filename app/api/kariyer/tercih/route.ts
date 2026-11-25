import { NextResponse } from "next/server";
import { hataCevabi, kapiKontrol } from "@/lib/ders-server";
import { durumDogrula, emsalOku, tabanOku, type OgrenimKodu, type TercihKadro, type TercihVerisi } from "@/lib/kpss-tercih";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

const TABLO = "kpss_tercih";

/** Nothing loaded yet (or the table has not been created): the page shows its empty state */
const BOS = { donemler: [] as string[], donem: null, veri: null, durum: null };

/** PostgREST / Postgres "relation does not exist": db/kpss-tercih.sql has not been run yet */
function tabloYok(hata: { code?: string; message?: string }): boolean {
  // Only the missing TABLE: a missing column or anything else must surface as an error, not as "nothing loaded"
  return hata.code === "PGRST205" || hata.code === "42P01" || /could not find the table|relation "[^"]*" does not exist/i.test(hata.message ?? "");
}

/** "2026/2" -> 202602, so rounds sort by what they are, not by when they were (re)loaded; other shapes go last */
function donemSirasi(donem: string): number {
  const m = /^(\d{4})\/(\d{1,2})$/.exec(donem);
  return m ? Number(m[1]) * 100 + Number(m[2]) : -1;
}

const nesne = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const metin = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const metinler = (v: unknown): string[] => (Array.isArray(v) ? v.map(metin).filter(Boolean) : []);

/** String-valued dictionary; anything else in it is dropped */
function sozluk(v: unknown): Record<string, string> {
  const cikti: Record<string, string> = {};
  for (const [k, d] of Object.entries(nesne(v))) if (typeof d === "string") cikti[k] = d;
  return cikti;
}

/**
 * Tolerant reader for the `veri` column. The worker writes it in the shape of
 * TercihVerisi; this only guarantees the page never meets a missing array or
 * object. A row without a `kadrolar` array counts as "not loaded".
 */
function veriOku(ham: unknown, donem: string): TercihVerisi | null {
  const h = nesne(ham);
  if (!Array.isArray(h.kadrolar)) return null;

  const kadrolar: TercihKadro[] = [];
  for (const satir of h.kadrolar) {
    const k = nesne(satir);
    const kod = metin(k.kod).trim();
    if (!kod) continue;
    const adet = Number(k.adet);
    kadrolar.push({
      kod,
      sbb: metin(k.sbb),
      kurum: metin(k.kurum),
      istihdam: metin(k.istihdam),
      unvan: metin(k.unvan),
      il: metin(k.il),
      ilce: metin(k.ilce),
      birim: metin(k.birim),
      teskilat: metin(k.teskilat),
      sinif: metin(k.sinif),
      derece: metin(k.derece),
      adet: Number.isFinite(adet) && adet > 0 ? adet : 0,
      nitelikler: metinler(k.nitelikler),
      // Placement scores, when the worker has them; undefined keys are left out of the response
      taban: tabanOku(k.taban),
      emsal: emsalOku(k.emsal),
    });
  }

  const ogrenim: Record<string, OgrenimKodu> = {};
  for (const [kod, tanim] of Object.entries(nesne(h.ogrenim))) {
    const t = nesne(tanim);
    ogrenim[kod] = { metin: metin(t.metin), programlar: metinler(t.programlar) };
  }

  const aciklamalar: TercihVerisi["aciklamalar"] = {};
  for (const [kod, a] of Object.entries(nesne(h.aciklamalar))) {
    const n = nesne(a);
    const govde = metin(n.metin);
    if (govde) aciklamalar[kod] = { baslik: metin(n.baslik), metin: govde };
  }

  const belgeler: TercihVerisi["belgeler"] = [];
  if (Array.isArray(h.belgeler)) {
    for (const b of h.belgeler) {
      const n = nesne(b);
      const url = metin(n.url);
      // Only web links: this ends up in an href
      if (/^https?:\/\//i.test(url)) belgeler.push({ ad: metin(n.ad) || url, url });
    }
  }

  const enFazla = Number(h.enFazlaTercih);
  return {
    donem: metin(h.donem) || donem,
    tercihBaslangic: metin(h.tercihBaslangic) || undefined,
    tercihBitis: metin(h.tercihBitis) || undefined,
    // 0 = the guide's limit could not be read; the page then shows no limit instead of guessing one
    enFazlaTercih: Number.isInteger(enFazla) && enFazla > 0 ? enFazla : 0,
    kadrolar,
    ogrenim,
    ozel: sozluk(h.ozel),
    programlar: sozluk(h.programlar),
    aciklamalar,
    belgeler,
  };
}

/**
 * GET /api/kariyer/tercih[?donem=2026/1]
 * Returns: { donemler (newest round first), donem, veri, durum, kaynakUrl, yuklendi }
 * for the requested round, or the newest one when none (or an unknown one) is asked for.
 */
export async function GET(request: Request) {
  const engel = await kapiKontrol();
  if (engel) return engel;

  try {
    const supabase = createServerSupabaseClient();
    const liste = await supabase.from(TABLO).select("donem, yuklendi").order("yuklendi", { ascending: false });
    if (liste.error) {
      if (tabloYok(liste.error)) return NextResponse.json(BOS);
      throw new Error(`Kılavuz okunamadı: ${liste.error.message}`);
    }
    // Newest round first. The worker refreshes `yuklendi` when it reloads an old round, so that
    // column only breaks ties: reloading 2026/1 must not make it the default again after 2026/2.
    const donemler = (liste.data ?? []).map((s) => String(s.donem)).sort((a, b) => donemSirasi(b) - donemSirasi(a));
    if (!donemler.length) return NextResponse.json(BOS);

    const istenen = new URL(request.url).searchParams.get("donem")?.trim();
    const donem = istenen && donemler.includes(istenen) ? istenen : donemler[0];

    const satir = await supabase.from(TABLO).select("donem, kaynak_url, yuklendi, veri, durum").eq("donem", donem).maybeSingle();
    if (satir.error) throw new Error(`Kılavuz okunamadı: ${satir.error.message}`);

    const veri = satir.data ? veriOku(satir.data.veri, donem) : null;
    return NextResponse.json({
      donemler,
      donem,
      veri,
      durum: veri ? durumDogrula(satir.data?.durum) : null,
      kaynakUrl: typeof satir.data?.kaynak_url === "string" && /^https?:\/\//i.test(satir.data.kaynak_url) ? satir.data.kaynak_url : null,
      yuklendi: satir.data?.yuklendi ?? null,
    });
  } catch (err) {
    return hataCevabi(err);
  }
}

/**
 * PATCH /api/kariyer/tercih
 * Body: { donem, durum }. Writes only the `durum` column of that round; the
 * parsed guide (`veri`) belongs to the worker and is never touched from here.
 */
export async function PATCH(request: Request) {
  const engel = await kapiKontrol();
  if (engel) return engel;

  try {
    let govde: Record<string, unknown>;
    try {
      govde = nesne(await request.json());
    } catch {
      return NextResponse.json({ hata: "Geçersiz istek gövdesi." }, { status: 400 });
    }

    const donem = typeof govde.donem === "string" ? govde.donem.trim() : "";
    if (!donem || donem.length > 20) {
      return NextResponse.json({ hata: "Dönem belirtilmemiş." }, { status: 400 });
    }
    if (!govde.durum || typeof govde.durum !== "object" || Array.isArray(govde.durum)) {
      return NextResponse.json({ hata: "Kaydedilecek bilgi yok." }, { status: 400 });
    }
    const durum = durumDogrula(govde.durum);

    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase.from(TABLO).update({ durum }).eq("donem", donem).select("donem");
    if (error) throw new Error(`Kaydedilemedi: ${error.message}`);
    if (!data?.length) {
      return NextResponse.json({ hata: "Bu dönemin kılavuzu bulunamadı." }, { status: 404 });
    }

    return NextResponse.json({ tamam: true, durum });
  } catch (err) {
    return hataCevabi(err);
  }
}
