"use client";

/**
 * Kök layout'un kendisi çökerse app/error.tsx devreye giremez (o da layout'un
 * içinde yaşıyor). Bu dosya kendi <html>/<body>'sini kuruyor, yani son çare.
 *
 * Bilerek sade: burada tema değişkenleri, yazı tipi ve ToastProvider yok —
 * hiçbirine güvenilemez. Renkler elle yazılı.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="tr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1c211b",
          color: "rgba(255,255,255,0.85)",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "20px",
        }}
      >
        <div style={{ maxWidth: 360, textAlign: "center" }}>
          <h1 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>
            Uygulama açılamadı
          </h1>
          <p
            style={{
              fontSize: 13,
              lineHeight: 1.6,
              color: "rgba(255,255,255,0.45)",
              marginTop: 10,
            }}
          >
            Beklenmeyen bir hata oldu. Sayfayı yenilemek çoğu zaman yeterli.
          </p>
          {error.digest && (
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginTop: 12 }}>
              kod: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: 22,
              padding: "11px 22px",
              borderRadius: 12,
              border: "none",
              background: "#b9cc8a",
              color: "#1c211b",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Tekrar dene
          </button>
        </div>
      </body>
    </html>
  );
}
