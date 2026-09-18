import { DEFAULT_PROFILE, type Profile, type Assessment, type Listing } from "./types";

export class InputError extends Error {}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("Geçersiz veri.");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, field: string): string {
  if (typeof value !== "string" || value.length > max) throw new InputError(`${field}: en fazla ${max} karakter kullan.`);
  return value.trim();
}
function list(value: unknown, max: number, field: string): string[] {
  if (!Array.isArray(value) || value.length > max) throw new InputError(`${field}: en fazla ${max} öğe ekle.`);
  return [...new Set(value.map(v => text(v, 120, field)).filter(Boolean))];
}
export function validateProfile(value: unknown): Profile {
  const v = object(value);
  const p = { ...DEFAULT_PROFILE };
  for (const key of ["name", "skills", "experience", "education", "languages", "constraints", "email"] as const)
    p[key] = text(v[key], key === "email" ? 254 : key === "name" ? 100 : 5000, key);
  for (const key of ["roles", "sectors", "interests", "locations", "greenhouseBoards", "leverBoards", "workModes"] as const)
    p[key] = list(v[key], key === "locations" ? 5 : 10, key);
  p.sources = list(v.sources, 4, "Kaynaklar") as Profile["sources"];
  if (p.sources.some(s => !["jooble", "google", "greenhouse", "lever"].includes(s))) throw new InputError("Bilinmeyen kaynak.");
  if (p.workModes.some(s => !["Ofis", "Hibrit", "Uzaktan"].includes(s))) throw new InputError("Geçersiz çalışma biçimi.");
  for (const key of ["enabled", "emailEnabled"] as const) {
    if (typeof v[key] !== "boolean") throw new InputError("Geçersiz tercih.");
    p[key] = v[key];
  }
  for (const [key, min, max] of [["threshold", 0, 100], ["intervalMinutes", 15, 1440], ["maxAgeDays", 1, 90]] as const) {
    const n = v[key];
    if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) throw new InputError(`${key}: ${min}–${max} arasında olmalı.`);
    p[key] = n;
  }
  if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) throw new InputError("Geçerli bir e-posta adresi yaz.");
  if ([...p.greenhouseBoards, ...p.leverBoards].some(s => !/^[a-zA-Z0-9_-]{1,80}$/.test(s))) throw new InputError("Şirket panosu için URL yerine kısa ad yaz (ör. acme).");
  if (p.enabled && (!p.roles.length || !p.skills || !p.locations.length || !p.sources.length)) throw new InputError("Takibi açmak için meslek, yetkinlik, konum ve en az bir kaynak gerekli.");
  if (p.enabled && p.emailEnabled && !p.email) throw new InputError("Bildirimler için e-posta adresi gerekli.");
  if (p.enabled && p.sources.includes("greenhouse") && !p.greenhouseBoards.length) throw new InputError("Greenhouse için en az bir şirket panosu ekle.");
  if (p.enabled && p.sources.includes("lever") && !p.leverBoards.length) throw new InputError("Lever için en az bir şirket panosu ekle.");
  return p;
}
export function validateAssessment(value: unknown): Assessment {
  const a = object(value);
  if (typeof a.score !== "number" || !Number.isInteger(a.score) || a.score < 0 || a.score > 100 || typeof a.eligible !== "boolean" || !["direct", "transferable", "explore", "unsuitable"].includes(String(a.category))) throw new InputError("AI değerlendirme biçimi geçersiz.");
  return { score: a.score, eligible: a.eligible, category: a.category as Assessment["category"], reason: text(a.reason, 1600, "Gerekçe"), strengths: assessmentList(a.strengths), gaps: assessmentList(a.gaps), questions: assessmentList(a.questions) };
}
function assessmentList(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 8) throw new InputError("AI listesi geçersiz.");
  return v.map(x => text(x, 500, "AI açıklaması"));
}
export function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return null;
    if (!u.hostname.includes(".") || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname) || u.hostname.endsWith(".local")) return null;
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
    u.searchParams.sort();
    return u.toString();
  } catch { return null; }
}
export function plainText(value: unknown, max = 18000): string {
  if (typeof value !== "string") return "";
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim().slice(0, max);
}
export function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) && d.getTime() <= Date.now() + 86400000 ? d.toISOString() : null;
}
export function isRecent(job: Listing, days: number, now = Date.now()): boolean {
  return !job.published_at || new Date(job.published_at).getTime() >= now - days * 86400000;
}
export function matchingProfile(p: Profile): string {
  return JSON.stringify([p.roles, p.sectors, p.interests, p.skills, p.experience, p.education, p.languages, p.locations, p.workModes, p.constraints, p.maxAgeDays]);
}
export function shouldNotify(assessment: Assessment | null, threshold: number, status: string): boolean {
  return !!assessment && assessment.eligible && assessment.category !== "unsuitable" && assessment.score >= threshold && !["applied", "dismissed"].includes(status);
}
