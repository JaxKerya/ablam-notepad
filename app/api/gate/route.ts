import { NextResponse } from "next/server";
import {
  COK_SAHANE_KELIME,
  COOKIE_SECENEKLERI,
  GATE_COOKIE,
  gateTokenUret,
  turkceNormalize,
} from "@/lib/gate";

export const runtime = "nodejs";

/** Çok şahane kelime doğruysa imzalı çerezi verir; /api/ders/* bunu arar. */
export async function POST(request: Request) {
  let kelime = "";
  try {
    const govde = await request.json();
    kelime = typeof govde?.kelime === "string" ? govde.kelime : "";
  } catch {
    return NextResponse.json({ hata: "Geçersiz istek." }, { status: 400 });
  }

  if (turkceNormalize(kelime) !== COK_SAHANE_KELIME) {
    return NextResponse.json({ hata: "Yanlış cevap." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(GATE_COOKIE, gateTokenUret(), COOKIE_SECENEKLERI);
  return res;
}
