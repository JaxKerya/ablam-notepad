"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clapperboard,
  Plus,
  Trash2,
  ArrowRight,
  X,
  Loader2,
  LayoutGrid,
  CornerDownLeft,
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
    <div className="min-h-screen px-4 py-10 sm:px-8 sm:py-16">
      <div className="mx-auto w-full max-w-3xl">
        {/* Header */}
        <div className="animate-fade-in mb-10">
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-white/45 transition-colors hover:text-white/80"
          >
            <ArrowLeft size={14} /> Ana sayfa
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent)]/15 text-[var(--accent)] glow-sm">
              <Clapperboard size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white">
                Ablam Sheets
              </h1>
              <p className="text-[13px] text-white/50">
                Animasyon shot&apos;larını takip et, yönet, senkronize et.
              </p>
            </div>
          </div>
        </div>

        {/* New project input */}
        <div className="animate-slide-up glass-strong mb-8 rounded-2xl border border-[var(--border)] p-4">
          <div className="flex items-center gap-2.5">
            <div className="relative flex-1">
              <LayoutGrid
                size={16}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35"
              />
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createProject()}
                placeholder="Yeni proje adı"
                className="focus-ring w-full rounded-xl border border-[var(--border)] bg-black/20 py-2.5 pl-10 pr-4 text-[14px] text-white placeholder:text-white/30"
                autoFocus
              />
            </div>
            <button
              type="button"
              onClick={createProject}
              disabled={!newName.trim() || creating}
              className="flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-[13px] font-medium text-[#2a3329] transition-all hover:bg-[var(--accent-light)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {creating ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Plus size={15} />
              )}
              Oluştur
            </button>
          </div>
        </div>

        {/* Project list */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 size={22} className="animate-spin text-[var(--accent)]/60" />
          </div>
        ) : projects.length === 0 ? (
          <div className="animate-fade-in rounded-2xl border border-dashed border-[var(--border)] py-16 text-center">
            <Clapperboard size={28} className="mx-auto mb-3 text-white/20" />
            <p className="text-[14px] text-white/45">Henüz proje yok.</p>
            <p className="mt-1 text-[12.5px] text-white/30">
              Yukarıdan ilk projeni oluştur.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {projects.map((p, i) => (
              <div
                key={p.id}
                className="animate-fade-in group relative flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-black/15 p-4 transition-all hover:border-[var(--border-hover)] hover:bg-black/25"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <Link href={`/sheets/${p.id}`} className="flex flex-1 items-center gap-3.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/12 text-[var(--accent)]">
                    <Clapperboard size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium text-white">
                      {p.name}
                    </p>
                    <p className="text-[12px] text-white/40">
                      {p.shot_count} shot
                    </p>
                  </div>
                  <ArrowRight
                    size={16}
                    className="text-white/25 transition-all group-hover:translate-x-0.5 group-hover:text-white/60"
                  />
                </Link>
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(p.id)}
                  className="rounded-lg p-2 text-white/25 opacity-0 transition-all hover:bg-red-500/15 hover:text-red-400 group-hover:opacity-100"
                  title="Projeyi sil"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="mt-8 flex items-center justify-center gap-1.5 text-center text-[11.5px] text-white/25">
          <CornerDownLeft size={12} /> Enter ile hızlıca proje oluştur
        </p>
      </div>

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40 animate-backdrop-blur"
            onClick={() => !deleting && setDeleteConfirm(null)}
          />
          <div className="pointer-events-none relative flex h-full items-center justify-center p-4">
          <div
            className="pointer-events-auto animate-fade-in-scale w-full max-w-sm rounded-2xl border border-white/[0.12] bg-black/20 backdrop-blur-2xl p-6 shadow-2xl shadow-black/40"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-white">
                Projeyi sil?
              </h3>
              <button
                type="button"
                onClick={() => !deleting && setDeleteConfirm(null)}
                className="rounded-md p-1 text-white/35 hover:text-white/80"
              >
                <X size={16} />
              </button>
            </div>
            <p className="mb-5 text-[13px] leading-relaxed text-white/55">
              Bu proje ve içindeki tüm shot&apos;lar, animatörler ve durumlar kalıcı
              olarak silinecek. Bu işlem geri alınamaz.
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
                className="flex-1 rounded-xl border border-[var(--border)] py-2.5 text-[13px] text-white/70 transition-colors hover:bg-white/5"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => deleteProject(deleteConfirm)}
                disabled={deleting}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-500/90 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Sil
              </button>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
