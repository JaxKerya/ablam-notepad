import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import KanvasTahta from "@/components/kanvas/KanvasTahta";
import type { Kanvas } from "@/lib/kanvas";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ kanvasId: string }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function kanvasiOku(id: string) {
  if (!UUID.test(id)) return null;
  const { data } = await createServerSupabaseClient()
    .from("kanvaslar")
    // Önizleme resmi yalnızca listede kullanılıyor; tahta sayfasına gömülmesin
    .select("id, ad, desen, ton, olusturan, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  return data ? ({ ...data, onizleme: null } as Kanvas) : null;
}

export async function generateMetadata({ params }: PageProps) {
  const { kanvasId } = await params;
  const k = await kanvasiOku(kanvasId);
  return { title: k?.ad ?? "Kanvas" };
}

export default async function KanvasSayfasi({ params }: PageProps) {
  const { kanvasId } = await params;
  const kanvas = await kanvasiOku(kanvasId);
  if (!kanvas) notFound();
  return <KanvasTahta kanvas={kanvas} />;
}
