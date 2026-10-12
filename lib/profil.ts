/**
 * Ablam Ders profilleri. DERSLER ORTAK (ders, soru, not, kategori, arşiv), CEVAPLAR
 * KİŞİYE ÖZEL: cevaplar (ders_answers.profil), pratik/deneme/yanlış oturumları
 * (ders_sessions.profil) ve onlardan türeyen her şey — ders kartındaki doğru
 * sayısı, deneme netleri, Yanlışlarım. Şema: db/ders-profil.sql.
 *
 * Seçim bir çerezde: hem sunucu rotaları (lib/ders-server.ts dersProfili) hem
 * tarayıcıdaki sorgular aynı yerden okusun diye. Her kişi kendi cihazında bir kez
 * seçiyor. Çerez yoksa "ablam" — profil gelmeden önceki bütün veri onun.
 */
export const PROFILLER = ["ablam", "ozi"] as const;
export type Profil = (typeof PROFILLER)[number];
export const VARSAYILAN_PROFIL: Profil = "ablam";
export const PROFIL_ADI: Record<Profil, string> = { ablam: "Ablam", ozi: "Ozi" };
export const PROFIL_CEREZI = "ders-profil";

export function profilDogrula(deger: string | null | undefined): Profil {
  return (PROFILLER as readonly string[]).includes(deger ?? "") ? (deger as Profil) : VARSAYILAN_PROFIL;
}

/** Tarayıcıda: seçili profil (sunucuda çağrılırsa varsayılan) */
export function aktifProfil(): Profil {
  if (typeof document === "undefined") return VARSAYILAN_PROFIL;
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${PROFIL_CEREZI}=([^;]*)`));
  return profilDogrula(m ? decodeURIComponent(m[1]) : null);
}

/** Tarayıcıda: profili seçer (bir yıl hatırlanır) */
export function profilSec(p: Profil) {
  document.cookie = `${PROFIL_CEREZI}=${encodeURIComponent(p)}; path=/; max-age=31536000; samesite=lax`;
}
