import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import DersView from "@/components/ders/DersView";
import DenemeView from "@/components/ders/DenemeView";
import type { DersAnswer, DersQuestion, DersSession } from "@/lib/ders";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

/** Sekmede dersin kendi adı görünsün — birden çok ders açıkken ayırt edilebilsin */
export async function generateMetadata({ params }: PageProps) {
  const { sessionId } = await params;
  const { data } = await createServerSupabaseClient()
    .from("ders_sessions")
    .select("title")
    .eq("id", sessionId)
    .maybeSingle();
  return { title: data?.title ?? "Ders" };
}

export default async function DersOturumSayfasi({ params }: PageProps) {
  const { sessionId } = await params;
  const supabase = createServerSupabaseClient();

  const { data: oturum } = await supabase
    .from("ders_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (!oturum) notFound();

  const [sorularRes, cevaplarRes] = await Promise.all([
    supabase
      .from("ders_questions")
      .select("*")
      // İşaretli soru = ablamın itiraz ettiği ve düzeltilemeyen soru. Bir daha
      // karşısına çıkmaması gerekiyor; oturumu yeniden açtığında da çıkmasın.
      .eq("flagged", false)
      // Açık uçlu üretimi kapatıldı (2026-09-16). Eski derslerin açık uçluları
      // silinmedi ama gösterilmiyor; cevapları da aşağıda ayıklanıyor ki
      // "22 cevaplandı / 20 soru" gibi bir sayım çıkmasın.
      .eq("kind", "coktan")
      .eq("session_id", sessionId)
      .order("position", { ascending: true }),
    supabase.from("ders_answers").select("*").eq("session_id", sessionId),
  ]);

  const sorular = (sorularRes.data ?? []) as DersQuestion[];
  const soruKimlikleri = new Set(sorular.map((s) => s.id));
  const ilkCevaplar = ((cevaplarRes.data ?? []) as DersAnswer[]).filter((c) =>
    soruKimlikleri.has(c.question_id)
  );

  // Deneme sınavının akışı bambaşka: süre işliyor, geri bildirim sona saklanıyor,
  // sorular arasında gezilebiliyor. Aynı bileşene sığdırmak DersView'i üçüncü bir
  // moda daha bölerdi; ayrı ekran hem okunur hem birbirini bozmaz.
  const ortak = {
    oturum: oturum as DersSession,
    sorular,
    ilkCevaplar,
  };
  return oturum.tur === "deneme" ? <DenemeView {...ortak} /> : <DersView {...ortak} />;
}
