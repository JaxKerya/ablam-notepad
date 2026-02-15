import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#12140e] px-4">
      <h1 className="mb-2 text-2xl font-semibold text-gray-200">
        Not bulunamadı
      </h1>
      <p className="mb-6 text-gray-500">
        Aradığınız not mevcut değil veya kaldırılmış olabilir.
      </p>
      <Link
        href="/"
        className="rounded-lg bg-[#8B9D5A]/15 px-5 py-2.5 text-sm font-medium text-[#b5c87a] transition-colors hover:bg-[#8B9D5A]/25"
      >
        Yeni not oluştur
      </Link>
    </main>
  );
}
