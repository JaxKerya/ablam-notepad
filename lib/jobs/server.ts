import { createClient } from "@supabase/supabase-js";
import { createHash, createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { SetupCheck } from "./types";
import { InputError } from "./validation";

export const JOB_COOKIE = "ablam-jobs-session";
export const COOKIE_OPTIONS = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/api/jobs", maxAge: 7 * 86400 };
export function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("İş takibi veritabanı bağlantısı eksik. Kurulum rehberini kontrol et.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12000) }) } });
}
export function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error("İş takibi veritabanı işlemi başarısız. db/jobs.sql kurulumu ve sunucu bağlantısını kontrol et.");
  return result.data;
}
export function equal(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}
function signature(value: string) {
  if (!process.env.SITE_GATE_SECRET || !process.env.JOBS_PASSWORD) throw new Error("İş takibi giriş ayarları eksik.");
  return createHmac("sha256", process.env.SITE_GATE_SECRET).update(`${process.env.JOBS_PASSWORD}:${value}`).digest("hex");
}
export function token() {
  const value = `${Date.now()}.${randomUUID()}`;
  return `${value}.${signature(value)}`;
}
export function validToken(value: string | undefined) {
  if (!value || !process.env.JOBS_PASSWORD || !process.env.SITE_GATE_SECRET) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const age = Date.now() - Number(parts[0]);
  return Number.isFinite(age) && age >= 0 && age < 7 * 86400000 && equal(parts[2], signature(`${parts[0]}.${parts[1]}`));
}
export async function authorize(request?: Request) {
  if (request && !["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Geçersiz istek kaynağı." }, { status: 403 });
  }
  if (!validToken((await cookies()).get(JOB_COOKIE)?.value)) return NextResponse.json({ error: "İş Fırsatları parolanla giriş yap." }, { status: 401 });
  return null;
}
export async function readBody(request: Request) {
  const body = await request.text();
  if (body.length > 40000) throw new InputError("Form çok uzun.");
  try { return JSON.parse(body); } catch { throw new InputError("Geçersiz JSON."); }
}
export function failure(e: unknown) {
  return NextResponse.json({ error: e instanceof InputError ? e.message : "İşlem tamamlanamadı. Bağlantı ve veritabanı kurulumunu kontrol et; yeniden deneyebilirsin." }, { status: e instanceof InputError ? 400 : 503 });
}
export function configured() : SetupCheck[] {
  return [
    { label: "Özel veritabanı bağlantısı", ready: !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY), help: "SUPABASE_SERVICE_ROLE_KEY ve db/jobs.sql" },
    { label: "Kişisel alana giriş", ready: !!(process.env.JOBS_PASSWORD && process.env.SITE_GATE_SECRET), help: "JOBS_PASSWORD ve SITE_GATE_SECRET" },
    { label: "Yapay zekâ", ready: !!(process.env.AI_BASE_URL && process.env.AI_API_KEY && (process.env.JOBS_AI_MODEL || process.env.AI_MODEL)), help: "AI_BASE_URL, AI_API_KEY ve JOBS_AI_MODEL (veya AI_MODEL)" },
    { label: "E-posta gönderimi", ready: !!(process.env.RESEND_API_KEY && process.env.JOBS_EMAIL_FROM), help: "RESEND_API_KEY ve doğrulanmış JOBS_EMAIL_FROM" },
    { label: "Zamanlayıcı anahtarı", ready: !!process.env.CRON_SECRET, help: "CRON_SECRET; ayrıca sunucu zamanlayıcısını başlat" },
    { label: "Jooble", ready: !!process.env.JOOBLE_API_KEY, help: "JOOBLE_API_KEY (Türkiye bölgesi)" },
    { label: "Google İşler", ready: !!process.env.SERPAPI_API_KEY, help: "SERPAPI_API_KEY" },
  ];
}
export function limit(name: string, fallback: number, maximum: number) {
  const v = Number(process.env[name]);
  return Number.isInteger(v) && v > 0 ? Math.min(v, maximum) : fallback;
}
export async function budget(kind: "ai" | "searches") {
  return check(await db().rpc("job_take_budget", { budget_kind: kind, budget_limit: kind === "ai" ? limit("JOBS_DAILY_AI_LIMIT", 100, 5000) : limit("JOBS_DAILY_SEARCH_LIMIT", 100, 5000) })) === true;
}
export async function lock(owner: string) {
  return check(await db().rpc("job_claim_lock", { lock_name: "worker", lock_owner: owner })) === true;
}
export async function unlock(owner: string) {
  check(await db().from("job_locks").delete().eq("id", "worker").eq("owner", owner));
}
