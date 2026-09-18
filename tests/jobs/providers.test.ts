import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { collect, fingerprint } from "../../lib/jobs/sources";
import { DEFAULT_PROFILE, type SourceState } from "../../lib/jobs/types";
import { sendEmail } from "../../lib/jobs/email";
import { equal, token, validToken } from "../../lib/jobs/server";
import { careerContext } from "../../lib/jobs/ai";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });
const profile = { ...DEFAULT_PROFILE, roles: ["Tasarımcı"], locations: ["İstanbul"] };
const state = { id: "jooble", kind: "jooble", board: "", query_index: 0, page: 1, page_token: null, last_attempt: null, last_success: null, next_run: "", last_error: null, last_count: 0, last_query: null } as SourceState;
test("Jooble uses the Turkey endpoint, preserves pagination and rejects unsafe listings", async () => {
  process.env.JOOBLE_API_KEY = "test-key";
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://tr.jooble.org/api/test-key");
    assert.equal(JSON.parse(String(init?.body)).location, "İstanbul");
    return Response.json({ totalCount: 50, jobs: [{ id: 1, title: "Designer", company: "Example", snippet: "<p>Work</p>", link: "https://example.com/jobs/1" }, { id: 2, title: "Unsafe", link: "javascript:alert(1)" }] });
  };
  const result = await collect(state, profile, []);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].description, "Work");
  assert.equal(result.more, true);
});
test("Google uses next_page_token and direct application link", async () => {
  process.env.SERPAPI_API_KEY = "test";
  globalThis.fetch = async url => {
    assert.equal(new URL(String(url)).searchParams.get("next_page_token"), "page2");
    return Response.json({ jobs_results: [{ title: "Designer", company_name: "A", description: "Description", apply_options: [{ link: "https://company.example/job/1" }], job_id: "x" }], serpapi_pagination: { next_page_token: "page3" } });
  };
  const result = await collect({ ...state, kind: "google", page: 2, page_token: "page2" }, profile, []);
  assert.equal(result.nextToken, "page3");
  assert.equal(result.jobs[0].url, "https://company.example/job/1");
  assert.equal(result.jobs[0].published_at, null);
});
test("Malformed and failing sources cannot be reported as successful empty scans", async () => {
  process.env.JOOBLE_API_KEY = "test";
  globalThis.fetch = async () => Response.json({ error: "limit" });
  await assert.rejects(collect(state, profile, []));
  globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
  await assert.rejects(collect(state, profile, []), /503/);
});
test("Greenhouse and Lever normalize company board content", async () => {
  globalThis.fetch = async () => Response.json({ jobs: [{ id: 4, title: "Artist", location: { name: "Remote" }, content: "<p>Illustration</p>", absolute_url: "https://boards.greenhouse.io/acme/jobs/4" }] });
  const gh = await collect({ ...state, kind: "greenhouse", board: "acme" }, profile, []);
  assert.equal(gh.jobs[0].location, "Remote");
  assert.equal(gh.jobs[0].source, "Greenhouse · acme");
  globalThis.fetch = async () => Response.json([{ id: 5, text: "Designer", categories: { location: "İstanbul" }, descriptionPlain: "Design", lists: [{ text: "Skills", content: "<li>Figma</li>" }], hostedUrl: "https://jobs.lever.co/acme/5" }]);
  const lever = await collect({ ...state, kind: "lever", board: "acme" }, profile, []);
  assert.match(lever.jobs[0].description, /Figma/);
});
test("Repeat listings share fingerprints; different posting IDs stay separate", () => {
  assert.equal(fingerprint("https://x.example/job?id=1&utm_source=abc"), fingerprint("https://x.example/job?id=1"));
  assert.notEqual(fingerprint("https://x.example/job?id=1"), fingerprint("https://x.example/job?id=2"));
});
test("Email retries use the same provider idempotency key and body", async () => {
  process.env.RESEND_API_KEY = "test";
  const calls: RequestInit[] = [];
  globalThis.fetch = async (_url, init) => { calls.push(init!); return Response.json({ id: "provider-id" }); };
  const email = { id: "notification-1", sender: "sender@example.com", recipient: "test@example.com", subject: "Job", body: "İlan" };
  assert.equal(await sendEmail(email), "provider-id");
  await sendEmail(email);
  assert.equal(new Headers(calls[0].headers).get("Idempotency-Key"), "ablam-job-notification-1");
  assert.equal(calls[0].body, calls[1].body);
  globalThis.fetch = async () => new Response("Rate limited", { status: 429 });
  await assert.rejects(sendEmail(email), /429/);
});
test("Private session fails closed on forgery, future timestamps and password rotation", () => {
  process.env.JOBS_PASSWORD = "test-password-16chars";
  process.env.SITE_GATE_SECRET = "test-signing-secret";
  const t = token();
  assert.equal(validToken(t), true);
  assert.equal(validToken(`${t}junk`), false);
  assert.equal(validToken(undefined), false);
  assert.equal(validToken(`${Date.now() + 99999999}.fake.signature`), false);
  process.env.JOBS_PASSWORD = "different-test-password";
  assert.equal(validToken(t), false);
  assert.equal(equal("abc", "abc"), true);
  assert.equal(equal("abc", "abd"), false);
});
test("AI context excludes name, email and notification credentials", () => {
  const context = JSON.stringify(careerContext({ ...profile, name: "Private name", email: "private@example.com" }));
  assert.ok(!context.includes("private@example.com"));
  assert.ok(!context.includes("Private name"));
});
