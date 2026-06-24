"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  Settings2,
  Table2,
  BarChart3,
  Cloud,
  CloudOff,
  Loader2,
  Trash2,
  Copy,
  X,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { supabase } from "@/lib/supabase-browser";
import { useToast } from "@/components/Toast";
import CellSelect from "@/components/sheets/CellSelect";
import SummaryPanel from "@/components/sheets/SummaryPanel";
import SheetSettings from "@/components/sheets/SheetSettings";
import SheetToolbar from "@/components/sheets/SheetToolbar";
import ShotRow from "@/components/sheets/ShotRow";
import {
  sortShots,
  type SheetProject,
  type SheetStatus,
  type SheetPipelineColumn,
  type SheetAnimator,
  type SheetShot,
  type SortState,
  type SortKey,
} from "@/lib/sheets";

interface Props {
  project: SheetProject;
  initialStatuses: SheetStatus[];
  initialColumns: SheetPipelineColumn[];
  initialAnimators: SheetAnimator[];
  initialShots: SheetShot[];
}

type SyncState = "idle" | "saving" | "saved" | "error";

export default function SheetView({
  project: initialProject,
  initialStatuses,
  initialColumns,
  initialAnimators,
  initialShots,
}: Props) {
  const [project, setProject] = useState(initialProject);
  const [statuses, setStatuses] = useState(initialStatuses);
  const [columns, setColumns] = useState(initialColumns);
  const [animators, setAnimators] = useState(initialAnimators);
  const [shots, setShots] = useState(initialShots);
  const [tab, setTab] = useState<"table" | "summary">("table");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sync, setSync] = useState<SyncState>("idle");
  const [addingShot, setAddingShot] = useState(false);

  // view state
  const [search, setSearch] = useState("");
  const [filterAnimators, setFilterAnimators] = useState<Set<string>>(new Set());
  const [filterStatuses, setFilterStatuses] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { addToast } = useToast();

  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingPatches = useRef<Map<string, Partial<SheetShot>>>(new Map());
  const recentSaves = useRef<Map<string, number>>(new Map());
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lastSelectedIndex = useRef<number | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  /* ---------------- meta refresh ---------------- */
  const refreshMeta = useCallback(async () => {
    const [s, c, a] = await Promise.all([
      supabase.from("sheet_statuses").select("*").eq("project_id", project.id).order("position"),
      supabase.from("sheet_pipeline_columns").select("*").eq("project_id", project.id).order("position"),
      supabase.from("sheet_animators").select("*").eq("project_id", project.id).order("position"),
    ]);
    if (s.data) setStatuses(s.data as SheetStatus[]);
    if (c.data) setColumns(c.data as SheetPipelineColumn[]);
    if (a.data) setAnimators(a.data as SheetAnimator[]);
  }, [project.id]);

  /* ---------------- realtime ---------------- */
  useEffect(() => {
    const channel = supabase
      .channel(`sheet-${project.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sheet_shots", filter: `project_id=eq.${project.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as { id: string }).id;
            setShots((prev) => prev.filter((s) => s.id !== oldId));
            return;
          }
          const row = payload.new as SheetShot;
          const saved = recentSaves.current.get(row.id);
          if (saved && Date.now() - saved < 2500) return;
          setShots((prev) => {
            const exists = prev.some((s) => s.id === row.id);
            return exists ? prev.map((s) => (s.id === row.id ? row : s)) : [...prev, row];
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sheet_statuses", filter: `project_id=eq.${project.id}` },
        () => refreshMeta()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sheet_pipeline_columns", filter: `project_id=eq.${project.id}` },
        () => refreshMeta()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sheet_animators", filter: `project_id=eq.${project.id}` },
        () => refreshMeta()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [project.id, refreshMeta]);

  /* ---------------- shot field mutations ---------------- */
  const flush = useCallback(async (id: string) => {
    const patch = pendingPatches.current.get(id);
    pendingPatches.current.delete(id);
    const timer = saveTimers.current.get(id);
    if (timer) clearTimeout(timer);
    saveTimers.current.delete(id);
    if (!patch || Object.keys(patch).length === 0) return;

    recentSaves.current.set(id, Date.now());
    setSync("saving");
    const { error } = await supabase.from("sheet_shots").update(patch).eq("id", id);
    if (error) {
      setSync("error");
    } else {
      setSync("saved");
      setTimeout(() => setSync((s) => (s === "saved" ? "idle" : s)), 1200);
    }
  }, []);

  const updateShot = useCallback(
    (id: string, patch: Partial<SheetShot>, immediate = false) => {
      setShots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
      const merged = { ...(pendingPatches.current.get(id) ?? {}), ...patch };
      pendingPatches.current.set(id, merged);
      const existing = saveTimers.current.get(id);
      if (existing) clearTimeout(existing);
      if (immediate) flush(id);
      else saveTimers.current.set(id, setTimeout(() => flush(id), 600));
    },
    [flush]
  );

  const togglePipeline = useCallback(
    (shot: SheetShot, columnId: string) => {
      const next = { ...(shot.pipeline ?? {}) };
      next[columnId] = !next[columnId];
      updateShot(shot.id, { pipeline: next }, true);
    },
    [updateShot]
  );

  /* ---------------- position persistence ---------------- */
  const persistPositions = useCallback(async (rows: { id: string; position: number }[]) => {
    if (rows.length === 0) return;
    const now = Date.now();
    rows.forEach((r) => recentSaves.current.set(r.id, now));
    setSync("saving");
    const results = await Promise.all(
      rows.map((r) => supabase.from("sheet_shots").update({ position: r.position }).eq("id", r.id))
    );
    const err = results.some((r) => r.error);
    setSync(err ? "error" : "saved");
    if (!err) setTimeout(() => setSync((s) => (s === "saved" ? "idle" : s)), 1200);
  }, []);

  /* ---------------- add / delete / duplicate ---------------- */
  const addShot = useCallback(async (): Promise<string | null> => {
    const maxPos = shots.reduce((m, s) => Math.max(m, s.position), -1);
    const { data, error } = await supabase
      .from("sheet_shots")
      .insert({ project_id: project.id, position: maxPos + 1, status_id: statuses[0]?.id ?? null, pipeline: {} })
      .select()
      .single();
    if (error || !data) {
      addToast("Satır eklenemedi.", "error");
      return null;
    }
    recentSaves.current.set(data.id, Date.now());
    setShots((prev) => [...prev, data as SheetShot]);
    return data.id;
  }, [shots, project.id, statuses, addToast]);

  const handleAddClick = useCallback(async () => {
    if (addingShot) return;
    setAddingShot(true);
    await addShot();
    setAddingShot(false);
  }, [addingShot, addShot]);

  const deleteShot = useCallback(
    async (id: string) => {
      recentSaves.current.set(id, Date.now());
      setShots((prev) => prev.filter((s) => s.id !== id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      const { error } = await supabase.from("sheet_shots").delete().eq("id", id);
      if (error) addToast("Satır silinemedi.", "error");
    },
    [addToast]
  );

  const duplicateShot = useCallback(
    async (id: string) => {
      const ordered = [...shots].sort((a, b) => a.position - b.position);
      const idx = ordered.findIndex((s) => s.id === id);
      if (idx < 0) return;
      const src = ordered[idx];
      const { data, error } = await supabase
        .from("sheet_shots")
        .insert({
          project_id: project.id,
          animator_id: src.animator_id,
          status_id: src.status_id,
          shot_code: src.shot_code,
          frame_count: src.frame_count,
          notes: src.notes,
          revision_note: src.revision_note,
          pipeline: src.pipeline,
          position: src.position + 1,
        })
        .select()
        .single();
      if (error || !data) {
        addToast("Çoğaltılamadı.", "error");
        return;
      }
      recentSaves.current.set(data.id, Date.now());
      const newOrdered = [...ordered];
      newOrdered.splice(idx + 1, 0, data as SheetShot);
      const reindexed = newOrdered.map((s, i) => ({ ...s, position: i }));
      setShots(reindexed);
      persistPositions(reindexed.map((s) => ({ id: s.id, position: s.position })));
      addToast("Satır çoğaltıldı.", "success");
    },
    [shots, project.id, addToast, persistPositions]
  );

  /* ---------------- bulk ---------------- */
  const bulkUpdate = useCallback(
    async (patch: Partial<SheetShot>) => {
      const ids = [...selected];
      if (ids.length === 0) return;
      const now = Date.now();
      ids.forEach((id) => recentSaves.current.set(id, now));
      setShots((prev) => prev.map((s) => (selected.has(s.id) ? { ...s, ...patch } : s)));
      setSync("saving");
      const { error } = await supabase.from("sheet_shots").update(patch).in("id", ids);
      setSync(error ? "error" : "saved");
      if (!error) setTimeout(() => setSync((s) => (s === "saved" ? "idle" : s)), 1200);
    },
    [selected]
  );

  const bulkDelete = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const now = Date.now();
    ids.forEach((id) => recentSaves.current.set(id, now));
    setShots((prev) => prev.filter((s) => !selected.has(s.id)));
    setSelected(new Set());
    const { error } = await supabase.from("sheet_shots").delete().in("id", ids);
    if (error) addToast("Silinemedi.", "error");
    else addToast(`${ids.length} satır silindi.`, "delete");
  }, [selected, addToast]);

  const bulkDuplicate = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const sources = shots.filter((s) => ids.includes(s.id));
    let maxPos = shots.reduce((m, s) => Math.max(m, s.position), -1);
    const rows = sources.map((src) => ({
      project_id: project.id,
      animator_id: src.animator_id,
      status_id: src.status_id,
      shot_code: src.shot_code,
      frame_count: src.frame_count,
      notes: src.notes,
      revision_note: src.revision_note,
      pipeline: src.pipeline,
      position: ++maxPos,
    }));
    const { data, error } = await supabase.from("sheet_shots").insert(rows).select();
    if (error || !data) {
      addToast("Çoğaltılamadı.", "error");
      return;
    }
    const now = Date.now();
    data.forEach((d) => recentSaves.current.set(d.id, now));
    setShots((prev) => [...prev, ...(data as SheetShot[])]);
    setSelected(new Set());
    addToast(`${data.length} satır çoğaltıldı.`, "success");
  }, [selected, shots, project.id, addToast]);

  /* ---------------- view derivation ---------------- */
  const filtersActive =
    search.trim() !== "" || filterAnimators.size > 0 || filterStatuses.size > 0;
  const sortActive = sort !== null && sort.key !== "position";
  const dragEnabled = !filtersActive && !sortActive;

  const visibleShots = useMemo(() => {
    let list = sortShots(shots, sort, animators, statuses);
    const q = search.trim().toLowerCase();
    if (q)
      list = list.filter(
        (s) => s.shot_code.toLowerCase().includes(q) || s.notes.toLowerCase().includes(q)
      );
    if (filterAnimators.size > 0)
      list = list.filter((s) => s.animator_id && filterAnimators.has(s.animator_id));
    if (filterStatuses.size > 0)
      list = list.filter((s) => s.status_id && filterStatuses.has(s.status_id));
    return list;
  }, [shots, sort, animators, statuses, search, filterAnimators, filterStatuses]);

  /* ---------------- drag reorder ---------------- */
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const ordered = [...shots].sort((a, b) => a.position - b.position);
      const oldIndex = ordered.findIndex((s) => s.id === active.id);
      const newIndex = ordered.findIndex((s) => s.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      const moved = arrayMove(ordered, oldIndex, newIndex).map((s, i) => ({ ...s, position: i }));
      setShots(moved);
      const changed = moved.filter((m) => {
        const old = ordered.find((o) => o.id === m.id);
        return old && old.position !== m.position;
      });
      persistPositions(changed.map((s) => ({ id: s.id, position: s.position })));
    },
    [shots, persistPositions]
  );

  /* ---------------- selection ---------------- */
  const toggleSelect = useCallback(
    (id: string, e: React.MouseEvent) => {
      const idx = visibleShots.findIndex((s) => s.id === id);
      if (e.shiftKey && lastSelectedIndex.current !== null) {
        const [a, b] = [lastSelectedIndex.current, idx].sort((x, y) => x - y);
        const range = visibleShots.slice(a, b + 1).map((s) => s.id);
        setSelected((prev) => {
          const next = new Set(prev);
          range.forEach((rid) => next.add(rid));
          return next;
        });
      } else {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      }
      lastSelectedIndex.current = idx;
    },
    [visibleShots]
  );

  const allSelected = visibleShots.length > 0 && visibleShots.every((s) => selected.has(s.id));
  const toggleSelectAll = useCallback(() => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(visibleShots.map((s) => s.id)));
  }, [allSelected, visibleShots]);

  /* ---------------- keyboard navigation ---------------- */
  const focusCell = (row: number, col: string) => {
    const el = wrapperRef.current?.querySelector<HTMLInputElement>(
      `[data-row="${row}"][data-col="${col}"]`
    );
    if (el) {
      el.focus();
      el.select();
    }
  };

  const focusLastCell = (col: string) => {
    const els = wrapperRef.current?.querySelectorAll<HTMLInputElement>(`[data-col="${col}"]`);
    if (els && els.length) {
      const el = els[els.length - 1];
      el.focus();
      el.select();
    }
  };

  const handleTableKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const col = target.getAttribute?.("data-col");
    const rowAttr = target.getAttribute?.("data-row");
    if (!col || rowAttr === null || rowAttr === undefined) return;
    const row = parseInt(rowAttr);

    if (e.key === "ArrowDown" || e.key === "Enter") {
      e.preventDefault();
      if (row + 1 < visibleShots.length) {
        focusCell(row + 1, col);
      } else if (e.key === "Enter" && dragEnabled) {
        handleAddClick().then(() => requestAnimationFrame(() => focusLastCell(col)));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (row > 0) focusCell(row - 1, col);
    }
  };

  /* ---------------- sorting ---------------- */
  const handleSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  const clearFilters = () => {
    setSearch("");
    setFilterAnimators(new Set());
    setFilterStatuses(new Set());
  };

  const animatorOptions = animators.map((a) => ({ id: a.id, label: a.name, color: a.color }));
  const statusOptions = statuses.map((s) => ({ id: s.id, label: s.name, color: s.color }));
  const colSpan = 9 + columns.length;

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <div className="sticky top-0 z-30 border-b border-[var(--border)] glass-strong">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/sheets"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/45 transition-colors hover:bg-white/5 hover:text-white/85"
            title="Projeler"
          >
            <ArrowLeft size={17} />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold text-white">{project.name}</h1>
            {project.naming_pattern?.trim() && (
              <p className="truncate font-mono text-[11px] text-white/35">{project.naming_pattern}</p>
            )}
          </div>

          <SyncBadge state={sync} />

          <div className="hidden items-center rounded-lg border border-[var(--border)] bg-black/20 p-0.5 sm:flex">
            <TabBtn active={tab === "table"} onClick={() => setTab("table")} icon={<Table2 size={14} />} label="Tablo" />
            <TabBtn active={tab === "summary"} onClick={() => setTab("summary")} icon={<BarChart3 size={14} />} label="Özet" />
          </div>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/5 hover:text-white/90"
            title="Ayarlar"
          >
            <Settings2 size={17} />
          </button>
        </div>

        <div className="flex items-center gap-1 px-4 pb-2 sm:hidden">
          <TabBtn active={tab === "table"} onClick={() => setTab("table")} icon={<Table2 size={14} />} label="Tablo" />
          <TabBtn active={tab === "summary"} onClick={() => setTab("summary")} icon={<BarChart3 size={14} />} label="Özet" />
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
        {tab === "summary" ? (
          <SummaryPanel animators={animators} statuses={statuses} shots={shots} />
        ) : (
          <>
            <SheetToolbar
              search={search}
              onSearch={setSearch}
              animators={animators}
              statuses={statuses}
              filterAnimators={filterAnimators}
              filterStatuses={filterStatuses}
              onToggleAnimator={(id) =>
                setFilterAnimators((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              onToggleStatus={(id) =>
                setFilterStatuses((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              onClear={clearFilters}
              sort={sort}
              onClearSort={() => setSort(null)}
              visibleCount={visibleShots.length}
              totalCount={shots.length}
            />

            <div
              ref={wrapperRef}
              onKeyDown={handleTableKeyDown}
              className="overflow-x-auto rounded-2xl border border-[var(--border)]"
            >
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="bg-black/30 text-[11.5px] uppercase tracking-wide text-white/55">
                      <th className="w-8 px-1 py-2.5 text-center">
                        <button
                          type="button"
                          onClick={toggleSelectAll}
                          className={`mx-auto flex h-[16px] w-[16px] items-center justify-center rounded border transition-all ${
                            allSelected
                              ? "border-[var(--accent)] bg-[var(--accent)] text-[#2a3329]"
                              : "border-white/25 hover:border-[var(--accent)]/60"
                          }`}
                          title="Tümünü seç"
                        >
                          {allSelected && <span className="text-[10px] leading-none">✓</span>}
                        </button>
                      </th>
                      <th className="w-14 px-1 py-2.5 text-center font-medium">#</th>
                      <SortableTh label="Animatör" sortKey="animator" sort={sort} onSort={handleSort} className="min-w-[150px] text-left" />
                      <SortableTh label="Shot" sortKey="shot_code" sort={sort} onSort={handleSort} className="min-w-[180px] text-left" />
                      <SortableTh label="Kare" sortKey="frame_count" sort={sort} onSort={handleSort} className="w-16 text-center" />
                      <th className="min-w-[220px] px-2 py-2.5 text-left font-medium">Notlar</th>
                      <SortableTh label="Durum" sortKey="status" sort={sort} onSort={handleSort} className="min-w-[120px] text-left" />
                      {columns.map((c) => (
                        <th key={c.id} className="w-12 px-1 py-2.5 text-center font-medium" title={c.name}>
                          {c.name}
                        </th>
                      ))}
                      <th className="min-w-[160px] px-2 py-2.5 text-left font-medium">Revize</th>
                      <th className="w-16 px-1 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleShots.length === 0 ? (
                      <tr>
                        <td colSpan={colSpan} className="px-4 py-12 text-center text-[13px] text-white/35">
                          {shots.length === 0
                            ? "Henüz shot yok. Aşağıdan ilk satırı ekle."
                            : "Filtreye uyan shot yok."}
                        </td>
                      </tr>
                    ) : (
                      <SortableContext items={visibleShots.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                        {visibleShots.map((shot, i) => (
                          <ShotRow
                            key={shot.id}
                            shot={shot}
                            index={i}
                            columns={columns}
                            animatorOptions={animatorOptions}
                            statusOptions={statusOptions}
                            namingPattern={project.naming_pattern}
                            selected={selected.has(shot.id)}
                            dragEnabled={dragEnabled}
                            onToggleSelect={toggleSelect}
                            updateShot={updateShot}
                            flush={flush}
                            togglePipeline={togglePipeline}
                            duplicateShot={duplicateShot}
                            deleteShot={deleteShot}
                          />
                        ))}
                      </SortableContext>
                    )}
                  </tbody>
                </table>
              </DndContext>
            </div>

            {!dragEnabled && shots.length > 0 && (
              <p className="mt-2 text-[11.5px] text-white/30">
                Filtre veya sıralama açıkken sürükle-bırak devre dışıdır.
              </p>
            )}

            <button
              type="button"
              onClick={handleAddClick}
              disabled={addingShot}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--border)] py-3 text-[13px] text-white/45 transition-all hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 hover:text-[var(--accent)] disabled:opacity-40"
            >
              {addingShot ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              Yeni shot ekle
            </button>
          </>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && tab === "table" && (
        <div className="fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
          <div className="animate-slide-up flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.12] bg-black/25 backdrop-blur-xl px-3 py-2.5 shadow-xl shadow-black/30">
            <span className="px-1.5 text-[12.5px] font-medium text-white">{selected.size} seçili</span>
            <div className="h-5 w-px bg-[var(--border)]" />
            <div className="w-[130px]">
              <CellSelect
                value={null}
                options={statusOptions}
                placeholder="Durum ata"
                variant="badge"
                allowClear={false}
                onChange={(id) => bulkUpdate({ status_id: id })}
              />
            </div>
            <div className="w-[130px]">
              <CellSelect
                value={null}
                options={animatorOptions}
                placeholder="Animatör ata"
                allowClear={false}
                onChange={(id) => bulkUpdate({ animator_id: id })}
              />
            </div>
            <button
              type="button"
              onClick={bulkDuplicate}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-white/70 transition-colors hover:bg-white/8 hover:text-white"
            >
              <Copy size={13} /> Çoğalt
            </button>
            <button
              type="button"
              onClick={bulkDelete}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-red-400 transition-colors hover:bg-red-500/15"
            >
              <Trash2 size={13} /> Sil
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/8 hover:text-white/80"
              title="Seçimi temizle"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {settingsOpen && (
        <SheetSettings
          project={project}
          statuses={statuses}
          columns={columns}
          animators={animators}
          onClose={() => setSettingsOpen(false)}
          onRefresh={refreshMeta}
          onProjectChange={(patch) => setProject((p) => ({ ...p, ...patch }))}
        />
      )}
    </div>
  );
}

function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
  className = "",
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState | null;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort?.key === sortKey;
  return (
    <th className={`px-2 py-2.5 font-medium ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-white/90 ${
          active ? "text-[var(--accent)]" : ""
        }`}
      >
        {label}
        {active &&
          (sort!.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
        active ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-white/50 hover:text-white/85"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function SyncBadge({ state }: { state: SyncState }) {
  if (state === "idle") return null;
  const map = {
    saving: { icon: <Loader2 size={13} className="animate-spin" />, text: "Kaydediliyor", cls: "text-white/50" },
    saved: { icon: <Cloud size={13} />, text: "Kaydedildi", cls: "text-emerald-400/80" },
    error: { icon: <CloudOff size={13} />, text: "Hata", cls: "text-red-400" },
  } as const;
  const s = map[state];
  return (
    <span className={`hidden items-center gap-1.5 text-[11.5px] sm:flex ${s.cls}`}>
      {s.icon}
      {s.text}
    </span>
  );
}
