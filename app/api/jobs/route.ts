import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { authorize, check, configured, db, failure, limit, lock, readBody, unlock } from "@/lib/jobs/server";
import { DEFAULT_PROFILE, type Profile } from "@/lib/jobs/types";
import { InputError, matchingProfile, object, validateProfile } from "@/lib/jobs/validation";
import { sourcePlan, sourceReady } from "@/lib/jobs/sources";
import { sendEmail } from "@/lib/jobs/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const denied = await authorize();
  if (denied) return denied;
  try {
    const client = db();
    const params = new URL(request.url).searchParams;
    const saved = check(await client.from("job_profile").select("*").eq("id", 1).maybeSingle());
    const profile = (saved?.profile || DEFAULT_PROFILE) as Profile;
    const version = saved?.version || 1;
    const cutoff = new Date(Date.now() - profile.maxAgeDays * 86400000).toISOString();
    if (params.get("view") === "list") {
      const page = Math.max(0, Math.min(10000, Number(params.get("page")) || 0));
      const filter = params.get("filter") || "matched";
      let query = client.from("job_listings").select("*", { count: "exact" });
      if (filter === "matched") query = query.eq("profile_version", version).eq("eligible", true).gte("score", profile.threshold).gte("first_seen", cutoff).or(`published_at.is.null,published_at.gte.${cutoff}`).not("status", "in", '("applied","dismissed")');
      else if (["saved", "applied", "dismissed", "new"].includes(filter)) query = query.eq("status", filter);
      else if (filter === "pending") query = query.or(`profile_version.is.null,profile_version.neq.${version}`).not("status", "in", '("applied","dismissed")').gte("first_seen", cutoff);
      const search = (params.get("q") || "").replace(/[^\p{L}\p{N}\s]/gu, "").trim().slice(0, 100);
      if (search) query = query.or(`title.ilike.%${search}%,company.ilike.%${search}%,location.ilike.%${search}%`);
      const response = await query.order("score", { ascending: false, nullsFirst: false }).order("first_seen", { ascending: false }).order("id").range(page * 24, page * 24 + 23);
      check(response);
      return NextResponse.json({ jobs: response.data || [], total: response.count || 0, page, profileVersion: version }, { headers: { "Cache-Control": "no-store" } });
    }
    const counts = [
      client.from("job_listings").select("id", { count: "exact", head: true }),
      client.from("job_listings").select("id", { count: "exact", head: true }).eq("profile_version", version).eq("eligible", true).gte("score", profile.threshold).gte("first_seen", cutoff).or(`published_at.is.null,published_at.gte.${cutoff}`).not("status", "in", '("applied","dismissed")'),
      client.from("job_listings").select("id", { count: "exact", head: true }).or(`profile_version.is.null,profile_version.neq.${version}`).gte("first_seen", cutoff).not("status", "in", '("applied","dismissed")'),
      client.from("job_listings").select("id", { count: "exact", head: true }).eq("status", "saved"),
      client.from("job_listings").select("id", { count: "exact", head: true }).eq("status", "applied"),
    ];
    const [sources, runs, notifications, usage, ...stats] = await Promise.all([
      client.from("job_sources").select("*").order("id"),
      client.from("job_runs").select("*").order("started_at", { ascending: false }).limit(20),
      client.from("job_notifications").select("id,job_id,recipient,subject,status,attempts,last_error,sent_at,created_at").order("created_at", { ascending: false }).limit(40),
      client.from("job_usage").select("*").eq("day", new Date().toISOString().slice(0, 10)).maybeSingle(),
      ...counts,
    ]);
    const enabledIds = sourcePlan(profile).map(s => s.id);
    const setup = configured();
    setup.unshift({ label: "Veritabanı tabloları", ready: true, help: "db/jobs.sql kurulu" });
    return NextResponse.json({ profile, profileVersion: version, queries: saved?.queries || [],
      sources: (check(sources) || []).filter(s => enabledIds.includes(s.id)), runs: check(runs), notifications: check(notifications), setup,
      stats: Object.fromEntries(stats.map((s, i) => { check(s); return [["total", "matched", "pending", "saved", "applied"][i], s.count || 0]; })),
      daily: { ai: check(usage)?.ai || 0, searches: usage.data?.searches || 0, aiLimit: limit("JOBS_DAILY_AI_LIMIT", 100, 5000), searchLimit: limit("JOBS_DAILY_SEARCH_LIMIT", 100, 5000) },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const owner = randomUUID();
  let claimed = false;
  try {
    const body = object(await readBody(request));
    if (!await lock(owner)) return NextResponse.json({ error: "Tarama şu anda çalışıyor. Birkaç dakika sonra yeniden dene; formun korunuyor." }, { status: 409 });
    claimed = true;
    const client = db();
    if (body.action === "profile") {
      const profile = validateProfile(body.profile);
      if (profile.enabled) {
        const missing = profile.sources.filter(s => !sourceReady(s));
        if (missing.length) throw new InputError(`Seçili kaynakların bağlantısı eksik: ${missing.join(", ")}. Kaynağı kapat veya API anahtarını tanımla.`);
        if (!process.env.AI_API_KEY || !process.env.AI_BASE_URL || !(process.env.JOBS_AI_MODEL || process.env.AI_MODEL)) throw new InputError("Takibi başlatmak için AI bağlantısını tamamla.");
        if (profile.emailEnabled && (!process.env.RESEND_API_KEY || !process.env.JOBS_EMAIL_FROM)) throw new InputError("E-posta ayarlarını tamamla veya şimdilik e-posta bildirimlerini kapat.");
      }
      const previous = check(await client.from("job_profile").select("*").eq("id", 1).maybeSingle());
      if (previous && body.version !== previous.version) return NextResponse.json({ error: "Profil başka bir sekmede değişti. Sayfayı yenileyip son değişiklikleri kontrol et." }, { status: 409 });
      const changed = !previous || matchingProfile(previous.profile) !== matchingProfile(profile);
      const version = check(await client.rpc("job_save_profile", { new_profile: profile, expected_version: previous?.version || 0, matching_changed: changed }));
      return NextResponse.json({ ok: true, version });
    }
    if (body.action === "status") {
      if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id) || !["new", "saved", "applied", "dismissed"].includes(String(body.status))) throw new InputError("İlan durumu geçersiz.");
      const updated = check(await client.from("job_listings").update({ status: body.status }).eq("id", body.id).select("id").maybeSingle());
      if (!updated) throw new InputError("İlan bulunamadı.");
      if (["new", "saved"].includes(String(body.status))) check(await client.from("job_notifications").delete().eq("job_id", body.id).eq("status", "cancelled").eq("attempts", 0));
      return NextResponse.json({ ok: true });
    }
    if (body.action === "test-email") {
      const saved = check(await client.from("job_profile").select("profile").eq("id", 1).maybeSingle());
      const p = saved?.profile as Profile | undefined;
      if (!p?.email) throw new InputError("Önce profiline e-posta adresini kaydet.");
      if (!process.env.JOBS_EMAIL_FROM || !process.env.RESEND_API_KEY) throw new InputError("E-posta bağlantısı eksik.");
      const last = check(await client.from("job_notifications").select("created_at").is("job_id", null).order("created_at", { ascending: false }).limit(1));
      if (last?.[0] && Date.now() - Date.parse(last[0].created_at) < 300000) throw new InputError("Test e-postası için beş dakika bekle.");
      const notification = check(await client.from("job_notifications").insert({ recipient: p.email, sender: process.env.JOBS_EMAIL_FROM, subject: "Ablam İş Fırsatları — bağlantı testi", body: "E-posta bağlantın çalışıyor. Takip açıkken profilinle eşleşen yeni ilanları bu adrese göndereceğiz." }).select("*").single());
      try {
        const providerId = await sendEmail(notification);
        check(await client.from("job_notifications").update({ status: "sent", sent_at: new Date().toISOString(), attempts: 1, provider_id: providerId }).eq("id", notification.id));
      } catch {
        check(await client.from("job_notifications").update({ last_error: "Test gönderilemedi. Takip açıkken yeniden denenecek.", attempts: 1, next_attempt: new Date(Date.now() + 300000).toISOString() }).eq("id", notification.id));
        throw new InputError("Test gönderilemedi. Bağlantıyı kontrol et; bildirim geçmişinde ayrıntısını görebilirsin.");
      }
      return NextResponse.json({ ok: true });
    }
    throw new InputError("Bilinmeyen işlem.");
  } catch (e) { return failure(e); }
  finally { if (claimed) await unlock(owner); }
}
