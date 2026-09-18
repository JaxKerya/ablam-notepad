import type { Metadata } from "next";

// /kariyer bir istemci bileşeni ("use client") olduğu için metadata dışa
// aktaramıyor; sekme başlığını bu layout veriyor (ders ve sheets ile aynı).
export const metadata: Metadata = {
  title: { absolute: "Ablam Kariyer", template: "%s · Ablam Kariyer" },
  description: "Sana uyan iş ilanlarını bulur, puanlar, haber verir.",
};

export default function KariyerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
