import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { check, configured, COOKIE_OPTIONS, db, equal, failure, JOB_COOKIE, readBody, token, validToken } from "@/lib/jobs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json({ authenticated: validToken((await cookies()).get(JOB_COOKIE)?.value), setup: configured() }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Geçersiz istek." }, { status: 403 });
    if (!process.env.JOBS_PASSWORD || !process.env.SITE_GATE_SECRET) return NextResponse.json({ error: "Önce sunucuda JOBS_PASSWORD ve SITE_GATE_SECRET ayarlarını tamamla." }, { status: 503 });
    const body = await readBody(request);
    // Global bucket for a single-person app; not bypassable with spoofed IP headers.
    const bucket = createHash("sha256").update("ablam-jobs-login").digest("hex");
    if (!check(await db().rpc("job_auth_allow", { attempt_bucket: bucket }))) return NextResponse.json({ error: "Çok fazla giriş denemesi. 15 dakika sonra yeniden dene." }, { status: 429 });
    if (typeof body?.password !== "string" || !equal(body.password, process.env.JOBS_PASSWORD)) return NextResponse.json({ error: "Parola doğru değil." }, { status: 401 });
    (await cookies()).set(JOB_COOKIE, token(), COOKIE_OPTIONS);
    return NextResponse.json({ ok: true });
  } catch (e) { return failure(e); }
}
export async function DELETE(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Geçersiz istek." }, { status: 403 });
  (await cookies()).set(JOB_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
  return NextResponse.json({ ok: true });
}
