"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Lock, Unlock, Eye, EyeOff } from "lucide-react";
import { hashPassword } from "@/lib/crypto";
import { supabase } from "@/lib/supabase-browser";

interface PasswordSetupProps {
    noteId: string;
    hasPassword: boolean;
    onPasswordChange: (hasPassword: boolean) => void;
}

export default function PasswordSetup({
    noteId,
    hasPassword,
    onPasswordChange,
}: PasswordSetupProps) {
    const [open, setOpen] = useState(false);
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [showPw, setShowPw] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSetPassword = async () => {
        setError("");
        if (password.length < 3) {
            setError("Şifre en az 3 karakter olmalıdır.");
            return;
        }
        if (password !== confirm) {
            setError("Şifreler eşleşmiyor.");
            return;
        }

        setLoading(true);
        const hash = await hashPassword(password);
        const { error: dbError } = await supabase
            .from("notes")
            .update({ password_hash: hash })
            .eq("id", noteId);

        setLoading(false);
        if (dbError) {
            setError("Kaydetme hatası: " + dbError.message);
            return;
        }

        onPasswordChange(true);
        setPassword("");
        setConfirm("");
        setOpen(false);
    };

    const handleRemovePassword = async () => {
        setLoading(true);
        const { error: dbError } = await supabase
            .from("notes")
            .update({ password_hash: null })
            .eq("id", noteId);

        setLoading(false);
        if (dbError) {
            setError("Kaldırma hatası: " + dbError.message);
            return;
        }

        onPasswordChange(false);
        setOpen(false);
    };

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-200 ${hasPassword
                    ? "border-[var(--accent)]/20 bg-[var(--accent)]/10 text-[var(--accent-light)]"
                    : "border-transparent text-gray-500 hover:border-[var(--border)] hover:bg-white/[0.03] hover:text-gray-300"
                    }`}
            >
                {hasPassword ? <Lock size={13} /> : <Unlock size={13} />}
                <span>{hasPassword ? "Şifreli" : "Şifre Ekle"}</span>
            </button>

            {open &&
                typeof document !== "undefined" &&
                createPortal(
                    <div
                        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
                        onClick={() => {
                            setOpen(false);
                            setError("");
                            setPassword("");
                            setConfirm("");
                        }}
                    >
                        <div
                            className="animate-fade-in-scale mx-4 w-full max-w-xs rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-6 shadow-2xl shadow-black/40"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="mb-4 flex items-center gap-2.5">
                                <div
                                    className={`flex h-9 w-9 items-center justify-center rounded-xl ${hasPassword
                                        ? "bg-[var(--accent)]/10"
                                        : "bg-[var(--accent)]/10"
                                        }`}
                                >
                                    <Lock size={16} className="text-[var(--accent)]" />
                                </div>
                                <h3 className="text-sm font-semibold text-gray-200">
                                    {hasPassword ? "Şifre Yönetimi" : "Şifre Belirle"}
                                </h3>
                            </div>

                            {!hasPassword ? (
                                <>
                                    <div className="space-y-3">
                                        <div className="relative">
                                            <input
                                                type={showPw ? "text" : "password"}
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                placeholder="Şifre"
                                                className="focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-3 pr-10 text-sm text-gray-200 placeholder-gray-600 transition-all"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPw(!showPw)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400"
                                            >
                                                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                                            </button>
                                        </div>
                                        <input
                                            type={showPw ? "text" : "password"}
                                            value={confirm}
                                            onChange={(e) => setConfirm(e.target.value)}
                                            placeholder="Şifre Tekrar"
                                            className="focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 px-3 text-sm text-gray-200 placeholder-gray-600 transition-all"
                                        />
                                    </div>
                                    {error && (
                                        <p className="mt-2 text-xs text-red-400">{error}</p>
                                    )}
                                    <div className="mt-4 flex gap-2.5">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setOpen(false);
                                                setError("");
                                                setPassword("");
                                                setConfirm("");
                                            }}
                                            className="flex-1 rounded-xl border border-[var(--border)] bg-white/[0.03] px-4 py-2.5 text-xs font-medium text-gray-400 transition-all hover:bg-white/[0.06] hover:text-gray-300"
                                        >
                                            Vazgeç
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleSetPassword}
                                            disabled={loading}
                                            className="flex-1 rounded-xl bg-[var(--accent)]/15 px-4 py-2.5 text-xs font-medium text-[var(--accent-light)] transition-all hover:bg-[var(--accent)]/25 disabled:opacity-50"
                                        >
                                            {loading ? "Kaydediliyor..." : "Şifrele"}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <p className="mb-4 text-[13px] leading-relaxed text-gray-500">
                                        Bu not şifre ile korunuyor. Şifreyi kaldırmak ister misiniz?
                                    </p>
                                    {error && (
                                        <p className="mb-3 text-xs text-red-400">{error}</p>
                                    )}
                                    <div className="flex gap-2.5">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setOpen(false);
                                                setError("");
                                            }}
                                            className="flex-1 rounded-xl border border-[var(--border)] bg-white/[0.03] px-4 py-2.5 text-xs font-medium text-gray-400 transition-all hover:bg-white/[0.06] hover:text-gray-300"
                                        >
                                            Vazgeç
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleRemovePassword}
                                            disabled={loading}
                                            className="flex-1 rounded-xl bg-red-500/15 px-4 py-2.5 text-xs font-medium text-red-400 transition-all hover:bg-red-500/25 disabled:opacity-50"
                                        >
                                            {loading ? "Kaldırılıyor..." : "Şifreyi Kaldır"}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>,
                    document.body
                )}
        </>
    );
}
