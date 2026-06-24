// Ablam Sheets — paylaşılan tipler, varsayılanlar ve yardımcılar

export interface SheetProject {
  id: string;
  name: string;
  naming_pattern: string;
  created_at: string;
  updated_at: string;
}

export interface SheetStatus {
  id: string;
  project_id: string;
  name: string;
  color: string;
  position: number;
}

export interface SheetPipelineColumn {
  id: string;
  project_id: string;
  name: string;
  position: number;
}

export interface SheetAnimator {
  id: string;
  project_id: string;
  name: string;
  color: string;
  position: number;
}

export interface SheetShot {
  id: string;
  project_id: string;
  animator_id: string | null;
  status_id: string | null;
  shot_code: string;
  frame_count: number;
  notes: string;
  revision_note: string;
  pipeline: Record<string, boolean>;
  position: number;
  created_at: string;
  updated_at: string;
}

// Yeni projeler için sade varsayılan durum akışı
export const DEFAULT_STATUSES: { name: string; color: string }[] = [
  { name: "Yapılmadı", color: "#e06666" },
  { name: "Yapılıyor", color: "#93c47d" },
  { name: "Hazır", color: "#6fa8dc" },
  { name: "Onay", color: "#d4e4a5" },
];

// Pipeline (checkbox) kolonları varsayılan olarak boş gelir; istenirse ayarlardan eklenir
export const DEFAULT_PIPELINE_COLUMNS: string[] = [];

// Yeni animatörlere döngüsel atanan renk paleti
export const ANIMATOR_COLORS: string[] = [
  "#d4e4a5",
  "#e06666",
  "#6fa8dc",
  "#93c47d",
  "#b4a7d6",
  "#ffd966",
  "#76a5af",
  "#f6b26b",
  "#c27ba0",
  "#8e7cc3",
];

// İsimlendirme şablonu varsayılan olarak boştur; her proje kendi şablonunu belirler
export const DEFAULT_NAMING_PATTERN = "";

// Pattern tokenlarını doldurur, örn. {episode}_{shot}_{start}_{end}_{version}
export function buildShotName(
  pattern: string,
  values: { episode?: string; shot?: string; start?: string; end?: string; version?: string }
): string {
  return pattern
    .replace(/\{episode\}/g, values.episode ?? "")
    .replace(/\{shot\}/g, values.shot ?? "")
    .replace(/\{start\}/g, values.start ?? "")
    .replace(/\{end\}/g, values.end ?? "")
    .replace(/\{version\}/g, values.version ?? "");
}

// Bir metni okunabilir bir hex renge çevirir (deterministik) — gerekirse fallback
export function colorWithAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Başlangıç/bitiş karesinden toplam kare sayısı (her iki uç dahil)
export function framesFromRange(start: number, end: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const diff = Math.floor(end) - Math.floor(start) + 1;
  return diff > 0 ? diff : 0;
}

export type SortKey = "position" | "shot_code" | "frame_count" | "animator" | "status";
export type SortDir = "asc" | "desc";
export interface SortState {
  key: SortKey;
  dir: SortDir;
}

// Görünüm katmanı sıralaması — ham veriyi (position) değiştirmez
export function sortShots(
  shots: SheetShot[],
  sort: SortState | null,
  animators: SheetAnimator[],
  statuses: SheetStatus[]
): SheetShot[] {
  const list = [...shots].sort((a, b) => a.position - b.position);
  if (!sort) return list;

  const animatorOrder = new Map(animators.map((a, i) => [a.id, i]));
  const statusOrder = new Map(statuses.map((s, i) => [s.id, i]));
  const dir = sort.dir === "asc" ? 1 : -1;

  return list.sort((a, b) => {
    let av: number | string;
    let bv: number | string;
    switch (sort.key) {
      case "shot_code":
        av = a.shot_code.toLowerCase();
        bv = b.shot_code.toLowerCase();
        break;
      case "frame_count":
        av = a.frame_count || 0;
        bv = b.frame_count || 0;
        break;
      case "animator":
        av = a.animator_id ? animatorOrder.get(a.animator_id) ?? 9999 : 9999;
        bv = b.animator_id ? animatorOrder.get(b.animator_id) ?? 9999 : 9999;
        break;
      case "status":
        av = a.status_id ? statusOrder.get(a.status_id) ?? 9999 : 9999;
        bv = b.status_id ? statusOrder.get(b.status_id) ?? 9999 : 9999;
        break;
      default:
        av = a.position;
        bv = b.position;
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return a.position - b.position;
  });
}

// Renk parlaklığına göre okunabilir metin rengi (siyah/beyaz) döndürür
export function readableTextColor(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1a1f1a" : "#ffffff";
}
