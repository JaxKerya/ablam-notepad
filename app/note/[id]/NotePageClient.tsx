"use client";

import { useState } from "react";
import PasswordGate from "@/components/PasswordGate";
import NoteEditor from "@/components/NoteEditor";
import type { JSONContent } from "@tiptap/react";

interface NotePageClientProps {
    noteId: string;
}

export default function NotePageClient({ noteId }: NotePageClientProps) {
    const [unlocked, setUnlocked] = useState(false);
    const [content, setContent] = useState<JSONContent | null>(null);

    const handleUnlock = (noteContent: JSONContent) => {
        setContent(noteContent);
        setUnlocked(true);
    };

    if (unlocked && content) {
        return <NoteEditor noteId={noteId} initialContent={content} hasPassword={true} />;
    }

    return <PasswordGate noteId={noteId} onUnlock={handleUnlock} />;
}
