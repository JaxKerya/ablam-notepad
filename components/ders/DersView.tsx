"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  PlayCircle,
  SkipForward,
  Send,
  RotateCcw,
  BookOpen,
  Sparkles,
  CircleCheck,
  CircleAlert,
  CircleX,
  MinusCircle,
  ThumbsDown,
  NotebookPen,
  Undo2,
  Dices,
} from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { useToast } from "@/components/Toast";
import {
  DERS_NOTLARI_KLASORU,
  formatSure,
  notlariNotBelgesine,
  skorHesapla,
  slugla,
  soruParcalari,
  videoLinki,
  VERDICT_LABEL,
  VERDICT_STYLE,
  type DersAnswer,
  type DersQuestion,
  type DersSession,
  type Verdict,
} from "@/lib/ders";

interface Props {
  oturum: DersSession;
  sorular: DersQuestion[];
  ilkCevaplar: DersAnswer[];
}

type Mod = "ozet" | "soru" | "sonuc";

/**
 * Soru kökü. Olumsuzluk kelimeleri (değildir, söylenemez, yer almaz…) koyu ve
 * altı çizili basılıyor — ÖSYM'nin basılı kitapçıkta yaptığının aynısı. Sebebi
 * ölçme hatasını azaltmak: soruyu bilen ama "değildir"i atlayan öğrenci bildiği
 * soruyu kaybediyor.
 */
function SoruMetni({ metin, className }: { metin: string; className?: string }) {
  // whitespace-pre-line: öncüllü sorularda soru kökü üç yargıyı alt alta
  // sıralıyor (I. … II. … III. …). Satır sonları korunmazsa hepsi tek paragrafa
  // yapışıyor ve soru okunamaz hâle geliyor.
  return (
    <p className={`whitespace-pre-line ${className ?? ""}`}>
      {soruParcalari(metin).map((p, i) =>
        p.vurgulu ? (
          <strong key={i} className="font-semibold text-white underline decoration-white/40 underline-offset-2">
            {p.metin}
          </strong>
        ) : (
          <span key={i}>{p.metin}</span>
        )
      )}
    </p>
  );
}

const VERDICT_ICON: Record<Verdict, typeof CircleCheck> = {
  dogru: CircleCheck,
  eksik: CircleAlert,
  yanlis: CircleX,
  pas: MinusCircle,
};

export default function DersView({ oturum, sorular: ilkSorular, ilkCevaplar }: Props) {
  const { addToast } = useToast();

  /**
   * PRATİK MODU. Tekrar oturumları bir test değil, bitmeyen bir döngü: tek soru
   * gelir, cevaplanır, "başka soru" denir, bir tane daha gelir. Bu yüzden burada
   * ilerleme çubuğu ve "sonuçları gör" ile biten akış yok.
   */
  const pratik = oturum.tur === "tekrar";

  /**
   * Döngüde eklenen sorular. Sunucudan gelen liste bir prop olduğu için
   * router.refresh() beklemek yerine yeni satırı doğrudan buraya ekliyoruz —
   * böylece "başka soru" anında geçiyor, arada boş ekran olmuyor.
   */
  const [ekSorular, setEkSorular] = useState<DersQuestion[]>([]);

  /**
   * İtiraz sonrası yerel düzeltmeler. Sunucudan gelen liste bir prop olduğu için
   * düzeltilen soruyu burada üzerine yazıyoruz, havuzdan çıkarılanı da buradan
   * eliyoruz — sayfa yenilenmeden sonuç görünüyor.
   */
  const [yenilenenler, setYenilenenler] = useState<Map<string, DersQuestion>>(new Map());
  const [cikarilanlar, setCikarilanlar] = useState<Set<string>>(new Set());

  const sorular = useMemo(
    () =>
      [...ilkSorular, ...ekSorular]
        .filter((s) => !cikarilanlar.has(s.id))
        .map((s) => yenilenenler.get(s.id) ?? s),
    [ilkSorular, ekSorular, yenilenenler, cikarilanlar]
  );
  const [soruGeliyor, setSoruGeliyor] = useState(false);

  const [cevaplar, setCevaplar] = useState<Map<string, DersAnswer>>(
    () => new Map(ilkCevaplar.map((c) => [c.question_id, c]))
  );
  const [mod, setMod] = useState<Mod>(() => {
    // Pratikte özet ekranı yok — düğmeye basan zaten soru istiyor.
    if (oturum.tur === "tekrar") return "soru";
    if (ilkCevaplar.length === 0) return "ozet";
    return ilkCevaplar.length >= ilkSorular.length ? "sonuc" : "soru";
  });
  const [index, setIndex] = useState(() => {
    const cevaplananlar = new Set(ilkCevaplar.map((c) => c.question_id));
    const i = ilkSorular.findIndex((s) => !cevaplananlar.has(s.id));
    // Pratikte hepsi cevaplanmışsa sonuncuda kal; "başka soru" yenisini getirir.
    if (i === -1) return oturum.tur === "tekrar" ? Math.max(0, ilkSorular.length - 1) : 0;
    return i;
  });

  const [metin, setMetin] = useState("");
  const [secim, setSecim] = useState<number | null>(null);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [isaretliler, setIsaretliler] = useState<Set<string>>(
    () => new Set(ilkSorular.filter((s) => s.flagged).map((s) => s.id))
  );
  const [notKaydediliyor, setNotKaydediliyor] = useState(false);
  const [kaydedilenNot, setKaydedilenNot] = useState<string | null>(null);
  // Aynı kimlikte bir not zaten varsa içeriğini VE klasörünü saklıyoruz:
  // "geri al" o notu silmek yerine eski hâline döndürsün, ablamın kendi
  // yazdıkları da taşıdığı klasör de uçmasın.
  const [onceki, setOnceki] = useState<{ content: unknown; folder_id: string | null } | null>(null);

  /**
   * "Soruları tekrar çöz" ile yeniden çözülmek üzere işaretlenen sorular.
   *
   * Cevapları SİLİNMİYOR: değerlendirme ucu (/api/ders/grade) cevabı soru
   * kimliğine göre upsert ediyor, yani yeni cevap eskisinin üstüne yazılıyor.
   * Bu küme yalnızca "ekranda cevaplanmamış gibi görünsün" demek. Ablam
   * yarıda bırakırsa dokunmadığı soruların eski cevapları da duruyor.
   */
  const [tekrarBekleyen, setTekrarBekleyen] = useState<Set<string>>(new Set());

  const soru = sorular[index];
  const kayitliCevap = soru ? cevaplar.get(soru.id) : undefined;
  // Tekrar çözülecek sorular her yerde cevapsız görünsün: giriş açılır, şıklar
  // tıklanabilir olur, sonuç kutusu çıkmaz. Tek yerden dönmesi bunu sağlıyor.
  const mevcutCevap = soru && tekrarBekleyen.has(soru.id) ? undefined : kayitliCevap;

  /**
   * Sorunun videosu. Tekrar oturumlarında sorular farklı derslerden geldiği için
   * oturumun video_id'si soru düzeyinde geçerli değil; eski satırlarda soru
   * düzeyinde video olmadığı için oturumunkine düşülüyor.
   */
  const soruVideosu = (s: DersQuestion) => s.video_id ?? oturum.video_id;

  /**
   * Çoktan seçmelide ablamın işaretlediği şıkkın indeksi; hiçbir şık
   * işaretlenmediyse null.
   *
   * Burada `Number(user_answer)` DOĞRUDAN kullanılamaz: pas geçilen soruda
   * user_answer null oluyor ve `Number(null)` JavaScript'te 0 — yani A şıkkı
   * seçilmiş gibi görünüyordu. Ablam pas geçtiğinde altta "pas geçtin" yazarken
   * A şıkkı kırmızı yanıyordu, sanki onu işaretleyip yanlış yapmış gibi.
   */
  const isaretlenenSik = (() => {
    if (!mevcutCevap) return secim;
    const ham = mevcutCevap.user_answer;
    if (ham === null || ham === undefined || ham.trim() === "") return null;
    const n = Number(ham);
    return Number.isInteger(n) ? n : null;
  })();
  // İlerleme çubuğu bu turu sayıyor: tekrar çözerken 19/19 yazsaydı çubuk
  // dolu başlar, ablam nerede olduğunu göremezdi.
  const cevaplananSayisi = [...cevaplar.keys()].filter((id) => !tekrarBekleyen.has(id)).length;

  const skor = useMemo(() => skorHesapla([...cevaplar.values()]), [cevaplar]);

  const zayifKonular = useMemo(() => {
    const konular = new Map<string, { toplam: number; kotu: number }>();
    for (const s of sorular) {
      const c = cevaplar.get(s.id);
      if (!c || !s.topic) continue;
      const k = konular.get(s.topic) ?? { toplam: 0, kotu: 0 };
      k.toplam += 1;
      if (c.verdict === "yanlis" || c.verdict === "eksik" || c.verdict === "pas") k.kotu += 1;
      konular.set(s.topic, k);
    }
    return [...konular.entries()]
      .filter(([, v]) => v.kotu > 0)
      .sort((a, b) => b[1].kotu - a[1].kotu)
      .map(([ad, v]) => ({ ad, ...v }));
  }, [sorular, cevaplar]);

  const gonder = async (pas = false) => {
    if (!soru || gonderiliyor) return;
    if (!pas && soru.kind === "acik" && !metin.trim()) return;
    if (!pas && soru.kind === "coktan" && secim === null) return;

    setGonderiliyor(true);
    try {
      const res = await fetch("/api/ders/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: soru.id,
          cevap: soru.kind === "acik" ? metin.trim() : undefined,
          secim: soru.kind === "coktan" ? secim : undefined,
          pas,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.hata ?? "Değerlendirilemedi.");

      const yeni: DersAnswer = {
        id: soru.id,
        session_id: oturum.id,
        question_id: soru.id,
        user_answer: soru.kind === "acik" ? metin.trim() : secim !== null ? String(secim) : null,
        verdict: data.verdict as Verdict,
        feedback: data.feedback ?? null,
        missing: Array.isArray(data.missing) ? data.missing : [],
        created_at: new Date().toISOString(),
      };
      setCevaplar((m) => new Map(m).set(soru.id, yeni));
      // Yeniden çözüldü: artık normal cevaplı soru, sonucu görünsün
      setTekrarBekleyen((s) => {
        if (!s.has(soru.id)) return s;
        const yeniKume = new Set(s);
        yeniKume.delete(soru.id);
        return yeniKume;
      });
    } catch (err) {
      addToast((err as Error).message, "error");
    } finally {
      setGonderiliyor(false);
    }
  };

  const sonraki = () => {
    setMetin("");
    setSecim(null);
    if (index + 1 >= sorular.length) {
      setMod("sonuc");
    } else {
      setIndex(index + 1);
    }
  };

  /**
   * Döngünün kendisi: kategoriden bir rastgele soru daha getirir ve ona geçer.
   * Uç, eklenen satırı geri döndürüyor; sayfa yenilenmiyor.
   */
  const baskaSoru = async () => {
    if (soruGeliyor) return;
    setSoruGeliyor(true);
    try {
      const res = await fetch("/api/ders/tekrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: oturum.id, adet: 1 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.hata ?? "Soru getirilemedi.");
      const yeni = (data.sorular ?? []) as DersQuestion[];
      if (!yeni.length) throw new Error("Bu kategoride başka soru kalmadı.");
      setMetin("");
      setSecim(null);
      setEkSorular((e) => [...e, ...yeni]);
      setIndex(sorular.length);
      setMod("soru");
    } catch (err) {
      addToast((err as Error).message, "error");
    } finally {
      setSoruGeliyor(false);
    }
  };

  /**
   * İşareti geri alır — soruyu havuza döndürür.
   *
   * İşaret koyma artık buradan geçmiyor: itiraz gerekçesiyle birlikte alınıp
   * denetime gidiyor (bkz. itiraziGonder). Geri alma tek tıkla kalıyor çünkü
   * yanlışlıkla çıkarılan bir soruyu geri getirmenin denetlenecek bir tarafı yok.
   */
  const isaretiKaldir = async (soruId: string) => {
    setIsaretliler((s) => {
      const yeni = new Set(s);
      yeni.delete(soruId);
      return yeni;
    });

    const { error } = await supabase
      .from("ders_questions")
      .update({ flagged: false })
      .eq("id", soruId);

    if (error) {
      addToast("İşaret kaldırılamadı: " + error.message, "error");
      setIsaretliler((s) => new Set(s).add(soruId));
      return;
    }
    addToast("Soru havuza geri kondu", "info");
  };

  /**
   * SORU İTİRAZI. Ablam soruyu hatalı bulduğunda gerekçesini yazıyor; sunucu
   * önce haklı olup olmadığına karar veriyor, haklıysa soruyu düzeltiyor.
   *
   * İki sonuç var ve ikisinde de soru bir daha aynı hâliyle karşısına çıkmıyor:
   * ya düzeltilmiş hâli geliyor ya da soru havuzdan çıkıyor. Bu, itirazın
   * karşılıksız kalmaması demek — eski davranışta işaret koyuluyor ve soru
   * ertesi pratikte aynen geri geliyordu.
   */
  const [itirazAcik, setItirazAcik] = useState(false);
  const [itirazMetni, setItirazMetni] = useState("");
  const [itirazGidiyor, setItirazGidiyor] = useState(false);

  const itiraziGonder = async () => {
    if (!soru || itirazGidiyor) return;
    setItirazGidiyor(true);
    const soruId = soru.id;
    try {
      const res = await fetch("/api/ders/geri-bildirim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: soruId, metin: itirazMetni.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.hata ?? "Gönderilemedi.");

      setItirazAcik(false);
      setItirazMetni("");
      // Eski cevap sunucuda silindi; ekranda da kalmamalı
      setCevaplar((m) => {
        const yeni = new Map(m);
        yeni.delete(soruId);
        return yeni;
      });
      setMetin("");
      setSecim(null);

      if (data.yenilendi && data.soru) {
        setYenilenenler((m) => new Map(m).set(soruId, { ...soru, ...data.soru }));
        addToast(data.gerekce ?? "Soru düzeltildi", "success");
        return;
      }

      // Düzeltilmedi: soru havuzdan çıktı, ekrandan da çıkıyor
      const kalan = sorular.filter((s) => s.id !== soruId).length;
      setCikarilanlar((s) => new Set(s).add(soruId));
      addToast(data.gerekce ?? "Bu soru bir daha karşına çıkmayacak", "info");

      if (kalan === 0) {
        if (pratik) void baskaSoru();
        else setMod("sonuc");
        return;
      }
      // Çıkarılan soru her zaman o an bakılan soru; liste kayınca aynı indeks
      // bir sonrakini gösteriyor, yalnızca sondaysak geri çekmek gerekiyor.
      setIndex((i) => Math.min(i, kalan - 1));
    } catch (err) {
      addToast((err as Error).message, "error");
    } finally {
      setItirazGidiyor(false);
    }
  };

  /**
   * Dersten çıkarılmış ders notunu not defterine kaydeder — yönlendirme yapmadan,
   * ablam soruların başındayken akışından kopmasın diye. Kaydettikten sonra düğme
   * geri alma düğmesine dönüşür. Notlar mevcut klasör sistemindeki "Ders Notları"
   * klasörüne düşer, böylece ana not listesini doldurmaz.
   *
   * Not, özetin kendisi değil: transkriptten çıkarılmış, bölümlere ayrılmış ve her
   * bölümü videodaki anına bağlanmış bir çalışma materyali. Çıkarma işi istek
   * üzerine yapılıyor (bkz. /api/ders/notes), o yüzden burada bir bekleme var.
   */
  const notaKaydet = async () => {
    if (notKaydediliyor) return;
    setNotKaydediliyor(true);

    const baslik = oturum.title ?? "Ders";
    // Kimliğe video kimliği de giriyor: başlık tek başına yetmiyor. Aynı
    // serinin 48. ve 49. bölümü için model aynı kısa başlığı ("Fatih Sultan
    // Mehmed Dönemi") üretebilir ve ikinci ders birincinin notunu sessizce
    // ezerdi. Aynı videoyu tekrar çalışıp kaydetmek yine üstüne yazar —
    // istenen davranış bu.
    const notId = `ders-${slugla(baslik)}-${oturum.video_id}`;

    try {
      const res = await fetch("/api/ders/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: oturum.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.hata ?? "Ders notu çıkarılamadı.");

      // Klasör yoksa oluştur, varsa onu kullan
      // maybeSingle aynı adda iki klasör varsa HATA döner; kontrol edilmezse
      // mevcut boş kalır ve her kaydetmede yeni bir klasör daha açılırdı.
      const { data: mevcut, error: klasorHatasi } = await supabase
        .from("folders")
        .select("id")
        .eq("name", DERS_NOTLARI_KLASORU)
        .limit(1)
        .maybeSingle();
      if (klasorHatasi) throw new Error(klasorHatasi.message);

      let klasorId: string | null = mevcut?.id ?? null;
      if (!klasorId) {
        const { data: yeni, error } = await supabase
          .from("folders")
          .insert({ name: DERS_NOTLARI_KLASORU })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        klasorId = yeni.id;
      }

      // Üzerine yazmadan önce eskisini al — geri alma bunu geri koyacak.
      // folder_id de saklanıyor: upsert onu da yazıyor, geri alma yalnızca
      // content'i döndürseydi ablamın başka klasöre taşıdığı not
      // "Ders Notları"nda kalırdı.
      const { data: eskiNot } = await supabase
        .from("notes")
        .select("content, folder_id")
        .eq("id", notId)
        .maybeSingle();

      const { error: notHatasi } = await supabase.from("notes").upsert(
        {
          id: notId,
          folder_id: klasorId,
          content: notlariNotBelgesine(baslik, data.notlar, oturum.video_id),
        },
        { onConflict: "id" }
      );
      if (notHatasi) throw new Error(notHatasi.message);

      setOnceki(eskiNot ? { content: eskiNot.content, folder_id: eskiNot.folder_id } : null);
      setKaydedilenNot(notId);
      addToast("Ders notu kaydedildi", "success");
    } catch (err) {
      addToast("Nota kaydedilemedi: " + (err as Error).message, "error");
    } finally {
      setNotKaydediliyor(false);
    }
  };

  /** Kaydetmeyi geri alır: not zaten varsa eski hâline döner, yoksa silinir */
  const kaydetmeyiGeriAl = async () => {
    if (!kaydedilenNot || notKaydediliyor) return;
    setNotKaydediliyor(true);

    const { error } = onceki
      ? await supabase
          .from("notes")
          .update({ content: onceki.content, folder_id: onceki.folder_id })
          .eq("id", kaydedilenNot)
      : await supabase.from("notes").delete().eq("id", kaydedilenNot);
    setNotKaydediliyor(false);

    if (error) {
      addToast("Geri alınamadı: " + error.message, "error");
      return;
    }
    setKaydedilenNot(null);
    setOnceki(null);
    addToast(onceki ? "Not eski hâline döndürüldü" : "Kaydetme geri alındı", "delete");
  };

  /**
   * Soruları baştan çözmeye döner.
   *
   * Önceki hâli yalnızca "sorulara dön"dü: cevaplanmış sorular kilitli
   * geldiği için ablam soruları gözden geçiriyordu, çözmüyordu. Aynı dersi
   * ikinci kez çözmek isteyince yapabileceği tek şey dersi silip yeniden
   * ürettirmekti — hem para hem de geçmişi harcayan bir yol.
   *
   * Cevaplar silinmiyor, yalnızca "yeniden çözülecek" diye işaretleniyor;
   * verilen yeni cevap eskisinin üstüne yazılıyor (bkz. tekrarBekleyen).
   */
  const tekrarCoz = () => {
    setTekrarBekleyen(new Set(cevaplar.keys()));
    setIndex(0);
    setMetin("");
    setSecim(null);
    setMod("soru");
  };

  /**
   * Not kaydetme düğmesi yalnızca SONUÇ ekranında. Notu isteyeceği an, soruları
   * çözüp neyi bilmediğini gördükten sonrasıdır; derse başlamadan önce sunmak
   * hem erken hem de "kendini sına" düğmesiyle dikkat çekişiyordu.
   */
  const notDugmesi = (ekstraSinif = "") => (
    <button
      onClick={kaydedilenNot ? kaydetmeyiGeriAl : notaKaydet}
      disabled={notKaydediliyor}
      className={`flex w-full items-center justify-center gap-2 rounded-xl border px-5 py-3 text-[13px] transition-colors disabled:opacity-40 ${ekstraSinif} ${
        kaydedilenNot
          ? "border-[var(--accent)]/35 bg-[var(--accent)]/[0.07] text-[var(--accent-light)] hover:border-[var(--accent)]/55"
          : "border-[var(--border)] text-white/55 hover:border-[var(--border-hover)] hover:text-white/85"
      }`}
    >
      {notKaydediliyor ? (
        <Loader2 size={14} className="animate-spin" />
      ) : kaydedilenNot ? (
        <Undo2 size={14} />
      ) : (
        <NotebookPen size={14} />
      )}
      {notKaydediliyor && !kaydedilenNot
        ? "Ders notu çıkarılıyor..."
        : kaydedilenNot
          ? "Kaydedildi — geri al"
          : "Ders notu çıkar ve kaydet"}
    </button>
  );

  // ---------------------------------------------------------------- kabuk
  const kabuk = (icerik: React.ReactNode) => (
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
        href="/ders"
        className="glass fixed top-5 left-5 z-20 flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-[13px] text-white/55 transition-all duration-200 hover:border-[var(--border-hover)] hover:text-white/85 sm:top-6 sm:left-7"
      >
        <ArrowLeft size={14} />
        <span>Dersler</span>
      </Link>

      <div className="relative z-10 mx-auto max-w-2xl px-5 pb-20 pt-24 sm:pt-28">{icerik}</div>
    </main>
  );

  // ---------------------------------------------------------------- özet
  if (mod === "ozet") {
    return kabuk(
      <div className="animate-fade-in">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="glow-sm mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)]/10">
            <BookOpen size={24} className="text-[var(--accent)]" />
          </div>
          <h1 className="text-xl font-semibold leading-snug text-white/95">
            {oturum.title ?? "Ders"}
          </h1>
        </div>

        {oturum.summary && (
          <div className="glass rounded-2xl border border-[var(--border)] p-5">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider text-white/35">
              <Sparkles size={12} className="text-[var(--accent)]/70" />
              Bu derste ne anlatıldı
            </h2>
            <p className="text-[13.5px] leading-relaxed text-white/75">{oturum.summary}</p>
          </div>
        )}

        {oturum.topics?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {oturum.topics.map((k) => (
              <span
                key={k}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[12px] text-white/60"
              >
                {k}
              </span>
            ))}
          </div>
        )}

        <button
          onClick={() => setMod("soru")}
          className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3.5 text-sm font-medium text-[var(--background)] shadow-lg shadow-[var(--accent)]/10 transition-all hover:bg-[var(--accent-light)] active:scale-[0.99]"
        >
          Kendini sına
          <ArrowRight size={15} />
        </button>

        <p className="mt-3 text-center text-[11.5px] text-white/30">
          {sorular.length} soru · her cevaptan sonra hemen geri bildirim alacaksın
        </p>
      </div>
    );
  }

  // ---------------------------------------------------------------- sonuç
  if (mod === "sonuc") {
    return kabuk(
      <div className="animate-fade-in">
        <div className="mb-7 flex flex-col items-center text-center">
          {/* Yüzde işareti değil, derslerdeki gibi 100 üzerinden not:
              puan büyük, üzerinden alındığı 100 altında küçük yazılıyor. */}
          <div className="glow-md mb-4 flex h-20 w-20 flex-col items-center justify-center rounded-full border-2 border-[var(--accent)]/30 bg-[var(--accent)]/10">
            <span className="text-2xl font-semibold leading-none text-[var(--accent-light)]">
              {skor.puan}
            </span>
            <span className="mt-1 text-[11.5px] leading-none text-[var(--accent-light)]/55">
              / 100
            </span>
          </div>
          <h1 className="text-xl font-semibold text-white/95">Ders tamamlandı</h1>
          <p className="mt-1.5 text-[13px] text-white/45">{oturum.title ?? "Ders"}</p>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {(
            [
              ["dogru", skor.dogru],
              ["eksik", skor.eksik],
              ["yanlis", skor.yanlis],
              ["pas", skor.pas],
            ] as [Verdict, number][]
          ).map(([v, sayi]) => (
            <div
              key={v}
              className={`rounded-xl border px-2 py-3 text-center ${VERDICT_STYLE[v]}`}
            >
              <div className="text-lg font-semibold">{sayi}</div>
              <div className="mt-0.5 text-[11px] opacity-80">{VERDICT_LABEL[v]}</div>
            </div>
          ))}
        </div>

        {(oturum.denetim?.duzeltilen > 0 || oturum.denetim?.elenen > 0) && (
          <p className="mt-4 text-center text-[11.5px] leading-relaxed text-white/30">
            Bu derste denetim
            {oturum.denetim.duzeltilen > 0 && ` ${oturum.denetim.duzeltilen} cevabı düzeltti`}
            {oturum.denetim.duzeltilen > 0 && oturum.denetim.elenen > 0 && ","}
            {oturum.denetim.elenen > 0 && ` ${oturum.denetim.elenen} soruyu eledi`}.
          </p>
        )}

        {zayifKonular.length > 0 && (
          <div className="glass mt-4 rounded-2xl border border-[var(--border)] p-5">
            <h2 className="mb-3 text-[12px] font-medium uppercase tracking-wider text-white/35">
              Tekrar etmen iyi olur
            </h2>
            <div className="space-y-2">
              {zayifKonular.map((k) => (
                <div key={k.ad} className="flex items-center justify-between gap-3">
                  <span className="text-[13px] text-white/75">{k.ad}</span>
                  <span className="flex-shrink-0 text-[11.5px] text-amber-200/70">
                    {k.kotu}/{k.toplam} soruda takıldın
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Soruların dökümü */}
        <div className="mt-4 space-y-2">
          {sorular.map((s, i) => {
            const c = cevaplar.get(s.id);
            const v = (c?.verdict ?? "pas") as Verdict;
            const Ikon = VERDICT_ICON[v];
            return (
              <div
                key={s.id}
                className="glass rounded-xl border border-[var(--border)] p-3.5"
              >
                <div className="flex items-start gap-2.5">
                  <Ikon
                    size={15}
                    className={`mt-0.5 flex-shrink-0 ${
                      v === "dogru"
                        ? "text-[var(--accent)]"
                        : v === "eksik"
                          ? "text-amber-300"
                          : v === "yanlis"
                            ? "text-red-400"
                            : "text-white/30"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-line text-[13px] leading-relaxed text-white/80">
                      <span className="text-white/30">{i + 1}.</span>{" "}
                      {soruParcalari(s.question).map((p, j) =>
                        p.vurgulu ? (
                          <strong key={j} className="font-semibold text-white/95 underline decoration-white/30 underline-offset-2">
                            {p.metin}
                          </strong>
                        ) : (
                          <span key={j}>{p.metin}</span>
                        )
                      )}
                    </p>
                    {c?.feedback && (
                      <p className="mt-1.5 text-[12px] leading-relaxed text-white/45">
                        {c.feedback}
                      </p>
                    )}
                    <a
                      href={videoLinki(soruVideosu(s), s.start_seconds)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] text-[var(--accent)]/70 transition-colors hover:text-[var(--accent)]"
                    >
                      <PlayCircle size={12} />
                      Videoda {formatSure(s.start_seconds)}
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Ders notu YALNIZCA gerçek derste. Pratik oturumu birden çok dersten
            soru taşıyor ve /api/ders/notes notu oturumun video_id'sinden üretiyor —
            pratikte o alan rastgele bir kaynak videoyu gösterdiği için ortaya
            "Tarih pratiği" başlıklı ama tek bir dersin içeriğini taşıyan bir not
            çıkardı. Yani düğme sadece gereksiz değil, yanlış çalışıyordu. */}
        {!pratik && notDugmesi("mt-6")}

        <div className="mt-2 flex gap-2">
          {/* Pratikte "devam et" yok: bitiren bitirir, yeni pratik ders
              listesindeki "Soru Gönder" ile baştan başlar. */}
          {!pratik && (
            <button
              onClick={tekrarCoz}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-3 text-[13px] text-white/65 transition-colors hover:border-[var(--border-hover)] hover:text-white/90"
            >
              <RotateCcw size={14} />
              Soruları tekrar çöz
            </button>
          )}
          <Link
            href="/ders"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-[13px] font-medium text-[var(--background)] transition-colors hover:bg-[var(--accent-light)]"
          >
            {pratik ? "Derslere dön" : "Yeni ders"}
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- soru
  if (!soru) {
    return kabuk(
      <div className="flex flex-col items-center gap-3 py-10">
        {soruGeliyor ? (
          <>
            <Loader2 size={20} className="animate-spin text-[var(--accent)]/60" />
            <p className="text-[13px] text-white/40">Soru getiriliyor...</p>
          </>
        ) : (
          <>
            <p className="text-center text-[13px] text-white/40">Soru bulunamadı.</p>
            {pratik && (
              <button
                onClick={baskaSoru}
                className="flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-[13px] text-white/65 transition-colors hover:border-[var(--border-hover)]"
              >
                <Dices size={14} />
                Soru getir
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  const verdict = mevcutCevap?.verdict as Verdict | undefined;
  const VerdictIkon = verdict ? VERDICT_ICON[verdict] : null;

  return kabuk(
    <div>
      {/* İlerleme — pratikte "kaçıncı soru" diye bir şey yok, sayaç var */}
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-[11.5px] text-white/35">
          {pratik ? (
            <>
              <span className="flex items-center gap-1.5">
                <Dices size={12} className="text-[var(--accent)]/60" />
                {oturum.kategori ?? "Karışık"} pratiği
              </span>
              <span>
                {cevaplananSayisi} soru çözüldü
                {skor.toplam > 0 && ` · ${skor.dogru} doğru`}
              </span>
            </>
          ) : (
            <>
              <span>
                Soru {index + 1} / {sorular.length}
              </span>
              <span>{cevaplananSayisi} cevaplandı</span>
            </>
          )}
        </div>
        {!pratik && (
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className="h-full rounded-full bg-[var(--accent)]/70 transition-all duration-500"
              style={{ width: `${((index + 1) / sorular.length) * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* Soru kartı */}
      <div key={soru.id} className="animate-fade-in glass rounded-2xl border border-[var(--border)] p-5">
        <div className="mb-3 flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[11px] text-white/45">
              {soru.kind === "acik" ? "Açık uçlu" : "Çoktan seçmeli"}
            </span>
            {soru.topic && (
              <span className="text-[11.5px] text-[var(--accent)]/60">{soru.topic}</span>
            )}
          </div>

          <button
            onClick={() =>
              isaretliler.has(soru.id) ? isaretiKaldir(soru.id) : setItirazAcik((a) => !a)
            }
            title={
              isaretliler.has(soru.id)
                ? "İşareti kaldır, soruyu havuza geri koy"
                : "Bu soru hatalı — nesi bozuk olduğunu yaz"
            }
            aria-label="Bu soruyu hatalı olarak işaretle"
            // h-9/w-9: telefonda parmakla basılabilir bir hedef (26px çok küçüktü)
            className={`-mr-1 -mt-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-colors ${
              isaretliler.has(soru.id)
                ? "bg-amber-400/15 text-amber-300"
                : "text-white/20 hover:bg-white/[0.06] hover:text-white/50"
            }`}
          >
            <ThumbsDown size={14} />
          </button>
        </div>

        <SoruMetni
          metin={soru.question}
          className="text-[15px] font-medium leading-relaxed text-white/95"
        />

        {/* İtiraz kutusu — soru metninin hemen altında, çünkü yazarken soruya
            bakması gerekiyor. Ne olacağı burada açıkça yazıyor: düzeltilirse
            düzeltilmiş hâli gelir, düzeltilmezse soru bir daha çıkmaz. */}
        {itirazAcik && (
          <div className="animate-fade-in mt-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.04] p-3.5">
            <div className="mb-2 flex items-center gap-2 text-[12.5px] font-medium text-amber-200/90">
              <ThumbsDown size={13} />
              Bu soruda ne yanlış?
            </div>
            <textarea
              value={itirazMetni}
              onChange={(e) => setItirazMetni(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") itiraziGonder();
              }}
              rows={3}
              autoFocus
              disabled={itirazGidiyor}
              placeholder="Örn: Doğru cevap C değil, derste D anlatılmıştı."
              className="focus-ring w-full resize-y rounded-lg border border-[var(--border)] bg-black/20 p-3 text-[13px] leading-relaxed text-white/85 placeholder-white/25 disabled:opacity-50"
            />
            <p className="mt-2 text-[11px] leading-relaxed text-white/35">
              Yazdıkların derse bakılarak değerlendirilir. Haklıysan soru düzeltilir;
              düzeltilemezse soru bir daha karşına çıkmaz.
            </p>
            <div className="mt-2.5 flex gap-2">
              <button
                onClick={itiraziGonder}
                disabled={itirazGidiyor}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-400/15 px-4 py-2.5 text-[12.5px] font-medium text-amber-100 transition-colors hover:bg-amber-400/25 disabled:opacity-50"
              >
                {itirazGidiyor ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    Değerlendiriliyor…
                  </>
                ) : (
                  "Gönder"
                )}
              </button>
              <button
                onClick={() => {
                  setItirazAcik(false);
                  setItirazMetni("");
                }}
                disabled={itirazGidiyor}
                className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-[12.5px] text-white/55 transition-colors hover:border-[var(--border-hover)] hover:text-white/85 disabled:opacity-50"
              >
                Vazgeç
              </button>
            </div>
          </div>
        )}

        {/* Cevap alanı */}
        {soru.kind === "acik" ? (
          <textarea
            value={mevcutCevap ? (mevcutCevap.user_answer ?? "") : metin}
            onChange={(e) => setMetin(e.target.value)}
            onKeyDown={(e) => {
              // Uzun metin yazılan bir ekran; fareye uzanmadan gönderebilsin
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                gonder(false);
              }
            }}
            disabled={!!mevcutCevap || gonderiliyor}
            rows={5}
            placeholder="Cevabını kendi cümlelerinle yaz..."
            className="focus-ring mt-4 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 text-[13.5px] leading-relaxed text-white/90 placeholder-white/25 transition-all disabled:opacity-70"
          />
        ) : (
          <div className="mt-4 space-y-2">
            {(soru.choices ?? []).map((sik, i) => {
              const secili = isaretlenenSik === i;
              const dogruSik = !!mevcutCevap && soru.correct_index === i;
              return (
                <button
                  key={i}
                  onClick={() => !mevcutCevap && setSecim(i)}
                  disabled={!!mevcutCevap || gonderiliyor}
                  className={`flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-3 text-left text-[13.5px] leading-relaxed transition-all ${
                    dogruSik
                      ? "border-[var(--accent)]/50 bg-[var(--accent)]/12 text-[var(--accent-light)]"
                      : secili
                        ? mevcutCevap
                          ? "border-red-400/45 bg-red-400/10 text-red-200"
                          : "border-[var(--accent)]/45 bg-[var(--accent)]/10 text-white/95"
                        : "border-[var(--border)] bg-[var(--surface)] text-white/70 hover:border-[var(--border-hover)]"
                  } disabled:cursor-default`}
                >
                  <span className="mt-px flex-shrink-0 font-mono text-[12px] opacity-50">
                    {"ABCDE"[i]})
                  </span>
                  <span>{sik}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Eylemler */}
        {!mevcutCevap ? (
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => gonder(true)}
              disabled={gonderiliyor}
              className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-3 text-[13px] text-white/50 transition-colors hover:border-[var(--border-hover)] hover:text-white/80 disabled:opacity-40"
            >
              <SkipForward size={14} />
              Pas geç
            </button>
            <button
              onClick={() => gonder(false)}
              disabled={
                gonderiliyor ||
                (soru.kind === "acik" ? !metin.trim() : secim === null)
              }
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3 text-[13px] font-medium text-[var(--background)] transition-all hover:bg-[var(--accent-light)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-30"
            >
              {gonderiliyor ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Değerlendiriliyor...
                </>
              ) : (
                <>
                  <Send size={14} />
                  Cevabı gönder
                </>
              )}
            </button>
          </div>
        ) : null}

        {!mevcutCevap && soru.kind === "acik" && (
          <p className="mt-2.5 text-center text-[11px] text-white/25">
            <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px]">
              Ctrl
            </kbd>
            {" + "}
            <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px]">
              Enter
            </kbd>
            {" ile de gönderebilirsin"}
          </p>
        )}
      </div>

      {/* Geri bildirim */}
      {mevcutCevap && verdict && VerdictIkon && (
        <div
          className={`animate-slide-up mt-3 rounded-2xl border p-5 ${VERDICT_STYLE[verdict]}`}
        >
          <div className="flex items-center gap-2">
            <VerdictIkon size={17} />
            <span className="text-[14px] font-semibold">{VERDICT_LABEL[verdict]}</span>
          </div>

          {mevcutCevap.feedback && (
            <p className="mt-2.5 text-[13.5px] leading-relaxed opacity-90">
              {mevcutCevap.feedback}
            </p>
          )}

          {mevcutCevap.missing.length > 0 && (
            <p className="mt-2.5 text-[12.5px] leading-relaxed opacity-75">
              Eksik kalanlar: {mevcutCevap.missing.join(", ")}
            </p>
          )}

          {soru.kind === "acik" && verdict !== "dogru" && soru.answer_key && (
            <div className="mt-3 rounded-xl border border-white/10 bg-[var(--surface)] p-3.5">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wider opacity-60">
                Beklenen cevap
              </p>
              <p className="text-[13px] leading-relaxed opacity-90">{soru.answer_key}</p>
            </div>
          )}

          <a
            href={videoLinki(soruVideosu(soru), soru.start_seconds)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[var(--surface)] px-3 py-2 text-[12px] transition-colors hover:border-white/30"
          >
            <PlayCircle size={13} />
            Bu konu videonun {formatSure(soru.start_seconds)} anında anlatılıyor
          </a>

          {pratik ? (
            // Döngü buradan dönüyor: her basışta kategoriden yeni bir rastgele soru
            <div className="mt-4 flex gap-2">
              <button
                onClick={baskaSoru}
                disabled={soruGeliyor}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/20 bg-black/20 px-5 py-3 text-[13px] font-medium transition-colors hover:bg-[var(--surface-elevated)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {soruGeliyor ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Dices size={14} />
                )}
                Başka soru
              </button>
              <button
                onClick={() => setMod("sonuc")}
                className="flex items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-[13px] transition-colors hover:border-white/30"
              >
                Bitir
              </button>
            </div>
          ) : (
            <button
              onClick={sonraki}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-black/20 px-5 py-3 text-[13px] font-medium transition-colors hover:bg-[var(--surface-elevated)]"
            >
              {index + 1 >= sorular.length ? "Sonuçları gör" : "Sonraki soru"}
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
