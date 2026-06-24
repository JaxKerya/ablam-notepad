"use client";

import { useState } from "react";
import {
  X,
  Plus,
  Trash2,
  Users,
  Tag,
  Columns3,
  Settings2,
  GripVertical,
  Loader2,
} from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { useToast } from "@/components/Toast";
import {
  ANIMATOR_COLORS,
  type SheetProject,
  type SheetStatus,
  type SheetPipelineColumn,
  type SheetAnimator,
} from "@/lib/sheets";

type Tab = "animators" | "statuses" | "columns" | "general";

interface Props {
  project: SheetProject;
  statuses: SheetStatus[];
  columns: SheetPipelineColumn[];
  animators: SheetAnimator[];
  onClose: () => void;
  onRefresh: () => void;
  onProjectChange: (patch: Partial<SheetProject>) => void;
}

const STATUS_PALETTE = [
  "#e06666", "#93c47d", "#6fa8dc", "#b4a7d6",
  "#8e7cc3", "#76a5af", "#45818e", "#bf9000",
  "#f6b26b", "#c27ba0", "#ffd966", "#a4c2f4",
];

export default function SheetSettings({
  project,
  statuses,
  columns,
  animators,
  onClose,
  onRefresh,
  onProjectChange,
}: Props) {
  const [tab, setTab] = useState<Tab>("animators");
  const { addToast } = useToast();

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "animators", label: "Animatörler", icon: <Users size={15} /> },
    { id: "statuses", label: "Durumlar", icon: <Tag size={15} /> },
    { id: "columns", label: "Kolonlar", icon: <Columns3 size={15} /> },
    { id: "general", label: "Genel", icon: <Settings2 size={15} /> },
  ];

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40 animate-backdrop-blur" onClick={onClose} />
      <div className="pointer-events-none relative flex h-full items-center justify-center p-4">
      <div
        className="pointer-events-auto animate-fade-in-scale flex h-[80vh] max-h-[640px] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-black/20 backdrop-blur-2xl shadow-2xl shadow-black/40"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-[15px] font-semibold text-white">Proje Ayarları</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-white/35 transition-colors hover:text-white/85"
          >
            <X size={17} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[var(--border)] px-3 py-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                tab === t.id
                  ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                  : "text-white/50 hover:bg-white/5 hover:text-white/80"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === "animators" && (
            <AnimatorsTab
              projectId={project.id}
              animators={animators}
              onRefresh={onRefresh}
              addToast={addToast}
            />
          )}
          {tab === "statuses" && (
            <StatusesTab
              projectId={project.id}
              statuses={statuses}
              onRefresh={onRefresh}
              addToast={addToast}
            />
          )}
          {tab === "columns" && (
            <ColumnsTab
              projectId={project.id}
              columns={columns}
              onRefresh={onRefresh}
              addToast={addToast}
            />
          )}
          {tab === "general" && (
            <GeneralTab project={project} onProjectChange={onProjectChange} addToast={addToast} />
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

type AddToast = (m: string, t?: "success" | "error" | "info" | "delete") => void;

/* ---------------- Animators ---------------- */
function AnimatorsTab({
  projectId,
  animators,
  onRefresh,
  addToast,
}: {
  projectId: string;
  animators: SheetAnimator[];
  onRefresh: () => void;
  addToast: AddToast;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    const color = ANIMATOR_COLORS[animators.length % ANIMATOR_COLORS.length];
    const { error } = await supabase.from("sheet_animators").insert({
      project_id: projectId,
      name: n,
      color,
      position: animators.length,
    });
    if (error) addToast("Animatör eklenemedi.", "error");
    else {
      setName("");
      onRefresh();
    }
    setBusy(false);
  };

  const updateName = async (id: string, newName: string) => {
    await supabase.from("sheet_animators").update({ name: newName }).eq("id", id);
    onRefresh();
  };

  const updateColor = async (id: string, color: string) => {
    await supabase.from("sheet_animators").update({ color }).eq("id", id);
    onRefresh();
  };

  const remove = async (id: string) => {
    await supabase.from("sheet_animators").delete().eq("id", id);
    addToast("Animatör silindi.", "delete");
    onRefresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <AddRow
        value={name}
        onChange={setName}
        onAdd={add}
        busy={busy}
        placeholder="Animatör adı"
      />
      {animators.length === 0 ? (
        <Empty text="Henüz animatör yok." />
      ) : (
        <div className="flex flex-col gap-1.5">
          {animators.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-black/15 p-2 pl-3"
            >
              <input
                type="color"
                value={a.color}
                onChange={(e) => updateColor(a.id, e.target.value)}
                className="h-6 w-6 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0"
                title="Renk"
              />
              <input
                defaultValue={a.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== a.name && updateName(a.id, e.target.value.trim())}
                className="focus-ring flex-1 rounded-lg bg-transparent px-2 py-1 text-[13px] text-white"
              />
              <button
                type="button"
                onClick={() => remove(a.id)}
                className="rounded-md p-1.5 text-white/30 transition-colors hover:bg-red-500/15 hover:text-red-400"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Statuses ---------------- */
function StatusesTab({
  projectId,
  statuses,
  onRefresh,
  addToast,
}: {
  projectId: string;
  statuses: SheetStatus[];
  onRefresh: () => void;
  addToast: AddToast;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    const color = STATUS_PALETTE[statuses.length % STATUS_PALETTE.length];
    const { error } = await supabase.from("sheet_statuses").insert({
      project_id: projectId,
      name: n,
      color,
      position: statuses.length,
    });
    if (error) addToast("Durum eklenemedi.", "error");
    else {
      setName("");
      onRefresh();
    }
    setBusy(false);
  };

  const updateName = async (id: string, newName: string) => {
    await supabase.from("sheet_statuses").update({ name: newName }).eq("id", id);
    onRefresh();
  };
  const updateColor = async (id: string, color: string) => {
    await supabase.from("sheet_statuses").update({ color }).eq("id", id);
    onRefresh();
  };
  const remove = async (id: string) => {
    await supabase.from("sheet_statuses").delete().eq("id", id);
    addToast("Durum silindi.", "delete");
    onRefresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <AddRow value={name} onChange={setName} onAdd={add} busy={busy} placeholder="Durum adı (örn. Render)" />
      {statuses.length === 0 ? (
        <Empty text="Henüz durum yok." />
      ) : (
        <div className="flex flex-col gap-1.5">
          {statuses.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-black/15 p-2 pl-3"
            >
              <input
                type="color"
                value={s.color}
                onChange={(e) => updateColor(s.id, e.target.value)}
                className="h-6 w-6 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0"
                title="Renk"
              />
              <input
                defaultValue={s.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && updateName(s.id, e.target.value.trim())}
                className="focus-ring flex-1 rounded-lg bg-transparent px-2 py-1 text-[13px] text-white"
              />
              <button
                type="button"
                onClick={() => remove(s.id)}
                className="rounded-md p-1.5 text-white/30 transition-colors hover:bg-red-500/15 hover:text-red-400"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Pipeline Columns ---------------- */
function ColumnsTab({
  projectId,
  columns,
  onRefresh,
  addToast,
}: {
  projectId: string;
  columns: SheetPipelineColumn[];
  onRefresh: () => void;
  addToast: AddToast;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    const { error } = await supabase.from("sheet_pipeline_columns").insert({
      project_id: projectId,
      name: n,
      position: columns.length,
    });
    if (error) addToast("Kolon eklenemedi.", "error");
    else {
      setName("");
      onRefresh();
    }
    setBusy(false);
  };

  const updateName = async (id: string, newName: string) => {
    await supabase.from("sheet_pipeline_columns").update({ name: newName }).eq("id", id);
    onRefresh();
  };
  const remove = async (id: string) => {
    await supabase.from("sheet_pipeline_columns").delete().eq("id", id);
    addToast("Kolon silindi.", "delete");
    onRefresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-relaxed text-white/45">
        Pipeline aşamaları için onay kutucuğu kolonları (örn. LYT, PB, R, CMP, CLR).
      </p>
      <AddRow value={name} onChange={setName} onAdd={add} busy={busy} placeholder="Kolon adı (örn. CMP)" />
      {columns.length === 0 ? (
        <Empty text="Henüz kolon yok." />
      ) : (
        <div className="flex flex-col gap-1.5">
          {columns.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-black/15 p-2 pl-3"
            >
              <GripVertical size={14} className="shrink-0 text-white/20" />
              <input
                defaultValue={c.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && updateName(c.id, e.target.value.trim())}
                className="focus-ring flex-1 rounded-lg bg-transparent px-2 py-1 text-[13px] text-white"
              />
              <button
                type="button"
                onClick={() => remove(c.id)}
                className="rounded-md p-1.5 text-white/30 transition-colors hover:bg-red-500/15 hover:text-red-400"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- General ---------------- */
function GeneralTab({
  project,
  onProjectChange,
  addToast,
}: {
  project: SheetProject;
  onProjectChange: (patch: Partial<SheetProject>) => void;
  addToast: AddToast;
}) {
  const [name, setName] = useState(project.name);
  const [pattern, setPattern] = useState(project.naming_pattern);

  const saveName = async () => {
    const n = name.trim();
    if (!n || n === project.name) return;
    await supabase.from("sheet_projects").update({ name: n }).eq("id", project.id);
    onProjectChange({ name: n });
    addToast("Proje adı güncellendi.", "success");
  };

  const savePattern = async () => {
    if (pattern === project.naming_pattern) return;
    await supabase.from("sheet_projects").update({ naming_pattern: pattern }).eq("id", project.id);
    onProjectChange({ naming_pattern: pattern });
    addToast("İsimlendirme şablonu güncellendi.", "success");
  };

  return (
    <div className="flex flex-col gap-5">
      <Field label="Proje Adı">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          className="focus-ring w-full rounded-xl border border-[var(--border)] bg-black/20 px-3 py-2.5 text-[13px] text-white"
        />
      </Field>

      <Field label="İsimlendirme Şablonu (isteğe bağlı)">
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onBlur={savePattern}
          placeholder="örn. {episode}_{shot}_{start}_{end}_{version}"
          className="focus-ring w-full rounded-xl border border-[var(--border)] bg-black/20 px-3 py-2.5 font-mono text-[12.5px] text-[var(--accent-light)] placeholder:text-white/25"
        />
        <p className="mt-2 text-[11.5px] leading-relaxed text-white/40">
          Boş bırakabilirsiniz. Projenize göre kendi şablonunuzu yazın. Kullanılabilir alanlar:{" "}
          <code className="text-white/60">{"{episode}"}</code>{" "}
          <code className="text-white/60">{"{shot}"}</code>{" "}
          <code className="text-white/60">{"{start}"}</code>{" "}
          <code className="text-white/60">{"{end}"}</code>{" "}
          <code className="text-white/60">{"{version}"}</code>
        </p>
      </Field>
    </div>
  );
}

/* ---------------- shared bits ---------------- */
function AddRow({
  value,
  onChange,
  onAdd,
  busy,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onAdd: () => void;
  busy: boolean;
  placeholder: string;
}) {
  return (
    <div className="flex gap-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onAdd()}
        placeholder={placeholder}
        className="focus-ring flex-1 rounded-xl border border-[var(--border)] bg-black/20 px-3 py-2 text-[13px] text-white placeholder:text-white/30"
      />
      <button
        type="button"
        onClick={onAdd}
        disabled={!value.trim() || busy}
        className="flex items-center gap-1.5 rounded-xl bg-[var(--accent)]/90 px-3.5 py-2 text-[12.5px] font-medium text-[#2a3329] transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        Ekle
      </button>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] py-8 text-center text-[12.5px] text-white/30">
      {text}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[12px] font-medium text-white/55">{label}</label>
      {children}
    </div>
  );
}
