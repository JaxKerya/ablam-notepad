import type { Metadata } from "next";
import MaliyetEkrani from "./MaliyetEkrani";

// Gizli sayfa: hiçbir yerden bağlantı verilmez, yalnızca adresle açılır. Arama motorlarına da kapalı.
export const metadata: Metadata = {
  title: "Maliyet",
  robots: { index: false, follow: false },
};

export default function MaliyetSayfasi() {
  return <MaliyetEkrani />;
}
