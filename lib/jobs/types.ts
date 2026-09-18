export type SourceKind = "jooble" | "google" | "greenhouse" | "lever";
export type JobStatus = "new" | "saved" | "applied" | "dismissed";
export interface Profile {
  name: string;
  sectors: string[];
  roles: string[];
  interests: string[];
  skills: string;
  experience: string;
  education: string;
  languages: string;
  locations: string[];
  workModes: string[];
  constraints: string;
  email: string;
  threshold: number;
  intervalMinutes: number;
  maxAgeDays: number;
  enabled: boolean;
  emailEnabled: boolean;
  sources: SourceKind[];
  greenhouseBoards: string[];
  leverBoards: string[];
}
export const DEFAULT_PROFILE: Profile = {
  name: "", sectors: [], roles: [], interests: [], skills: "", experience: "",
  education: "", languages: "", locations: [], workModes: ["Ofis", "Hibrit", "Uzaktan"],
  constraints: "", email: "", threshold: 70, intervalMinutes: 60, maxAgeDays: 30,
  enabled: false, emailEnabled: true, sources: ["jooble", "google"],
  greenhouseBoards: [], leverBoards: [],
};
export interface Listing {
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  source: string;
  source_id: string;
  published_at: string | null;
}
export interface Assessment {
  score: number;
  category: "direct" | "transferable" | "explore" | "unsuitable";
  reason: string;
  strengths: string[];
  gaps: string[];
  questions: string[];
  eligible: boolean;
}
export interface Job extends Listing {
  id: string;
  fingerprint: string;
  status: JobStatus;
  assessment: Assessment | null;
  profile_version: number | null;
  first_seen: string;
  evaluated_at: string | null;
  attempts: number;
  last_error: string | null;
}
export interface SourceState {
  id: string;
  kind: SourceKind;
  board: string;
  query_index: number;
  page: number;
  page_token: string | null;
  last_attempt: string | null;
  last_success: string | null;
  next_run: string;
  last_error: string | null;
  last_count: number;
  last_query: string | null;
}
export interface Run {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  found: number;
  evaluated: number;
  sent: number;
  errors: string[];
  trigger: string;
}
export interface Notification {
  id: string;
  job_id: string | null;
  recipient: string;
  subject: string;
  status: string;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
}
export interface SetupCheck { label: string; ready: boolean; help: string }
export interface Dashboard {
  profile: Profile;
  profileVersion: number;
  queries: string[];
  sources: SourceState[];
  runs: Run[];
  notifications: Notification[];
  setup: SetupCheck[];
  stats: { total: number; matched: number; pending: number; saved: number; applied: number };
  daily: { ai: number; searches: number; aiLimit: number; searchLimit: number };
}
