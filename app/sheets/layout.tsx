import type { Metadata } from "next";

// /sheets bir istemci bileşeni; başlığı bu layout veriyor.
export const metadata: Metadata = {
  // Nesne biçimi şart: düz metin başlık verilirse alt sayfalar
  // (aiview, ders oturumu, proje) hiçbir şablon almıyor.
  // absolute: bölümün KENDİ kökü üst şablonu almasın ("Ablam Ders · Ablam"
  // diye tekrar ediyordu). template ise alt sayfalar için geçerli.
  title: { absolute: "Ablam Sheets", template: "%s · Ablam Sheets" },
  description: "Animasyon shot'larını takip et, yönet, senkronize et.",
};

export default function SheetsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
