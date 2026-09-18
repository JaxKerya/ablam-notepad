import { randomUUID } from "node:crypto";
import { assess, BudgetError, expandQueries } from "./ai";
import { enqueue, sendEmail } from "./email";
import { budget, check, db, lock, unlock } from "./server";
import { collect, fingerprint, sourcePlan } from "./sources";
import { isRecent, shouldNotify } from "./validation";
import type { Job, Profile, SourceState } from "./types";

const now = () => new Date().toISOString();
const later = (minutes: number) => new Date(Date.now() + minutes * 60000).toISOString();
const message = (e: unknown) => e instanceof Error ? e.message : "Bilinmeyen işlem hatası.";

export async function runWorker(trigger: "scheduler" | "manual") {
  const owner = randomUUID();
  if (!await lock(owner)) return { status: "busy", message: "Başka bir tarama veya profil güncellemesi sürüyor." };
  const client = db();
  const result = { status: "completed", found: 0, evaluated: 0, sent: 0, errors: [] as string[] };
  let runId: string | undefined;
  // A route is capped at 300s. Stop starting work after 200s; each I/O is bounded.
  const deadline = Date.now() + 200000;
  try {
    check(await client.from("job_runs").update({ status: "interrupted", finished_at: now(), errors: ["Önceki çalışma kesildi. Kuyruk korunarak yeniden başlatıldı."] }).eq("status", "running"));
    const previous = check(await client.from("job_runs").select("started_at").order("started_at", { ascending: false }).limit(1));
    if (previous?.[0] && Date.now() - Date.parse(previous[0].started_at) < 60000) return { status: "cooldown", message: "Son taramadan sonra en az bir dakika bekle." };
    const run = check(await client.from("job_runs").insert({ trigger }).select("id").single());
    if (!run) throw new Error("Tarama kaydı oluşturulamadı.");
    runId = run.id;
    const saved = check(await client.from("job_profile").select("*").eq("id", 1).maybeSingle());
    if (!saved || !(saved.profile as Profile).enabled) {
      result.status = "paused";
      return result;
    }
    const profile = saved.profile as Profile;
    const version = saved.version as number;
    let queries = saved.queries as string[];
    if (saved.queries_version !== version) {
      try {
        queries = await expandQueries(profile);
        check(await client.from("job_profile").update({ queries, queries_version: version }).eq("id", 1).eq("version", version));
      } catch (e) {
        result.errors.push(`Arama genişletme: ${message(e)}`);
        queries = [...new Set([...profile.roles, ...profile.interests])];
      }
    }
    const plan = sourcePlan(profile);
    if (plan.length) check(await client.from("job_sources").upsert(plan, { onConflict: "id", ignoreDuplicates: true }));
    const states = plan.length ? check(await client.from("job_sources").select("*").in("id", plan.map(s => s.id)).lte("next_run", now()).order("next_run").limit(4)) as SourceState[] : [];
    for (const state of states) {
      if (Date.now() > deadline - 50000) break;
      if (!await budget("searches")) { result.errors.push("Günlük kaynak çağrı sınırına ulaşıldı. Aramalar yarın devam edecek."); break; }
      check(await client.from("job_sources").update({ last_attempt: now() }).eq("id", state.id));
      try {
        const page = await collect(state, profile, queries);
        const unique = [...new Map(page.jobs.filter(j => isRecent(j, profile.maxAgeDays)).map(j => [fingerprint(j.url), { ...j, fingerprint: fingerprint(j.url) }])).values()];
        for (let start = 0; start < unique.length; start += 100) {
          if (Date.now() > deadline - 40000) throw new Error("Büyük kaynak yanıtının kalan kısmı sonraki turda işlenecek.");
          const inserted = check(await client.from("job_listings").upsert(unique.slice(start, start + 100), { onConflict: "fingerprint", ignoreDuplicates: true }).select("id"));
          result.found += inserted?.length ?? 0;
        }
        // Query rotation is explicit. Continue at most 5 pages per query, then give other roles a turn.
        const more = page.more && state.page < 5;
        check(await client.from("job_sources").update({ last_success: now(), last_count: page.jobs.length, last_query: page.query,
          last_error: page.more && !more ? "Bu sorguda ilk 5 sayfa tarandı; sıradaki sorguya geçildi. Kapsam sınırına ulaşıldı." : null,
          next_run: later(more ? 5 : profile.intervalMinutes), page: more ? state.page + 1 : 1, page_token: more ? page.nextToken : null,
          query_index: more ? state.query_index : (state.query_index + 1) % Math.max(1, page.queryCount),
        }).eq("id", state.id));
      } catch (e) {
        const error = message(e);
        result.errors.push(`${state.id}: ${error}`);
        check(await client.from("job_sources").update({ last_error: error, next_run: later(Math.max(15, profile.intervalMinutes)),
          // A provider can expire pagination tokens. Restart that query after a failure.
          page: 1, page_token: null,
        }).eq("id", state.id));
      }
    }
    const cutoff = new Date(Date.now() - profile.maxAgeDays * 86400000).toISOString();
    const jobs = check(await client.from("job_listings").select("*").or(`profile_version.is.null,profile_version.neq.${version}`)
      .lte("next_attempt", now()).gte("first_seen", cutoff).not("status", "in", '("applied","dismissed")').order("first_seen").limit(5)) as Job[];
    for (const job of jobs) {
      if (Date.now() > deadline - 50000) break;
      if (!isRecent(job, profile.maxAgeDays)) {
        check(await client.from("job_listings").update({ profile_version: version, eligible: false, score: null, assessment: null, evaluated_at: now() }).eq("id", job.id));
        continue;
      }
      try {
        const assessment = await assess(profile, job);
        check(await client.from("job_listings").update({ assessment, score: assessment.score, eligible: assessment.eligible && assessment.category !== "unsuitable", profile_version: version,
          evaluated_at: now(), attempts: 0, last_error: null }).eq("id", job.id));
        result.evaluated++;
      } catch (e) {
        result.errors.push(message(e));
        if (e instanceof BudgetError) break;
        check(await client.from("job_listings").update({ attempts: job.attempts + 1, last_error: message(e), next_attempt: later(Math.min(360, 5 * 2 ** Math.min(job.attempts, 7))) }).eq("id", job.id));
      }
    }
    // Reconcile separately from evaluation: a crash between evaluation and enqueue cannot lose a notification.
    if (profile.emailEnabled && profile.email && Date.now() < deadline - 25000) {
      if (!process.env.RESEND_API_KEY || !process.env.JOBS_EMAIL_FROM) {
        result.errors.push("E-posta bağlantısı eksik. Uygun ilanlar korunuyor; bağlantı kurulunca bildirimler kuyruğa alınacak.");
      } else {
        const candidates = check(await client.from("job_listings").select("*, job_notifications!left(id)")
          .eq("profile_version", version).eq("eligible", true).gte("score", profile.threshold).gte("first_seen", cutoff)
          .is("job_notifications", null).not("status", "in", '("applied","dismissed")').order("first_seen").limit(20)) as (Job & { job_notifications: unknown[] })[];
        for (const job of candidates) {
          if (Date.now() > deadline - 25000) break;
          if (isRecent(job, profile.maxAgeDays) && shouldNotify(job.assessment, profile.threshold, job.status)) await enqueue(job, profile);
        }
        const pending = check(await client.from("job_notifications").select("*").eq("status", "pending").lte("next_attempt", now()).order("created_at").limit(5));
        for (const notification of pending ?? []) {
          if (Date.now() > deadline - 20000) break;
          // Recheck current score/status after changes and avoid sending to an old recipient.
          if (notification.recipient !== profile.email) {
            check(await client.from("job_notifications").update({ status: "cancelled", last_error: "Alıcı adresi değişti." }).eq("id", notification.id));
            continue;
          }
          if (notification.job_id) {
            const job = check(await client.from("job_listings").select("*").eq("id", notification.job_id).single()) as Job;
            if (job.profile_version !== version) continue;
            if (!shouldNotify(job.assessment, profile.threshold, job.status) || !isRecent(job, profile.maxAgeDays)) {
              check(await client.from("job_notifications").update({ status: "cancelled", last_error: "İlan artık bildirim koşullarını karşılamıyor." }).eq("id", notification.id));
              continue;
            }
          }
          try {
            const providerId = await sendEmail(notification);
            check(await client.from("job_notifications").update({ status: "sent", sent_at: now(), provider_id: providerId, attempts: notification.attempts + 1, last_error: null }).eq("id", notification.id));
            result.sent++;
          } catch (e) {
            result.errors.push(message(e));
            check(await client.from("job_notifications").update({ attempts: notification.attempts + 1, last_error: message(e), next_attempt: later(Math.min(360, 5 * 2 ** Math.min(notification.attempts, 7))) }).eq("id", notification.id));
          }
        }
      }
    }
    if (result.errors.length) result.status = "partial";
    return result;
  } catch (e) {
    result.status = "failed";
    result.errors.push(message(e));
    throw e;
  } finally {
    try { if (runId) check(await client.from("job_runs").update({ ...result, finished_at: now() }).eq("id", runId)); }
    finally { await unlock(owner); }
  }
}
