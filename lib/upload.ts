import { supabase } from "./supabase-browser";

/**
 * Upload an image to Supabase Storage and return its public URL.
 */
export async function uploadImage(
    file: File,
    noteId: string
): Promise<string> {
    const ext = file.name.split(".").pop() || "png";
    const uniqueName = `${noteId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error } = await supabase.storage
        .from("AblamAblam")
        .upload(uniqueName, file, {
            cacheControl: "3600",
            upsert: false,
        });

    if (error) {
        throw new Error(`Görsel yüklenemedi: ${error.message}`);
    }

    const {
        data: { publicUrl },
    } = supabase.storage.from("AblamAblam").getPublicUrl(uniqueName);

    return publicUrl;
}
