"use client";

import { useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { icons, Search, X } from "lucide-react";
import type { LucideProps } from "lucide-react";
import tagsRaw from "@/lib/icon-tags.json";

// Convert kebab-case to PascalCase to match lucide-react keys
function kebabToPascal(s: string): string {
    return s.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
}

// Build tag lookup: PascalCase icon name → tags[]
const iconTags: Record<string, string[]> = {};
for (const [kebab, tags] of Object.entries(tagsRaw)) {
    const pascal = kebabToPascal(kebab);
    if (icons[pascal as keyof typeof icons]) {
        iconTags[pascal] = tags as string[];
    }
}

// Popular icons shown by default (before any search)
const POPULAR_ICONS = [
    // Documents & productivity
    "FileText", "Notebook", "ClipboardList", "ListTodo", "BookOpen",
    // Lifestyle & daily
    "House", "ShoppingCart", "Heart", "Star", "Coffee",
    // Education & work
    "GraduationCap", "Briefcase", "Lightbulb", "Target", "Trophy",
    // Tech & tools
    "Code", "Globe", "Smartphone", "Laptop", "Wrench",
    // Communication
    "Mail", "Phone", "MessageCircle", "Send", "Users",
    // Time & planning
    "Calendar", "Clock", "CalendarDays",
    // Creative
    "Palette", "Camera", "Music", "Pen", "Sparkles",
    // Nature & travel
    "Plane", "MapPin", "Sun", "Cloud", "Leaf",
    // Food & health
    "Apple", "Stethoscope", "Dumbbell", "Pizza", "Cookie",
    // Finance & misc
    "Wallet", "Key", "Shield", "Bookmark", "Gift",
];

interface IconPickerProps {
    currentIcon?: string | null;
    onSelect: (iconName: string) => void;
    onClose: () => void;
}

function DynamicIcon({ name, ...props }: { name: string } & LucideProps) {
    const IconComponent = icons[name as keyof typeof icons];
    if (!IconComponent) return null;
    return <IconComponent {...props} />;
}

export { DynamicIcon };

export default function IconPicker({ currentIcon, onSelect, onClose }: IconPickerProps) {
    const [search, setSearch] = useState("");

    const allIconNames = useMemo(() => Object.keys(icons), []);

    const filteredIcons = useMemo(() => {
        if (!search.trim()) return POPULAR_ICONS;
        const q = search.toLowerCase();
        return allIconNames.filter((name) => {
            if (name.toLowerCase().includes(q)) return true;
            const tags = iconTags[name];
            if (tags && tags.some((tag) => tag.includes(q))) return true;
            return false;
        }).slice(0, 60);
    }, [search, allIconNames]);

    const handleSelect = useCallback((name: string) => {
        onSelect(name);
        onClose();
    }, [onSelect, onClose]);

    if (typeof document === "undefined") return null;

    return createPortal(
        <div className="fixed inset-0 z-[60]">
            <div
                className="absolute inset-0 bg-black/40 animate-backdrop-blur"
                onClick={onClose}
            />
            <div className="pointer-events-none relative flex h-full items-center justify-center">
            <div
                className="pointer-events-auto animate-fade-in-scale mx-4 flex w-full max-w-sm flex-col rounded-2xl border border-white/[0.12] bg-black/20 backdrop-blur-2xl shadow-2xl shadow-black/40"
                style={{ maxHeight: "70vh" }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center gap-2.5 border-b border-white/[0.04] px-4 pt-4 pb-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)]/10">
                        {currentIcon ? (
                            <DynamicIcon name={currentIcon} size={15} className="text-[var(--accent)]" />
                        ) : (
                            <Search size={14} className="text-[var(--accent)]" />
                        )}
                    </div>
                    <h3 className="flex-1 text-sm font-semibold text-white/95">İkon Seç</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-white/30 transition-all hover:bg-white/5 hover:text-white/85"
                    >
                        <X size={14} />
                    </button>
                </div>

                {/* Search */}
                <div className="px-4 py-3">
                    <div className="relative">
                        <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="1703 ikon içinde ara…"
                            autoFocus
                            className="focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2 pl-8 pr-3 text-sm text-white/95 placeholder-white/30 transition-all"
                        />
                    </div>
                    {!search.trim() && (
                        <p className="mt-2 text-[10px] text-white/30">Popüler ikonlar · aramaya başlayın</p>
                    )}
                </div>

                {/* Icons grid */}
                <div className="flex-1 overflow-y-auto px-4 pb-4">
                    {filteredIcons.length === 0 ? (
                        <p className="py-6 text-center text-xs text-white/30">Sonuç bulunamadı</p>
                    ) : (
                        <div className="grid grid-cols-6 gap-1.5">
                            {filteredIcons.map((name) => {
                                const isActive = currentIcon === name;
                                return (
                                    <button
                                        key={name}
                                        type="button"
                                        onClick={() => handleSelect(name)}
                                        title={name}
                                        className={`flex h-10 w-full items-center justify-center rounded-lg transition-all duration-100 ${isActive
                                            ? "bg-[var(--accent)]/15 text-[var(--accent-light)]"
                                            : "text-white/50 hover:bg-white/[0.08] hover:text-white/85"
                                            }`}
                                    >
                                        <DynamicIcon name={name} size={18} />
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
            </div>
        </div>,
        document.body
    );
}
