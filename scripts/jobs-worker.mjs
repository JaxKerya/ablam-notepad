// Run beside the deployed Next.js server. Use Node 22.9+; never prints secrets.
// A separate process means closing the browser has no effect on the scheduler.
const base = process.env.JOBS_SITE_URL;
const secret = process.env.CRON_SECRET;
if (!base || !secret) {
  console.error("JOBS_SITE_URL ve CRON_SECRET tanımlanmalı.");
  process.exit(1);
}
const url = new URL("/api/jobs/scan", base);
if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
  console.error("Yerel geliştirme dışında JOBS_SITE_URL HTTPS olmalı.");
  process.exit(1);
}
let stopping = false;
let wake;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; wake?.(); });
console.log("İş Fırsatları zamanlayıcısı başladı (5 dakikada bir).");
while (!stopping) {
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${secret}` }, redirect: "error", signal: AbortSignal.timeout(290000) });
    if (!response.ok) console.error(`${new Date().toISOString()} Tarama HTTP ${response.status}; sonraki turda yeniden denenecek.`);
    else {
      const result = await response.json();
      console.log(`${new Date().toISOString()} ${result.status}; yeni=${result.found ?? 0}, değerlendirilen=${result.evaluated ?? 0}, e-posta=${result.sent ?? 0}`);
    }
  } catch { console.error(`${new Date().toISOString()} Sunucuya ulaşılamadı; sonraki turda yeniden denenecek.`); }
  if (!stopping) await new Promise(resolve => { const timer = setTimeout(resolve, 300000); wake = () => { clearTimeout(timer); resolve(); }; });
}
