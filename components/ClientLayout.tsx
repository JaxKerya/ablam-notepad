"use client";

import { useState, useEffect } from "react";
import { ToastProvider } from "@/components/Toast";
import SiteGate from "@/components/SiteGate";

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [authed, setAuthed] = useState<boolean | null>(null); // null = loading

  useEffect(() => {
    setAuthed(localStorage.getItem("ablam-site-auth") === "true");
  }, []);

  // Prevent flash while checking localStorage
  if (authed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--accent)]/20 border-t-[var(--accent)]/60" />
      </div>
    );
  }

  if (!authed) {
    return <SiteGate onUnlock={() => setAuthed(true)} />;
  }

  return <ToastProvider>{children}</ToastProvider>;
}
