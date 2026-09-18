import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { runWorker } from "../../lib/jobs/worker";
import { DEFAULT_PROFILE, type Job } from "../../lib/jobs/types";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });
type Options = { locked?: boolean; paused?: boolean; sourceError?: boolean; aiError?: boolean; emailError?: boolean; exhausted?: boolean; existingMatch?: boolean };
function harness(options: Options = {}) {
  Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: "https://database.example", SUPABASE_SERVICE_ROLE_KEY: "test-server-key", AI_BASE_URL: "https://ai.example/v1", AI_API_KEY: "test-ai-key", AI_MODEL: "test-model", SERPAPI_API_KEY: "test-search-key", RESEND_API_KEY: "test-email-key", JOBS_EMAIL_FROM: "sender@example.com" });
  const profile = { ...DEFAULT_PROFILE, roles: ["Designer"], skills: "Design", locations: ["İstanbul"], email: "recipient@example.com", enabled: !options.paused, sources: ["google"] };
  const assessment = { score: 85, eligible: true, category: "direct", reason: "Skills match", strengths: ["Design"], gaps: [], questions: [] };
  const job = { id: "11111111-1111-4111-8111-111111111111", fingerprint: "fixture", title: "Designer", company: "Acme", location: "İstanbul", description: "Long description", url: "https://company.example/1", source: "Google İşler", source_id: "1", published_at: null,
    status: "new", assessment: options.existingMatch ? assessment : null, profile_version: options.existingMatch ? 1 : null, first_seen: new Date().toISOString(), evaluated_at: null, attempts: 0, last_error: null } as Job;
  const state = { job, notifications: [] as Record<string, unknown>[], calls: [] as { path: string; method: string; body: Record<string, unknown> }[], released: false, run: {} as Record<string, unknown> };
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const method = init?.method || "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    state.calls.push({ path, method, body });
    if (url.hostname === "ai.example") return options.aiError ? new Response("Unavailable", { status: 503 }) : Response.json({ choices: [{ message: { content: JSON.stringify(assessment) } }] });
    if (url.hostname === "api.resend.com") return options.emailError ? new Response("Unavailable", { status: 429 }) : Response.json({ id: "sent-id" });
    if (url.hostname === "serpapi.com") return new Response("Unavailable", { status: 503 });
    if (url.hostname !== "database.example") throw new Error(`Unmocked network: ${url.hostname}`);
    if (path.endsWith("/rpc/job_claim_lock")) return Response.json(!options.locked);
    if (path.endsWith("/rpc/job_take_budget")) return Response.json(!(options.exhausted && body.budget_kind === "ai"));
    if (path.endsWith("/job_locks")) { state.released = true; return new Response(null, { status: 204 }); }
    if (path.endsWith("/job_runs")) {
      if (method === "POST") return Response.json({ id: "run1" });
      if (method === "PATCH" && url.searchParams.has("id")) Object.assign(state.run, body);
      return method === "GET" ? Response.json([]) : new Response(null, { status: 204 });
    }
    if (path.endsWith("/job_profile")) return Response.json({ id: 1, profile, version: 1, queries: ["Designer"], queries_version: 1 });
    if (path.endsWith("/job_sources")) {
      if (method === "GET") return Response.json(options.sourceError ? [{ id: "google", kind: "google", board: "", query_index: 0, page: 1, page_token: null }] : []);
      return new Response(null, { status: 204 });
    }
    if (path.endsWith("/job_listings")) {
      if (method === "PATCH") { Object.assign(job, body); return new Response(null, { status: 204 }); }
      if (url.searchParams.has("id")) return Response.json(job);
      if (url.searchParams.get("select")?.includes("job_notifications")) {
        assert.equal(url.searchParams.get("job_notifications"), "is.null", "reconciliation must use an anti-join, not an embedded column filter");
        return Response.json(job.assessment && !state.notifications.length ? [job] : []);
      }
      return Response.json(job.profile_version === 1 ? [] : [job]);
    }
    if (path.endsWith("/job_notifications")) {
      if (method === "POST") { if (!state.notifications.length) state.notifications.push({ ...body, id: "notification1", status: "pending", attempts: 0, next_attempt: new Date().toISOString() }); return new Response(null, { status: 201 }); }
      if (method === "PATCH") { Object.assign(state.notifications[0], body); return new Response(null, { status: 204 }); }
      return Response.json(state.notifications.filter(n => n.status === "pending"));
    }
    throw new Error(`Unmocked path: ${path}`);
  };
  return state;
}
test("busy worker never calls providers or releases somebody else's lock", async () => {
  const state = harness({ locked: true });
  assert.equal((await runWorker("scheduler")).status, "busy");
  assert.equal(state.calls.length, 1);
  assert.equal(state.released, false);
});
test("paused tracking logs heartbeat but makes no paid calls", async () => {
  const state = harness({ paused: true });
  assert.equal((await runWorker("scheduler")).status, "paused");
  assert.equal(state.calls.filter(c => c.path.includes("chat/completions") || c.path.includes("emails")).length, 0);
  assert.equal(state.released, true);
});
test("worker evaluates, durably queues and sends a real-shaped match once", async () => {
  const state = harness();
  const result = await runWorker("manual");
  assert.equal(result.status, "completed");
  assert.equal(state.job.profile_version, 1);
  assert.equal(state.notifications[0].status, "sent");
  assert.equal(state.run.sent, 1);
  await runWorker("scheduler");
  assert.equal(state.calls.filter(c => c.path === "/emails").length, 1);
  assert.equal(state.released, true);
});
test("reconciliation recovers a crash between assessment and notification creation", async () => {
  const state = harness({ existingMatch: true });
  await runWorker("scheduler");
  assert.equal(state.calls.filter(c => c.path.endsWith("chat/completions")).length, 0);
  assert.equal(state.notifications[0].status, "sent");
});
test("AI failure retains the job, backs off and does not invent a score", async () => {
  const state = harness({ aiError: true });
  assert.equal((await runWorker("scheduler")).status, "partial");
  assert.equal(state.job.assessment, null);
  assert.equal(state.job.attempts, 1);
  assert.equal(state.notifications.length, 0);
  assert.ok(state.job.last_error?.includes("503"));
  assert.equal(state.released, true);
});
test("email failure keeps durable queue and source failure doesn't block existing jobs", async () => {
  const state = harness({ sourceError: true, emailError: true });
  assert.equal((await runWorker("scheduler")).status, "partial");
  assert.equal(state.job.profile_version, 1);
  assert.equal(state.notifications[0].status, "pending");
  assert.equal(state.notifications[0].attempts, 1);
  assert.ok(String(state.notifications[0].last_error).includes("429"));
  assert.equal(state.released, true);
});
test("exhausted AI budget leaves the queue intact without calling the model", async () => {
  const state = harness({ exhausted: true });
  assert.equal((await runWorker("scheduler")).status, "partial");
  assert.equal(state.job.attempts, 0);
  assert.equal(state.job.profile_version, null);
  assert.equal(state.calls.filter(c => c.path.endsWith("chat/completions")).length, 0);
});
