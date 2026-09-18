import { test, expect, type Page } from "@playwright/test";
import { DEFAULT_PROFILE, type Dashboard, type Job } from "../../lib/jobs/types";

// Explicitly mocked provider/database data. Never writes to live Supabase or sends email.
const job: Job = {
  id: "11111111-1111-4111-8111-111111111111", fingerprint: "fixture", title: "Görsel Tasarım Uzmanı", company: "Örnek Tasarım Stüdyosu", location: "İstanbul · Hibrit", description: "Bu ilan yalnızca arayüz testi içindir. Marka görselleri, sosyal medya ve sunum tasarımı.", url: "https://example.com/jobs/fixture", source: "Test kaynağı", source_id: "fixture", published_at: null,
  status: "new", first_seen: new Date().toISOString(), profile_version: 1, evaluated_at: new Date().toISOString(), attempts: 0, last_error: null,
  assessment: { score: 86, eligible: true, category: "transferable", reason: "Görsel iletişim becerilerin ve tasarım araçlarındaki deneyimin bu rolün beklentileriyle örtüşüyor.", strengths: ["Görsel tasarım deneyimi", "Figma ve Photoshop"], gaps: ["Ajans deneyimi belirtilmemiş"], questions: ["Haftalık ofis günleri kaç?"] },
};
const fixture: Dashboard = {
  profile: { ...DEFAULT_PROFILE, name: "Abla", skills: "Figma, Photoshop", roles: ["Grafik tasarımcı"], locations: ["İstanbul"], email: "test@example.com", enabled: true }, profileVersion: 1, queries: ["Grafik tasarımcı", "Görsel tasarım uzmanı", "Visual designer"],
  sources: [{ id: "google", kind: "google", board: "", query_index: 0, page: 1, page_token: null, last_attempt: new Date().toISOString(), last_success: new Date().toISOString(), next_run: new Date(Date.now() + 3600000).toISOString(), last_error: null, last_count: 10, last_query: "Grafik tasarımcı · İstanbul" }],
  runs: [{ id: "run", started_at: new Date().toISOString(), finished_at: new Date().toISOString(), status: "completed", found: 1, evaluated: 1, sent: 0, errors: [], trigger: "scheduler" }], notifications: [], setup: [{ label: "Test bağlantısı", ready: true, help: "Test" }], stats: { total: 1, matched: 1, pending: 0, saved: 0, applied: 0 }, daily: { ai: 2, searches: 1, aiLimit: 100, searchLimit: 100 },
};
async function setup(page: Page, authenticated = true) {
  let dashboard = structuredClone(fixture);
  const jobs = [structuredClone(job)];
  await page.addInitScript(() => localStorage.setItem("ablam-site-auth", "true"));
  await page.route("**/api/gate", route => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/jobs**", async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname.endsWith("/session")) return route.fulfill({ json: { authenticated, setup: fixture.setup } });
    if (url.pathname.endsWith("/scan")) return route.fulfill({ json: { status: "completed" } });
    if (method === "POST") {
      const body = route.request().postDataJSON();
      if (body.action === "profile") dashboard = { ...dashboard, profile: body.profile, profileVersion: dashboard.profileVersion + 1 };
      if (body.action === "status") jobs[0].status = body.status;
      return route.fulfill({ json: { ok: true } });
    }
    if (url.searchParams.get("view") === "list") {
      const filter = url.searchParams.get("filter");
      const search = (url.searchParams.get("q") || "").toLocaleLowerCase("tr");
      const result = jobs.filter(j => (!search || `${j.title} ${j.company}`.toLocaleLowerCase("tr").includes(search)) && (!filter || ["all", "matched"].includes(filter) || filter === j.status));
      return route.fulfill({ json: { jobs: result, total: result.length, page: 0 } });
    }
    return route.fulfill({ json: dashboard });
  });
}

test("unauthenticated APIs cannot expose profile or run paid jobs", async ({ request }) => {
  expect((await request.get("/api/jobs")).status()).toBe(401);
  expect((await request.post("/api/jobs/scan")).status()).toBe(401);
  expect((await request.get("/api/jobs/scan")).status()).toBe(401);
});
test("private area shows its own password gate", async ({ page }) => {
  await setup(page, false);
  await page.goto("/is");
  await expect(page.getByLabel("İş Fırsatları parolası", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Devam et" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Profilim", exact: true })).not.toBeVisible();
});
test("desktop dashboard: detail, filtering, profile persistence and application status", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await setup(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/is");
  await expect(page.getByRole("heading", { name: "Görsel Tasarım Uzmanı" })).toBeVisible();
  await page.screenshot({ path: "test-results/jobs-desktop.png", fullPage: true });
  await page.getByText("İlan ve değerlendirme ayrıntıları", { exact: true }).click();
  await expect(page.getByText("Haftalık ofis günleri kaç?", { exact: true })).toBeVisible();
  await page.getByLabel("İlan, şirket veya şehir ara").fill("bulunmayan");
  await expect(page.getByRole("heading", { name: "Bu aramada bir ilan bulunamadı" })).toBeVisible();
  await page.getByLabel("İlan, şirket veya şehir ara").fill("");
  await expect(page.getByRole("heading", { name: "Görsel Tasarım Uzmanı" })).toBeVisible();
  await page.getByLabel("Görsel Tasarım Uzmanı başvuru durumu").selectOption("applied");
  await expect(page.getByRole("status")).toContainText("İlan durumu güncellendi");
  await page.getByRole("button", { name: "Profilim", exact: true }).click();
  await page.getByLabel("Adın", { exact: true }).fill("Yeni isim");
  await page.getByLabel("Yetkin olduğun meslekler", { exact: false }).fill("Grafik tasarımcı, İçerik tasarımcısı");
  await page.getByRole("button", { name: "Kaynaklar", exact: true }).click();
  await page.getByRole("button", { name: "Profilim", exact: true }).click();
  await expect(page.getByLabel("Adın", { exact: true })).toHaveValue("Yeni isim");
  await page.getByRole("button", { name: "Profili ve tercihleri kaydet" }).click();
  await expect(page.getByRole("status")).toContainText("Profilin kaydedildi");
  await expect(page.getByLabel("Yetkin olduğun meslekler", { exact: false })).toHaveValue("Grafik tasarımcı, İçerik tasarımcısı");
  await page.getByRole("button", { name: "Sistem günlüğü", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Son çalışmalar" })).toBeVisible();
  expect(errors).toEqual([]);
});
test("mobile layout has no horizontal overflow and forms remain usable", async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/is");
  await expect(page.getByRole("heading", { name: "Görsel Tasarım Uzmanı" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/jobs-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Profilim", exact: true }).click();
  await expect(page.getByLabel("Adın", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/jobs-profile-mobile.png", fullPage: true });
});
test("source/network errors render a retry state instead of an empty list", async ({ page }) => {
  await setup(page);
  await page.route("**/api/jobs?view=list**", route => route.fulfill({ status: 503, json: { error: "Test bağlantı hatası" } }));
  await page.goto("/is");
  await expect(page.getByRole("alert").filter({ hasText: "Test bağlantı hatası" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Yeniden dene" })).toBeVisible();
});

test("existing home, Sheets and Ders still render after dependency updates", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await setup(page);
  await page.route("**/rest/v1/**", route => route.fulfill({ json: [], headers: { "content-range": "0-0/0" } }));
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Ablam İş Fırsatları" })).toBeVisible();
  await page.goto("/sheets");
  await expect(page.getByRole("heading", { name: "Ablam Sheets", exact: true })).toBeVisible();
  await page.goto("/ders");
  await expect(page.getByRole("heading", { name: "Ablam Ders", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
