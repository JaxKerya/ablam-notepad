import type { Job, Profile } from "./types";
import { check, db } from "./server";

export function emailBody(job: Job) {
  const a = job.assessment!;
  return ["Senin için yeni bir iş fırsatı var.", "", `${job.title} — ${job.company}`, job.location, `Uygunluk: ${a.score}/100`, "", a.reason,
    "", "Güçlü yanların:", ...a.strengths.map(s => `• ${s}`), "", "Eksikler / dikkat edilecekler:", ...a.gaps.map(s => `• ${s}`),
    ...a.questions.map(s => `• ${s}`), "", `İlanı aç: ${job.url}`, `Kaynak: ${job.source}`, "", "Puan, yapay zekânın tahminidir. Başvurmadan önce ilanın güncelliğini ve koşullarını kontrol et.", "Bildirim tercihlerini ablamablam.com/is sayfasından değiştirebilirsin."].join("\n");
}
export async function enqueue(job: Job, profile: Profile) {
  if (!process.env.JOBS_EMAIL_FROM) throw new Error("E-posta gönderen adresi yapılandırılmamış.");
  check(await db().from("job_notifications").upsert({ job_id: job.id, recipient: profile.email, sender: process.env.JOBS_EMAIL_FROM,
    subject: `Yeni fırsat: ${job.title} — ${job.company}`.slice(0, 250), body: emailBody(job) }, { onConflict: "job_id", ignoreDuplicates: true }));
}
export async function sendEmail(n: { id: string; sender: string; recipient: string; subject: string; body: string }) {
  if (!process.env.RESEND_API_KEY) throw new Error("E-posta servisi henüz bağlı değil.");
  const response = await fetch("https://api.resend.com/emails", { method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `ablam-job-${n.id}` },
    body: JSON.stringify({ from: n.sender, to: [n.recipient], subject: n.subject, text: n.body }),
  });
  if (!response.ok) throw new Error(`E-posta hizmeti HTTP ${response.status} döndürdü.`);
  const result = await response.json();
  if (typeof result.id !== "string") throw new Error("E-posta servisi gönderim kimliği döndürmedi.");
  return result.id as string;
}
