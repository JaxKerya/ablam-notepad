import type { Metadata } from "next";

// /kariyer/tercih is a client component ("use client") and cannot export
// metadata; this layout gives the tab its title. The parent layout's template
// turns it into "Tercih Rehberi · Ablam Kariyer".
export const metadata: Metadata = {
  title: "Tercih Rehberi",
  description: "ÖSYM'nin tercih tablolarından sana açık kadroları gösterir.",
};

export default function TercihLayout({ children }: { children: React.ReactNode }) {
  return children;
}
