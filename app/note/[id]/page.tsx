import { createServerSupabaseClient } from "@/lib/supabase-server";
import NoteEditor from "@/components/NoteEditor";

export const dynamic = "force-dynamic";

interface NotePageProps {
  params: Promise<{ id: string }>;
}

const DEFAULT_CONTENT = { type: "doc", content: [{ type: "paragraph" }] };

export default async function NotePage({ params }: NotePageProps) {
  const { id } = await params;
  const noteId = decodeURIComponent(id);
  const supabase = createServerSupabaseClient();

  // Try to fetch the existing note
  const { data: existing, error: fetchError } = await supabase
    .from("notes")
    .select("id, content")
    .eq("id", noteId)
    .single();

  // Unexpected database error (not "row not found")
  if (fetchError && fetchError.code !== "PGRST116") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] text-gray-500">
        <p>Veritabanı hatası. Lütfen daha sonra tekrar deneyin.</p>
      </main>
    );
  }

  // If it doesn't exist, create it
  if (!existing) {
    const { error } = await supabase
      .from("notes")
      .insert({ id: noteId, content: DEFAULT_CONTENT });

    if (error) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-[var(--background)] text-gray-500">
          <p>Not oluşturulamadı. Lütfen Supabase yapılandırmanızı kontrol edin.</p>
        </main>
      );
    }
  }

  const content = existing?.content ?? DEFAULT_CONTENT;

  return (
    <main className="relative flex min-h-screen items-start justify-center bg-[var(--background)] px-4 pt-12 pb-12 sm:pt-20">
      {/* Background glow */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 50% 30%, rgba(139,157,90,0.04) 0%, rgba(139,157,90,0.012) 50%, transparent 75%)",
        }}
      />
      <NoteEditor noteId={noteId} initialContent={content} />
    </main>
  );
}
