const STORAGE_KEY = "ablam-notepad-history";
const MAX_HISTORY = 50;

export interface NoteHistoryItem {
  id: string;
  lastVisited: number; // timestamp
}

export function getNoteHistory(): NoteHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as NoteHistoryItem[];
  } catch {
    return [];
  }
}

export function addToNoteHistory(noteId: string): void {
  if (typeof window === "undefined") return;
  try {
    const history = getNoteHistory().filter((item) => item.id !== noteId);
    history.unshift({ id: noteId, lastVisited: Date.now() });
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(history.slice(0, MAX_HISTORY))
    );
  } catch {
    // localStorage unavailable
  }
}

export function removeFromNoteHistory(noteId: string): void {
  if (typeof window === "undefined") return;
  try {
    const history = getNoteHistory().filter((item) => item.id !== noteId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // localStorage unavailable
  }
}

export function clearNoteHistory(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable
  }
}
