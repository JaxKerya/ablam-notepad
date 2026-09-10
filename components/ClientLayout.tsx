"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ToastProvider } from "@/components/Toast";
import SiteGate, { MAGIC_TEXT } from "@/components/SiteGate";

const KAPI_ANAHTARI = "ablam-site-auth";
/** Aynı sekmede localStorage değişince "storage" olayı tetiklenmez; kendi olayımız */
const KAPI_OLAYI = "ablam-kapi-degisti";

/**
 * Kapı durumu tarayıcının localStorage'ında, yani React'in dışında bir kaynakta.
 * Bunu useEffect + setState ile okumak yerine useSyncExternalStore kullanılıyor.
 *
 * Sebep: effect içinde senkron setState çağırmak basamaklı render'a yol açıyor
 * (react-hooks/set-state-in-effect bunu hata olarak işaretliyordu). Bu kanca
 * "dış kaynağı oku" işini React'in kendi mekanizmasıyla yapıyor — effect yok,
 * ekstra render yok.
 *
 * Sunucu anlık görüntüsü null: sunucuda localStorage yok, dolayısıyla ilk
 * çizimde ne kapı ne içerik gösteriliyor, yalnızca bekleme çarkı. Böylece
 * girişi olan biri bir an için kapıyı görmüyor.
 */
function kapiyaAbone(dinleyici: () => void) {
  window.addEventListener("storage", dinleyici);
  window.addEventListener(KAPI_OLAYI, dinleyici);
  return () => {
    window.removeEventListener("storage", dinleyici);
    window.removeEventListener(KAPI_OLAYI, dinleyici);
  };
}

function kapiDurumu(): boolean {
  try {
    return localStorage.getItem(KAPI_ANAHTARI) === "true";
  } catch {
    // Gizli sekme / depolama kapalı — kapı kapalı sayılır
    return false;
  }
}

/** Sunucuda ve hidrasyonun ilk anında: "henüz bilinmiyor" */
const sunucuDurumu = (): boolean | null => null;

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = useSyncExternalStore(kapiyaAbone, kapiDurumu, sunucuDurumu);

  // Kapıyı geçenlere imzalı sunucu çerezi ver — /api/ders/* uçları bunu arıyor.
  // Girişi localStorage'dan gelen eski ziyaretçiler ve süresi dolan çerezler de
  // burada tazeleniyor. Başarısız olursa site normal çalışmaya devam eder;
  // sadece Ablam Ders bölümü uyarı gösterir.
  useEffect(() => {
    if (!authed) return;
    fetch("/api/gate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kelime: MAGIC_TEXT }),
    }).catch(() => {});
  }, [authed]);

  // Prevent flash while checking localStorage
  if (authed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--accent)]/20 border-t-[var(--accent)]/60" />
      </div>
    );
  }

  if (!authed) {
    return (
      <SiteGate
        // SiteGate localStorage'a yazıyor; aynı sekmede "storage" olayı
        // tetiklenmediği için değişikliği kendi olayımızla duyuruyoruz.
        onUnlock={() => window.dispatchEvent(new Event(KAPI_OLAYI))}
      />
    );
  }

  return <ToastProvider>{children}</ToastProvider>;
}
