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
  // Bahçe logosundaki gül (public/gul.svg; app/favicon.ico ve dokunmatik simge
  // ondan üretildi). favicon.ico'yu Next dosya adından kendisi ekliyor; SVG'yi
  // destekleyen tarayıcı keskin olanı, Safari ico'yu alır.
  icons: {
    icon: [{ url: "/gul.svg", type: "image/svg+xml" }],
    apple: "/apple-touch-icon.png",
  },
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
