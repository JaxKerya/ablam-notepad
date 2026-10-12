import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ClientLayout from "@/components/ClientLayout";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

/**
 * Başlık ŞABLONLU: alt sayfalar yalnızca kendi adını veriyor, sonuna "· Ablam"
 * ekleniyor. Önceden tek bir global başlık vardı ve üç ayrı uygulamanın
 * (NotePad, Sheets, Ders) hepsi sekmede "Ablam NotePad" diye görünüyordu —
 * açık sekmeler ayırt edilemiyor, yer imi anlamsız oluyordu.
 */
export const metadata: Metadata = {
  title: {
    default: "Ablam NotePad",
    template: "%s · Ablam NotePad",
  },
  description: "Ablam için not defteri, iş takibi ve ders çalışma aracı.",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" className="dark">
      <body className={`${inter.variable} font-sans antialiased`}>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
