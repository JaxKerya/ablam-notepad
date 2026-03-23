"use client";

import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { X, CheckCircle2, AlertCircle, Info, Trash2 } from "lucide-react";

type ToastType = "success" | "error" | "info" | "delete";

interface Toast {
    id: number;
    message: string;
    type: ToastType;
}

interface ToastContextType {
    addToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error("useToast must be used within ToastProvider");
    return ctx;
}

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [mounted, setMounted] = useState(false);

    useEffect(() => setMounted(true), []);

    const addToast = useCallback((message: string, type: ToastType = "success") => {
        const id = nextId++;
        setToasts((prev) => [...prev, { id, message, type }]);
    }, []);

    const removeToast = useCallback((id: number) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ addToast }}>
            {children}
            {mounted &&
                createPortal(
                    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2">
                        {toasts.map((toast) => (
                            <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
                        ))}
                    </div>,
                    document.body
                )}
        </ToastContext.Provider>
    );
}

const ICONS: Record<ToastType, React.ReactNode> = {
    success: <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />,
    error: <AlertCircle size={15} className="shrink-0 text-red-400" />,
    info: <Info size={15} className="shrink-0 text-blue-400" />,
    delete: <Trash2 size={15} className="shrink-0 text-red-400" />,
};

const BG: Record<ToastType, string> = {
    success: "border-emerald-500/20 bg-emerald-500/[0.06]",
    error: "border-red-500/20 bg-red-500/[0.06]",
    info: "border-blue-500/20 bg-blue-500/[0.06]",
    delete: "border-red-500/20 bg-red-500/[0.06]",
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
    const [show, setShow] = useState(false);
    const [exiting, setExiting] = useState(false);

    useEffect(() => {
        requestAnimationFrame(() => setShow(true));
        const timer = setTimeout(() => {
            setExiting(true);
            setTimeout(() => onDismiss(toast.id), 300);
        }, 3000);
        return () => clearTimeout(timer);
    }, [toast.id, onDismiss]);

    return (
        <div
            className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 shadow-lg shadow-black/20 backdrop-blur-md transition-all duration-300 ${BG[toast.type]} ${show && !exiting
                ? "translate-x-0 opacity-100"
                : "translate-x-8 opacity-0"
                }`}
            style={{ minWidth: 220, maxWidth: 360 }}
        >
            {ICONS[toast.type]}
            <span className="flex-1 text-[13px] text-white/95">{toast.message}</span>
            <button
                type="button"
                onClick={() => {
                    setExiting(true);
                    setTimeout(() => onDismiss(toast.id), 300);
                }}
                className="shrink-0 rounded-md p-0.5 text-white/30 transition-colors hover:text-white/85"
            >
                <X size={12} />
            </button>
        </div>
    );
}
