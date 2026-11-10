// Plain-text extraction from announcement attachments (PDF and DOCX).
//
// Public-sector sources (Kamu İlan, Yerel Yönetimler) publish the actual
// announcement — position, KPSS score type, education requirement — only in an
// attached file; the list title ("16 SÖZLEŞMELİ PERSONEL ALACAK") does not say
// whether the job fits. The scoring model needs this text.

import { unzipSync, strFromU8 } from "fflate";
import { extractText } from "unpdf";
import { varliklariCoz } from "./http";

/** Larger files are skipped: announcements are a few pages, huge files are scans or bundles */
const EN_BUYUK_BAYT = 8 * 1024 * 1024;

export async function pdfMetni(veri: ArrayBuffer): Promise<string> {
  if (veri.byteLength > EN_BUYUK_BAYT) return "";
  const { text } = await extractText(new Uint8Array(veri), { mergePages: true });
  return metniToparla(text);
}

/** DOCX is a zip; the body text lives in word/document.xml */
export function docxMetni(veri: ArrayBuffer): string {
  if (veri.byteLength > EN_BUYUK_BAYT) return "";
  const dosyalar = unzipSync(new Uint8Array(veri), { filter: (f) => f.name === "word/document.xml" });
  const xml = dosyalar["word/document.xml"];
  if (!xml) return "";
  const metin = strFromU8(xml)
    .replace(/<w:tab\/>/g, " ")
    .replace(/<\/w:tc>/g, " | ") // table cells, so a requirements table stays readable
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "");
  return metniToparla(varliklariCoz(metin));
}

/** Collapses whitespace and blank lines so the text fits the model's character budget */
export function metniToparla(metin: string): string {
  return metin
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
