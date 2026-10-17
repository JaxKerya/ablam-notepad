"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, PenLine, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { useToast } from "@/components/Toast";
import { useModal } from "@/components/useModal";
import BahceLogo, { MODUL_PALETLERI } from "@/components/BahceLogo";
import { aktifProfil } from "@/lib/profil";
import { tarihMetni } from "@/lib/ders";
import { ZEMIN, type Kanvas } from "@/lib/kanvas";

type Satir = Kanvas & { oge: number };

export default function KanvasListesi() {
  const [liste, setListe] = useState<Satir[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [yeniAd, setYeniAd] = useState("");
  const [olusturuluyor, setOlusturuluyor] = useState(false);
  const [adDegisen, setAdDegisen] = useState<string | null>(null);
  const [silinecek, setSilinecek] = useState<Satir | null>(null);
  const [siliniyor, setSiliniyor] = useState(false);
  const router = useRouter();
  const { addToast } = useToast();

  const silmeRef = useModal<HTMLDivElement>(!!silinecek, () => {
    if (!siliniyor) setSilinecek(null);
  });

  const getir = useCallback(async () => {
    const { data, error } = await supabase
      .from("kanvaslar")
      .select("id, ad, desen, ton, olusturan, onizleme, created_at, updated_at, kanvas_ogeler(count)")
      .order("updated_at", { ascending: false });
    if (error) {
      setHata(error.message);
      setYukleniyor(false);
      return;
    }
    setHata(null);
    setListe(
      (data ?? []).map((k) => {
        const sayi = k.kanvas_ogeler as unknown as { count: number }[] | null;
        return { ...(k as unknown as Kanvas), oge: sayi?.[0]?.count ?? 0 };
      })
    );
    setYukleniyor(false);
  }, []);

  // Bkz. app/sheets/page.tsx: setState'ler await sonrası çalışıyor
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    getir();
  }, [getir]);

  const olustur = async () => {
    const ad = yeniAd.trim() || `Kanvas ${liste.length + 1}`;
    if (olusturuluyor) return;
    setOlusturuluyor(true);
    const { data, error } = await supabase
      .from("kanvaslar")
      // Yeni kanvas boş zeminle açılıyor (tablodaki varsayılan "kareli"; zemin tahtadaki menüden değişir)
      .insert({ ad, olusturan: aktifProfil(), desen: "bos" })
      .select("id")
      .single();
    if (error || !data) {
      addToast("Kanvas oluşturulamadı.", "error");
      setOlusturuluyor(false);
      return;
    }
    router.push(`/kanvas/${data.id}`);
  };

  const yenidenAdlandir = async (k: Satir, ad: string) => {
    setAdDegisen(null);
    const yeni = ad.trim();
    if (!yeni || yeni === k.ad) return;
    setListe((l) => l.map((x) => (x.id === k.id ? { ...x, ad: yeni } : x)));
    const { error } = await supabase.from("kanvaslar").update({ ad: yeni }).eq("id", k.id);
    if (error) addToast("Ad değiştirilemedi.", "error");
  };

  const sil = async (k: Satir) => {
    setSiliniyor(true);
    const { error } = await supabase.from("kanvaslar").delete().eq("id", k.id);
    if (error) {
      addToast("Kanvas silinemedi.", "error");
    } else {
      addToast("Kanvas silindi.", "delete");
      setListe((l) => l.filter((x) => x.id !== k.id));
      // Yapıştırılan resimler: başarısız olursa yalnızca depoda yer kaplarlar
      const { data: dosyalar } = await supabase.storage.from("AblamAblam").list(`kanvas/${k.id}`, { limit: 1000 });
      if (dosyalar?.length) {
        await supabase.storage.from("AblamAblam").remove(dosyalar.map((d) => `kanvas/${k.id}/${d.name}`));
      }
    }
    setSilinecek(null);
    setSiliniyor(false);
  };

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background: [
            "radial-gradient(ellipse 80% 50% at 50% 0%, rgb(var(--accent-rgb) / 0.07) 0%, transparent 60%)",
            "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.15) 100%)",
          ].join(", "),
        }}
      />

      <Link
        href="/"
        className="glass fixed top-5 left-5 z-20 animate-fade-in flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-[13px] text-white/55 transition-all duration-200 hover:border-[var(--border-hover)] hover:text-white/85 sm:top-6 sm:left-7"
      >
        <ArrowLeft size={14} />
        <span>Ana sayfa</span>
      </Link>

      <div className="relative z-10 mx-auto max-w-3xl px-5 pb-20 pt-24 sm:pt-28">
        <div className="animate-fade-in mb-10 flex flex-col items-center text-center">
          <h1 className="sr-only">Ablam Kanvas</h1>
          <BahceLogo metin="Ablam Kanvas" palet={MODUL_PALETLERI.kanvas} yukseklik={200} className="-mt-10 w-full max-w-xl sm:-mt-16" />
        </div>

        <div className="animate-slide-up glass flex gap-2 rounded-2xl border border-[var(--border)] p-3" style={{ animationDelay: "80ms" }}>
          <div className="relative min-w-0 flex-1">
            <PenLine size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              value={yeniAd}
              onChange={(e) => setYeniAd(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && olustur()}
              disabled={olusturuluyor}
              maxLength={80}
              placeholder="Yeni kanvasın adı (ör. Türev soruları)"
              className="focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-3 pl-10 pr-4 text-sm text-white/95 placeholder-white/25 transition-all disabled:opacity-50"
            />
          </div>
          <button
            type="button"
            onClick={olustur}
            disabled={olusturuluyor}
            className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 text-sm font-medium text-[var(--background)] shadow-lg shadow-[var(--accent)]/10 transition-all hover:bg-[var(--accent-light)] active:scale-[0.99] disabled:opacity-40"
          >
            {olusturuluyor ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            <span className="hidden sm:inline">Kanvas oluştur</span>
          </button>
        </div>

        <div className="mt-10">
          <h2 className="mb-3 px-1 text-[12px] font-medium uppercase tracking-wider text-white/30">Kanvaslar</h2>

          {yukleniyor ? (
            <div className="flex justify-center py-10">
              <Loader2 size={18} className="animate-spin text-[var(--accent)]/50" />
            </div>
          ) : hata ? (
            <div className="glass rounded-2xl border border-red-400/25 bg-red-400/[0.04] px-5 py-8 text-center">
              <p className="text-[13px] text-white/70">Kanvaslar yüklenemedi.</p>
              <p className="mt-1 text-[11.5px] text-white/35">Bağlantı sorunu olabilir; çizimlerin duruyor.</p>
              <button
                type="button"
                onClick={() => {
                  setYukleniyor(true);
                  getir();
                }}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-[13px] text-white/65 transition-colors hover:border-[var(--border-hover)] hover:text-white/90"
              >
                Tekrar dene
              </button>
            </div>
          ) : liste.length === 0 ? (
            <div className="glass rounded-2xl border border-[var(--border)] px-5 py-10 text-center">
              <p className="text-[13px] text-white/35">Henüz kanvas yok. Yukarıdan ilkini oluştur.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {liste.map((k, i) => (
                <div
                  key={k.id}
                  className="animate-fade-in group relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] transition-all hover:border-[var(--border-hover)]"
                  style={{ animationDelay: `${Math.min(i * 35, 300)}ms` }}
                >
                  <Link href={`/kanvas/${k.id}`} className="block">
                    <div className="aspect-[16/10] w-full" style={{ background: ZEMIN[k.ton]?.zemin ?? ZEMIN.koyu.zemin }}>
                      {k.onizleme ? (
                        // Önizleme kanvas sayfasında üretilen küçük JPEG (data URL); optimize edilecek bir şey yok
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={k.onizleme} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[12px] text-white/25">Boş kanvas</div>
                      )}
                    </div>
                  </Link>
                  <div className="flex items-center gap-2 px-3.5 py-2.5">
                    <div className="min-w-0 flex-1">
                      {adDegisen === k.id ? (
                        <input
                          autoFocus
                          defaultValue={k.ad}
                          maxLength={80}
                          onBlur={(e) => yenidenAdlandir(k, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") setAdDegisen(null);
                          }}
                          className="w-full rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[13.5px] font-medium text-white outline-none ring-1 ring-[var(--accent)]/40"
                        />
                      ) : (
                        <Link href={`/kanvas/${k.id}`} className="block truncate text-[13.5px] font-medium text-white/90">
                          {k.ad}
                        </Link>
                      )}
                      <p className="mt-0.5 truncate text-[11.5px] text-white/35">
                        {k.oge} öğe · {tarihMetni(k.updated_at)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAdDegisen(k.id)}
                      aria-label="Adını değiştir"
                      title="Adını değiştir"
                      className="rounded-lg p-2 text-white/25 transition-all hover:bg-white/[0.06] hover:text-white/70 sm:opacity-0 sm:group-hover:opacity-100"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSilinecek(k)}
                      aria-label="Kanvası sil"
                      title="Kanvası sil"
                      className="rounded-lg p-2 text-white/25 transition-all hover:bg-red-400/10 hover:text-red-400 sm:opacity-0 sm:group-hover:opacity-100"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {silinecek && (
        <div
          className="animate-overlay fixed inset-0 z-[var(--z-panel)] flex items-center justify-center bg-black/40 px-5"
          onClick={() => !siliniyor && setSilinecek(null)}
        >
          <div
            ref={silmeRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="kanvas-silme-basligi"
            className="animate-fade-in-scale w-full max-w-xs rounded-2xl border border-[var(--border)] bg-[var(--surface-popup)] p-6 shadow-2xl shadow-black/40"
            onClick={(e) => e.stopPropagation()}
          >
            <p id="kanvas-silme-basligi" className="text-[14px] font-medium text-white/90">
              “{silinecek.ad}” silinsin mi?
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/45">
              İçindeki bütün çizimler, yazılar ve resimler de silinir; ikinizden de gider. Geri alınamaz.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setSilinecek(null)}
                disabled={siliniyor}
                className="flex-1 rounded-xl border border-[var(--border)] px-4 py-2.5 text-[13px] text-white/60 transition-colors hover:text-white/90 disabled:opacity-50"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => sil(silinecek)}
                disabled={siliniyor}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-500/85 px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
              >
                {siliniyor ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Sil
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
