import type { Metadata } from "next";

// /youtube bir istemci bileşeni ("use client") olduğu için metadata dışa
// aktaramıyor; sekme başlığını bu layout veriyor (ders, sheets, kariyer ile aynı).
export const metadata: Metadata = {
  title: { absolute: "Ablam YouTube", template: "%s · Ablam YouTube" },
  description: "Konuyu yaz, uyku anlatımı bölümü hazırlansın; onayla, YouTube'a gitsin.",
};

export default function YoutubeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
