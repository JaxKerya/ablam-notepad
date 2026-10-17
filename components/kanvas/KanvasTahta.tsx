"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Circle, Download, Eraser, Grid3x3, Hand, Highlighter, ImagePlus, Loader2,
  Maximize, Minus, MousePointer2, MoveUpRight, Pen, Plus, Redo2, Slash, Square, Type, Undo2, Users,
} from "lucide-react";
import { supabase } from "@/lib/supabase-browser";
import { useToast } from "@/components/Toast";
import { aktifProfil, type Profil } from "@/lib/profil";
import {
  isabet, kutuBirlesimi, kutuIcinde, kutularKesisir, KALINLIKLAR, ogeDogrula, otele, RENK_ADI, RENKLER,
  renkHex, satir, sinirKutusu, yeniKimlik, yeniSira, yuvarla, ZEMIN,
  type Desen, type Kanvas, type Kutu, type Oge, type Renk, type SekilTuru, type Ton,
} from "@/lib/kanvas";
import { ogeCiz, yaziFontu, yaziOlc, zeminCiz, type Kamera } from "./ciz";

/*
 * Ablam Kanvas tahtası. Çizim imperatif: öğeler, kamera ve süren hareket
 * ref'lerde duruyor, her değişiklik bir sonraki animasyon karesinde tuvale
 * çiziliyor. React state'i yalnızca arayüz için (seçili araç, renk, kim burada…).
 *
 * CANLI EŞİTLEME (Supabase Realtime, kanal kanvas-<id>, "broadcast"):
 *   taslak  çizilmekte olan kalem çizgisi — yalnızca yeni noktalar gidiyor
 *   oge     biten ya da değişen öğeler (tam hâli)
 *   sil     silinen öğe kimlikleri
 *   tasi    seçim sürüklenirken önizleme kayması
 *   imlec   farenin yeri (karşı tarafta adıyla görünüyor)
 *   kanvas  ad / zemin değişikliği
 * Kalıcı kayıt kanvas_ogeler tablosunda; yayın kaçarsa (bağlantı koptu, sekme
 * uyudu) yeniden bağlanınca ve sekmeye dönülünce tablo baştan okunuyor.
 */

type Arac = "sec" | "el" | "kalem" | "fosfor" | "silgi" | SekilTuru | "yazi";
const SEKILLER: SekilTuru[] = ["cizgi", "ok", "dikdortgen", "elips"];
const sekilMi = (a: Arac): a is SekilTuru => (SEKILLER as string[]).includes(a);
type KalinlikGrubu = keyof typeof KALINLIKLAR;
const kalinlikGrubu = (a: Arac): KalinlikGrubu | null =>
  a === "kalem" ? "kalem" : a === "fosfor" ? "fosfor" : a === "yazi" ? "yazi" : sekilMi(a) ? "sekil" : null;

const ARACLAR: { arac: Arac; Ikon: typeof Pen; ad: string; tus: string }[] = [
  { arac: "sec", Ikon: MousePointer2, ad: "Seç ve taşı", tus: "V" },
  { arac: "el", Ikon: Hand, ad: "Kaydır", tus: "H" },
  { arac: "kalem", Ikon: Pen, ad: "Kalem", tus: "P" },
  { arac: "fosfor", Ikon: Highlighter, ad: "Fosforlu kalem", tus: "F" },
  { arac: "silgi", Ikon: Eraser, ad: "Silgi", tus: "E" },
  { arac: "cizgi", Ikon: Slash, ad: "Düz çizgi", tus: "L" },
  { arac: "ok", Ikon: MoveUpRight, ad: "Ok", tus: "A" },
  { arac: "dikdortgen", Ikon: Square, ad: "Dikdörtgen", tus: "R" },
  { arac: "elips", Ikon: Circle, ad: "Elips", tus: "O" },
  { arac: "yazi", Ikon: Type, ad: "Yazı", tus: "T" },
];
const TUSLAR: Record<string, Arac> = Object.fromEntries(ARACLAR.map((a) => [a.tus.toLowerCase(), a.arac]));


const EN_AZ_Z = 0.08, EN_COK_Z = 8;
const sinirla = (z: number) => Math.min(EN_COK_Z, Math.max(EN_AZ_Z, z));
/** Yayın sıklıkları (ms). Supabase ücretsiz planı saniyede 100 mesaja izin veriyor; iki kişi çizerken ~30 */
const TASLAK_ARALIK = 50, IMLEC_ARALIK = 70;

/**
 * Karşı taraftan gelen konumlar (imleç, süren çizgi, taşınan seçim) bu kadar
 * GERİDEN oynatılıyor. Mesajlar 50-70 ms arayla ve ağın keyfine göre düzensiz
 * geliyor; her gelişte o noktaya atlamak imleci "kare kare" gösteriyordu
 * (17.10.2026). Biraz geriden oynatınca imleç hep iki bilinen nokta ARASINDA
 * olur ve aradaki yol kare kare doldurulur: sabit hızla kayar, çizgi de imleçle
 * birlikte uzar. Gecikme = en uzun mesaj aralığı + ağ titremesi payı.
 */
const OYNATMA_GECIKMESI = 130;
interface Ornek { t: number; x: number; y: number }

/** Örnekler arasında t anındaki konum (doğrusal ara değer); t sondan büyükse son konum */
function aradeger(o: Ornek[], t: number): Ornek | null {
  if (!o.length) return null;
  if (t <= o[0].t) return o[0];
  for (let i = o.length - 1; i > 0; i--) {
    if (o[i - 1].t <= t) {
      if (t >= o[i].t) return o[i];
      const a = o[i - 1], b = o[i], u = (t - a.t) / (b.t - a.t || 1);
      return { t, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
  }
  return o[o.length - 1];
}

/**
 * Yeni örnek ekler. Karşı taraf bir süre durup yeniden kıpırdadıysa eski konumla
 * yeni konum arasını bütün o bekleme boyunca yavaşça kaymasın diye, yeni
 * hareketin hemen öncesine "eski yerinde duruyordu" örneği konuyor. Eskiler atılıyor.
 */
function ornekEkle(o: Ornek[], yeni: Ornek, aralik: number) {
  const son = o[o.length - 1];
  if (son && yeni.t - son.t > aralik * 2.5) o.push({ t: yeni.t - aralik, x: son.x, y: son.y });
  o.push(yeni);
  while (o.length > 2 && o[1].t < yeni.t - 2000) o.shift();
}
/** Tek yayın mesajı 256 KB'ı geçemez; çok öğeli taşımalar parçalanıyor */
const YAYIN_PARCA = 150_000;

type GeriKaydi =
  | { tur: "ekle"; ogeler: Oge[] }
  | { tur: "sil"; ogeler: Oge[] }
  | { tur: "degis"; once: Oge[]; sonra: Oge[] };

type Islem =
  | { tur: "kaydir"; sx: number; sy: number; kx: number; ky: number }
  | { tur: "ciz"; oge: Extract<Oge, { tur: "kalem" }>; yayinlanan: number; sonYayin: number }
  | { tur: "sekil"; oge: Extract<Oge, { tur: "sekil" }>; sonYayin: number }
  | { tur: "sil"; silinen: Oge[] }
  | { tur: "tasi"; bx: number; by: number; dx: number; dy: number; sonYayin: number }
  | { tur: "kutu"; bx: number; by: number; x: number; y: number; onceki: Set<string> }
  | { tur: "boyut"; once: Extract<Oge, { tur: "resim" }>; oran: number };

interface Yazma { id: string | null; x: number; y: number; metin: string; r: string; b: number; sira: number }
interface Uzak { istemci: string }
/** Karşı tarafın süren çizgisi; kalemde her noktanın oynatılacağı an. bitti: kalıcı hâli geldi, oynatma bitince bırakılacak */
interface UzakTaslak { oge: Oge; zamanlar?: number[]; sonT: number; bitti?: boolean }
/** Karşı tarafın sürüklediği seçim: kayma örnekleri; bitince yeni konumlar oynatma sona erince işleniyor */
interface UzakTasi { idler: Set<string>; ornekler: Ornek[]; son?: Oge[] }
type Durum = "kayitli" | "kaydediliyor" | "hata";

/** Sayfadan ayrılırken kapatılan kanalın kapanışı; yeni kanal bunu bekliyor */
let kanalKaldirma: Promise<unknown> = Promise.resolve();

function olcumBaglami() {
  const c = document.createElement("canvas");
  return c.getContext("2d")!;
}

export default function KanvasTahta({ kanvas }: { kanvas: Kanvas }) {
  const { addToast } = useToast();
  const kanvasId = kanvas.id;

  // ---------------- arayüz durumu
  const [arac, setArac] = useState<Arac>("kalem");
  const [renk, setRenk] = useState<Renk>("m");
  const [kalinlik, setKalinlik] = useState<Record<KalinlikGrubu, number>>({ kalem: 0, fosfor: 1, sekil: 1, yazi: 1 });
  const [ad, setAd] = useState(kanvas.ad);
  const [adDuzenle, setAdDuzenle] = useState(false);
  const [desen, setDesen] = useState<Desen>(kanvas.desen);
  const [ton, setTon] = useState<Ton>(kanvas.ton);
  const [zeminMenusu, setZeminMenusu] = useState(false);
  const [yuzde, setYuzde] = useState(100);
  const [seciliSayi, setSeciliSayi] = useState(0);
  const [geriVar, setGeriVar] = useState({ geri: false, ileri: false });
  const [buradakiler, setBuradakiler] = useState<Uzak[]>([]);
  const [durum, setDurum] = useState<Durum>("kayitli");
  const [bagli, setBagli] = useState(true);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [resimYukleniyor, setResimYukleniyor] = useState(0);
  const [yazma, setYazma] = useState<Yazma | null>(null);
  /** Yazı kutusu kamera değişince yerini korusun diye kamera arayüze de yansıyor */
  const [kamUI, setKamUI] = useState<Kamera>({ x: 0, y: 0, z: 1 });
  const [bosluk, setBosluk] = useState(false);
  const [islemde, setIslemde] = useState(false);

  // ---------------- çizim durumu (ref)
  const tuvalRef = useRef<HTMLCanvasElement>(null);
  const kapRef = useRef<HTMLDivElement>(null);
  const dosyaRef = useRef<HTMLInputElement>(null);
  const yaziRef = useRef<HTMLTextAreaElement>(null);
  const ogeler = useRef(new Map<string, Oge>());
  const sirali = useRef<Oge[]>([]);
  const siraBozuk = useRef(true);
  const kam = useRef<Kamera>({ x: 0, y: 0, z: 1 });
  const boyut = useRef({ w: 0, h: 0, dpr: 1 });
  const islem = useRef<Islem | null>(null);
  const secili = useRef(new Set<string>());
  const geri = useRef<GeriKaydi[]>([]);
  const ileri = useRef<GeriKaydi[]>([]);
  const uzakTaslak = useRef(new Map<string, UzakTaslak>());
  const uzakTasi = useRef(new Map<string, UzakTasi>());
  const imlecler = useRef(new Map<string, { ornekler: Ornek[]; son: number }>());
  const imlecZamanlayici = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imlecim = useRef<{ x: number; y: number } | null>(null);
  const dokunmalar = useRef(new Map<number, { x: number; y: number }>());
  const kistirma = useRef<{ d0: number; z0: number; wx: number; wy: number } | null>(null);
  const kanal = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const kanalHazir = useRef(false);
  const bekleyen = useRef(new Map<string, Oge | null>());
  const kayitZamanlayici = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kayitSuruyor = useRef(false);
  const onizlemeZamanlayici = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sonImlecYayini = useRef(0);
  const kare = useRef(0);
  const baglam = useRef<CanvasRenderingContext2D | null>(null);
  /** Çizim sürerken arka plan (zemin + bitmiş öğeler) bu tuvalde bekliyor; bkz. ciz */
  const katman = useRef<HTMLCanvasElement | null>(null);
  const katmanSurum = useRef(-1);
  const sahneSurum = useRef(0);
  const ayarlar = useRef({ arac, renk, kalinlik, desen, ton, yazmaId: null as string | null });
  const istemci = useRef("");
  const profil = useRef<Profil>("ablam");
  const olcum = useRef<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    ayarlar.current = { arac, renk, kalinlik, desen, ton, yazmaId: yazma?.id ?? null };
  }, [arac, renk, kalinlik, desen, ton, yazma]);

  // ---------------- yardımcılar
  /** Bir sonraki animasyon karesinde çiz (aynı karede birden çok istek tek çizime iner) */
  const cizRef = useRef<() => void>(() => {});
  const istek = useCallback(() => {
    if (!kare.current) kare.current = requestAnimationFrame(() => cizRef.current());
  }, []);

  const ciz = useCallback(() => {
    kare.current = 0;
    const tuval = tuvalRef.current;
    if (!tuval) return;
    // Düşük gecikmeli bağlam: çizim tarayıcının birleştiricisini beklemeden ekrana
    // gidiyor, çizgi fareyi bir kare daha yakından izliyor. Zemin her karede tam
    // boyandığı için saydamlık gerekmiyor (alpha: false da hızlandırıyor).
    const ctx = baglam.current ?? (baglam.current = tuval.getContext("2d", { desynchronized: true, alpha: false }));
    if (!ctx) return;
    const { w, h, dpr } = boyut.current;
    const k = kam.current;
    const { desen, ton, yazmaId } = ayarlar.current;
    const yeniden = () => {
      sahneSurum.current++; // resim yüklendi: önbellekteki arka plan eskidi
      istek();
    };

    if (siraBozuk.current) {
      sirali.current = [...ogeler.current.values()].sort((a, b) => a.sira - b.sira);
      siraBozuk.current = false;
    }
    const gorunur: Kutu = { x0: k.x, y0: k.y, x1: k.x + w / k.z, y1: k.y + h / k.z };

    const is = islem.current;
    const yerelKayma = is?.tur === "tasi" ? is : null;
    // Karşı taraf OYNATMA_GECIKMESI kadar geriden oynatılıyor; oynatılacak örnek
    // kaldıkça bir sonraki kare de isteniyor (devam)
    const simdi = performance.now();
    const an = simdi - OYNATMA_GECIKMESI;
    let devam = false;
    for (const [kim, t] of uzakTasi.current) {
      const son = t.ornekler[t.ornekler.length - 1];
      if (t.son && (!son || an >= son.t)) {
        // Sürükleme bitti ve oynatma son konuma vardı: kalıcı konumlar şimdi işleniyor
        for (const o of t.son) ogeler.current.set(o.id, o);
        uzakTasi.current.delete(kim);
        siraBozuk.current = true;
        sahneSurum.current++;
      } else if (son && an < son.t) devam = true;
    }
    if (siraBozuk.current) {
      sirali.current = [...ogeler.current.values()].sort((a, b) => a.sira - b.sira);
      siraBozuk.current = false;
    }
    const kaymaBul = (id: string) => {
      if (yerelKayma && secili.current.has(id)) return yerelKayma;
      for (const t of uzakTasi.current.values()) {
        if (!t.idler.has(id)) continue;
        const p = aradeger(t.ornekler, an);
        return p ? { dx: p.x, dy: p.y } : null;
      }
      return null;
    };

    /** Zemin + bitmiş öğeler */
    const sahne = (c: CanvasRenderingContext2D) => {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      zeminCiz(c, w, h, k, desen, ton);
      c.setTransform(dpr * k.z, 0, 0, dpr * k.z, -k.x * k.z * dpr, -k.y * k.z * dpr);
      for (const o of sirali.current) {
        // Karşı tarafın henüz oynatılmakta olan çizgisi taslak olarak çiziliyor
        if (o.id === yazmaId || uzakTaslak.current.has(o.id)) continue;
        const kay = kaymaBul(o.id);
        const kutu = sinirKutusu(o);
        const kk = kay ? { x0: kutu.x0 + kay.dx, y0: kutu.y0 + kay.dy, x1: kutu.x1 + kay.dx, y1: kutu.y1 + kay.dy } : kutu;
        if (!kutularKesisir(kk, gorunur)) continue;
        if (kay) {
          c.save();
          c.translate(kay.dx, kay.dy);
          ogeCiz(c, o, ton, yeniden);
          c.restore();
        } else ogeCiz(c, o, ton, yeniden);
      }
    };

    // Çizerken (kalem/şekil) arka plan değişmiyor: bir kez ayrı tuvale çizilip her
    // karede tek parça kopyalanıyor, karede yalnızca süren çizgi hesaplanıyor.
    // Kanvas dolduğunda bile kalem takılmasın diye. Öğe, kamera ya da zemin
    // değişirse (karşı taraf çizdi, resim yüklendi) sahneSurum artıyor ve yenileniyor.
    if ((is?.tur === "ciz" || is?.tur === "sekil") && uzakTasi.current.size === 0) {
      let kat = katman.current;
      if (!kat || kat.width !== tuval.width || kat.height !== tuval.height) {
        kat = document.createElement("canvas");
        kat.width = tuval.width;
        kat.height = tuval.height;
        katman.current = kat;
        katmanSurum.current = -1;
      }
      if (katmanSurum.current !== sahneSurum.current) {
        const kc = kat.getContext("2d", { alpha: false });
        if (kc) sahne(kc);
        katmanSurum.current = sahneSurum.current;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(kat, 0, 0);
      ctx.setTransform(dpr * k.z, 0, 0, dpr * k.z, -k.x * k.z * dpr, -k.y * k.z * dpr);
    } else {
      sahne(ctx);
    }
    for (const [id, u] of uzakTaslak.current) {
      const z = u.zamanlar;
      if (u.oge.tur !== "kalem" || !z) {
        ogeCiz(ctx, u.oge, ton, yeniden, true);
        continue;
      }
      let m = 0;
      while (m < z.length && z[m] <= an) m++;
      if (m >= z.length && u.bitti) {
        // Oynatma bitti; kalıcı hâli zaten öğelerde, bir sonraki karede o çizilir
        uzakTaslak.current.delete(id);
        sahneSurum.current++;
        devam = true;
      }
      if (m < z.length) devam = true;
      m = Math.max(1, m);
      const tamami = m * 2 >= u.oge.veri.n.length;
      const g = tamami ? u.oge : { ...u.oge, veri: { ...u.oge.veri, n: u.oge.veri.n.slice(0, m * 2) } };
      ogeCiz(ctx, g, ton, yeniden, !(tamami && u.bitti));
    }
    if (is?.tur === "ciz") ogeCiz(ctx, is.oge, ton, yeniden, true);
    if (is?.tur === "sekil") ogeCiz(ctx, is.oge, ton, yeniden);

    // Seçim çerçeveleri
    const vurgu = ton === "koyu" ? "rgba(212,228,165,0.9)" : "rgba(70,110,60,0.9)";
    if (secili.current.size) {
      ctx.lineWidth = 1 / k.z;
      ctx.strokeStyle = vurgu;
      ctx.setLineDash([4 / k.z, 3 / k.z]);
      const kutular: Kutu[] = [];
      for (const id of secili.current) {
        const o = ogeler.current.get(id);
        if (!o) continue;
        const b = sinirKutusu(o);
        const d = yerelKayma ? { dx: yerelKayma.dx, dy: yerelKayma.dy } : { dx: 0, dy: 0 };
        const p = 3 / k.z;
        const kb = { x0: b.x0 + d.dx - p, y0: b.y0 + d.dy - p, x1: b.x1 + d.dx + p, y1: b.y1 + d.dy + p };
        kutular.push(kb);
        if (secili.current.size > 1) ctx.strokeRect(kb.x0, kb.y0, kb.x1 - kb.x0, kb.y1 - kb.y0);
      }
      const hepsi = kutuBirlesimi(kutular);
      if (hepsi) {
        ctx.setLineDash([]);
        ctx.lineWidth = 1.5 / k.z;
        ctx.strokeRect(hepsi.x0, hepsi.y0, hepsi.x1 - hepsi.x0, hepsi.y1 - hepsi.y0);
        // Tek resim seçiliyse sağ alt köşede boyut tutamacı
        const tek = secili.current.size === 1 ? ogeler.current.get([...secili.current][0]) : null;
        if (tek?.tur === "resim") {
          const t = 9 / k.z;
          ctx.fillStyle = ZEMIN[ton].zemin;
          ctx.fillRect(hepsi.x1 - t / 2, hepsi.y1 - t / 2, t, t);
          ctx.strokeRect(hepsi.x1 - t / 2, hepsi.y1 - t / 2, t, t);
        }
      }
      ctx.setLineDash([]);
    }
    if (is?.tur === "kutu") {
      ctx.lineWidth = 1 / k.z;
      ctx.strokeStyle = vurgu;
      ctx.fillStyle = ton === "koyu" ? "rgba(212,228,165,0.08)" : "rgba(70,110,60,0.08)";
      const x0 = Math.min(is.bx, is.x), y0 = Math.min(is.by, is.y);
      ctx.fillRect(x0, y0, Math.abs(is.x - is.bx), Math.abs(is.y - is.by));
      ctx.strokeRect(x0, y0, Math.abs(is.x - is.bx), Math.abs(is.y - is.by));
    }

    // Ekran koordinatında: silgi halkası ve karşı tarafın imleci
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const im = imlecim.current;
    if (im && ayarlar.current.arac === "silgi") {
      ctx.strokeStyle = ton === "koyu" ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc((im.x - k.x) * k.z, (im.y - k.y) * k.z, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Karşı tarafın imleci: isimsiz, sıradan bir fare oku (kimin olduğu bilinemiyor:
    // profil seçimi cihazda, yanlış seçilmiş olabilir)
    for (const [, c] of imlecler.current) {
      if (simdi - c.son > 15_000) continue;
      const p = aradeger(c.ornekler, an);
      if (!p) continue;
      if (an < c.ornekler[c.ornekler.length - 1].t) devam = true;
      const sx = (p.x - k.x) * k.z, sy = (p.y - k.y) * k.z;
      if (sx < -40 || sy < -40 || sx > w + 40 || sy > h + 40) continue;
      ctx.save();
      ctx.translate(Math.round(sx) + 0.5, Math.round(sy) + 0.5);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 16.5);
      ctx.lineTo(4.2, 12.6);
      ctx.lineTo(7, 18.8);
      ctx.lineTo(9.7, 17.6);
      ctx.lineTo(7, 11.6);
      ctx.lineTo(12.4, 11.6);
      ctx.closePath();
      ctx.shadowColor = "rgba(0,0,0,0.25)";
      ctx.shadowBlur = 3;
      ctx.shadowOffsetY = 1;
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 1;
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();
    }
    if (devam) istek();
  }, [istek]);

  useEffect(() => {
    cizRef.current = ciz;
  }, [ciz]);

  const kameraDegisti = useCallback(() => {
    sahneSurum.current++;
    istek();
    setKamUI({ ...kam.current });
    setYuzde(Math.round(kam.current.z * 100));
    try {
      localStorage.setItem(`ablam-kanvas-kamera-${kanvasId}`, JSON.stringify(kam.current));
    } catch {
      // depolama kapalı: kamera hatırlanmaz
    }
  }, [istek, kanvasId]);

  const dunya = (sx: number, sy: number) => ({ x: sx / kam.current.z + kam.current.x, y: sy / kam.current.z + kam.current.y });
  const ekranNoktasi = (e: { clientX: number; clientY: number }) => {
    const r = tuvalRef.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  const yakinlastir = useCallback((sx: number, sy: number, z: number) => {
    const k = kam.current;
    const yeniZ = sinirla(z);
    const wx = sx / k.z + k.x, wy = sy / k.z + k.y;
    kam.current = { x: wx - sx / yeniZ, y: wy - sy / yeniZ, z: yeniZ };
    kameraDegisti();
  }, [kameraDegisti]);

  const sigdir = useCallback(() => {
    const kutu = kutuBirlesimi([...ogeler.current.values()].map(sinirKutusu));
    const { w, h } = boyut.current;
    if (!kutu || !w) {
      kam.current = { x: -w / 2, y: -h / 2, z: 1 };
    } else {
      const p = 60;
      const z = sinirla(Math.min(2, (w - p * 2) / Math.max(1, kutu.x1 - kutu.x0), (h - p * 2 - 80) / Math.max(1, kutu.y1 - kutu.y0)));
      kam.current = { x: (kutu.x0 + kutu.x1) / 2 - w / 2 / z, y: (kutu.y0 + kutu.y1) / 2 - h / 2 / z, z };
    }
    kameraDegisti();
  }, [kameraDegisti]);

  const seciliGuncelle = useCallback(() => {
    for (const id of secili.current) if (!ogeler.current.has(id)) secili.current.delete(id);
    setSeciliSayi(secili.current.size);
    istek();
  }, [istek]);

  /** Araç değişince (seç aracı dışında) seçim bırakılıyor */
  const aracSec = useCallback((a: Arac) => {
    setArac(a);
    if (a !== "sec" && secili.current.size) {
      secili.current = new Set();
      seciliGuncelle();
    }
  }, [seciliGuncelle]);

  // ---------------- yayın
  const yayinla = useCallback((event: string, payload: Record<string, unknown>) => {
    if (!kanalHazir.current || !kanal.current) return;
    kanal.current.send({ type: "broadcast", event, payload: { ...payload, istemci: istemci.current } }).catch(() => {});
  }, []);

  const ogeleriYayinla = useCallback((liste: Oge[]) => {
    let parca: Oge[] = [], boy = 0;
    for (const o of liste) {
      const b = JSON.stringify(o).length;
      if (parca.length && boy + b > YAYIN_PARCA) {
        yayinla("oge", { ogeler: parca });
        parca = [];
        boy = 0;
      }
      parca.push(o);
      boy += b;
    }
    if (parca.length) yayinla("oge", { ogeler: parca });
  }, [yayinla]);

  // ---------------- kalıcı kayıt (kuyruk: aynı öğenin art arda değişiklikleri tek yazıma iner)
  const onizlemeKaydet = useCallback(async () => {
    if (onizlemeZamanlayici.current) clearTimeout(onizlemeZamanlayici.current);
    onizlemeZamanlayici.current = null;
    let onizleme: string | null = null;
    try {
      const W = 360, H = 225;
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const ctx = c.getContext("2d")!;
      const { ton } = ayarlar.current;
      ctx.fillStyle = ZEMIN[ton].zemin;
      ctx.fillRect(0, 0, W, H);
      const liste = [...ogeler.current.values()].sort((a, b) => a.sira - b.sira);
      const kutu = kutuBirlesimi(liste.map(sinirKutusu));
      if (kutu) {
        const z = Math.min(1.5, (W - 24) / Math.max(1, kutu.x1 - kutu.x0), (H - 24) / Math.max(1, kutu.y1 - kutu.y0));
        ctx.setTransform(z, 0, 0, z, W / 2 - ((kutu.x0 + kutu.x1) / 2) * z, H / 2 - ((kutu.y0 + kutu.y1) / 2) * z);
        for (const o of liste) ogeCiz(ctx, o, ton, () => {});
      }
      onizleme = c.toDataURL("image/jpeg", 0.72);
    } catch {
      // CORS'suz bir resim tuvali kirlettiyse önizleme atlanır
    }
    await supabase.from("kanvaslar").update({ updated_at: new Date().toISOString(), ...(onizleme ? { onizleme } : {}) }).eq("id", kanvasId);
  }, [kanvasId]);

  const kaydet = useCallback(async () => {
    if (kayitZamanlayici.current) clearTimeout(kayitZamanlayici.current);
    kayitZamanlayici.current = null;
    if (kayitSuruyor.current || !bekleyen.current.size) return;
    kayitSuruyor.current = true;
    const is = new Map(bekleyen.current);
    bekleyen.current.clear();
    const yaz = [...is.values()].filter((o): o is Oge => !!o).map(satir);
    const sil = [...is.entries()].filter(([, o]) => !o).map(([id]) => id);
    let hata = false;
    if (yaz.length) hata = !!(await supabase.from("kanvas_ogeler").upsert(yaz)).error || hata;
    if (sil.length) hata = !!(await supabase.from("kanvas_ogeler").delete().in("id", sil)).error || hata;
    kayitSuruyor.current = false;
    if (hata) {
      // Başarısız olanlar kuyruğa geri (bu arada daha yenisi geldiyse o kalsın)
      for (const [id, o] of is) if (!bekleyen.current.has(id)) bekleyen.current.set(id, o);
      setDurum("hata");
      kayitZamanlayici.current = setTimeout(() => void kaydet(), 3000);
      return;
    }
    if (bekleyen.current.size) {
      kayitZamanlayici.current = setTimeout(() => void kaydet(), 250);
    } else {
      setDurum("kayitli");
      if (!onizlemeZamanlayici.current) onizlemeZamanlayici.current = setTimeout(() => void onizlemeKaydet(), 8000);
    }
  }, [onizlemeKaydet]);

  const kuyruga = useCallback((ekle: Oge[], sil: string[]) => {
    for (const o of ekle) bekleyen.current.set(o.id, o);
    for (const id of sil) bekleyen.current.set(id, null);
    setDurum("kaydediliyor");
    if (!kayitZamanlayici.current) kayitZamanlayici.current = setTimeout(() => void kaydet(), 250);
  }, [kaydet]);

  /** Yerel değişikliğin tek kapısı: tabloya işle, kuyruğa al, yayınla */
  const uygula = useCallback((ekle: Oge[], sil: string[]) => {
    for (const id of sil) ogeler.current.delete(id);
    for (const o of ekle) ogeler.current.set(o.id, o);
    siraBozuk.current = true;
    sahneSurum.current++;
    kuyruga(ekle, sil);
    if (ekle.length) ogeleriYayinla(ekle);
    if (sil.length) yayinla("sil", { idler: sil });
    seciliGuncelle();
  }, [kuyruga, ogeleriYayinla, yayinla, seciliGuncelle]);

  const gecmiseEkle = useCallback((k: GeriKaydi) => {
    geri.current.push(k);
    if (geri.current.length > 200) geri.current.shift();
    ileri.current = [];
    setGeriVar({ geri: true, ileri: false });
  }, []);

  const geriAl = useCallback((yon: "geri" | "ileri") => {
    const kaynak = yon === "geri" ? geri.current : ileri.current;
    const hedef = yon === "geri" ? ileri.current : geri.current;
    const k = kaynak.pop();
    if (!k) return;
    const ters = yon === "geri";
    const kimlikler = k.tur === "degis" ? [] : k.ogeler.map((o) => o.id);
    if (k.tur === "degis") uygula(ters ? k.once : k.sonra, []);
    else if ((k.tur === "ekle") === ters) uygula([], kimlikler); // eklemeyi geri al / silmeyi yinele
    else uygula(k.ogeler, []);
    hedef.push(k);
    setGeriVar({ geri: geri.current.length > 0, ileri: ileri.current.length > 0 });
  }, [uygula]);

  // ---------------- yükleme ve kanal
  /**
   * Yazı kutusunun boyu bu cihazda, bu fontla yeniden ölçülüyor: kayıttaki ölçü
   * yazanın cihazından (ya da font değişmeden önceden) geliyor, seçim çerçevesi
   * ve tıklama alanı yazıya otursun. Yalnızca yerel; kaydedilmiyor.
   */
  const yaziyiOlc = useCallback((o: Oge): Oge => {
    if (o.tur !== "yazi" || !olcum.current) return o;
    const { w, h } = yaziOlc(olcum.current, o.veri.m, o.veri.b);
    return w === o.veri.w && h === o.veri.h ? o : { ...o, veri: { ...o.veri, w, h } };
  }, []);

  const hepsiniYukle = useCallback(async () => {
    const gelen: Oge[] = [];
    for (let bas = 0; ; bas += 1000) {
      const { data, error } = await supabase
        .from("kanvas_ogeler")
        .select("id, kanvas_id, tur, veri, sira, olusturan")
        .eq("kanvas_id", kanvasId)
        .order("sira")
        .range(bas, bas + 999);
      if (error) {
        addToast("Kanvas yüklenemedi; bağlantıyı kontrol et.", "error");
        return false;
      }
      for (const h of data ?? []) {
        const o = ogeDogrula(h);
        if (o) gelen.push(o);
      }
      if (!data || data.length < 1000) break;
    }
    const yeni = new Map(gelen.map((o) => [o.id, yaziyiOlc(o)]));
    // Henüz kaydedilmemiş yerel değişiklikler tablodakinden yeni
    for (const [id, o] of bekleyen.current) {
      if (o) yeni.set(id, o);
      else yeni.delete(id);
    }
    ogeler.current = yeni;
    siraBozuk.current = true;
    sahneSurum.current++;
    seciliGuncelle();
    return true;
  }, [kanvasId, addToast, seciliGuncelle, yaziyiOlc]);

  useEffect(() => {
    istemci.current = yeniKimlik();
    profil.current = aktifProfil();
    olcum.current = olcumBaglami();
    // Yazı fontu (Excalifont) iner inmez yazılar onunla yeniden ölçülüp çizilsin;
    // inmeden çizilenler bir an yedek fontla görünür
    void document.fonts.load(yaziFontu(20), "AaĞğŞşİıÇçÖöÜü0123").then(() => {
      for (const o of ogeler.current.values()) if (o.tur === "yazi") ogeler.current.set(o.id, yaziyiOlc(o));
      siraBozuk.current = true;
      sahneSurum.current++;
      istek();
    });

    let ilk = true;
    // Kapatılan kanalın geç gelen bildirimi yenisini kopuk göstermesin
    // (geliştirmede React etkiyi iki kez kurup söküyor)
    let canli = true;
    const kanalKur = () => {
      const k = supabase.channel(`kanvas-${kanvasId}`, {
        config: { broadcast: { self: false }, presence: { key: istemci.current } },
      });
      const kimden = (p: Record<string, unknown>) => (typeof p.istemci === "string" ? p.istemci : "");

      k.on("broadcast", { event: "oge" }, ({ payload }) => {
        const liste = Array.isArray(payload?.ogeler) ? payload.ogeler : [];
        const kim = kimden(payload);
        const tasima = uzakTasi.current.get(kim);
        const simdi = performance.now();
        for (const h of liste) {
          const o = ogeDogrula(h);
          if (!o || o.kanvas_id !== kanvasId) continue;
          if (tasima && tasima.idler.has(o.id)) {
            // Sürüklemenin kalıcı konumu: önizleme oraya kadar oynatılsın, sonra işlensin
            const eski = ogeler.current.get(o.id);
            if (eski && !tasima.son?.length) {
              const a = sinirKutusu(eski), b = sinirKutusu(o);
              ornekEkle(tasima.ornekler, { t: simdi, x: b.x0 - a.x0, y: b.y0 - a.y0 }, TASLAK_ARALIK);
            }
            (tasima.son ??= []).push(o);
            continue;
          }
          ogeler.current.set(o.id, yaziyiOlc(o));
          const u = uzakTaslak.current.get(o.id);
          if (u?.zamanlar && o.tur === "kalem") {
            // Çizgi bitti ama henüz oynatılıyor: kalıcı hâli taslağa geçsin, oynatma sürsün
            const eksik = o.veri.n.length / 2 - u.zamanlar.length;
            const sonT = u.zamanlar[u.zamanlar.length - 1] ?? simdi;
            for (let i = 0; i < eksik; i++) u.zamanlar.push(sonT);
            u.oge = o;
            u.bitti = true;
          } else uzakTaslak.current.delete(o.id);
        }
        siraBozuk.current = true;
        sahneSurum.current++;
        seciliGuncelle();
      })
        .on("broadcast", { event: "sil" }, ({ payload }) => {
          for (const id of Array.isArray(payload?.idler) ? payload.idler : []) {
            ogeler.current.delete(id);
            uzakTaslak.current.delete(id);
          }
          siraBozuk.current = true;
          sahneSurum.current++;
          seciliGuncelle();
        })
        .on("broadcast", { event: "taslak" }, ({ payload }) => {
          const simdi = performance.now();
          if (payload?.iptal) {
            uzakTaslak.current.delete(payload.id);
          } else if (payload?.oge) {
            const o = ogeDogrula(payload.oge);
            if (o) uzakTaslak.current.set(o.id, { oge: o, sonT: simdi });
          } else if (typeof payload?.id === "string" && Array.isArray(payload.n) && payload.n.length >= 2) {
            const eski = uzakTaslak.current.get(payload.id);
            const oncekiN = eski?.oge.tur === "kalem" && eski.zamanlar && payload.bas > 0 ? eski.oge.veri.n : null;
            const n: number[] = oncekiN ? [...oncekiN, ...payload.n] : payload.n;
            const zamanlar = oncekiN && eski?.zamanlar ? [...eski.zamanlar] : [];
            // Bu paketteki noktalar gönderen tarafta son ~50 ms'de çizildi: o aralığa eşit
            // yayılıyor. Duraklamadan sonra gelen paket bekleme boyunca yayılmasın diye sınırlı.
            const yeniSayi = payload.n.length / 2;
            const onceki = zamanlar[zamanlar.length - 1] ?? simdi - TASLAK_ARALIK;
            const bas = Math.max(onceki, simdi - TASLAK_ARALIK * 1.5);
            const kim = kimden(payload);
            const imlec = imlecler.current.get(kim) ?? { ornekler: [], son: simdi };
            for (let i = 1; i <= yeniSayi; i++) {
              const t = bas + ((simdi - bas) * i) / yeniSayi;
              zamanlar.push(t);
              // Çizerken ayrıca imleç mesajı gelmiyor: imleç çizginin ucunu izliyor
              ornekEkle(imlec.ornekler, { t, x: payload.n[i * 2 - 2], y: payload.n[i * 2 - 1] }, TASLAK_ARALIK);
            }
            imlec.son = simdi;
            imlecler.current.set(kim, imlec);
            uzakTaslak.current.set(payload.id, {
              oge: {
                id: payload.id, kanvas_id: kanvasId, sira: 0, olusturan: null, tur: "kalem",
                veri: {
                  n, r: payload.r, k: payload.k,
                  ...(Number(payload.z) > 0 ? { z: Number(payload.z) } : {}),
                  ...(payload.f ? { f: 1 as const } : {}),
                },
              },
              zamanlar,
              sonT: simdi,
            });
          }
          istek();
        })
        .on("broadcast", { event: "tasi" }, ({ payload }) => {
          const kim = kimden(payload);
          const simdi = performance.now();
          if (payload?.bitti) {
            uzakTasi.current.delete(kim);
          } else {
            let t = uzakTasi.current.get(kim);
            if (!t) {
              // Sürükleme sıfır kaymadan başlıyor
              t = { idler: new Set(payload.idler ?? []), ornekler: [{ t: simdi - TASLAK_ARALIK, x: 0, y: 0 }] };
              uzakTasi.current.set(kim, t);
            }
            ornekEkle(t.ornekler, { t: simdi, x: Number(payload.dx) || 0, y: Number(payload.dy) || 0 }, TASLAK_ARALIK);
          }
          istek();
        })
        .on("broadcast", { event: "imlec" }, ({ payload }) => {
          const kim = kimden(payload);
          if (payload?.yok) {
            imlecler.current.delete(kim);
          } else {
            const simdi = performance.now();
            const c = imlecler.current.get(kim) ?? { ornekler: [], son: simdi };
            ornekEkle(c.ornekler, { t: simdi, x: Number(payload.x), y: Number(payload.y) }, IMLEC_ARALIK);
            c.son = simdi;
            imlecler.current.set(kim, c);
          }
          istek();
        })
        .on("broadcast", { event: "kanvas" }, ({ payload }) => {
          if (typeof payload?.ad === "string") setAd(payload.ad);
          if (payload?.desen) setDesen(payload.desen);
          if (payload?.ton) setTon(payload.ton);
        })
        .on("presence", { event: "sync" }, () => {
          const durum = k.presenceState<{ istemci: string }>();
          const liste: Uzak[] = [];
          for (const kayitlar of Object.values(durum)) {
            const p = kayitlar[0];
            if (p && p.istemci !== istemci.current) liste.push({ istemci: p.istemci });
          }
          // Ayrılanın imleci ve yarım kalan çizgisi kalmasın
          for (const kim of imlecler.current.keys()) if (!liste.some((u) => u.istemci === kim)) imlecler.current.delete(kim);
          setBuradakiler(liste);
          istek();
        })
        .subscribe(async (s, hata) => {
          if (!canli) return;
          if (s !== "SUBSCRIBED") console.warn("[kanvas] canlı kanal:", s, hata?.message ?? "");
          if (s === "SUBSCRIBED") {
            kanalHazir.current = true;
            setBagli(true);
            await k.track({ istemci: istemci.current });
            // İlk bağlantıda da yayın dinlenmeye başladıktan SONRA okunuyor: arada çizilen kaçmasın
            const tamam = await hepsiniYukle();
            if (ilk) {
              ilk = false;
              setYukleniyor(false);
              let kayitli: Kamera | null = null;
              try {
                kayitli = JSON.parse(localStorage.getItem(`ablam-kanvas-kamera-${kanvasId}`) ?? "null");
              } catch {
                kayitli = null;
              }
              if (kayitli && Number.isFinite(kayitli.z)) {
                kam.current = kayitli;
                kameraDegisti();
              } else sigdir();
            }
            if (!tamam) setBagli(false);
          } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
            kanalHazir.current = false;
            setBagli(false);
            if (ilk) {
              // Realtime açılamasa da tahta yerel çalışsın
              ilk = false;
              await hepsiniYukle();
              setYukleniyor(false);
              sigdir();
            }
          }
        });
      kanal.current = k;
    };
    // Aynı adlı kanal eskisi tamamen kapanmadan yeniden açılırsa katılım zaman
    // aşımına düşüyor (TIMED_OUT): önce varsa eskisinin kapanması bekleniyor
    void kanalKaldirma.then(() => {
      if (canli) kanalKur();
    });

    const gorunurluk = () => {
      if (document.visibilityState === "visible") void hepsiniYukle();
      else void kaydet();
    };
    document.addEventListener("visibilitychange", gorunurluk);
    const ayrilirken = () => {
      void kaydet();
    };
    window.addEventListener("pagehide", ayrilirken);
    const temizle = setInterval(() => istek(), 5000); // eskiyen imleçler silinsin

    return () => {
      canli = false;
      document.removeEventListener("visibilitychange", gorunurluk);
      window.removeEventListener("pagehide", ayrilirken);
      clearInterval(temizle);
      kanalHazir.current = false;
      const k = kanal.current;
      kanal.current = null;
      if (k) kanalKaldirma = supabase.removeChannel(k).catch(() => {});
      void kaydet();
    };
    // Kanal sayfa başına bir kez kuruluyor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kanvasId]);

  // ---------------- tuval boyutu
  useEffect(() => {
    // Site geneli kaydırma çubuğuna yer ayırıyor (globals.css scrollbar-gutter);
    // tam ekran tahtada o şerit boş kalıyordu
    const kok = document.documentElement;
    const onceki = kok.style.scrollbarGutter;
    kok.style.scrollbarGutter = "auto";
    document.body.style.overflow = "hidden";
    return () => {
      kok.style.scrollbarGutter = onceki;
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    const kap = kapRef.current, tuval = tuvalRef.current;
    if (!kap || !tuval) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const r = kap.getBoundingClientRect();
      boyut.current = { w: r.width, h: r.height, dpr };
      tuval.width = Math.round(r.width * dpr);
      tuval.height = Math.round(r.height * dpr);
      tuval.style.width = `${r.width}px`;
      tuval.style.height = `${r.height}px`;
      sahneSurum.current++;
      ciz();
    });
    ro.observe(kap);
    return () => ro.disconnect();
  }, [ciz]);

  useEffect(() => {
    sahneSurum.current++;
    istek();
  }, [desen, ton, yazma, istek]);

  // ---------------- yazı
  const yazmaRef = useRef<Yazma | null>(null);
  useEffect(() => {
    yazmaRef.current = yazma;
  }, [yazma]);
  const yaziyiBitir = useCallback(() => {
    // Hem tuvale tıklama hem textarea'nın blur'u çağırabiliyor: ilk çağıran bitirir
    const y = yazmaRef.current;
    if (!y) return;
    yazmaRef.current = null;
    setYazma(null);
    const metin = y.metin.replace(/\s+$/, "");
    const eski = y.id ? ogeler.current.get(y.id) : null;
    if (!metin.trim()) {
      if (eski) {
        uygula([], [eski.id]);
        gecmiseEkle({ tur: "sil", ogeler: [eski] });
      }
      return;
    }
    const { w, h } = yaziOlc(olcum.current!, metin, y.b);
    const oge: Oge = {
      id: y.id ?? yeniKimlik(), kanvas_id: kanvasId, sira: y.sira, olusturan: eski?.olusturan ?? profil.current,
      tur: "yazi", veri: { x: y.x, y: y.y, m: metin, r: y.r, b: y.b, w, h },
    };
    if (eski?.tur === "yazi" && eski.veri.m === metin) return;
    uygula([oge], []);
    gecmiseEkle(eski ? { tur: "degis", once: [eski], sonra: [oge] } : { tur: "ekle", ogeler: [oge] });
  }, [kanvasId, uygula, gecmiseEkle]);

  const yaziAc = useCallback((x: number, y: number, mevcut?: Oge) => {
    if (mevcut?.tur === "yazi") {
      setYazma({ id: mevcut.id, x: mevcut.veri.x, y: mevcut.veri.y, metin: mevcut.veri.m, r: mevcut.veri.r, b: mevcut.veri.b, sira: mevcut.sira });
    } else {
      const { renk, kalinlik } = ayarlar.current;
      const b = KALINLIKLAR.yazi[kalinlik.yazi];
      setYazma({ id: null, x, y: y - (b * 1.3) / 2, metin: "", r: renk, b, sira: yeniSira() });
    }
    setTimeout(() => yaziRef.current?.focus(), 0);
  }, []);

  // ---------------- resim
  const resimEkle = useCallback(async (dosya: File, yer?: { x: number; y: number }) => {
    if (!dosya.type.startsWith("image/")) return;
    setResimYukleniyor((n) => n + 1);
    try {
      const nesne = URL.createObjectURL(dosya);
      const boyutlar = await new Promise<{ w: number; h: number }>((coz, red) => {
        const im = new Image();
        im.onload = () => coz({ w: im.naturalWidth, h: im.naturalHeight });
        im.onerror = () => red(new Error("Resim okunamadı."));
        im.src = nesne;
      });
      URL.revokeObjectURL(nesne);
      const uzanti = (dosya.type.split("/")[1] || "png").replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "");
      const yol = `kanvas/${kanvasId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${uzanti}`;
      const { error } = await supabase.storage.from("AblamAblam").upload(yol, dosya, { cacheControl: "31536000", upsert: false, contentType: dosya.type });
      if (error) throw new Error(error.message);
      const url = supabase.storage.from("AblamAblam").getPublicUrl(yol).data.publicUrl;

      // Ekran görüntüleri genelde 2x: ekrandaki boyutunda gelsin, görünür alanın %60'ını aşmasın
      const k = kam.current, { w: W, h: H, dpr } = boyut.current;
      let w = boyutlar.w / Math.max(1, dpr), h = boyutlar.h / Math.max(1, dpr);
      const sigma = Math.min(1, (W * 0.6) / k.z / w, (H * 0.6) / k.z / h);
      w *= sigma;
      h *= sigma;
      const merkez = yer ?? dunya(W / 2, H / 2);
      const oge: Oge = {
        id: yeniKimlik(), kanvas_id: kanvasId, sira: yeniSira(), olusturan: profil.current,
        tur: "resim", veri: { x: yuvarla(merkez.x - w / 2), y: yuvarla(merkez.y - h / 2), w: yuvarla(w), h: yuvarla(h), u: url },
      };
      uygula([oge], []);
      gecmiseEkle({ tur: "ekle", ogeler: [oge] });
      secili.current = new Set([oge.id]);
      setArac("sec");
      seciliGuncelle();
    } catch (e) {
      addToast(`Resim eklenemedi: ${(e as Error).message}`, "error");
    } finally {
      setResimYukleniyor((n) => n - 1);
    }
  }, [kanvasId, uygula, gecmiseEkle, seciliGuncelle, addToast]);

  // ---------------- işaretçi
  const ustteki = (x: number, y: number) => {
    const pay = 6 / kam.current.z;
    if (siraBozuk.current) {
      sirali.current = [...ogeler.current.values()].sort((a, b) => a.sira - b.sira);
      siraBozuk.current = false;
    }
    for (let i = sirali.current.length - 1; i >= 0; i--) {
      if (isabet(sirali.current[i], x, y, pay)) return sirali.current[i];
    }
    return null;
  };

  const silgiyleSil = (x: number, y: number, is: Extract<Islem, { tur: "sil" }>) => {
    const pay = 9 / kam.current.z;
    const giden: Oge[] = [];
    for (const o of ogeler.current.values()) if (isabet(o, x, y, pay)) giden.push(o);
    if (!giden.length) return;
    is.silinen.push(...giden);
    uygula([], giden.map((o) => o.id));
  };

  const taslakYayinla = (is: Extract<Islem, { tur: "ciz" }>, zorla = false) => {
    const simdi = Date.now();
    if (!zorla && simdi - is.sonYayin < TASLAK_ARALIK) return;
    const n = is.oge.veri.n;
    if (n.length <= is.yayinlanan) return;
    yayinla("taslak", { id: is.oge.id, bas: is.yayinlanan, n: n.slice(is.yayinlanan), r: is.oge.veri.r, k: is.oge.veri.k, z: is.oge.veri.z, f: is.oge.veri.f ?? 0 });
    is.yayinlanan = n.length;
    is.sonYayin = simdi;
  };

  const imleciYayinla = (x: number, y: number) => {
    const gonder = () => {
      imlecZamanlayici.current = null;
      sonImlecYayini.current = Date.now();
      yayinla("imlec", { x: yuvarla(x), y: yuvarla(y) });
    };
    if (imlecZamanlayici.current) clearTimeout(imlecZamanlayici.current);
    const kalan = IMLEC_ARALIK - (Date.now() - sonImlecYayini.current);
    // Aralık dolmadıysa bekletiliyor (atılmıyor): fare durduğunda son konum da gitsin
    if (kalan <= 0) gonder();
    else imlecZamanlayici.current = setTimeout(gonder, kalan);
  };

  const islemiIptalEt = () => {
    const is = islem.current;
    if (is?.tur === "ciz") yayinla("taslak", { id: is.oge.id, iptal: true });
    if (is?.tur === "sekil") yayinla("taslak", { id: is.oge.id, iptal: true });
    if (is?.tur === "sil" && is.silinen.length) gecmiseEkle({ tur: "sil", ogeler: is.silinen });
    if (is?.tur === "tasi") yayinla("tasi", { bitti: true });
    islem.current = null;
    setIslemde(false);
    istek();
  };

  const asagi = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Açık menüyü kapatmak için tahtaya tıklamak çizmesin
    if (zeminMenusu) {
      setZeminMenusu(false);
      return;
    }
    if (yazmaRef.current) {
      yaziyiBitir();
      if (ayarlar.current.arac === "yazi") return;
    }
    const tuval = tuvalRef.current!;
    const { sx, sy } = ekranNoktasi(e);
    const { x, y } = dunya(sx, sy);

    if (e.pointerType === "touch") {
      dokunmalar.current.set(e.pointerId, { x: sx, y: sy });
      if (dokunmalar.current.size === 2) {
        islemiIptalEt();
        const [a, b] = [...dokunmalar.current.values()];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const w = dunya(mx, my);
        kistirma.current = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: kam.current.z, wx: w.x, wy: w.y };
        return;
      }
      if (dokunmalar.current.size > 2) return;
    }
    try {
      tuval.setPointerCapture(e.pointerId);
    } catch {
      // işaretçi bu arada kalktıysa yakalama gerekmiyor
    }
    const { arac, renk, kalinlik } = ayarlar.current;

    if (e.button === 1 || e.button === 2 || bosluk || arac === "el") {
      islem.current = { tur: "kaydir", sx, sy, kx: kam.current.x, ky: kam.current.y };
      setIslemde(true);
      return;
    }
    if (e.button !== 0) return;

    if (arac === "kalem" || arac === "fosfor") {
      const f = arac === "fosfor";
      islem.current = {
        tur: "ciz", yayinlanan: 0, sonYayin: 0,
        oge: { id: yeniKimlik(), kanvas_id: kanvasId, sira: yeniSira(), olusturan: profil.current, tur: "kalem",
          veri: {
            n: [yuvarla(x), yuvarla(y)], r: renk, k: KALINLIKLAR[f ? "fosfor" : "kalem"][kalinlik[f ? "fosfor" : "kalem"]],
            z: Math.round(kam.current.z * 1000) / 1000,
            ...(f ? { f: 1 as const } : {}),
          } },
      };
    } else if (arac === "silgi") {
      const is: Islem = { tur: "sil", silinen: [] };
      islem.current = is;
      silgiyleSil(x, y, is);
    } else if (sekilMi(arac)) {
      islem.current = {
        tur: "sekil", sonYayin: 0,
        oge: { id: yeniKimlik(), kanvas_id: kanvasId, sira: yeniSira(), olusturan: profil.current, tur: "sekil",
          veri: { s: arac, a: [yuvarla(x), yuvarla(y)], b: [yuvarla(x), yuvarla(y)], r: renk, k: KALINLIKLAR.sekil[kalinlik.sekil] } },
      };
    } else if (arac === "yazi") {
      const o = ustteki(x, y);
      // Yazı açılırken işaretçi bırakılınca odak tuvale dönmesin
      e.preventDefault();
      yaziAc(x, y, o?.tur === "yazi" ? o : undefined);
      return;
    } else if (arac === "sec") {
      // Tek resmin boyut tutamacı
      const tekId = secili.current.size === 1 ? [...secili.current][0] : null;
      const tek = tekId ? ogeler.current.get(tekId) : null;
      if (tek?.tur === "resim") {
        const t = 10 / kam.current.z;
        const kx = tek.veri.x + tek.veri.w + 3 / kam.current.z, ky = tek.veri.y + tek.veri.h + 3 / kam.current.z;
        if (Math.abs(x - kx) <= t && Math.abs(y - ky) <= t) {
          islem.current = { tur: "boyut", once: tek, oran: tek.veri.h / tek.veri.w };
          setIslemde(true);
          return;
        }
      }
      const o = ustteki(x, y);
      if (o) {
        if (e.shiftKey) {
          if (secili.current.has(o.id)) secili.current.delete(o.id);
          else secili.current.add(o.id);
        } else if (!secili.current.has(o.id)) secili.current = new Set([o.id]);
        seciliGuncelle();
        if (secili.current.has(o.id)) islem.current = { tur: "tasi", bx: x, by: y, dx: 0, dy: 0, sonYayin: 0 };
      } else {
        const onceki = e.shiftKey ? new Set(secili.current) : new Set<string>();
        if (!e.shiftKey) secili.current = new Set();
        seciliGuncelle();
        islem.current = { tur: "kutu", bx: x, by: y, x, y, onceki };
      }
    }
    setIslemde(true);
    istek();
  };

  const hareket = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { sx, sy } = ekranNoktasi(e);
    if (e.pointerType === "touch" && dokunmalar.current.has(e.pointerId)) {
      dokunmalar.current.set(e.pointerId, { x: sx, y: sy });
      const ks = kistirma.current;
      if (ks && dokunmalar.current.size === 2) {
        const [a, b] = [...dokunmalar.current.values()];
        const z = sinirla(ks.z0 * (Math.hypot(a.x - b.x, a.y - b.y) / ks.d0));
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        kam.current = { x: ks.wx - mx / z, y: ks.wy - my / z, z };
        kameraDegisti();
        return;
      }
    }
    const { x, y } = dunya(sx, sy);
    imlecim.current = { x, y };
    // Çizerken imleç ayrıca gönderilmiyor: karşı taraf çizginin ucunu imleç sayıyor
    if (islem.current?.tur !== "ciz") imleciYayinla(x, y);
    const is = islem.current;
    if (!is) {
      if (ayarlar.current.arac === "silgi") istek();
      return;
    }
    switch (is.tur) {
      case "kaydir":
        kam.current = { ...kam.current, x: is.kx - (sx - is.sx) / kam.current.z, y: is.ky - (sy - is.sy) / kam.current.z };
        kameraDegisti();
        return;
      case "ciz": {
        const olaylar = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
        const r = tuvalRef.current!.getBoundingClientRect();
        const n = is.oge.veri.n;
        for (const ev of olaylar.length ? olaylar : [e.nativeEvent]) {
          const p = dunya(ev.clientX - r.left, ev.clientY - r.top);
          const px = yuvarla(p.x), py = yuvarla(p.y);
          // Aynı noktayı tekrar eklemek çizgiyi kalınlaştırıyor
          if (Math.hypot(px - n[n.length - 2], py - n[n.length - 1]) * kam.current.z < 0.8) continue;
          n.push(px, py);
        }
        is.oge = { ...is.oge, veri: { ...is.oge.veri, n } };
        taslakYayinla(is);
        break;
      }
      case "sekil": {
        let bx = x, by = y;
        const a = is.oge.veri.a;
        if (e.shiftKey) {
          if (is.oge.veri.s === "cizgi" || is.oge.veri.s === "ok") {
            // 15 derecelik adımlara yasla
            const aci = Math.round(Math.atan2(y - a[1], x - a[0]) / (Math.PI / 12)) * (Math.PI / 12);
            const d = Math.hypot(x - a[0], y - a[1]);
            bx = a[0] + d * Math.cos(aci);
            by = a[1] + d * Math.sin(aci);
          } else {
            const d = Math.max(Math.abs(x - a[0]), Math.abs(y - a[1]));
            bx = a[0] + Math.sign(x - a[0] || 1) * d;
            by = a[1] + Math.sign(y - a[1] || 1) * d;
          }
        }
        is.oge = { ...is.oge, veri: { ...is.oge.veri, b: [yuvarla(bx), yuvarla(by)] } };
        if (Date.now() - is.sonYayin > TASLAK_ARALIK) {
          yayinla("taslak", { oge: is.oge });
          is.sonYayin = Date.now();
        }
        break;
      }
      case "sil":
        silgiyleSil(x, y, is);
        break;
      case "tasi":
        is.dx = x - is.bx;
        is.dy = y - is.by;
        if (Date.now() - is.sonYayin > TASLAK_ARALIK) {
          yayinla("tasi", { idler: [...secili.current], dx: is.dx, dy: is.dy });
          is.sonYayin = Date.now();
        }
        break;
      case "kutu": {
        is.x = x;
        is.y = y;
        const kutu = { x0: Math.min(is.bx, x), y0: Math.min(is.by, y), x1: Math.max(is.bx, x), y1: Math.max(is.by, y) };
        const yeni = new Set(is.onceki);
        for (const o of ogeler.current.values()) if (kutuIcinde(sinirKutusu(o), kutu)) yeni.add(o.id);
        secili.current = yeni;
        setSeciliSayi(yeni.size);
        break;
      }
      case "boyut": {
        const v = is.once.veri;
        const w = Math.max(24, x - v.x);
        const guncel = ogeler.current.get(is.once.id);
        if (guncel?.tur === "resim") {
          ogeler.current.set(guncel.id, { ...guncel, veri: { ...guncel.veri, w: yuvarla(w), h: yuvarla(w * is.oran) } });
          siraBozuk.current = true;
          sahneSurum.current++;
        }
        break;
      }
    }
    istek();
  };

  const yukari = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch") {
      dokunmalar.current.delete(e.pointerId);
      if (dokunmalar.current.size < 2) kistirma.current = null;
    }
    const is = islem.current;
    islem.current = null;
    setIslemde(false);
    if (!is) return;
    switch (is.tur) {
      case "ciz": {
        taslakYayinla(is, true);
        uygula([is.oge], []);
        gecmiseEkle({ tur: "ekle", ogeler: [is.oge] });
        break;
      }
      case "sekil": {
        const { a, b } = is.oge.veri;
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) * kam.current.z < 3) {
          yayinla("taslak", { id: is.oge.id, iptal: true });
          break;
        }
        uygula([is.oge], []);
        gecmiseEkle({ tur: "ekle", ogeler: [is.oge] });
        break;
      }
      case "sil":
        if (is.silinen.length) gecmiseEkle({ tur: "sil", ogeler: is.silinen });
        break;
      case "tasi": {
        if (Math.hypot(is.dx, is.dy) * kam.current.z < 1) {
          yayinla("tasi", { bitti: true });
          break;
        }
        const once: Oge[] = [], sonra: Oge[] = [];
        for (const id of secili.current) {
          const o = ogeler.current.get(id);
          if (!o) continue;
          once.push(o);
          sonra.push(otele(o, yuvarla(is.dx), yuvarla(is.dy)));
        }
        uygula(sonra, []);
        gecmiseEkle({ tur: "degis", once, sonra });
        break;
      }
      case "boyut": {
        const son = ogeler.current.get(is.once.id);
        if (son && son !== is.once) {
          uygula([son], []);
          gecmiseEkle({ tur: "degis", once: [is.once], sonra: [son] });
        }
        break;
      }
      case "kutu":
        setSeciliSayi(secili.current.size);
        break;
    }
    istek();
  };

  const ciftTik = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { sx, sy } = ekranNoktasi(e);
    const { x, y } = dunya(sx, sy);
    const o = ustteki(x, y);
    if (o?.tur === "yazi") yaziAc(x, y, o);
    else if (!o && ayarlar.current.arac === "sec") yaziAc(x, y);
  };

  // ---------------- tekerlek (React'in onWheel'i pasif; sayfa kaymasın diye elle)
  useEffect(() => {
    const tuval = tuvalRef.current;
    if (!tuval) return;
    const tekerlek = (e: WheelEvent) => {
      e.preventDefault();
      const r = tuval.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      // Fare tekerleği büyük adımlarla gelir → yakınlaştır; dokunmatik yüzeyin
      // iki parmak kaydırması küçük adımlarla → kaydır. Ctrl (ve yüzeyde kıstırma) her zaman yakınlaştırır.
      const fare = e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 40 && Math.abs(e.deltaX) < 1);
      if (e.ctrlKey || fare) {
        const f = Math.exp(-e.deltaY * (e.ctrlKey && !fare ? 0.01 : 0.0015) * (e.deltaMode === 1 ? 33 : 1));
        yakinlastir(sx, sy, kam.current.z * f);
      } else {
        kam.current = { ...kam.current, x: kam.current.x + e.deltaX / kam.current.z, y: kam.current.y + e.deltaY / kam.current.z };
        kameraDegisti();
      }
    };
    tuval.addEventListener("wheel", tekerlek, { passive: false });
    return () => tuval.removeEventListener("wheel", tekerlek);
  }, [yakinlastir, kameraDegisti]);

  // ---------------- klavye, yapıştırma, bırakma
  const seciliyiSil = useCallback(() => {
    const giden = [...secili.current].map((id) => ogeler.current.get(id)).filter((o): o is Oge => !!o);
    if (!giden.length) return;
    uygula([], giden.map((o) => o.id));
    gecmiseEkle({ tur: "sil", ogeler: giden });
    secili.current = new Set();
    seciliGuncelle();
  }, [uygula, gecmiseEkle, seciliGuncelle]);

  /** Seçiliyken renk ya da kalınlık değişirse seçilenlere uygulanır */
  const seciliyeStil = useCallback((degis: { r?: Renk; kIndeks?: number }) => {
    if (ayarlar.current.arac !== "sec" || !secili.current.size) return;
    const once: Oge[] = [], sonra: Oge[] = [];
    for (const id of secili.current) {
      const o = ogeler.current.get(id);
      if (!o || o.tur === "resim") continue;
      let y: Oge = o;
      if (degis.r) y = { ...y, veri: { ...y.veri, r: degis.r } } as Oge;
      if (degis.kIndeks !== undefined) {
        if (y.tur === "kalem") y = { ...y, veri: { ...y.veri, k: KALINLIKLAR[y.veri.f ? "fosfor" : "kalem"][degis.kIndeks] } };
        else if (y.tur === "sekil") y = { ...y, veri: { ...y.veri, k: KALINLIKLAR.sekil[degis.kIndeks] } };
        else if (y.tur === "yazi") {
          const b = KALINLIKLAR.yazi[degis.kIndeks];
          y = { ...y, veri: { ...y.veri, b, ...yaziOlc(olcum.current!, y.veri.m, b) } };
        }
      }
      once.push(o);
      sonra.push(y);
    }
    if (!sonra.length) return;
    uygula(sonra, []);
    gecmiseEkle({ tur: "degis", once, sonra });
  }, [uygula, gecmiseEkle]);

  useEffect(() => {
    const yaziyorMu = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    const tus = (e: KeyboardEvent) => {
      if (yaziyorMu(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === " ") {
        e.preventDefault();
        setBosluk(true);
        return;
      }
      if (mod && k === "z") {
        e.preventDefault();
        geriAl(e.shiftKey ? "ileri" : "geri");
      } else if (mod && k === "y") {
        e.preventDefault();
        geriAl("ileri");
      } else if (mod && k === "a") {
        e.preventDefault();
        secili.current = new Set(ogeler.current.keys());
        setArac("sec");
        seciliGuncelle();
      } else if (mod && (k === "=" || k === "+")) {
        e.preventDefault();
        yakinlastir(boyut.current.w / 2, boyut.current.h / 2, kam.current.z * 1.25);
      } else if (mod && k === "-") {
        e.preventDefault();
        yakinlastir(boyut.current.w / 2, boyut.current.h / 2, kam.current.z / 1.25);
      } else if (mod && k === "0") {
        e.preventDefault();
        yakinlastir(boyut.current.w / 2, boyut.current.h / 2, 1);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        seciliyiSil();
      } else if (e.key === "Escape") {
        secili.current = new Set();
        seciliGuncelle();
      } else if (!mod && !e.altKey && TUSLAR[k]) {
        aracSec(TUSLAR[k]);
      }
    };
    const birak = (e: KeyboardEvent) => {
      if (e.key === " ") setBosluk(false);
    };
    const yapistir = (e: ClipboardEvent) => {
      if (yaziyorMu(e.target)) return;
      const dosyalar = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!dosyalar.length) return;
      e.preventDefault();
      dosyalar.forEach((f) => void resimEkle(f));
    };
    window.addEventListener("keydown", tus);
    window.addEventListener("keyup", birak);
    window.addEventListener("paste", yapistir);
    return () => {
      window.removeEventListener("keydown", tus);
      window.removeEventListener("keyup", birak);
      window.removeEventListener("paste", yapistir);
    };
  }, [geriAl, seciliGuncelle, yakinlastir, seciliyiSil, resimEkle, aracSec]);

  useEffect(() => {
    istek(); // silgi halkası araç değişince kaybolsun/gelsin
  }, [arac, istek]);

  const birakildi = (e: React.DragEvent) => {
    e.preventDefault();
    const { sx, sy } = ekranNoktasi(e);
    const yer = dunya(sx, sy);
    [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/")).forEach((f) => void resimEkle(f, yer));
  };

  // ---------------- kanvas ayarları
  const meta = useCallback(async (degis: { ad?: string; desen?: Desen; ton?: Ton }) => {
    if (degis.ad !== undefined) setAd(degis.ad);
    if (degis.desen) setDesen(degis.desen);
    if (degis.ton) setTon(degis.ton);
    yayinla("kanvas", degis);
    const { error } = await supabase.from("kanvaslar").update({ ...degis, updated_at: new Date().toISOString() }).eq("id", kanvasId);
    if (error) addToast("Kanvas ayarı kaydedilemedi.", "error");
  }, [kanvasId, yayinla, addToast]);

  const pngIndir = useCallback(() => {
    const liste = [...ogeler.current.values()].sort((a, b) => a.sira - b.sira);
    const kutu = kutuBirlesimi(liste.map(sinirKutusu));
    if (!kutu) {
      addToast("Kanvas boş.", "info");
      return;
    }
    const p = 48;
    const olcek = Math.min(2, 8000 / (kutu.x1 - kutu.x0 + p * 2), 8000 / (kutu.y1 - kutu.y0 + p * 2));
    const c = document.createElement("canvas");
    c.width = Math.ceil((kutu.x1 - kutu.x0 + p * 2) * olcek);
    c.height = Math.ceil((kutu.y1 - kutu.y0 + p * 2) * olcek);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = ZEMIN[ton].zemin;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.setTransform(olcek, 0, 0, olcek, (p - kutu.x0) * olcek, (p - kutu.y0) * olcek);
    for (const o of liste) ogeCiz(ctx, o, ton, () => {});
    try {
      c.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${ad || "kanvas"}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }, "image/png");
    } catch {
      addToast("Resimler yüzünden PNG oluşturulamadı.", "error");
    }
  }, [ad, ton, addToast]);

  // ---------------- arayüz
  const grup = arac === "sec" ? null : kalinlikGrubu(arac);
  const stilGorunur = grup !== null || (arac === "sec" && seciliSayi > 0);
  const koyu = ton === "koyu";
  const imlec = bosluk || arac === "el" ? (islemde ? "grabbing" : "grab")
    : arac === "silgi" ? "none" : arac === "yazi" ? "text" : arac === "sec" ? "default" : "crosshair";
  const yazmaStili = yazma
    ? {
        left: (yazma.x - kamUI.x) * kamUI.z,
        top: (yazma.y - kamUI.y) * kamUI.z,
        fontSize: yazma.b * kamUI.z,
        lineHeight: 1.3,
        color: renkHex(yazma.r, ton),
        font: yaziFontu(yazma.b * kamUI.z),
      }
    : undefined;
  // Çubuklar kendi koyu zeminini taşıyor: açık "kâğıt" tahtada cam yüzey griye dönüp yazıyı soluyordu
  const cubuk = "glass-blur-layer rounded-2xl border border-white/10 bg-[#26332B]/90 shadow-[0_8px_30px_rgba(0,0,0,0.25)]";

  return (
    <div ref={kapRef} className="fixed inset-0 overflow-hidden" style={{ background: ZEMIN[ton].zemin }} onDragOver={(e) => e.preventDefault()} onDrop={birakildi}>
      <canvas
        ref={tuvalRef}
        className="absolute inset-0 touch-none select-none"
        style={{ cursor: imlec }}
        onPointerDown={asagi}
        onPointerMove={hareket}
        onPointerUp={yukari}
        onPointerCancel={yukari}
        onPointerLeave={() => {
          imlecim.current = null;
          if (imlecZamanlayici.current) clearTimeout(imlecZamanlayici.current);
          imlecZamanlayici.current = null;
          yayinla("imlec", { yok: true });
          istek();
        }}
        onDoubleClick={ciftTik}
        onContextMenu={(e) => e.preventDefault()}
      />

      {yazma && (
        <textarea
          ref={yaziRef}
          value={yazma.metin}
          onChange={(e) => {
            const y = { ...yazma, metin: e.target.value };
            yazmaRef.current = y;
            setYazma(y);
          }}
          onBlur={yaziyiBitir}
          onKeyDown={(e) => {
            if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
              e.preventDefault();
              yaziyiBitir();
            }
          }}
          spellCheck={false}
          rows={Math.max(1, yazma.metin.split("\n").length)}
          placeholder="Yaz…"
          className="absolute z-10 resize-none overflow-hidden border border-dashed border-[var(--accent)]/60 bg-transparent p-0 outline-none placeholder:opacity-40"
          style={{ ...yazmaStili, minWidth: 40 * kamUI.z, width: Math.max(40, ...yazma.metin.split("\n").map((s) => s.length + 1)) * yazma.b * 0.62 * kamUI.z }}
        />
      )}

      {/* Sol üst: geri, ad, kayıt durumu, kim burada */}
      <div className="pointer-events-none absolute left-3 right-3 top-3 flex items-start justify-between gap-2 sm:left-4 sm:right-4 sm:top-4">
        <div className={`${cubuk} pointer-events-auto flex min-w-0 items-center gap-1 p-1.5`}>
          <Link href="/kanvas" aria-label="Kanvaslar" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white" onClick={() => void kaydet().then(onizlemeKaydet)}>
            <ArrowLeft size={16} />
          </Link>
          {adDuzenle ? (
            <input
              autoFocus
              defaultValue={ad}
              maxLength={80}
              onBlur={(e) => {
                setAdDuzenle(false);
                const yeni = e.target.value.trim();
                if (yeni && yeni !== ad) void meta({ ad: yeni });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setAdDuzenle(false);
              }}
              className="h-8 w-44 rounded-lg bg-white/[0.06] px-2 text-[13.5px] font-medium text-white outline-none ring-1 ring-[var(--accent)]/40 sm:w-60"
            />
          ) : (
            <button onClick={() => setAdDuzenle(true)} title="Adı değiştir" className="h-8 max-w-[11rem] truncate rounded-lg px-2 text-[13.5px] font-medium text-white/85 transition-colors hover:bg-white/[0.06] sm:max-w-[18rem]">
              {ad}
            </button>
          )}
          <span
            className={`mr-1 hidden h-1.5 w-1.5 shrink-0 rounded-full sm:block ${!bagli || durum === "hata" ? "bg-red-400" : durum === "kaydediliyor" ? "bg-amber-300" : "bg-emerald-300/80"}`}
            title={!bagli ? "Canlı bağlantı yok — çizdiklerin kaydediliyor ama karşı taraf yeniden bağlanınca görecek" : durum === "hata" ? "Kaydedilemedi, tekrar deneniyor" : durum === "kaydediliyor" ? "Kaydediliyor…" : "Kaydedildi"}
          />
          {buradakiler.length > 0 && (
            <span
              className="ml-1 flex items-center gap-1 border-l border-white/10 pl-2 text-[11.5px] tabular-nums text-white/60"
              title={`Bu kanvasta ${buradakiler.length} kişi daha var`}
            >
              <Users size={13} />
              +{buradakiler.length}
            </span>
          )}
        </div>

        {/* Sağ üst: geri al, zemin, PNG */}
        <div className={`${cubuk} pointer-events-auto relative flex shrink-0 items-center gap-0.5 p-1.5`}>
          <IkonDugme ad="Geri al (Ctrl+Z)" onClick={() => geriAl("geri")} pasif={!geriVar.geri}><Undo2 size={16} /></IkonDugme>
          <IkonDugme ad="Yinele (Ctrl+Shift+Z)" onClick={() => geriAl("ileri")} pasif={!geriVar.ileri}><Redo2 size={16} /></IkonDugme>
          <span className="mx-0.5 h-5 w-px bg-white/10" />
          <IkonDugme ad="Zemin" onClick={() => setZeminMenusu((a) => !a)} secili={zeminMenusu}><Grid3x3 size={16} /></IkonDugme>
          <IkonDugme ad="PNG olarak indir" onClick={pngIndir}><Download size={16} /></IkonDugme>
          {zeminMenusu && (
            <div className="glass-blur-layer absolute right-0 top-[calc(100%+8px)] z-20 w-52 rounded-xl border border-white/10 bg-[#26332B]/95 p-2 text-[12.5px] shadow-xl">
              <p className="px-1.5 pb-1 pt-0.5 text-[10.5px] uppercase tracking-[0.12em] text-white/35">Desen</p>
              <div className="grid grid-cols-3 gap-1">
                {(["kareli", "noktali", "bos"] as Desen[]).map((d) => (
                  <button key={d} onClick={() => void meta({ desen: d })} className={`rounded-lg py-1.5 transition-colors ${desen === d ? "bg-[var(--accent)]/15 text-[var(--accent-light)]" : "text-white/60 hover:bg-white/[0.06]"}`}>
                    {d === "kareli" ? "Kareli" : d === "noktali" ? "Noktalı" : "Boş"}
                  </button>
                ))}
              </div>
              <p className="px-1.5 pb-1 pt-2.5 text-[10.5px] uppercase tracking-[0.12em] text-white/35">Zemin</p>
              <div className="grid grid-cols-2 gap-1">
                {(["koyu", "acik"] as Ton[]).map((t) => (
                  <button key={t} onClick={() => void meta({ ton: t })} className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 transition-colors ${ton === t ? "bg-[var(--accent)]/15 text-[var(--accent-light)]" : "text-white/60 hover:bg-white/[0.06]"}`}>
                    <span className="h-3 w-3 rounded-full border border-white/25" style={{ background: ZEMIN[t].zemin }} />
                    {t === "koyu" ? "Tahta" : "Kâğıt"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Alt orta: araçlar + stil */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex flex-col items-center gap-2 px-3 sm:bottom-4">
        {stilGorunur && (
          <div className={`${cubuk} pointer-events-auto flex items-center gap-1 p-1.5`}>
            {RENKLER.map((r) => (
              <button
                key={r}
                aria-label={RENK_ADI[r]}
                title={RENK_ADI[r]}
                onClick={() => {
                  setRenk(r);
                  seciliyeStil({ r });
                }}
                className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${renk === r ? "bg-white/[0.12]" : "hover:bg-white/[0.06]"}`}
              >
                <span className="h-4 w-4 rounded-full" style={{ background: renkHex(r, "koyu"), boxShadow: renk === r ? "0 0 0 2px rgba(255,255,255,0.55)" : "inset 0 0 0 1px rgba(0,0,0,0.25)" }} />
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-white/10" />
            {[0, 1, 2].map((i) => {
              const aktif = grup ? kalinlik[grup] === i : false;
              return (
                <button
                  key={i}
                  aria-label={["İnce", "Orta", "Kalın"][i]}
                  title={["İnce", "Orta", "Kalın"][i]}
                  onClick={() => {
                    if (grup) setKalinlik((k) => ({ ...k, [grup]: i }));
                    seciliyeStil({ kIndeks: i });
                  }}
                  className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${aktif ? "bg-white/[0.12]" : "hover:bg-white/[0.06]"}`}
                >
                  <span className="rounded-full bg-white/80" style={{ width: 4 + i * 3.5, height: 4 + i * 3.5 }} />
                </button>
              );
            })}
            {arac === "sec" && seciliSayi > 0 && (
              <>
                <span className="mx-1 h-5 w-px bg-white/10" />
                <button onClick={seciliyiSil} className="rounded-lg px-2 py-1 text-[12px] text-white/65 transition-colors hover:bg-red-500/15 hover:text-red-200">
                  Sil ({seciliSayi})
                </button>
              </>
            )}
          </div>
        )}
        <div className={`${cubuk} pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto p-1.5`}>
          {ARACLAR.map(({ arac: a, Ikon, ad, tus }, i) => (
            <span key={a} className="flex items-center">
              {(i === 2 || i === 5 || i === 9) && <span className="mx-1 h-5 w-px bg-white/10" />}
              <IkonDugme ad={`${ad} (${tus})`} onClick={() => aracSec(a)} secili={arac === a} buyuk>
                <Ikon size={17} />
              </IkonDugme>
            </span>
          ))}
          <IkonDugme ad="Resim ekle (ya da Ctrl+V ile yapıştır)" onClick={() => dosyaRef.current?.click()} buyuk>
            {resimYukleniyor > 0 ? <Loader2 size={17} className="animate-spin" /> : <ImagePlus size={17} />}
          </IkonDugme>
          <input
            ref={dosyaRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              [...(e.target.files ?? [])].forEach((f) => void resimEkle(f));
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {/* Sağ alt: yakınlık */}
      <div className={`${cubuk} absolute bottom-3 right-3 hidden items-center gap-0.5 p-1.5 sm:bottom-4 sm:right-4 md:flex`}>
        <IkonDugme ad="Uzaklaş (Ctrl+-)" onClick={() => yakinlastir(boyut.current.w / 2, boyut.current.h / 2, kam.current.z / 1.25)}><Minus size={15} /></IkonDugme>
        <button onClick={() => yakinlastir(boyut.current.w / 2, boyut.current.h / 2, 1)} title="%100 (Ctrl+0)" className="h-8 w-12 rounded-lg text-[12px] tabular-nums text-white/70 transition-colors hover:bg-white/[0.06]">
          %{yuzde}
        </button>
        <IkonDugme ad="Yakınlaş (Ctrl++)" onClick={() => yakinlastir(boyut.current.w / 2, boyut.current.h / 2, kam.current.z * 1.25)}><Plus size={15} /></IkonDugme>
        <IkonDugme ad="Hepsini göster" onClick={sigdir}><Maximize size={15} /></IkonDugme>
      </div>

      {yukleniyor && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: ZEMIN[ton].zemin }}>
          <Loader2 size={20} className={`animate-spin ${koyu ? "text-white/40" : "text-black/30"}`} />
        </div>
      )}
    </div>
  );
}

function IkonDugme({ ad, onClick, secili, pasif, buyuk, children }: {
  ad: string; onClick: () => void; secili?: boolean; pasif?: boolean; buyuk?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      aria-label={ad}
      title={ad}
      onClick={onClick}
      disabled={pasif}
      aria-pressed={secili}
      className={`flex shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-30 ${buyuk ? "h-9 w-9" : "h-8 w-8"} ${
        secili ? "bg-[var(--accent)]/18 text-[var(--accent-light)]" : "text-white/60 hover:bg-white/[0.08] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
