import { createHash } from "node:crypto";
import type { Listing, Profile, SourceState } from "./types";
import { plainText, safeUrl, validDate } from "./validation";

type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(row) : [];
const str = (v: unknown): string => typeof v === "string" ? v : typeof v === "number" ? String(v) : "";

export function fingerprint(url: string) { return createHash("sha256").update(safeUrl(url) || url).digest("hex"); }
export function sourcePlan(profile: Profile) {
  return profile.sources.flatMap(kind => {
    const boards = kind === "greenhouse" ? profile.greenhouseBoards : kind === "lever" ? profile.leverBoards : [""];
    return boards.map(board => ({ id: `${kind}${board ? `:${board}` : ""}`, kind, board }));
  });
}
export function sourceReady(kind: string) {
  return kind === "jooble" ? !!process.env.JOOBLE_API_KEY : kind === "google" ? !!process.env.SERPAPI_API_KEY : true;
}
export async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  // Only fixed provider endpoints are fetched; listing URLs are never server-fetched.
  const response = await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Kaynak yanıtı: HTTP ${response.status}.`);
  const body = await response.text();
  if (body.length > 12_000_000) throw new Error("Kaynak yanıtı boyut sınırını aştı.");
  try { return JSON.parse(body); } catch { throw new Error("Kaynak geçerli JSON döndürmedi."); }
}
function listing(title: unknown, company: unknown, location: unknown, description: unknown, url: unknown, source: string, id: unknown, date?: unknown): Listing | null {
  const link = safeUrl(str(url));
  const name = plainText(title, 300);
  if (!link || !name) return null;
  return { title: name, company: plainText(company, 200) || "Şirket belirtilmemiş", location: plainText(location, 300), description: plainText(description), url: link, source, source_id: str(id).slice(0, 500), published_at: validDate(date) };
}
export interface SourcePage { jobs: Listing[]; more: boolean; nextToken: string | null; query: string; queryCount: number }
export async function collect(source: SourceState, profile: Profile, queries: string[]): Promise<SourcePage> {
  if (!sourceReady(source.kind)) throw new Error("Kaynağın API anahtarı henüz tanımlanmamış.");
  const terms = queries.length ? queries : profile.roles;
  const locations = profile.locations.length ? profile.locations : ["Türkiye"];
  const pairs = terms.flatMap(query => locations.map(location => ({ query, location })));
  const pair = pairs[source.query_index % pairs.length] || { query: "", location: "Türkiye" };
  let items: (Listing | null)[] = [];
  let more = false;
  let nextToken: string | null = null;
  let query = `${pair.query} · ${pair.location}`;
  if (source.kind === "jooble") {
    const data = row(await fetchJson(`https://tr.jooble.org/api/${encodeURIComponent(process.env.JOOBLE_API_KEY!)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywords: pair.query, location: pair.location, page: source.page, ResultOnPage: 20 }),
    }));
    if (!Array.isArray(data.jobs)) throw new Error("Jooble ilan listesi döndürmedi.");
    items = rows(data.jobs).map(j => listing(j.title, j.company, j.location, j.snippet, j.link, "Jooble", j.id, j.updated));
    more = items.length > 0 && source.page * 20 < Number(data.totalCount);
  } else if (source.kind === "google") {
    const params = new URLSearchParams({ engine: "google_jobs", q: `${pair.query} ${pair.location}`, hl: "tr", gl: "tr", api_key: process.env.SERPAPI_API_KEY! });
    if (source.page_token) params.set("next_page_token", source.page_token);
    const data = row(await fetchJson(`https://serpapi.com/search.json?${params}`));
    if (data.error) throw new Error("Google İşler araması başarısız; kota veya sorguyu kontrol et.");
    if (!Array.isArray(data.jobs_results) && row(data.search_metadata).status !== "Success") throw new Error("Google İşler yanıt biçimi değişti.");
    items = rows(data.jobs_results).map(j => {
      const options = rows(j.apply_options);
      const url = options.find(o => safeUrl(str(o.link)))?.link || j.share_link;
      return listing(j.title, j.company_name, j.location, j.description, url, "Google İşler", j.job_id);
    });
    nextToken = str(row(data.serpapi_pagination).next_page_token) || null;
    more = !!nextToken;
  } else if (source.kind === "greenhouse") {
    const data = row(await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.board)}/jobs?content=true`));
    if (!Array.isArray(data.jobs)) throw new Error("Greenhouse şirket panosu bulunamadı.");
    items = rows(data.jobs).map(j => listing(j.title, source.board, row(j.location).name, j.content, j.absolute_url, `Greenhouse · ${source.board}`, j.id, j.updated_at));
    query = `${source.board} · tüm açık pozisyonlar`;
  } else {
    const data = await fetchJson(`https://api.lever.co/v0/postings/${encodeURIComponent(source.board)}?mode=json&skip=${(source.page - 1) * 100}&limit=100`);
    if (!Array.isArray(data)) throw new Error("Lever şirket panosu bulunamadı.");
    items = rows(data).map(j => listing(j.text, source.board, row(j.categories).location, `${str(j.descriptionPlain)} ${rows(j.lists).map(l => `${str(l.text)} ${str(l.content)}`).join(" ")} ${str(j.additionalPlain)}`, j.hostedUrl, `Lever · ${source.board}`, j.id));
    more = items.length === 100;
    query = `${source.board} · tüm açık pozisyonlar`;
  }
  return { jobs: items.filter((j): j is Listing => !!j), more, nextToken, query, queryCount: pairs.length };
}
