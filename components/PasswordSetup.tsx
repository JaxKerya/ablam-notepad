"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Lock, Unlock, Eye, EyeOff, KeyRound } from "lucide-react";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { supabase } from "@/lib/supabase-browser";

interface PasswordSetupProps {
    noteId: string;
    hasPassword: boolean;
    onPasswordChange: (hasPassword: boolean) => void;
}

type ModalMode = "menu" | "set" | "change-verify" | "change-new" | "remove";

export default function PasswordSetup({
    noteId,
    hasPassword,
    onPasswordChange,
}: PasswordSetupProps) {
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<ModalMode>("menu");
    const [currentPassword, setCurrentPassword] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [hint, setHint] = useState("");
    const [showPw, setShowPw] = useState(false);
    const [showConfirmPw, setShowConfirmPw] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const resetState = () => {
        setOpen(false);
        setMode("menu");
        setCurrentPassword("");
        setPassword("");
        setConfirm("");
        setHint("");
        setShowPw(false);
        setError("");
        setLoading(false);
    };

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
            .update({ password_hash: hash, password_hint: hint.trim() || null })
            .eq("id", noteId);

        setLoading(false);
        if (dbError) {
            setError("Kaydetme hatası: " + dbError.message);
            return;
        }

        onPasswordChange(true);
        resetState();
    };

    const handleVerifyCurrentPassword = async () => {
        setError("");
        if (!currentPassword.trim()) {
            setError("Mevcut şifreyi girin.");
            return;
        }

        setLoading(true);
        const { data, error: dbError } = await supabase
            .from("notes")
            .select("password_hash")
            .eq("id", noteId)
            .single();

        if (dbError || !data) {
            setLoading(false);
            setError("Not bulunamadı.");
            return;
        }

        const isValid = await verifyPassword(currentPassword, data.password_hash);
        setLoading(false);

        if (!isValid) {
            setError("Mevcut şifre yanlış.");
            return;
        }

        setCurrentPassword("");
        setError("");
        setMode("change-new");
    };

    const handleRemovePassword = async () => {
        setLoading(true);
        const { error: dbError } = await supabase
            .from("notes")
            .update({ password_hash: null, password_hint: null })
            .eq("id", noteId);

        setLoading(false);
        if (dbError) {
            setError("Kaldırma hatası: " + dbError.message);
            return;
        }

        onPasswordChange(false);
        resetState();
    };

    const openModal = () => {
        setOpen(true);
        setMode(hasPassword ? "menu" : "set");
    };

    const renderContent = () => {
        // Set password (no existing password)
        if (mode === "set" || mode === "change-new") {
            return (
                <>
                    <div className="mb-4 flex items-center gap-2.5">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10">
                            {mode === "change-new" ? (
                                <KeyRound size={16} className="text-[var(--accent)]" />
                            ) : (
                                <Lock size={16} className="text-[var(--accent)]" />
                            )}
                        </div>
                        <h3 className="text-sm font-semibold text-white/95">
                            {mode === "change-new" ? "Yeni Şifre Belirle" : "Şifre Belirle"}
                        </h3>
                    </div>
                    <div className="space-y-3">
                        <div className="relative">
                            <input
                                type={showPw ? "text" : "password"}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Şifre"
                                className="focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-3 pr-10 text-sm text-white/95 placeholder-white/30 transition-all"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPw(!showPw)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70"
                            >
                                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                        </div>
                        <div className="relative">
                            <input
                                type={showConfirmPw ? "text" : "password"}
                                value={confirm}
                                onChange={(e) => setConfirm(e.target.value)}
                                placeholder="Şifre Tekrar"
                                className="focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 px-3 pr-10 text-sm text-white/95 placeholder-white/30 transition-all"
                            />
                            <button
                                type="button"
                                onClick={() => setShowConfirmPw(!showConfirmPw)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70"
                            >
                                {showConfirmPw ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                        </div>
                        <input
                            type="text"
                            value={hint}
                            onChange={(e) => setHint(e.target.value)}
                            placeholder="İpucu (isteğe bağlı)"
                            maxLength={100}
                            className="focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 px-3 text-sm text-white/95 placeholder-white/30 transition-all"
                        />
                    </div>
                    {error && (
                        <p className="mt-2 text-xs text-red-400">{error}</p>
                    )}
                    <div className="mt-4 flex gap-2.5">
                        <button
                            type="button"
                            onClick={resetState}
                            className="flex-1 rounded-xl border border-[var(--border)] bg-white/[0.06] px-4 py-2.5 text-xs font-medium text-white/70 transition-all hover:bg-white/[0.06] hover:text-white/85"
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
            );
        }

        // Verify current password before changing
        if (mode === "change-verify") {
            return (
                <>
                    <div className="mb-4 flex items-center gap-2.5">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10">
                            <KeyRound size={16} className="text-[var(--accent)]" />
                        </div>
                        <h3 className="text-sm font-semibold text-white/95">
                            Şifreyi Değiştir
                        </h3>
                    </div>
                    <p className="mb-3 text-[13px] leading-relaxed text-white/50">
                        Devam etmek için mevcut şifrenizi girin.
                    </p>
                    <div className="relative">
                        <input
                            type={showPw ? "text" : "password"}
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            placeholder="Mevcut Şifre"
                            autoFocus
                            className="focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-3 pr-10 text-sm text-white/95 placeholder-white/30 transition-all"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPw(!showPw)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70"
                        >
                            {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                    </div>
                    {error && (
                        <p className="mt-2 text-xs text-red-400">{error}</p>
                    )}
                    <div className="mt-4 flex gap-2.5">
                        <button
                            type="button"
                            onClick={resetState}
                            className="flex-1 rounded-xl border border-[var(--border)] bg-white/[0.06] px-4 py-2.5 text-xs font-medium text-white/70 transition-all hover:bg-white/[0.06] hover:text-white/85"
                        >
                            Vazgeç
                        </button>
                        <button
                            type="button"
                            onClick={handleVerifyCurrentPassword}
                            disabled={loading}
                            className="flex-1 rounded-xl bg-[var(--accent)]/15 px-4 py-2.5 text-xs font-medium text-[var(--accent-light)] transition-all hover:bg-[var(--accent)]/25 disabled:opacity-50"
                        >
                            {loading ? "Doğrulanıyor..." : "Devam Et"}
                        </button>
                    </div>
                </>
            );
        }

        // Menu: Change or Remove
        return (
            <>
                <div className="mb-4 flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10">
                        <Lock size={16} className="text-[var(--accent)]" />
                    </div>
                    <h3 className="text-sm font-semibold text-white/95">
                        Şifre Yönetimi
                    </h3>
                </div>
                <p className="mb-4 text-[13px] leading-relaxed text-white/50">
                    Bu not şifre ile korunuyor.
                </p>
                {error && (
                    <p className="mb-3 text-xs text-red-400">{error}</p>
                )}
                <div className="flex flex-col gap-2.5">
                    <button
                        type="button"
                        onClick={() => { setError(""); setMode("change-verify"); }}
                        className="w-full rounded-xl bg-[var(--accent)]/15 px-4 py-2.5 text-xs font-medium text-[var(--accent-light)] transition-all hover:bg-[var(--accent)]/25"
                    >
                        Şifreyi Değiştir
                    </button>
                    <button
                        type="button"
                        onClick={handleRemovePassword}
                        disabled={loading}
                        className="w-full rounded-xl bg-red-500/15 px-4 py-2.5 text-xs font-medium text-red-400 transition-all hover:bg-red-500/25 disabled:opacity-50"
                    >
                        {loading ? "Kaldırılıyor..." : "Şifreyi Kaldır"}
                    </button>
                    <button
                        type="button"
                        onClick={resetState}
                        className="w-full rounded-xl border border-[var(--border)] bg-white/[0.06] px-4 py-2.5 text-xs font-medium text-white/70 transition-all hover:bg-white/[0.06] hover:text-white/85"
                    >
                        Vazgeç
                    </button>
                </div>
            </>
        );
    };

    return (
        <>
            <button
                type="button"
                onClick={openModal}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-200 ${hasPassword
                    ? "border-[var(--accent)]/20 bg-[var(--accent)]/10 text-[var(--accent-light)]"
                    : "border-transparent text-white/50 hover:border-[var(--border)] hover:bg-white/[0.06] hover:text-white/85"
                    }`}
            >
                {hasPassword ? <Lock size={13} /> : <Unlock size={13} />}
                <span className="hidden sm:inline">{hasPassword ? "Şifreli" : "Şifre Ekle"}</span>
            </button>

            {open &&
                typeof document !== "undefined" &&
                createPortal(
                    <div className="fixed inset-0 z-[60]">
                        {/* Backdrop dim + blur */}
                        <div
                            className="absolute inset-0 bg-black/40 animate-backdrop-blur"
                            onClick={resetState}
                        />
                        {/* Card — sibling so backdrop-blur works */}
                        <div className="pointer-events-none relative flex h-full items-center justify-center">
                            <div
                                className="pointer-events-auto animate-fade-in-scale mx-4 w-full max-w-xs rounded-2xl border border-white/[0.12] bg-black/20 backdrop-blur-2xl p-6 shadow-2xl shadow-black/40"
                                onClick={(e) => e.stopPropagation()}
                            >
                                {renderContent()}
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
        </>
    );
}
