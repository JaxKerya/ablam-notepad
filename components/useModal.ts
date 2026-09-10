"use client";

import { useEffect, useRef } from "react";

const ODAKLANABILIR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal ve yan panel davranışı: Esc ile kapanma, odak tuzağı, odağın geri
 * verilmesi.
 *
 * Projede bunların hiçbiri yoktu: silme onayı açıkken Tab arka plandaki
 * düğmelere gidiyor, Esc hiçbir şey yapmıyor ve kapandıktan sonra odak
 * kayboluyordu. Klavyeyle çalışan biri için bu, kutunun "kapanmıyor" gibi
 * hissedilmesi demek.
 *
 * Kullanımı:
 *   const kutuRef = useModal<HTMLDivElement>(acikMi, () => setAcik(false));
 *   <div ref={kutuRef} role="dialog" aria-modal="true"> ... </div>
 *
 * Açılışta ilk odaklanabilir öğeye odaklanılıyor — silme onaylarında bu
 * "Vazgeç" oluyor, yani Enter'a basan yanlışlıkla silmiyor.
 */
export function useModal<T extends HTMLElement>(acik: boolean, kapat: () => void) {
  const ref = useRef<T>(null);
  // Çağıran satır içi ok fonksiyonu verirse effect her render'da yeniden
  // kurulmasın diye geri çağırma ref'te tutuluyor. Yazma render sırasında
  // değil effect içinde yapılıyor — render sırasında ref'e dokunmak React'in
  // eşzamanlı modunda güvenli değil.
  const kapatRef = useRef(kapat);
  useEffect(() => {
    kapatRef.current = kapat;
  });

  useEffect(() => {
    if (!acik) return;

    const oncekiOdak = document.activeElement as HTMLElement | null;
    const kap = ref.current;

    const ogeler = () =>
      kap
        ? Array.from(kap.querySelectorAll<HTMLElement>(ODAKLANABILIR)).filter(
            (e) => e.offsetParent !== null
          )
        : [];

    ogeler()[0]?.focus();

    const tus = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        kapatRef.current();
        return;
      }
      if (e.key !== "Tab" || !kap) return;

      const liste = ogeler();
      if (!liste.length) return;
      const ilk = liste[0];
      const son = liste[liste.length - 1];

      if (e.shiftKey && document.activeElement === ilk) {
        e.preventDefault();
        son.focus();
      } else if (!e.shiftKey && document.activeElement === son) {
        e.preventDefault();
        ilk.focus();
      }
    };

    document.addEventListener("keydown", tus);
    return () => {
      document.removeEventListener("keydown", tus);
      // Odak, kutuyu açan düğmeye dönsün
      oncekiOdak?.focus?.();
    };
  }, [acik]);

  return ref;
}
