import Link from "next/link";
import { FileQuestion, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[var(--background)] px-4">
      <div className="animate-fade-in flex flex-col items-center">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06]">
          <FileQuestion size={24} className="text-gray-600" />
        </div>
        <h1 className="mb-2 text-lg font-semibold text-gray-300">
          Not bulunamadı
        </h1>
        <p className="mb-8 max-w-xs text-center text-[13px] leading-relaxed text-gray-600">
          Aradığınız not mevcut değil veya kaldırılmış olabilir.
        </p>
        <Link
          href="/"
          className="flex items-center gap-2 rounded-xl bg-[var(--accent)]/10 px-5 py-2.5 text-sm font-medium text-[var(--accent-light)] ring-1 ring-[var(--accent)]/10 transition-all hover:bg-[var(--accent)]/15 hover:ring-[var(--accent)]/20"
        >
          <ArrowLeft size={15} />
          Ana Sayfaya Dön
        </Link>
      </div>
    </main>
  );
}
