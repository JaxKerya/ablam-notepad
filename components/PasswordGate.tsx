"use client";

import { useState } from "react";
import { Lock, Eye, EyeOff } from "lucide-react";
import { verifyPassword } from "@/lib/crypto";
import { supabase } from "@/lib/supabase-browser";
import type { JSONContent } from "@tiptap/react";

interface PasswordGateProps {
    noteId: string;
    onUnlock: (content: JSONContent) => void;
}

export default function PasswordGate({ noteId, onUnlock }: PasswordGateProps) {
    const [password, setPassword] = useState("");
    const [showPw, setShowPw] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [attempts, setAttempts] = useState(0);
    const [cooldown, setCooldown] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!password.trim() || cooldown) return;

        setLoading(true);
        setError("");

        try {
            // Fetch hash from DB
            const { data, error: dbError } = await supabase
                .from("notes")
                .select("password_hash, content")
                .eq("id", noteId)
                .single();

            if (dbError || !data) {
                setError("Not bulunamadı.");
                setLoading(false);
                return;
            }

            const isValid = await verifyPassword(password, data.password_hash);
            if (isValid) {
                onUnlock(data.content);
            } else {
                const newAttempts = attempts + 1;
                setAttempts(newAttempts);

                if (newAttempts >= 3) {
                    setCooldown(true);
                    setError("Çok fazla hatalı deneme. 10 saniye bekleyin.");
                    setTimeout(() => {
                        setCooldown(false);
                        setAttempts(0);
                        setError("");
                    }, 10000);
                } else {
                    setError("Yanlış şifre. Tekrar deneyin.");
                }
            }
        } catch {
            setError("Bir hata oluştu.");
        }

        setLoading(false);
        setPassword("");
    };

    return (
        <div className="animate-fade-in-scale mx-auto w-full max-w-sm">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-8 shadow-2xl shadow-black/30">
                <div className="mb-6 flex flex-col items-center gap-3">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)]/10">
                        <Lock size={24} className="text-[var(--accent)]" />
                    </div>
                    <h2 className="text-base font-semibold text-gray-200">
                        Şifreli Not
                    </h2>
                    <p className="text-center text-[13px] leading-relaxed text-gray-500">
                        Bu notu görüntülemek için şifre girmeniz gerekiyor.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                    <div className="relative">
                        <Lock
                            size={15}
                            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600"
                        />
                        <input
                            type={showPw ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Şifre girin"
                            autoFocus
                            disabled={cooldown}
                            className="focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-3 pl-10 pr-10 text-sm text-gray-200 placeholder-gray-600 transition-all disabled:opacity-50"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPw(!showPw)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400"
                        >
                            {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                    </div>

                    {error && (
                        <p className="text-xs text-red-400 text-center">{error}</p>
                    )}

                    <button
                        type="submit"
                        disabled={!password.trim() || loading || cooldown}
                        className="w-full rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-medium text-white shadow-lg shadow-[var(--accent)]/10 transition-all hover:bg-[#9AAD69] hover:shadow-[var(--accent)]/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
                    >
                        {loading ? "Doğrulanıyor..." : cooldown ? "Bekleyin..." : "Kilidi Aç"}
                    </button>
                </form>
            </div>
        </div>
    );
}
