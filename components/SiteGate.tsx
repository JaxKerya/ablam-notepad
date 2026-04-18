"use client";

import { useState } from "react";
import { KeyRound, Lightbulb } from "lucide-react";

const MAGIC_TEXT = "helikopter";
const HINT = "Ablamın birden fazla düşman ile savaşırken dönüştüğü cisim.";

/** Normalize Turkish characters & lowercase for comparison */
function turkishNormalize(str: string): string {
  return str
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .replace(/Ğ/g, "ğ")
    .replace(/Ü/g, "ü")
    .replace(/Ş/g, "ş")
    .replace(/Ö/g, "ö")
    .replace(/Ç/g, "ç")
    .toLocaleLowerCase("tr")
    .trim();
}

interface SiteGateProps {
  onUnlock: () => void;
}

export default function SiteGate({ onUnlock }: SiteGateProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [cooldown, setCooldown] = useState(false);
  const [shaking, setShaking] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || cooldown) return;

    const normalized = turkishNormalize(input);

    if (normalized === MAGIC_TEXT) {
      localStorage.setItem("ablam-site-auth", "true");
      onUnlock();
    } else {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);

      // Shake animation
      setShaking(true);
      setTimeout(() => setShaking(false), 500);

      if (newAttempts >= 3) {
        setCooldown(true);
        setError("Çok fazla hatalı deneme. 10 saniye bekleyin.");
        setTimeout(() => {
          setCooldown(false);
          setAttempts(0);
          setError("");
        }, 10000);
      } else {
        setError("Yanlış cevap. Tekrar deneyin.");
      }
      setInput("");
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--background)]">
      {/* Background depth */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: [
            "radial-gradient(ellipse 80% 60% at 50% 35%, rgba(212,228,165,0.08) 0%, transparent 60%)",
            "radial-gradient(circle at 15% 85%, rgba(212,228,165,0.04) 0%, transparent 40%)",
            "radial-gradient(circle at 85% 15%, rgba(255,255,255,0.03) 0%, transparent 35%)",
            "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.15) 100%)",
          ].join(", "),
        }}
      />

      {/* Floating bokeh particles */}
      <div
        className="animate-float pointer-events-none absolute rounded-full opacity-20"
        style={{
          width: 180,
          height: 180,
          top: "15%",
          left: "10%",
          background:
            "radial-gradient(circle, rgba(212,228,165,0.3), transparent 70%)",
        }}
      />
      <div
        className="animate-float-reverse pointer-events-none absolute rounded-full opacity-15"
        style={{
          width: 120,
          height: 120,
          bottom: "20%",
          right: "15%",
          background:
            "radial-gradient(circle, rgba(212,228,165,0.25), transparent 70%)",
        }}
      />

      {/* Main card */}
      <div className="animate-fade-in-scale relative z-10 mx-4 w-full max-w-sm">
        <div className={`rounded-2xl border border-[var(--border)] bg-[var(--surface-popup)] p-8 shadow-2xl shadow-black/30 ${shaking ? "animate-shake" : ""}`}>
          {/* Icon */}
          <div className="mb-6 flex flex-col items-center gap-3">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--accent)]/10">
              <KeyRound size={28} className="text-[var(--accent)]" />
            </div>
            <h1 className="text-lg font-semibold text-white/95">
              Çok Şahane Kelime
            </h1>
            <p className="text-center text-[13px] leading-relaxed text-white/50">
              Bu siteye girmek için çok şahane kelimeyi bilmen gerekiyor.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative">
              <KeyRound
                size={15}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30"
              />
              <input
                type="text"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setError("");
                }}
                placeholder="Çok şahane kelimeyi girin"
                autoFocus
                disabled={cooldown}
                className="focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-3 pl-10 pr-4 text-sm text-white/95 placeholder-white/30 transition-all disabled:opacity-50"
              />
            </div>

            {error && (
              <p className="text-center text-xs text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={!input.trim() || cooldown}
              className="w-full rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-medium text-[var(--background)] shadow-lg shadow-[var(--accent)]/10 transition-all hover:bg-[var(--accent-light)] hover:shadow-[var(--accent)]/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
            >
              {cooldown ? "Bekleyin..." : "Giriş Yap"}
            </button>

            <div className="flex flex-col items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowHint(!showHint)}
                className="flex items-center gap-1.5 text-[12px] text-white/30 transition-colors hover:text-[var(--accent)]/70"
              >
                <Lightbulb size={13} />
                {showHint ? "İpucunu gizle" : "İpucu göster"}
              </button>
              {showHint && (
                <p className="animate-fade-in text-center text-[12px] leading-relaxed text-[var(--accent-light)]/70">
                  {HINT}
                </p>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
