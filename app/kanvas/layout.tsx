import type { Metadata } from "next";
import "./excalifont.css";

// /kanvas bir istemci bileşeni; başlığı bu layout veriyor (bkz. app/sheets/layout.tsx).
export const metadata: Metadata = {
  title: { absolute: "Ablam Kanvas", template: "%s · Ablam Kanvas" },
  description: "Sonsuz, ortak çizim tahtası.",
};

export default function KanvasLayout({ children }: { children: React.ReactNode }) {
  return children;
}
