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

// RTF groups that hold no body text (fonts, styles, pictures, field codes…).
// Anything inside them would otherwise leak into the output as font names etc.
const RTF_GOVDE_DISI = new Set([
  "fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "headerl", "headerr", "headerf",
  "footer", "footerl", "footerr", "footerf", "footnote", "listtable", "listoverridetable", "rsidtbl",
  "generator", "fldinst", "themedata", "colorschememapping", "latentstyles", "datastore", "xmlnstbl",
  "pgdsctbl", "filetbl", "revtbl", "bkmkstart", "bkmkend", "nonshppict", "shpinst", "template", "operator",
]);
const RTF_SOZCUK: Record<string, string> = {
  par: "\n", line: "\n", row: "\n", sect: "\n", page: "\n",
  cell: " | ", nestcell: " | ", // table cells, same separator as docxMetni
  tab: " ", emspace: " ", enspace: " ", qmspace: " ",
  endash: "-", emdash: "-", bullet: "•",
  lquote: "'", rquote: "'", ldblquote: '"', rdblquote: '"',
};

/**
 * RTF -> plain text. Some municipalities attach the announcement as .rtf
 * (İzmir Büyükşehir zabıta, 478532; measured 12.11.2026: 257 KB file, ~30k
 * characters of text, the rest is formatting). \'xx bytes are decoded as
 * windows-1254 regardless of \ansicpg: Turkish Word files often declare 1252
 * and mark Turkish only per font (\fcharset162), and the two code pages differ
 * only in the six Turkish letters.
 */
export function rtfMetni(veri: ArrayBuffer): string {
  if (veri.byteLength > EN_BUYUK_BAYT) return "";
  const s = Buffer.from(veri).toString("latin1");
  if (!s.startsWith("{\\rtf")) return "";
  const cp1254 = new TextDecoder("windows-1254");
  const parcalar: string[] = [];
  let baytlar: number[] = [];
  const baytlariBosalt = () => {
    if (baytlar.length) {
      parcalar.push(cp1254.decode(new Uint8Array(baytlar)));
      baytlar = [];
    }
  };
  // Per group: is it skipped, and how many fallback characters follow a \uN
  const yigin: { atla: boolean; uc: number }[] = [];
  let atla = false;
  let uc = 1;
  let ucAtla = 0; // fallback characters still to drop after a \uN
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "{") {
      yigin.push({ atla, uc });
      i++;
    } else if (c === "}") {
      const ust = yigin.pop();
      if (ust) ({ atla, uc } = ust);
      ucAtla = 0;
      i++;
    } else if (c === "\\") {
      const sonraki = s[i + 1];
      if (sonraki === "'") {
        const bayt = parseInt(s.slice(i + 2, i + 4), 16);
        i += 4;
        if (ucAtla > 0) ucAtla--;
        else if (!atla && !isNaN(bayt)) baytlar.push(bayt);
      } else if (sonraki !== undefined && /[a-zA-Z]/.test(sonraki)) {
        const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i + 1, i + 50))!;
        i += 1 + m[0].length;
        const ad = m[1];
        if (ad === "bin") {
          i += Math.max(0, Number(m[2] ?? 0)); // raw binary payload
        } else if (RTF_GOVDE_DISI.has(ad)) {
          atla = true;
        } else if (ad === "uc") {
          uc = Number(m[2] ?? 1);
        } else if (ad === "u" && m[2] !== undefined) {
          if (!atla) {
            baytlariBosalt();
            const kod = Number(m[2]);
            parcalar.push(String.fromCharCode(kod < 0 ? kod + 65536 : kod));
          }
          ucAtla = uc;
        } else if (!atla && RTF_SOZCUK[ad] !== undefined) {
          baytlariBosalt();
          parcalar.push(RTF_SOZCUK[ad]);
        }
      } else {
        // Control symbol: \* marks an optional destination, \\ \{ \} are literals
        i += 2;
        if (sonraki === "*") atla = true;
        else if (sonraki === "~") {
          if (!atla) baytlar.push(0x20);
        } else if (sonraki === "\\" || sonraki === "{" || sonraki === "}") {
          if (ucAtla > 0) ucAtla--;
          else if (!atla) baytlar.push(sonraki.charCodeAt(0));
        } else if (sonraki === "\n" || sonraki === "\r") {
          if (!atla) baytlar.push(0x0a); // backslash-newline is \par
        }
      }
    } else {
      i++;
      if (c === "\r" || c === "\n") continue; // line breaks in the file carry no meaning
      if (ucAtla > 0) ucAtla--;
      else if (!atla) baytlar.push(c.charCodeAt(0));
    }
  }
  baytlariBosalt();
  return metniToparla(parcalar.join(""));
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
