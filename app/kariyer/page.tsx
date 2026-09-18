"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Briefcase,
  Check,
  ExternalLink,
  ListChecks,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  UserRound,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { useToast } from "@/components/Toast";
import {
  BOS_PROFIL,
  KARAR_ETIKETI,
  kalanGun,
  KARIYER_ACIK,
  kaynakEtiketi,
  ONIZLEME_ANAHTARI,
  profilBosMu,
  profilDogrula,
  sehirleriDogrula,
  sonBasvuruMetni,
  tarihMetni,
  type GeriBildirim,
  type ProfilOnerisi,
  type KariyerProfili,
  type Karar,
} from "@/lib/kariyer";

// İki ekran: Profil ve Eşleşmeler. Ablam çoğunlukla ikincisine gelecek;
// birincisi kurulumda ve ara sıra düzeltmede kullanılır.

type Sekme = "eslesmeler" | "tumu" | "profil";

interface Eslesme {
  ilan_id: string;
  puan: number;
  gerekce: string | null;
  uyusan: string[];
  uyusmayan: string[];
  karar: Karar;
  geri_bildirim: GeriBildirim | null;
  geri_bildirim_notu: string | null;
  degerlendirildi: string;
  ilan: {
    baslik: string;
    sirket: string | null;
    sehir: string | null;
    url: string | null;
    kaynak: string;
    son_basvuru: string | null;
  };
}

interface ProfilSatiri {
  serbest_metin: string | null;
  profil: KariyerProfili | null;
  sehirler: string[];
  uzaktan_olur: boolean;
  asgari_maas: number | null;
  bildirim_eposta: string | null;
  updated_at: string | null;
}

interface Tarama {
  kaynak: string;
  baslangic: string;
  bitis: string | null;
  bulunan: number;
  yeni: number;
  hata: string | null;
  /** Son tarama 3 saatten eski — veri gelirken hesaplanıyor (render saf kalsın) */
  sessiz: boolean;
}

/** Kaynak başına durum — şerit yalnızca son kaynağa bakıyordu, biri kırıkken diğeri sağlam görünüyordu */
interface KaynakDurumu {
  kaynak: string;
  /** Son başarılı bitiş */
  sonBasari: string | null;
  bulunan: number;
  /** En son satır hatalıysa metni */
  sonHata: string | null;
  /** Kaynağın kendi aralığına göre gecikmiş mi (İŞKUR 6 sa, LinkedIn 12 sa, diğerleri 1 sa; +2 sa pay) */
  bayat: boolean;
}

const KAYNAK_ARALIK_SAAT: Record<string, number> = { iskur: 6, linkedin: 12 };

function kaynakDurumlari(satirlar: Tarama[]): KaynakDurumu[] {
  const simdi = Date.now();
  const gruplar = new Map<string, Tarama[]>();
  for (const t of satirlar) {
    if (t.kaynak === "nabiz" || t.kaynak === "ozet") continue;
    gruplar.set(t.kaynak, [...(gruplar.get(t.kaynak) ?? []), t]);
  }
  return [...gruplar.entries()].map(([kaynak, liste]) => {
    const sonBasarili = liste.find((t) => !t.hata && t.bitis);
    const enSon = liste[0];
    const aralik = (KAYNAK_ARALIK_SAAT[kaynak] ?? 1) + 2;
    return {
      kaynak,
      sonBasari: sonBasarili?.bitis ?? null,
      bulunan: sonBasarili?.bulunan ?? 0,
      sonHata: enSon?.hata ?? null,
      bayat: !sonBasarili || simdi - new Date(sonBasarili.bitis!).getTime() > aralik * 3600_000,
    };
  });
}

const SIRA: Karar[] = ["bildir", "ozet", "listele"];

const KARAR_STIL: Record<Karar, string> = {
  bildir: "border-[var(--accent)]/40 bg-[var(--accent)]/15 text-[var(--accent-light)]",
  ozet: "border-amber-400/35 bg-amber-400/10 text-amber-200",
  listele: "border-white/15 bg-white/[0.04] text-white/50",
  ele: "border-white/10 bg-white/[0.03] text-white/30",
};

export default function KariyerSayfasi() {
  // Bölüm kapalıysa "yakında" ekranı. ?onizleme=1 ile gelen (geliştiren kişi)
  // görür; tercih localStorage'da kalır, sonraki girişlerde sormaz.
  const [gorunum, setGorunum] = useState<"bilinmiyor" | "yakinda" | "acik">(KARIYER_ACIK ? "acik" : "bilinmiyor");
  useEffect(() => {
    if (KARIYER_ACIK) return;
    queueMicrotask(() => {
      let onizleme = false;
      try {
        if (new URLSearchParams(window.location.search).get("onizleme") === "1") {
          localStorage.setItem(ONIZLEME_ANAHTARI, "1");
        }
        onizleme = localStorage.getItem(ONIZLEME_ANAHTARI) === "1";
      } catch {
        // gizli pencere vb. — görmesin
      }
      setGorunum(onizleme ? "acik" : "yakinda");
    });
  }, []);

  if (gorunum !== "acik") return <YakindaEkrani gizli={gorunum === "bilinmiyor"} />;
  return <KariyerUygulamasi />;
}

function YakindaEkrani({ gizli }: { gizli: boolean }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-x-hidden px-5">
      <Link
        href="/"
        className="glass fixed top-5 left-5 z-20 flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-[13px] text-white/55 transition-all duration-200 hover:border-[var(--border-hover)] hover:text-white/85 sm:top-6 sm:left-7"
      >
        <ArrowLeft size={14} />
        <span>Ana sayfa</span>
      </Link>
      <div className={`animate-fade-in flex flex-col items-center text-center transition-opacity ${gizli ? "opacity-0" : ""}`}>
        <div className="glow-md mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent)]/10">
          <Briefcase size={24} className="text-[var(--accent-light)]" />
        </div>
        <h1 className="text-2xl font-semibold text-white/95">Ablam Kariyer</h1>
        <p className="mt-2 max-w-xs text-[13.5px] leading-relaxed text-white/45">
          Hazırlanıyor. Açıldığında iş ilanları senin yerine taranacak, uygun olanlar burada ve e-postanda olacak.
        </p>
        <span className="mt-4 rounded-full border border-[var(--accent)]/25 bg-[var(--accent)]/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-[var(--accent-light)]/80">
          Yakında
        </span>
      </div>
    </main>
  );
}

function KariyerUygulamasi() {
  const { addToast } = useToast();
  const [sekme, setSekme] = useState<Sekme>("eslesmeler");
  const [yukleniyor, setYukleniyor] = useState(true);
  const [profilSatiri, setProfilSatiri] = useState<ProfilSatiri | null>(null);
  const [eslesmeler, setEslesmeler] = useState<Eslesme[]>([]);
  const [sonTarama, setSonTarama] = useState<Tarama | null>(null);
  const [tumu, setTumu] = useState<Eslesme[] | null>(null);
  const [toplamInceleme, setToplamInceleme] = useState<number | null>(null);
  const [kaynaklar, setKaynaklar] = useState<KaynakDurumu[]>([]);

  const getir = useCallback(async () => {
    const [p, e, t, n] = await Promise.all([
      supabase.from("kariyer_profil").select("*").eq("id", 1).maybeSingle(),
      supabase
        .from("kariyer_eslesmeler")
        .select(
          "ilan_id, puan, gerekce, uyusan, uyusmayan, karar, geri_bildirim, geri_bildirim_notu, degerlendirildi, kariyer_ilanlar(baslik, sirket, sehir, url, kaynak, son_basvuru)"
        )
        .neq("karar", "ele")
        .order("degerlendirildi", { ascending: false })
        .limit(200),
      supabase.from("kariyer_taramalar").select("*").not("kaynak", "in", "(nabiz,ozet)").order("baslangic", { ascending: false }).limit(60),
      supabase.from("kariyer_eslesmeler").select("ilan_id", { count: "exact", head: true }),
    ]);
    setToplamInceleme(n.count ?? null);
    setKaynaklar(kaynakDurumlari((t.data ?? []) as Tarama[]));
    if (p.data) {
      setProfilSatiri({ ...p.data, profil: p.data.profil ? profilDogrula(p.data.profil) : null, sehirler: p.data.sehirler ?? [] });
    }
    setEslesmeler(
      (e.data ?? [])
        .map((r) => {
          const ham = r.kariyer_ilanlar as unknown;
          const ilan = (Array.isArray(ham) ? ham[0] : ham) as Eslesme["ilan"];
          return { ...(r as Omit<Eslesme, "ilan">), ilan };
        })
        // Son başvurusu geçen ilan listede durmasın — kayıt kalır, gösterilmez
        .filter((x) => (kalanGun(x.ilan?.son_basvuru) ?? 0) >= 0)
    );
    const son = t.data?.[0];
    setSonTarama(son ? { ...son, sessiz: Date.now() - new Date(son.baslangic).getTime() > 3 * 3600_000 } : null);
    setYukleniyor(false);
  }, []);

  useEffect(() => {
    // Mikro göreve erteleme: setState efektin eş-zamanlı gövdesinde çağrılmıyor,
    // veri geldikten sonra çağrılıyor. Diğer sayfalardaki doğrudan çağrı lint'te
    // hata veriyor; burada tekrarlamıyoruz.
    queueMicrotask(getir);
  }, [getir]);

  /** "Tümü" sekmesi: elenenler ve süresi geçenler dahil son 300 değerlendirme */
  const tumunuGetir = useCallback(async () => {
    const { data } = await supabase
      .from("kariyer_eslesmeler")
      .select(
        "ilan_id, puan, gerekce, uyusan, uyusmayan, karar, geri_bildirim, geri_bildirim_notu, degerlendirildi, kariyer_ilanlar(baslik, sirket, sehir, url, kaynak, son_basvuru)"
      )
      .order("degerlendirildi", { ascending: false })
      .limit(300);
    setTumu(
      (data ?? []).map((r) => {
        const ham = r.kariyer_ilanlar as unknown;
        const ilan = (Array.isArray(ham) ? ham[0] : ham) as Eslesme["ilan"];
        return { ...(r as Omit<Eslesme, "ilan">), ilan };
      })
    );
  }, []);

  // Sekme her açılışta tazelenir — eşleşmelerde verilen geri bildirim burada da görünsün
  useEffect(() => {
    if (sekme === "tumu") queueMicrotask(tumunuGetir);
  }, [sekme, tumunuGetir]);

  // Profil boşsa ablam eşleşme ekranında boş bir listeyle karşılaşmasın:
  // sekme state'e yazılmıyor, TÜRETİLİYOR. Profil dolunca kendiliğinden açılır.
  const profilBos = !yukleniyor && profilBosMu(profilSatiri?.profil);
  const etkinSekme: Sekme = profilBos ? "profil" : sekme;

  const gruplar = useMemo(() => {
    const g: Record<Karar, Eslesme[]> = { bildir: [], ozet: [], listele: [], ele: [] };
    for (const e of eslesmeler) g[e.karar]?.push(e);
    for (const k of SIRA) g[k].sort((a, b) => b.puan - a.puan);
    return g;
  }, [eslesmeler]);

  /**
   * gb = null: geri al. Not yalnızca "ilgilenmedim"de anlamlı; kartın içindeki
   * panelden geliyor (sebep çipleri + serbest metin). Sebep modele olumsuz
   * örnek olarak gidiyor — tek kelime bile puanlamayı keskinleştiriyor.
   */
  const geriBildir = async (e: Eslesme, gb: GeriBildirim | null, not: string | null = null) => {
    const yeni = gb;
    setEslesmeler((l) =>
      l.map((x) => (x.ilan_id === e.ilan_id ? { ...x, geri_bildirim: yeni, geri_bildirim_notu: yeni === "ilgilenmedim" ? not : null } : x))
    );
    const { error } = await supabase
      .from("kariyer_eslesmeler")
      .update({
        geri_bildirim: yeni,
        geri_bildirim_notu: yeni === "ilgilenmedim" ? not : null,
        geri_bildirim_ts: yeni ? new Date().toISOString() : null,
      })
      .eq("ilan_id", e.ilan_id);
    if (error) {
      addToast("Kaydedilemedi: " + error.message, "error");
      getir();
    }
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

      <div className="relative z-10 mx-auto w-full max-w-2xl px-5 pb-24 pt-24 sm:pt-28">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="glow-md mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent)]/10">
            <Briefcase size={24} className="text-[var(--accent-light)]" />
          </div>
          <h1 className="text-2xl font-semibold text-white/95">Ablam Kariyer</h1>
          <p className="mt-1.5 max-w-md text-[13.5px] leading-relaxed text-white/45">
            İlanlar senin yerine sürekli taranıyor; uygun olanlar burada ve e-postanda.
          </p>
        </div>

        {/* Sekmeler */}
        <div className="glass mb-6 flex rounded-xl border border-[var(--border)] p-1">
          {(
            [
              ["eslesmeler", "Eşleşmeler", Sparkles],
              ["profil", "Profil", UserRound],
            ] as const
          ).map(([ad, etiket, Ikon]) => (
            <button
              key={ad}
              onClick={() => setSekme(ad)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                (etkinSekme === "tumu" ? "eslesmeler" : etkinSekme) === ad ? "bg-[var(--accent)]/15 text-[var(--accent-light)]" : "text-white/45 hover:text-white/75"
              }`}
            >
              <Ikon size={14} />
              {etiket}
            </button>
          ))}
        </div>

        {yukleniyor ? (
          <div className="flex justify-center py-16 text-white/30">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : etkinSekme === "tumu" ? (
          <TumuEkrani liste={tumu} onGeri={() => setSekme("eslesmeler")} />
        ) : etkinSekme === "profil" ? (
          <ProfilEkrani key={profilSatiri?.updated_at ?? "yok"} satir={profilSatiri} onKaydedildi={getir} />
        ) : (
          <EslesmeEkrani
            gruplar={gruplar}
            sonTarama={sonTarama}
            profilBos={profilBos}
            onGeriBildir={geriBildir}
            onProfileGit={() => setSekme("profil")}
            onTumuGit={() => setSekme("tumu")}
            toplamInceleme={toplamInceleme}
            kaynaklar={kaynaklar}
          />
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- tümü

/**
 * İncelenen her ilan, kararı ne olursa olsun: "sistem neyi gördü, neden
 * elendi" sorusunun cevabı. Eşleşmeler sekmesinden farklı olarak elenenler ve
 * süresi geçenler de burada; kartlar değil satırlar — 300 kayıt okunabilsin.
 */
function TumuEkrani({ liste, onGeri }: { liste: Eslesme[] | null; onGeri: () => void }) {
  const geri = (
    <button onClick={onGeri} className="mb-4 flex items-center gap-1.5 text-[12.5px] text-white/40 transition-colors hover:text-white/75">
      <ArrowLeft size={13} /> Eşleşmelere dön
    </button>
  );
  if (liste === null) {
    return (
      <div className="flex justify-center py-16 text-white/30">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }
  if (!liste.length) {
    return (
      <div>
        {geri}
        <div className="glass rounded-2xl border border-[var(--border)] px-5 py-10 text-center text-[13.5px] text-white/45">Henüz incelenen ilan yok.</div>
      </div>
    );
  }
  const sayim = liste.reduce<Record<string, number>>((t, e) => ({ ...t, [e.karar]: (t[e.karar] ?? 0) + 1 }), {});
  return (
    <div className="animate-fade-in">
      {geri}
      <p className="mb-4 text-center text-[11.5px] text-white/30">
        Son {liste.length} inceleme · {SIRA.map((k) => `${sayim[k] ?? 0} ${KARAR_ETIKETI[k].toLocaleLowerCase("tr")}`).join(" · ")} · {sayim.ele ?? 0} elendi
      </p>
      <div className="glass divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)]">
        {liste.map((e) => {
          const gecti = (kalanGun(e.ilan?.son_basvuru) ?? 0) < 0;
          return (
            <div key={e.ilan_id} className={`flex items-start gap-3 px-4 py-3 ${e.karar === "ele" || gecti ? "opacity-50" : ""}`}>
              <span className={`mt-0.5 w-9 flex-shrink-0 rounded-md border px-1.5 py-0.5 text-center text-[11.5px] font-medium tabular-nums ${KARAR_STIL[e.karar]}`}>
                {e.puan}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] text-white/85">
                  {e.ilan?.url ? (
                    <a href={e.ilan.url} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--accent-light)]">
                      {e.ilan.baslik}
                    </a>
                  ) : (
                    e.ilan?.baslik
                  )}
                </p>
                <p className="truncate text-[11.5px] text-white/35">
                  {[e.ilan?.sirket, e.ilan?.sehir, kaynakEtiketi(e.ilan?.kaynak ?? ""), tarihMetni(e.degerlendirildi)].filter(Boolean).join(" · ")}
                  {gecti && " · süresi geçti"}
                  {e.geri_bildirim && ` · ${e.geri_bildirim === "ilgilendim" ? "ilgilendin" : "ilgilenmedin"}`}
                </p>
                {e.gerekce && <p className="mt-0.5 truncate text-[12px] text-white/50" title={e.gerekce}>{e.gerekce}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- eşleşmeler

function EslesmeEkrani({
  gruplar,
  sonTarama,
  profilBos,
  onGeriBildir,
  onProfileGit,
  onTumuGit,
  toplamInceleme,
  kaynaklar,
}: {
  gruplar: Record<Karar, Eslesme[]>;
  sonTarama: Tarama | null;
  profilBos: boolean;
  onGeriBildir: (e: Eslesme, gb: GeriBildirim | null, not?: string | null) => void;
  onProfileGit: () => void;
  onTumuGit: () => void;
  toplamInceleme: number | null;
  kaynaklar: KaynakDurumu[];
}) {
  const toplam = SIRA.reduce((n, k) => n + gruplar[k].length, 0);
  const sorunlu = kaynaklar.filter((k) => k.bayat || k.sonHata);

  return (
    <div className="animate-fade-in">
      {/* Durum şeridi — sistem çalışıyor mu, tek satırda. 3 saatten eski tarama = sunucu sessiz, kırmızı. */}
      <p className="mb-5 text-center text-[11.5px] text-white/30">
        {sonTarama ? (
          sonTarama.sessiz ? (
            <span className="text-red-300/80">
              Tarayıcı {tarihMetni(sonTarama.baslangic)}den beri sessiz — sunucuya bakılmalı
            </span>
          ) : sonTarama.hata ? (
            <span className="text-red-300/70">
              Son tarama {tarihMetni(sonTarama.baslangic)} hata verdi — sistem yeniden deneyecek
            </span>
          ) : (
            <>
              Son tarama {tarihMetni(sonTarama.baslangic)} · {kaynakEtiketi(sonTarama.kaynak)}&apos;da {sonTarama.bulunan} ilan
              görüldü, {sonTarama.yeni} yeni
            </>
          )
        ) : (
          "Henüz tarama yapılmadı"
        )}
      </p>

      {/* Tüm incelenenler + kaynak sağlığı: sekme değil ama görünür — durum şeridinin hemen altında */}
      {!profilBos && (
        <div className="-mt-2 mb-5 flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={onTumuGit}
            className="glass flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3.5 py-1.5 text-[12px] text-white/50 transition-colors hover:border-[var(--border-hover)] hover:text-white/85"
          >
            <ListChecks size={13} />
            İncelenen tüm ilanlar{toplamInceleme ? ` (${toplamInceleme})` : ""}
          </button>
          {kaynaklar.length > 0 && (
            <details className="group relative">
              <summary
                className={`glass flex cursor-pointer list-none items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12px] transition-colors hover:border-[var(--border-hover)] hover:text-white/85 ${
                  sorunlu.length ? "border-amber-400/40 text-amber-200/80" : "border-[var(--border)] text-white/50"
                }`}
              >
                <Activity size={13} />
                {sorunlu.length ? `${kaynaklar.length} kaynak, ${sorunlu.length} sorunlu` : `${kaynaklar.length} kaynak çalışıyor`}
              </summary>
              <div className="glass absolute left-1/2 z-20 mt-2 w-[min(92vw,22rem)] -translate-x-1/2 divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] shadow-xl shadow-black/30">
                {kaynaklar.map((k) => (
                  <div key={k.kaynak} className="flex items-start gap-2.5 px-3.5 py-2.5 text-left">
                    <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${k.sonHata ? "bg-red-400" : k.bayat ? "bg-amber-400" : "bg-emerald-400"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] text-white/85">
                        {kaynakEtiketi(k.kaynak)}
                        <span className="text-white/35"> · {k.sonBasari ? `${tarihMetni(k.sonBasari)}, ${k.bulunan} ilan` : "hiç başarılı tarama yok"}</span>
                      </p>
                      {k.sonHata && <p className="mt-0.5 truncate text-[11.5px] text-red-200/70" title={k.sonHata}>son koşu hata: {k.sonHata}</p>}
                      {!k.sonHata && k.bayat && <p className="mt-0.5 text-[11.5px] text-amber-200/70">beklenenden uzun süredir taranmadı</p>}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {profilBos ? (
        <div className="glass rounded-2xl border border-[var(--border)] px-5 py-10 text-center">
          <p className="text-[14px] text-white/70">Önce kendini anlat, sistem ona göre arasın.</p>
          <button
            onClick={onProfileGit}
            className="mt-4 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-[13px] font-medium text-[var(--background)] transition-colors hover:bg-[var(--accent-light)]"
          >
            Profili oluştur
          </button>
        </div>
      ) : toplam === 0 ? (
        <div className="glass rounded-2xl border border-[var(--border)] px-5 py-10 text-center text-[13.5px] text-white/45">
          Henüz eşleşme yok. Sistem saat başı tarıyor; bir şey bulunca burada ve e-postanda olacak.
        </div>
      ) : (
        <>
          {SIRA.map(
            (k) =>
              gruplar[k].length > 0 && (
                <section key={k} className="mb-7">
                  <h2 className="mb-3 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider text-white/35">
                    {KARAR_ETIKETI[k]}
                    <span className="text-white/20">{gruplar[k].length}</span>
                  </h2>
                  <div className="space-y-2.5">
                    {gruplar[k].map((e) => (
                      <EslesmeKarti key={e.ilan_id} e={e} onGeriBildir={onGeriBildir} />
                    ))}
                  </div>
                </section>
              )
          )}
        </>
      )}
    </div>
  );
}

/** Hızlı sebepler — ablam tıklasın, yazmasın. Metin kutusu yine var, isteyen yazar. */
// "Zaten başvurdum" burada YOK: ilgisizlik değil ilgi; olumsuz örnek olarak modele gidiyordu (denetim bulgusu)
const SEBEPLER = ["Alanım değil", "Şartları taşımıyorum", "Şehir / mesafe", "Maaş"] as const;

function EslesmeKarti({ e, onGeriBildir }: { e: Eslesme; onGeriBildir: (e: Eslesme, gb: GeriBildirim | null, not?: string | null) => void }) {
  const alt = [e.ilan.sirket, e.ilan.sehir].filter(Boolean).join(" · ");
  const sonuk = e.geri_bildirim === "ilgilenmedim";
  // "İlgilenmedim" iki adım: önce sebep paneli açılır, kaydedince işaretlenir.
  // Kaydetmeden kapatırsa hiçbir şey değişmez — yanlışlıkla basılan tuş kayıt olmasın.
  const [panelAcik, setPanelAcik] = useState(false);
  const [secili, setSecili] = useState<string[]>([]);
  const [metin, setMetin] = useState("");

  const ilgilenmedimTikla = () => {
    if (sonuk) {
      onGeriBildir(e, null); // geri al
      return;
    }
    setPanelAcik((a) => !a);
  };
  const kaydet = () => {
    const not = [...secili, metin.trim()].filter(Boolean).join(", ") || null;
    onGeriBildir(e, "ilgilenmedim", not);
    setPanelAcik(false);
    setSecili([]);
    setMetin("");
  };

  return (
    <article className={`glass rounded-2xl border border-[var(--border)] p-4 transition-opacity ${sonuk ? "opacity-45" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[14.5px] font-medium leading-snug text-white/92">
            {e.ilan.url ? (
              <a href={e.ilan.url} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--accent-light)]">
                {e.ilan.baslik}
                <ExternalLink size={11} className="ml-1.5 inline opacity-40" />
              </a>
            ) : (
              e.ilan.baslik
            )}
          </h3>
          {alt && <p className="mt-0.5 text-[12.5px] text-white/45">{alt}</p>}
        </div>
        <span className={`flex-shrink-0 rounded-md border px-2 py-0.5 text-[12px] font-medium tabular-nums ${KARAR_STIL[e.karar]}`}>
          {e.puan}
        </span>
      </div>

      {e.gerekce && <p className="mt-2.5 text-[13px] leading-relaxed text-white/70">{e.gerekce}</p>}

      {(e.uyusan.length > 0 || e.uyusmayan.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {e.uyusan.map((u) => (
            <span key={"+" + u} className="rounded-md bg-[var(--accent)]/10 px-1.5 py-0.5 text-[11px] text-[var(--accent-light)]/80">+ {u}</span>
          ))}
          {e.uyusmayan.map((u) => (
            <span key={"-" + u} className="rounded-md bg-red-400/10 px-1.5 py-0.5 text-[11px] text-red-200/70">− {u}</span>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-white/25">
          {kaynakEtiketi(e.ilan.kaynak)} · {tarihMetni(e.degerlendirildi)}
          {e.ilan.son_basvuru && (
            <>
              {" · "}
              <span className={(kalanGun(e.ilan.son_basvuru) ?? 99) <= 3 ? "font-medium text-red-300/80" : ""}>
                {sonBasvuruMetni(e.ilan.son_basvuru)}
              </span>
            </>
          )}
        </span>
        <div className="flex gap-1">
          <GeriBildirimDugmesi
            aktif={e.geri_bildirim === "ilgilendim" && !panelAcik}
            onClick={() => {
              // Tek değer: biri seçilince öbürü düşer; açık sebep paneli de kapanır
              setPanelAcik(false);
              onGeriBildir(e, e.geri_bildirim === "ilgilendim" ? null : "ilgilendim");
            }}
            Ikon={ThumbsUp}
            etiket="İlgilendim"
          />
          <GeriBildirimDugmesi aktif={sonuk || panelAcik} onClick={ilgilenmedimTikla} Ikon={ThumbsDown} etiket="İlgilenmedim" />
        </div>
      </div>

      {sonuk && e.geri_bildirim_notu && (
        <p className="mt-2 text-[11.5px] text-white/35">İlgilenmedin: {e.geri_bildirim_notu}</p>
      )}

      {panelAcik && !sonuk && (
        <div className="mt-3 rounded-xl border border-[var(--border)] bg-white/[0.03] p-3">
          <p className="text-[12.5px] text-white/60">Neden ilgini çekmedi? Sistem bir dahakine buna göre eler. İstersen boş bırak.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SEBEPLER.map((sebep) => {
              const acik = secili.includes(sebep);
              return (
                <button
                  key={sebep}
                  type="button"
                  onClick={() => setSecili((l) => (acik ? l.filter((x) => x !== sebep) : [...l, sebep]))}
                  className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                    acik
                      ? "border-[var(--accent)]/50 bg-[var(--accent)]/20 text-[var(--accent-light)]"
                      : "border-white/15 bg-white/[0.04] text-white/60 hover:border-white/30 hover:text-white/85"
                  }`}
                >
                  {sebep}
                </button>
              );
            })}
          </div>
          <input
            value={metin}
            onChange={(ev) => setMetin(ev.target.value)}
            onKeyDown={(ev) => ev.key === "Enter" && kaydet()}
            placeholder="Başka bir sebep… (isteğe bağlı)"
            className="focus-ring mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12.5px] text-white/90 placeholder-white/25"
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <button type="button" onClick={() => setPanelAcik(false)} className="rounded-lg px-3 py-1.5 text-[12px] text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/70">
              Vazgeç
            </button>
            <button type="button" onClick={kaydet} className="rounded-lg bg-[var(--accent)]/15 px-3 py-1.5 text-[12px] font-medium text-[var(--accent-light)] transition-colors hover:bg-[var(--accent)]/25">
              Kaydet
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function GeriBildirimDugmesi({ aktif, onClick, Ikon, etiket }: { aktif: boolean; onClick: () => void; Ikon: typeof ThumbsUp; etiket: string }) {
  return (
    <button
      onClick={onClick}
      title={etiket}
      aria-label={etiket}
      aria-pressed={aktif}
      className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] transition-colors ${
        aktif ? "bg-[var(--accent)]/15 text-[var(--accent-light)]" : "text-white/35 hover:bg-white/[0.06] hover:text-white/70"
      }`}
    >
      <Ikon size={13} />
      <span className="hidden sm:inline">{etiket}</span>
    </button>
  );
}

// ---------------------------------------------------------------- profil

/**
 * Tek kayıt noktası. "Profili çıkar" yalnızca gösterir; "Kaydet" metni, profili
 * ve şartları birlikte yazar. Önceki sürümde çıkarma da kaydediyordu ve ablam
 * "kaydettim mi?" diye ikilemde kalıyordu. Kaydedilmemiş değişiklik varsa
 * düğmenin üstünde yazıyor; yoksa düğme sönük.
 */
function ProfilEkrani({ satir, onKaydedildi }: { satir: ProfilSatiri | null; onKaydedildi: () => void }) {
  const { addToast } = useToast();
  const [metin, setMetin] = useState(satir?.serbest_metin ?? "");
  const [profil, setProfil] = useState<KariyerProfili>(satir?.profil ?? BOS_PROFIL);
  const [oneriler, setOneriler] = useState<ProfilOnerisi[]>([]);
  const [sehirler, setSehirler] = useState<string[]>(satir?.sehirler ?? []);
  const [uzaktan, setUzaktan] = useState(satir?.uzaktan_olur ?? true);
  const [maas, setMaas] = useState(satir?.asgari_maas ? String(satir.asgari_maas) : "");
  const [eposta, setEposta] = useState(satir?.bildirim_eposta ?? "");
  const [cikariliyor, setCikariliyor] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [sifirlaniyor, setSifirlaniyor] = useState(false);
  const [yenidenSayi, setYenidenSayi] = useState<number | null>(null);
  const [yenideniliyor, setYenideniliyor] = useState(false);

  // Kaydedilmiş profil varsa: son 7 günün kaç ilanı yeniden puanlanabilir (düğme sayıyı gösterir)
  useEffect(() => {
    if (!satir?.profil || profilBosMu(satir.profil)) return;
    queueMicrotask(async () => {
      const res = await fetch("/api/kariyer/yeniden-degerlendir").catch(() => null);
      const data = res?.ok ? await res.json() : null;
      setYenidenSayi(typeof data?.sayi === "number" ? data.sayi : null);
    });
  }, [satir]);

  /** Paralı, o yüzden onaylı: son 7 günün puanları silinir, tarayıcı yeni profille yeniden puanlar */
  const yenidenPuanla = async () => {
    if (yenideniliyor || !yenidenSayi) return;
    const tahmin = (yenidenSayi * 0.004).toFixed(2);
    if (!window.confirm(`Son 7 günün ${yenidenSayi} ilanı yeni profile göre yeniden puanlanacak (yaklaşık $${tahmin}, saat başı 25'er). Geri bildirim verdiklerin korunur. Devam?`)) return;
    setYenideniliyor(true);
    try {
      const res = await fetch("/api/kariyer/yeniden-degerlendir", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.hata ?? "Başlatılamadı.");
      addToast(`${data.sifirlanan} ilan sıraya alındı — sonraki taramalarda yeniden puanlanacak`, "success");
      setYenidenSayi(0);
    } catch (err) {
      addToast((err as Error).message, "error");
    } finally {
      setYenideniliyor(false);
    }
  };
  // Her çıkarmada artıyor; liste alanları key ile sıfırlanıyor
  const [surum, setSurum] = useState(0);

  // Kaydedilmiş hâlin anlık görüntüsü — "değişiklik var mı" bununla kıyaslanıyor
  const kayitli = useMemo(
    () =>
      JSON.stringify({
        metin: satir?.serbest_metin ?? "",
        profil: satir?.profil ?? BOS_PROFIL,
        sehirler: satir?.sehirler ?? [],
        uzaktan: satir?.uzaktan_olur ?? true,
        maas: satir?.asgari_maas ? String(satir.asgari_maas) : "",
        eposta: satir?.bildirim_eposta ?? "",
      }),
    [satir]
  );
  const simdiki = JSON.stringify({ metin, profil, sehirler, uzaktan, maas, eposta });
  const degisti = simdiki !== kayitli;
  const bos = profilBosMu(profil);

  const cikar = async () => {
    if (cikariliyor) return;
    setCikariliyor(true);
    try {
      const res = await fetch("/api/kariyer/profil", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serbestMetin: metin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.hata ?? "Profil çıkarılamadı.");
      setProfil(data.profil);
      setOneriler(data.oneriler ?? []);
      setSurum((n) => n + 1);
    } catch (err) {
      addToast((err as Error).message, "error");
    } finally {
      setCikariliyor(false);
    }
  };

  const kaydet = async () => {
    if (kaydediliyor) return;
    setKaydediliyor(true);
    try {
      const res = await fetch("/api/kariyer/profil", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serbestMetin: metin,
          profil,
          sehirler,
          uzaktanOlur: uzaktan,
          asgariMaas: maas.trim() ? Number(maas.replace(/\D/g, "")) : null,
          bildirimEposta: eposta,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.hata ?? "Kaydedilemedi.");
      addToast(
        data.sifirlanan
          ? `Kaydedildi — şehir filtresiyle elenmiş ${data.sifirlanan} ilan yeni şartlarla yeniden bakılacak`
          : "Kaydedildi — bir sonraki taramada bu profil kullanılacak",
        "success"
      );
      onKaydedildi();
    } catch (err) {
      addToast((err as Error).message, "error");
    } finally {
      setKaydediliyor(false);
    }
  };

  /**
   * Profili baştan kurmak için: metin, profil, şehirler ve maaş silinir.
   * E-posta ve "uzaktan olur" kalır — kimlik bilgisi, profil değil. İlanlar ve
   * eşleşmeler de kalır; sıfırlama "beni yeniden anlat" demek, "geçmişi sil" değil.
   */
  const sifirla = async () => {
    if (sifirlaniyor) return;
    if (!window.confirm("Profil silinecek: anlattığın metin, çıkarılan profil, şehirler ve maaş. İlanlar ve eşleşmeler kalır. Devam?")) return;
    setSifirlaniyor(true);
    try {
      const res = await fetch("/api/kariyer/profil", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serbestMetin: "", profil: BOS_PROFIL, sehirler: [], asgariMaas: null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.hata ?? "Sıfırlanamadı.");
      addToast("Profil sıfırlandı — tarayıcı yeni profil kaydedilene kadar bekler", "success");
      onKaydedildi();
    } catch (err) {
      addToast((err as Error).message, "error");
    } finally {
      setSifirlaniyor(false);
    }
  };

  /** Öneriyi "kabul edeceğin işler"e ekler/çıkarır */
  const oneriyiDegistir = (is: string) => {
    const varMi = profil.kabulEder.includes(is);
    setProfil({ ...profil, kabulEder: varMi ? profil.kabulEder.filter((x) => x !== is) : [...profil.kabulEder, is] });
    setSurum((n) => n + 1);
  };

  return (
    <div className="animate-fade-in space-y-4">
      <section className="glass rounded-2xl border border-[var(--border)] p-5">
        <h2 className="text-[14px] font-medium text-white/90">1 · Kendini anlat</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-white/40">
          Eğitimin, yaptığın işler, bildiğin programlar, ne istediğin, ne istemediğin — kendi cümlelerinle.
          Şehir ve maaşı aşağıda ayrıca soruyoruz.
        </p>
        <textarea
          value={metin}
          onChange={(e) => setMetin(e.target.value)}
          rows={6}
          placeholder="Örn: Grafik tasarım mezunuyum, 3 yıl ajansta çalıştım, Photoshop ve Illustrator bilirim. Tasarım ya da sosyal medya işi arıyorum; satış istemem…"
          className="focus-ring mt-3 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 text-[13.5px] leading-relaxed text-white/90 placeholder-white/25"
        />
        <button
          onClick={cikar}
          disabled={cikariliyor || metin.trim().length < 20}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3 text-[13px] font-medium text-[var(--background)] transition-all hover:bg-[var(--accent-light)] disabled:cursor-not-allowed disabled:opacity-30"
        >
          {cikariliyor ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {cikariliyor ? "Okuyorum..." : bos ? "Profili çıkar" : "Metinden yeniden çıkar"}
        </button>
      </section>

      {!bos && (
        <section key={surum} className="glass rounded-2xl border border-[var(--border)] p-5">
          <h2 className="text-[14px] font-medium text-white/90">2 · Seni şöyle anladım</h2>
          <p className="mt-1 text-[12.5px] text-white/40">
            İlanlar buna göre puanlanıyor. Yanlış ya da eksik varsa doğrudan düzelt — her satır bir madde.
          </p>
          <div className="mt-4 space-y-4">
            <Alan etiket="Özet">
              <textarea value={profil.ozet} onChange={(e) => setProfil({ ...profil, ozet: e.target.value })} rows={2} className={girdiSinifi} />
            </Alan>
            <ListeAlani etiket="Yapabildiğin işler" deger={profil.yapabildigi} onChange={(v) => setProfil({ ...profil, yapabildigi: v })} />
            <ListeAlani etiket="Kabul edeceğin işler" deger={profil.kabulEder} onChange={(v) => setProfil({ ...profil, kabulEder: v })} />

            {oneriler.length > 0 && (
              <div className="rounded-xl border border-dashed border-[var(--accent)]/30 bg-[var(--accent)]/[0.04] p-3.5">
                <p className="text-[12.5px] text-white/60">
                  <span className="font-medium text-[var(--accent-light)]">Bunlar da uyabilir.</span> Tıkladığın &quot;kabul
                  edeceğin işler&quot;e eklenir; tıklamadığın yok sayılır.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {oneriler.map((o) => {
                    const secili = profil.kabulEder.includes(o.is);
                    return (
                      <button
                        key={o.is}
                        type="button"
                        onClick={() => oneriyiDegistir(o.is)}
                        title={o.neden}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors ${
                          secili
                            ? "border-[var(--accent)]/50 bg-[var(--accent)]/20 text-[var(--accent-light)]"
                            : "border-white/15 bg-white/[0.04] text-white/60 hover:border-white/30 hover:text-white/85"
                        }`}
                      >
                        {secili ? <Check size={12} /> : <Plus size={12} />}
                        {o.is}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <ListeAlani etiket="İstemediklerin" deger={profil.istemez} onChange={(v) => setProfil({ ...profil, istemez: v })} />
            <ListeAlani etiket="Güçlü yanların" deger={profil.guclu} onChange={(v) => setProfil({ ...profil, guclu: v })} />

            <details className="group rounded-xl border border-[var(--border)] bg-white/[0.02] px-3.5 py-2.5">
              <summary className="cursor-pointer list-none text-[12.5px] text-white/45 transition-colors hover:text-white/75">
                Arama terimleri ({profil.aramaTerimleri.length}) — iş sitelerinde bunlar aranıyor
              </summary>
              <div className="mt-3">
                <ListeAlani
                  etiket="Terimler"
                  aciklama="Her satır bir arama. Türkçe ve İngilizce karışık olabilir; LinkedIn'de İngilizce başlık çok."
                  deger={profil.aramaTerimleri}
                  onChange={(v) => setProfil({ ...profil, aramaTerimleri: v })}
                />
              </div>
            </details>
          </div>
        </section>
      )}

      <section className="glass rounded-2xl border border-[var(--border)] p-5">
        <h2 className="text-[14px] font-medium text-white/90">{bos ? "2" : "3"} · Şartlar</h2>
        <p className="mt-1 text-[12.5px] text-white/40">Bunlar kesin filtre — uymayan ilan hiç değerlendirilmez.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Alan etiket="Şehirler" aciklama="Birden fazla olabilir. Boş bırakırsan her yer.">
              <EtiketGirdisi deger={sehirler} onChange={(v) => setSehirler(sehirleriDogrula(v))} placeholder="Şehir yaz, Enter'a bas" />
            </Alan>
          </div>
          <Alan etiket="Asgari maaş (TL, isteğe bağlı)">
            <input value={maas} onChange={(e) => setMaas(e.target.value)} inputMode="numeric" placeholder="örn. 30000" className={girdiSinifi} />
          </Alan>
          <Alan etiket="Bildirim e-postası">
            <input value={eposta} onChange={(e) => setEposta(e.target.value)} type="email" placeholder="sen@ornek.com" className={girdiSinifi} />
          </Alan>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 sm:col-span-2">
            <input type="checkbox" checked={uzaktan} onChange={(e) => setUzaktan(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            <span className="text-[13px] text-white/80">Uzaktan çalışma olur (şehir dışı ilan uzaktansa geçer)</span>
          </label>
        </div>
      </section>

      <div className="sticky bottom-4 z-10">
        {degisti && !bos && (
          <p className="mb-2 text-center text-[11.5px] text-amber-200/70">Kaydedilmemiş değişiklik var</p>
        )}
        <button
          onClick={kaydet}
          disabled={kaydediliyor || bos || !degisti}
          className="glass flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/15 px-5 py-3 text-[13px] font-medium text-[var(--accent-light)] shadow-lg shadow-black/20 transition-colors hover:bg-[var(--accent)]/25 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {kaydediliyor ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {bos ? "Önce profili çıkar" : degisti ? "Kaydet" : "Kaydedildi"}
        </button>
      </div>

      {satir?.profil && !profilBosMu(satir.profil) && (
        <div className="flex flex-wrap justify-center gap-2 pt-2">
          <button
            type="button"
            onClick={yenidenPuanla}
            disabled={yenideniliyor || !yenidenSayi || degisti}
            title={degisti ? "Önce kaydet" : "Profil değiştiyse eski puanlar eski profile ait; bu düğme onları yeniletir"}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/70 disabled:opacity-40"
          >
            {yenideniliyor ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Son 7 günü yeni profile göre yeniden puanla{yenidenSayi ? ` (${yenidenSayi})` : ""}
          </button>
          <button
            type="button"
            onClick={sifirla}
            disabled={sifirlaniyor}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] text-white/30 transition-colors hover:bg-red-500/10 hover:text-red-200/80 disabled:opacity-40"
          >
            {sifirlaniyor ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
            Profili sıfırla
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Etiket girdisi: Enter ya da virgül ekler, × siler, Backspace boş kutuda
 * sonuncuyu siler. Şehirler için; ablam tek tek yazsın, liste görünsün.
 */
function EtiketGirdisi({ deger, onChange, placeholder }: { deger: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [yazilan, setYazilan] = useState("");
  const ekle = () => {
    const parcalar = yazilan.split(",").map((s) => s.trim()).filter(Boolean);
    if (parcalar.length) onChange([...deger, ...parcalar]);
    setYazilan("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 focus-within:border-[var(--accent)]/40">
      {deger.map((d) => (
        <span key={d} className="flex items-center gap-1 rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 py-1 pl-3 pr-1.5 text-[12.5px] text-[var(--accent-light)]">
          {d}
          <button type="button" onClick={() => onChange(deger.filter((x) => x !== d))} aria-label={`${d} kaldır`} className="rounded-full p-0.5 text-[var(--accent-light)]/60 transition-colors hover:bg-white/10 hover:text-white">
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        value={yazilan}
        onChange={(e) => setYazilan(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            ekle();
          } else if (e.key === "Backspace" && !yazilan && deger.length) {
            onChange(deger.slice(0, -1));
          }
        }}
        onBlur={ekle}
        placeholder={deger.length ? "" : placeholder}
        className="min-w-[10ch] flex-1 bg-transparent px-1 py-0.5 text-[13.5px] text-white/90 placeholder-white/25 outline-none"
      />
    </div>
  );
}

const girdiSinifi =
  "focus-ring w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[13.5px] text-white/90 placeholder-white/25";

function Alan({ etiket, aciklama, children }: { etiket: string; aciklama?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-medium uppercase tracking-wider text-white/35">{etiket}</span>
      {aciklama && <span className="mb-1.5 block text-[12px] text-white/30">{aciklama}</span>}
      {children}
    </label>
  );
}

/**
 * Liste alanı: her satır bir madde. Ablam için en az sürtünmeli düzenleme biçimi.
 * Metin yerel state; dışarıdan yeni profil gelince (yeniden anla) üst bileşen
 * key değiştirerek bu alanı sıfırlıyor — efektle prop'tan state kopyalamak yok.
 */
function ListeAlani({ etiket, aciklama, deger, onChange }: { etiket: string; aciklama?: string; deger: string[]; onChange: (v: string[]) => void }) {
  const [metin, setMetin] = useState(deger.join("\n"));
  return (
    <Alan etiket={etiket} aciklama={aciklama}>
      <textarea
        value={metin}
        onChange={(e) => setMetin(e.target.value)}
        onBlur={() => onChange(metin.split("\n").map((s) => s.trim()).filter(Boolean))}
        rows={Math.max(2, Math.min(6, deger.length + 1))}
        className={girdiSinifi + " resize-y leading-relaxed"}
      />
    </Alan>
  );
}
