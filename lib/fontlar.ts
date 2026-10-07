import { Playfair_Display } from "next/font/google";

/**
 * Logo yazı tipi: bahçe logosunun harfleri (components/BahceLogo) ve not
 * ekranının köşesindeki küçük "Ablam NotePad". Tek yerde tanımlı — Next aynı
 * fontu iki dosyada ayrı ayrı yüklerse iki kopya indirir.
 */
export const logoFontu = Playfair_Display({ subsets: ["latin", "latin-ext"], weight: "700", display: "swap" });
