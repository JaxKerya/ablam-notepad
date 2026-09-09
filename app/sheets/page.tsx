"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clapperboard,
  Plus,
  Trash2,
  ArrowRight,
  Loader2,
  LayoutGrid,
  ArrowLeft,
} from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { useToast } from "@/components/Toast";
import {
  DEFAULT_STATUSES,
  DEFAULT_PIPELINE_COLUMNS,
  DEFAULT_NAMING_PATTERN,
  type SheetProject,
} from "@/lib/sheets";

interface ProjectWithStats extends SheetProject {
  shot_count: number;
}

export default function SheetsHome() {
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();
  const { addToast } = useToast();

  const fetchProjects = useCallback(async () => {
    const { data, error } = await supabase
      .from("sheet_projects")
      .select("id, name, naming_pattern, created_at, updated_at, sheet_shots(count)")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Projeler yüklenemedi:", error.message);
      setLoading(false);
      return;
    }

    setProjects(
      (data ?? []).map((p) => {
        const shots = p.sheet_shots as unknown as { count: number }[] | null;
        return {
          id: p.id,
          name: p.name,
          naming_pattern: p.naming_pattern,
          created_at: p.created_at,
          updated_at: p.updated_at,
          shot_count: shots?.[0]?.count ?? 0,
        };
      })
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const createProject = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);

    const { data: project, error } = await supabase
      .from("sheet_projects")
      .insert({ name, naming_pattern: DEFAULT_NAMING_PATTERN })
      .select()
      .single();

    if (error || !project) {
      addToast("Proje oluşturulamadı.", "error");
      setCreating(false);
      return;
    }

    // Varsayılan durumları seed et (pipeline kolonları boş başlar, isteğe bağlı eklenir)
    const statusRows = DEFAULT_STATUSES.map((s, i) => ({
      project_id: project.id,
      name: s.name,
      color: s.color,
      position: i,
    }));
    const pipelineRows = DEFAULT_PIPELINE_COLUMNS.map((name, i) => ({
      project_id: project.id,
      name,
      position: i,
    }));

    const seedOps = [];
    if (statusRows.length > 0) seedOps.push(supabase.from("sheet_statuses").insert(statusRows));
    if (pipelineRows.length > 0)
      seedOps.push(supabase.from("sheet_pipeline_columns").insert(pipelineRows));
    if (seedOps.length > 0) await Promise.all(seedOps);

    addToast("Proje oluşturuldu.", "success");
    router.push(`/sheets/${project.id}`);
  };

  const deleteProject = async (id: string) => {
    setDeleting(true);
    const { error } = await supabase.from("sheet_projects").delete().eq("id", id);
    if (error) {
      addToast("Proje silinemedi.", "error");
    } else {
      addToast("Proje silindi.", "delete");
      setProjects((prev) => prev.filter((p) => p.id !== id));
    }
    setDeleteConfirm(null);
    setDeleting(false);
  };

  return (
    // Kabuk Ablam Ders'ten devralındı: aynı arka plan katmanı, aynı sabit geri
    // düğmesi, aynı ortalanmış başlık ve aynı kapsayıcı ölçüleri. İki bölüm
    // arasında gidip gelirken sayfa değişmiş gibi durmasın diye.
    <main className="relative min-h-screen overflow-x-hidden">
      {/* Arka plan derinliği */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background: [
            "radial-gradient(ellipse 80% 50% at 50% 0%, rgb(var(--accent-rgb) / 0.07) 0%, transparent 60%)",
            "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.15) 100%)",
          ].join(", "),
        }}
      />

      <Link
        href="/"
        className="glass fixed top-5 left-5 z-20 animate-fade-in flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-[13px] text-white/55 transition-all duration-200 hover:border-[var(--border-hover)] hover:text-white/85 sm:top-6 sm:left-7"
      >
        <ArrowLeft size={14} />
        <span>Ana sayfa</span>
      </Link>

      <div className="relative z-10 mx-auto max-w-3xl px-5 pb-20 pt-24 sm:pt-28">
        {/* Başlık */}
        <div className="animate-fade-in mb-10 flex flex-col items-center text-center">
          <div className="glow-sm mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)]/10">
            <Clapperboard size={26} className="text-[var(--accent)]" />
          </div>
          <h1 className="text-2xl font-semibold text-white/95">Ablam Sheets</h1>
          <p className="mt-2 max-w-md text-[13px] leading-relaxed text-white/45">
            Animasyon shot&apos;larını takip et, yönet, senkronize et.
          </p>
        </div>

        {/* Yeni proje */}
        <div
          className="animate-slide-up glass rounded-2xl border border-[var(--border)] p-5"
          style={{ animationDelay: "80ms" }}
        >
          <div className="relative">
            <LayoutGrid
              size={16}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30"
            />
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createProject()}
              disabled={creating}
              placeholder="Yeni proje adı"
              className="focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-3.5 pl-10 pr-4 text-sm text-white/95 placeholder-white/25 transition-all disabled:opacity-50"
              autoFocus
            />
          </div>

          <button
            type="button"
            onClick={createProject}
            disabled={!newName.trim() || creating}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3.5 text-sm font-medium text-[var(--background)] shadow-lg shadow-[var(--accent)]/10 transition-all hover:bg-[var(--accent-light)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
          >
            {creating ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Oluşturuluyor...
              </>
            ) : (
              <>
                <Plus size={15} />
                Proje oluştur
              </>
            )}
          </button>

          <p className="mt-3 text-center text-[11px] text-white/25">
            <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px]">
              Enter
            </kbd>
            {" ile de oluşturabilirsin"}
          </p>
        </div>

        {/* Projeler */}
        <div className="mt-10">
          <h2 className="mb-3 px-1 text-[12px] font-medium uppercase tracking-wider text-white/30">
            Projeler
          </h2>

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 size={18} className="animate-spin text-[var(--accent)]/50" />
            </div>
          ) : projects.length === 0 ? (
            <div className="glass rounded-2xl border border-[var(--border)] px-5 py-10 text-center">
              <p className="text-[13px] text-white/35">
                Henüz proje yok. Yukarıdan ilk projeni oluştur.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((p, i) => (
                <div
                  key={p.id}
                  className="animate-fade-in group relative flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 transition-all hover:border-[var(--border-hover)]"
                  style={{ animationDelay: `${Math.min(i * 35, 300)}ms` }}
                >
                  <Link
                    href={`/sheets/${p.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--accent)]/20 bg-[var(--accent)]/[0.07]">
                      <Clapperboard size={18} className="text-[var(--accent)]/80" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-white/90">
                        {p.name}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-white/35">
                        <span>{p.shot_count} shot</span>
                      </div>
                    </div>
                    <ArrowRight
                      size={15}
                      className="flex-shrink-0 text-white/20 transition-all group-hover:translate-x-0.5 group-hover:text-white/50"
                    />
                  </Link>

                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(p.id)}
                    aria-label="Projeyi sil"
                    className="flex-shrink-0 rounded-lg p-2 text-white/20 opacity-0 transition-all hover:bg-red-400/10 hover:text-red-400 group-hover:opacity-100"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Silme onayı — Ders'teki kutunun aynısı */}
      {deleteConfirm && (
        <div
          className="animate-overlay fixed inset-0 z-[var(--z-panel)] flex items-center justify-center bg-black/40 px-5"
          onClick={() => !deleting && setDeleteConfirm(null)}
        >
          <div
            className="animate-fade-in-scale w-full max-w-xs rounded-2xl border border-[var(--border)] bg-[var(--surface-popup)] p-6 shadow-2xl shadow-black/40"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[14px] font-medium text-white/90">Bu proje silinsin mi?</p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/45">
              İçindeki tüm shot&apos;lar, animatörler ve durumlar da silinir. Geri alınamaz.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
                className="flex-1 rounded-xl border border-[var(--border)] px-4 py-2.5 text-[13px] text-white/60 transition-colors hover:text-white/90 disabled:opacity-50"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => deleteProject(deleteConfirm)}
                disabled={deleting}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-500/85 px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
              >
                {deleting && <Loader2 size={14} className="animate-spin" />}
                Sil
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
