import type { Metadata } from "next";
import { DersKuyruguSaglayici, KuyrukRozeti } from "@/components/ders/DersKuyrugu";

// /ders bir istemci bileşeni ("use client") olduğu için metadata dışa
// aktaramıyor; başlığı bu layout veriyor.
export const metadata: Metadata = {
  // Nesne biçimi şart: düz metin başlık verilirse alt sayfalar
  // (aiview, ders oturumu, proje) hiçbir şablon almıyor.
  // absolute: bölümün KENDİ kökü üst şablonu almasın ("Ablam Ders · Ablam"
  // diye tekrar ediyordu). template ise alt sayfalar için geçerli.
  title: { absolute: "Ablam Ders", template: "%s · Ablam Ders" },
  description: "İzlenen ders videosundan soru üret, kendini sına.",
};

/**
 * Üretim kuyruğu layout'ta duruyor, sayfada değil: /ders'ten bir derse
 * geçildiğinde sayfa bileşeni sökülüyor ama layout ayakta kalıyor. Böylece
 * ablam ilk dersi çözmeye başlarken diğerleri hazırlanmaya devam ediyor.
 */
export default function DersLayout({ children }: { children: React.ReactNode }) {
  return (
    <DersKuyruguSaglayici>
      {children}
      <KuyrukRozeti />
    </DersKuyruguSaglayici>
  );
}
