import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import SheetView from "@/components/sheets/SheetView";
import type {
  SheetProject,
  SheetStatus,
  SheetPipelineColumn,
  SheetAnimator,
  SheetShot,
} from "@/lib/sheets";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { projectId } = await params;
  const { data } = await createServerSupabaseClient()
    .from("sheet_projects")
    .select("name")
    .eq("id", projectId)
    .maybeSingle();
  return { title: data?.name ?? "Proje" };
}

export default async function SheetProjectPage({ params }: PageProps) {
  const { projectId } = await params;
  const supabase = createServerSupabaseClient();

  const { data: project } = await supabase
    .from("sheet_projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const [statusesRes, columnsRes, animatorsRes, shotsRes] = await Promise.all([
    supabase
      .from("sheet_statuses")
      .select("*")
      .eq("project_id", projectId)
      .order("position", { ascending: true }),
    supabase
      .from("sheet_pipeline_columns")
      .select("*")
      .eq("project_id", projectId)
      .order("position", { ascending: true }),
    supabase
      .from("sheet_animators")
      .select("*")
      .eq("project_id", projectId)
      .order("position", { ascending: true }),
    supabase
      .from("sheet_shots")
      .select("*")
      .eq("project_id", projectId)
      .order("position", { ascending: true }),
  ]);

  return (
    <SheetView
      project={project as SheetProject}
      initialStatuses={(statusesRes.data ?? []) as SheetStatus[]}
      initialColumns={(columnsRes.data ?? []) as SheetPipelineColumn[]}
      initialAnimators={(animatorsRes.data ?? []) as SheetAnimator[]}
      initialShots={(shotsRes.data ?? []) as SheetShot[]}
    />
  );
}
