import { NextResponse } from "next/server";
import { chatJson } from "@/lib/ai";
import { hataCevabi, kapiKontrol } from "@/lib/ders-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 30;

// Yeni bölüm formu: yazılan konuya en uygun seriyi seçer ("Hazırla"dan sonraki onay adımında önerilir,
// kullanıcı değiştirebilir). Ana üretim modeli: girdi küçük, isabet önemli. Derleme serileri aday değil (konusu yok).

interface Cevap {
  seri: string;
  neden?: string;
}

export async function POST(istek: Request) {
  const engel = await kapiKontrol();
  if (engel) return engel;

  try {
    const { konu } = (await istek.json()) as { konu?: string };
    const metin = (konu ?? "").trim().slice(0, 400);
    if (metin.length < 4) return NextResponse.json({ hata: "Konu çok kısa." }, { status: 400 });

    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase.from("youtube_seriler").select("id,ad,aciklama,kalip,derleme");
    if (error) throw new Error(error.message);
    const seriler = (data ?? []).filter((s) => !s.derleme);
    if (seriler.length === 0) return NextResponse.json({ hata: "Seri yok." }, { status: 400 });
    if (seriler.length === 1) return NextResponse.json({ seri_id: seriler[0].id, neden: null });

    const liste = seriler
      .map((s, i) => `${i + 1}. ${s.ad} (${s.kalip === "deneyim" ? "bir dönemde/yerde geçen bir gece ya da hayat" : "bir soruya adım adım cevap"}): ${(s.aciklama ?? "").slice(0, 300)}`)
      .join("\n");
    const cevap = await chatJson<Cevap>({
      rol: "uretim",
      maxTokens: 2000,
      timeoutMs: 28_000,
      mesajlar: [
        {
          role: "system",
          content:
            "Uyku için uzun tarih/bilim anlatımları yayınlayan bir YouTube kanalının editörüsün. Verilen bölüm konusunu " +
            "kanalın serilerinden en uygun olanına yerleştir. Kişi odaklı konular (biri kimdi, hayatı) kişi serisine; " +
            "bir yerde/dönemde yaşamı anlatanlar deneyim serisine; neden/nasıl soruları soru serisine gider. " +
            'Sadece JSON: {"seri": "<listedeki numara>", "neden": "<en fazla 12 kelime, Türkçe>"}',
        },
        { role: "user", content: `Seriler:\n${liste}\n\nBölüm konusu: ${metin}` },
      ],
    });
    const no = parseInt(String(cevap.seri ?? "").replace(/\D/g, ""), 10);
    const secilen = seriler[no - 1] ?? seriler.find((s) => s.ad === cevap.seri);
    if (!secilen) return NextResponse.json({ seri_id: null, neden: null });
    return NextResponse.json({ seri_id: secilen.id, neden: cevap.neden?.slice(0, 120) ?? null });
  } catch (err) {
    return hataCevabi(err);
  }
}
