"use client";

import { useState } from "react";
import PasswordGate from "@/components/PasswordGate";
import NoteEditor from "@/components/NoteEditor";
import type { JSONContent } from "@tiptap/react";

interface NotePageClientProps {
    noteId: string;
    passwordHint: string | null;
    noteIcon: string | null;
}

export default function NotePageClient({ noteId, passwordHint, noteIcon }: NotePageClientProps) {
    const [unlocked, setUnlocked] = useState(false);
    const [content, setContent] = useState<JSONContent | null>(null);

    const handleUnlock = (noteContent: JSONContent) => {
        setContent(noteContent);
        setUnlocked(true);
    };

    if (unlocked && content) {
        return <NoteEditor noteId={noteId} initialContent={content} hasPassword={true} initialIcon={noteIcon} />;
    }

    return <PasswordGate noteId={noteId} passwordHint={passwordHint} onUnlock={handleUnlock} />;
}
