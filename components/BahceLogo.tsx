"use client";

import { useEffect, useRef } from "react";
import { logoFontu } from "@/lib/fontlar";

/**
 * BAHÇE LOGOSU — yazının harflerinden gövdeler uzayıp güller açıyor.
 *
 * Kaynak: Type Garden (type-garden.vercel.app), Akshat Agarwal. Sitenin "Copy
 * code" düğmesiyle alınan çizim kodu buraya taşındı; çizim ve büyüme mantığı
 * (vine, grow, gen, rose, leaf, render) olabildiğince aslına yakın. Atılanlar:
 * klavyeyle yazma, canlı ziyaretçiler (Supabase), kelebekler, afiş modu,
 * PNG/SVG dışa aktarma. Eklenenler: yazı kendiliğinden "yazılıyor", sonra
 * bahçe nefes alıyor (aslındaki "Breathe" salınımı).
 *
 * Font: aslı ticari GT Ultra Fine; burada Google Fonts'tan Playfair Display Bold
 * (Türkçe harfleri de var). Sitenin "Copy code" çıktısının önerdiği yedek de bu.
 *
 * HER AÇILIŞTA AYNI BAHÇE: rastgelelik yazıdan türetilen tohumla. Logo bir
 * marka; her girişte başka bir bahçe çıkması "ne değişti?" dedirtirdi.
 *
 * KELEBEK. Aslındaki kelebek (butterfly, drawFlies) sayfada geziyor: büyüme
 * bitince kenardan girer, süzülür, ara sıra logodaki açılmış bir güle konar,
 * fare yaklaşınca ürküp kaçar. Sayfanın ÜST BÖLÜMÜNE ait (logo + ilk ekran):
 * aşağı kaydırınca orada kalıp ekrandan çıkar, yukarı dönünce yine oradadır —
 * ekrana sabitlenmesi istenmedi. Tıklamayı geçiren ayrı bir tuvalde; yalnızca
 * logonun olduğu ana ekranlarda (soru, deneme ve not ekranlarında logo yok,
 * kelebek de yok — ablamın kararı, 07.10.2026).
 *
 * Performans: görünmezken (sekme arkada, logo ekran dışı) çizim duruyor; büyüme
 * bittikten sonra kare hızı yarıya iniyor (salınım yavaş, 30 fps yetiyor).
 * "Hareketi azalt" (prefers-reduced-motion) BİLEREK yok sayılıyor: Windows'ta
 * "Animasyon efektleri" kapalıyken tarayıcı bunu bildiriyor ve logo durağan
 * kalıyordu; hareket logonun kendisi, istenen de bu (07.10.2026).
 */


/** Bahçenin renkleri. Varsayılan: sitenin adaçayı yeşili temasına uyan "yosun" paleti */
export interface BahcePaleti {
  /** gül yaprakları */
  cicek: string;
  /** gövde, yaprak, diken */
  govde: string;
  /** gülün içindeki kıvrım çizgileri */
  cizgi: string;
  /** harfler */
  yazi: string;
  /** yaprak damarı — zemine yakın bir ton, yaprağı ortadan "keser" */
  damar: string;
}

export const BAHCE_PALETI: BahcePaleti = {
  cicek: "#F29E8E",
  govde: "#24392A",
  cizgi: "#FFF1EA",
  yazi: "#F0F2ED",
  damar: "#5C735D",
};

/**
 * Her modülün kendi gül rengi: aynı bahçe dili, farklı kimlik. Gövde, yazı ve
 * zemin tonları ortak (sitenin adaçayı teması); yalnızca çiçek ve içindeki
 * kıvrım çizgisi değişiyor. Kelebeğin kanat benekleri de çiçek rengini alıyor.
 * Çizgi rengi her çiçekte okunacak kadar ayrık seçildi: açık çiçekte (sarı)
 * koyu, koyu çiçekte açık.
 */
export const MODUL_PALETLERI = {
  notepad: { cicek: "#F0C75E", cizgi: "#8A6418" },
  ders: { cicek: "#F29E8E", cizgi: "#FFF1EA" },
  sheets: { cicek: "#F4AE6A", cizgi: "#FFF3E2" },
  kariyer: { cicek: "#C3A6EE", cizgi: "#F7F0FF" },
  youtube: { cicek: "#E35D4E", cizgi: "#FFDCD5" },
} satisfies Record<string, Partial<BahcePaleti>>;

type Nokta = [number, number];
interface Dilim {
  u0: number;
  u1: number;
  layer: number;
}
interface Govde {
  t: "stem";
  id: number;
  pts: Nokta[];
  segs: Dilim[];
  d0: number;
  dur: number;
  w: number;
  thorns: { u: number; s: number }[];
}
interface Yaprak {
  t: "leaf";
  id: number;
  x: number;
  y: number;
  a: number;
  L: number;
  bend: number;
  layer: number;
  d0: number;
}
interface Gul {
  t: "rose";
  id: number;
  x: number;
  y: number;
  R: number;
  rot: number;
  ph1: number;
  ph2: number;
  turns: number;
  layer: number;
  d0: number;
}
type Oge = Govde | Yaprak | Gul;
interface Harf {
  ch: string;
  id: number;
  birth: number;
  tb: number;
  ws: number;
  wi: number;
  prev: Harf | null;
  els: Oge[];
  endEls: Oge[] | null;
  tend: Govde[];
  cut: number | null;
  x: number;
  y: number;
  tw: number;
  lean: Nokta;
}
interface KelimeAyari {
  roseP: number;
  leafy: number;
  dens: number;
  lean: number;
  big: number;
  curvy: number;
  bridgeP: number;
  w: number;
}
interface Fircalar {
  fill: (p: Nokta[], col: string) => void;
  stroke: (p: Nokta[], col: string, w: number) => void;
  text: (ch: string, x: number, y: number, S: number, col: string, alpha: number) => void;
}

// ---------------------------------------------------------------- matematik
const h = (n: number) => {
  const x = Math.sin(n) * 43758.5453;
  return x - Math.floor(x);
};
const spr = (t: number, k = 7, w = 16) => (t <= 0 ? 0 : 1 - Math.exp(-t * k) * Math.cos(t * w));
const eo = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3));
function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function bez(a: Nokta, b: Nokta, c: Nokta, d: Nokta, n: number): Nokta[] {
  const P: Nokta[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      u = 1 - t;
    P.push([
      u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
      u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
    ]);
  }
  return P;
}
function at(P: Nokta[], u: number): [Nokta, number] {
  const n = P.length;
  const i = Math.min(n - 2, Math.max(1, Math.round(u * (n - 1))));
  return [P[i], Math.atan2(P[i + 1][1] - P[i - 1][1], P[i + 1][0] - P[i - 1][0])];
}
function jit(id: number, f: number, amp: number): [number, number, number] {
  if (!amp) return [0, 0, 0];
  return [
    (h(id * 1.37 + f * 7.13) * 2 - 1) * amp,
    (h(id * 2.71 + f * 3.11) * 2 - 1) * amp,
    (h(id * 5.3 + f * 1.7) * 2 - 1) * 0.035,
  ];
}
function yol(c: CanvasRenderingContext2D, p: Nokta[], kapali: boolean) {
  const n = p.length;
  if (n < 2) return;
  const m = (a: Nokta, b: Nokta): Nokta => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (kapali) {
    const s = m(p[n - 1], p[0]);
    c.moveTo(s[0], s[1]);
    for (let i = 0; i < n; i++) {
      const q = m(p[i], p[(i + 1) % n]);
      c.quadraticCurveTo(p[i][0], p[i][1], q[0], q[1]);
    }
    c.closePath();
  } else {
    c.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < n - 1; i++) {
      const q = m(p[i], p[i + 1]);
      c.quadraticCurveTo(p[i][0], p[i][1], q[0], q[1]);
    }
    c.lineTo(p[n - 1][0], p[n - 1][1]);
  }
}
function vine(base: Nokta, dir: number, len: number, amp: number, waves: number, ph: number, bend: number, n = 40): Nokta[] {
  const P: Nokta[] = [[base[0], base[1]]],
    step = len / n;
  let x = base[0],
    y = base[1];
  for (let i = 1; i <= n; i++) {
    const u = i / n,
      a = dir + bend * u + amp * Math.sin(u * Math.PI * waves + ph) * Math.min(1, u * 3);
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
    P.push([x, y]);
  }
  return P;
}
function curl(P: Nokta[], sign: number, rad: number): Nokta[] {
  const n = P.length,
    e = P[n - 1],
    a = Math.atan2(e[1] - P[n - 2][1], e[0] - P[n - 2][0]);
  const c: Nokta = [e[0] - Math.sin(a) * sign * rad, e[1] + Math.cos(a) * sign * rad];
  const a0 = Math.atan2(e[1] - c[1], e[0] - c[0]);
  for (let i = 1; i <= 14; i++) {
    const u = i / 14,
      t = a0 + sign * u * Math.PI * 1.6,
      rr = rad * (1 - 0.5 * u);
    P.push([c[0] + Math.cos(t) * rr, c[1] + Math.sin(t) * rr]);
  }
  return P;
}
/** Gövde harfin önünden ve arkasından geçerek "örülüyor": dilim dilim katman */
function weave(r: () => number, startLayer: number): Dilim[] {
  const cuts: number[] = [];
  const nc = 1 + Math.floor(r() * 3);
  for (let i = 0; i < nc; i++) cuts.push(0.15 + r() * 0.7);
  cuts.sort((a, b) => a - b);
  const segs: Dilim[] = [];
  let u0 = 0,
    layer = startLayer;
  for (const c of cuts) {
    if (c <= u0) continue;
    segs.push({ u0, u1: c, layer });
    if (r() < 0.3) {
      const g = 0.02 + r() * 0.03;
      u0 = Math.min(0.98, c + g);
    } else u0 = c;
    layer = 1 - layer;
  }
  segs.push({ u0, u1: 1, layer });
  return segs;
}
function layerAt(segs: Dilim[], u: number) {
  for (const s of segs) if (u >= s.u0 && u <= s.u1) return s.layer;
  return segs[segs.length - 1].layer;
}
/** Yazıdan sabit bir tohum: aynı yazı her açılışta aynı bahçe */
function tohumla(metin: string) {
  let x = 2166136261;
  for (const ch of metin) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  return x >>> 0;
}

export default function BahceLogo({
  metin,
  yukseklik = 150,
  palet,
  className,
}: {
  metin: string;
  /** Tuvalin yüksekliği (px). Yazı bunun ~%27'si; geri kalanı bahçeye yer. */
  yukseklik?: number;
  palet?: Partial<BahcePaleti>;
  className?: string;
}) {
  const kapRef = useRef<HTMLDivElement>(null);
  const tuvalRef = useRef<HTMLCanvasElement>(null);
  const paletAnahtari = JSON.stringify(palet ?? {});

  useEffect(() => {
    const kap = kapRef.current,
      tuval = tuvalRef.current;
    if (!kap || !tuval) return;
    const g = tuval.getContext("2d");
    if (!g) return;
    const C = { ...BAHCE_PALETI, ...(JSON.parse(paletAnahtari) as Partial<BahcePaleti>) };
    const F = logoFontu.style.fontFamily;
    const rand = rng(tohumla(metin));

    let W = 0,
      H = 0,
      dpr = 1,
      S = 0;
    let olcu: Record<string, number> = {};
    let harfler: Harf[] = [];
    const fa: Record<number, Nokta> = {};
    let fareX: number | null = null,
      fareY = 0;
    let uid = 1;

    const mw = (ch: string) => {
      if (olcu[ch] != null) return olcu[ch];
      g.font = `700 100px ${F}`;
      let w = g.measureText(ch).width / 100;
      if (ch === " ") w *= 1.4;
      return (olcu[ch] = w);
    };

    // ------------------------------------------------------------ büyüme
    const wordParams = (ws: number): KelimeAyari => {
      const r = rng(ws * 7 + 13);
      return {
        roseP: 0.3 + r() * 0.3,
        leafy: 0.6 + r() * 0.8,
        dens: 1,
        lean: (r() - 0.5) * 0.6,
        big: 0.85 + r() * 0.45,
        curvy: 0.8 + r() * 0.6,
        bridgeP: Math.min(0.95, 0.45 + r() * 0.35),
        w: 0.5,
      };
    };
    interface Filiz {
      base?: Nokta;
      dir?: number;
      len?: number;
      d0: number;
      tip?: string | null;
      depth?: number;
      layer0?: number;
      pts?: Nokta[];
    }
    const grow = (r: () => number, E: Oge[], nid: () => number, p: KelimeAyari, o: Filiz): Nokta[] => {
      const tip = o.tip || (r() < p.roseP ? "rose" : r() < 0.45 ? "fan" : r() < 0.6 ? "leaf" : "curl");
      let P =
        o.pts ||
        vine(o.base!, o.dir!, o.len!, (0.35 + r() * 0.45) * p.curvy, 1 + r() * 1.6, r() * 6.28, (r() - 0.5) * 1.2, 40);
      if (tip === "curl") P = curl(P, r() < 0.5 ? -1 : 1, 0.05 + r() * 0.05);
      const segs = weave(r, o.layer0 != null ? o.layer0 : r() < 0.5 ? 0 : 1);
      const dur = Math.max(320, (o.len || 0.8) * 620);
      const thorns: { u: number; s: number }[] = [];
      const nt = Math.floor(r() * 2.5);
      for (let i = 0; i < nt; i++) thorns.push({ u: 0.15 + r() * 0.65, s: r() < 0.5 ? -1 : 1 });
      E.push({ t: "stem", id: nid(), pts: P, segs, d0: o.d0, dur, w: o.depth ? 0.82 : 1, thorns });
      const nl = Math.floor(r() * 2.8 * p.leafy);
      let sd = r() < 0.5 ? -1 : 1;
      for (let i = 0; i < nl; i++) {
        const u = 0.25 + r() * 0.6,
          [q, a] = at(P, u);
        sd = -sd;
        E.push({
          t: "leaf",
          id: nid(),
          x: q[0],
          y: q[1],
          a: a + sd * (0.55 + r() * 0.5),
          L: (0.14 + r() * 0.2) * (o.depth ? 0.8 : 1),
          bend: (r() - 0.5) * 1.2,
          layer: layerAt(segs, u),
          d0: o.d0 + dur * u,
        });
      }
      const [tp, ta] = at(P, 1),
        td = o.d0 + dur * 0.8,
        tl = layerAt(segs, 1);
      if (tip === "rose") {
        const R = (0.13 + r() * 0.15) * p.big * (o.depth ? 0.75 : 1);
        // okunurluk: harfin gövdesine denk gelen gül çoğunlukla arkada kalır
        const over = tp[1] > -0.78 && tp[1] < 0.05 && Math.abs(tp[0]) < p.w * 0.5;
        const layer = over ? (r() < 0.22 ? 1 : 0) : r() < 0.6 ? 1 : tl;
        E.push({ t: "rose", id: nid(), x: tp[0], y: tp[1], R, rot: (r() - 0.5) * 1.0, ph1: r() * 6.28, ph2: r() * 6.28, turns: 1.8 + r() * 1, layer, d0: td });
        if (r() < 0.2) {
          const oo = ta + (r() < 0.5 ? 1 : -1) * 1.3;
          E.push({
            t: "rose",
            id: nid(),
            x: tp[0] + Math.cos(oo) * R * 1.4,
            y: tp[1] + Math.sin(oo) * R * 1.4,
            R: R * (0.6 + r() * 0.3),
            rot: (r() - 0.5) * 1.2,
            ph1: r() * 6.28,
            ph2: r() * 6.28,
            turns: 1.8 + r(),
            layer,
            d0: td + 120,
          });
        }
      } else if (tip === "fan") {
        const spread = 0.6 + r() * 0.3;
        for (let j = 0; j < 2; j++)
          E.push({ t: "leaf", id: nid(), x: tp[0], y: tp[1], a: ta + (j - 0.5) * spread, L: 0.2 + r() * 0.2, bend: (j - 0.5) * 0.8, layer: tl, d0: td + j * 60 });
      } else if (tip === "leaf") {
        E.push({ t: "leaf", id: nid(), x: tp[0], y: tp[1], a: ta + (r() - 0.5) * 0.3, L: 0.16 + r() * 0.16, bend: r() - 0.5, layer: tl, d0: td });
      }
      if (!o.depth && r() < 0.3) {
        const u = 0.35 + r() * 0.35,
          [q, a] = at(P, u);
        grow(r, E, nid, p, {
          base: q,
          dir: a + (r() < 0.5 ? -1 : 1) * (0.7 + r() * 0.4),
          len: (o.len || 0.8) * (0.35 + r() * 0.2),
          d0: o.d0 + dur * u,
          depth: 1,
          layer0: layerAt(segs, u),
        });
      }
      return P;
    };
    const gen = (l: Harf) => {
      const r = rng((l.ws ^ Math.imul(l.wi + 1, 2654435761)) + Math.floor(rand() * 1e6));
      const p = wordParams(l.ws),
        E: Oge[] = [];
      let k0 = 0;
      const nid = () => l.id * 100 + k0++;
      const w = mw(l.ch),
        inX = () => (r() - 0.5) * w * 0.7;
      p.w = w;
      const nUp = 1 + (r() < 0.45 * p.dens ? 1 : 0);
      for (let i = 0; i < nUp; i++) {
        grow(r, E, nid, p, {
          base: [inX(), -r() * 0.3],
          dir: -Math.PI / 2 + p.lean * 0.5 + (r() - 0.5) * 0.7,
          len: 0.6 + r() * 0.5,
          d0: 40 + i * 130,
          tip: l.wi === 0 && i === 0 ? "rose" : null,
        });
      }
      if (r() < 0.4 * p.dens) grow(r, E, nid, p, { base: [inX(), -0.1 - r() * 0.35], dir: Math.PI / 2 + (r() - 0.5) * 0.8, len: 0.35 + r() * 0.35, d0: 160 });
      if (l.prev && r() < p.bridgeP) {
        const px = -(mw(l.prev.ch) + w) / 2;
        const a: Nokta = [inX(), -0.05 - r() * 0.55],
          b: Nokta = [px + (r() - 0.5) * 0.25, -0.05 - r() * 0.55];
        const bulge = (r() < 0.55 ? -1 : 1) * (0.4 + r() * 0.4),
          dx = b[0] - a[0];
        let P = bez(a, [a[0] + dx * 0.15, a[1] + bulge], [b[0] - dx * 0.15, b[1] + bulge * 0.9], b, 40);
        if (r() < 0.45) P = P.slice(0, Math.floor(P.length * (0.7 + r() * 0.2)));
        grow(r, E, nid, p, { pts: P, len: Math.abs(dx) + Math.abs(bulge), d0: 90, tip: r() < 0.5 ? "curl" : r() < 0.5 ? "leaf" : "rose" });
      }
      if (l.wi === 0) grow(r, E, nid, p, { base: [-w * 0.3, -0.15 - r() * 0.4], dir: Math.PI + (r() - 0.5) * 1.2, len: 0.45 + r() * 0.3, d0: 120, tip: "curl" });
      l.els = E;
      l.endEls = null;
      const T: Oge[] = [],
        tr = rng(l.id * 977 + Math.floor(rand() * 1e6));
      grow(tr, T, () => l.id * 100 + 90 + T.length, p, { base: [w * 0.25, -0.1 - tr() * 0.45], dir: (tr() - 0.5) * 1.4, len: 0.45 + tr() * 0.25, d0: 0, tip: "curl", depth: 1 });
      l.tend = T.filter((e): e is Govde => e.t === "stem").slice(0, 1);
    };
    const genEnd = (l: Harf, rel: number) => {
      const r = rng(l.ws + l.wi * 31 + Math.floor(rand() * 1e6)),
        p = wordParams(l.ws),
        E: Oge[] = [];
      let k0 = 50;
      const nid = () => l.id * 100 + k0++;
      const w = mw(l.ch),
        n = 1 + Math.floor(r() * 2.5);
      p.w = w;
      for (let i = 0; i < n; i++) {
        const dir = -Math.PI / 2 + 0.6 + (i - (n - 1) / 2) * 0.9 + (r() - 0.5) * 0.4;
        grow(r, E, nid, p, { base: [(r() - 0.2) * w * 0.6, -r() * 0.5], dir, len: 0.4 + r() * 0.45, d0: rel + 40 + i * 90, depth: 1, tip: i === 0 || r() < 0.5 ? "rose" : "fan" });
      }
      l.endEls = E;
    };

    /**
     * Yazıyı "yazar": aslında klavyeden gelen harf harf ekleme, burada zamanlanmış.
     * Boşluk bir önceki kelimenin gövdelerini keser ve ucuna son gülleri açtırır
     * (aslındaki "space cuts").
     */
    const ARALIK = 105,
      GECIKME = 250;
    const yaz = (t0: number) => {
      harfler = [];
      uid = 1;
      let last: Harf | null = null;
      [...metin].forEach((ch, i) => {
        const now = t0 + i * ARALIK;
        if (ch === " ") {
          if (last && last.ch !== " ") {
            last.cut = now;
            genEnd(last, now - last.birth);
          }
          last = { ch: " ", id: uid++, birth: now, tb: now, ws: 0, wi: 0, prev: null, els: [], endEls: null, tend: [], cut: null, x: 0, y: 0, tw: 0, lean: [0, 0] };
          harfler.push(last);
          return;
        }
        const same = !!last && last.ch !== " ";
        const l: Harf = {
          ch,
          id: uid++,
          birth: now,
          tb: now,
          ws: same && last ? last.ws : Math.floor(rand() * 1e9),
          wi: same && last ? last.wi + 1 : 0,
          prev: same ? last : null,
          els: [],
          endEls: null,
          tend: [],
          cut: null,
          x: 0,
          y: 0,
          tw: 0,
          lean: [0, 0],
        };
        gen(l);
        harfler.push(l);
        last = l;
      });
    };

    /** Tek satır, ortalı. Bahçenin çoğu yazının üstünde: taban çizgisi yüksekliğin %62'sinde */
    const yerlestir = () => {
      const genislikler = harfler.map((l) => mw(l.ch));
      const birim = genislikler.reduce((a, b) => a + b, 0);
      S = Math.min(H * 0.27, birim > 0 ? (W * 0.82) / birim : H * 0.27);
      let x = W / 2 - (birim * S) / 2;
      const y = H * 0.62;
      harfler.forEach((l, i) => {
        const w = genislikler[i] * S;
        l.x = x + w / 2;
        l.y = y;
        l.tw = w;
        x += w;
      });
    };

    // ------------------------------------------------------------ çizim
    const strokeRange = (B: Fircalar, P: Nokta[], a: number, b: number, col: string, w: number) => {
      const n = P.length - 1,
        ia = a * n,
        ib = b * n;
      const lerp = (t: number): Nokta => {
        const i = Math.min(n - 1, Math.floor(t)),
          f = t - i;
        return [P[i][0] + (P[i + 1][0] - P[i][0]) * f, P[i][1] + (P[i + 1][1] - P[i][1]) * f];
      };
      const pts = [lerp(ia)];
      for (let i = Math.floor(ia) + 1; i < ib; i++) pts.push(P[i]);
      pts.push(lerp(ib));
      if (pts.length >= 2) B.stroke(pts, col, w);
    };
    const thorn = (B: Fircalar, P: Nokta[], u: number, s: number) => {
      const [p, a] = at(P, u),
        d = a + s * 2.3,
        L = S * 0.045;
      B.stroke([p, [p[0] + Math.cos(d) * L, p[1] + Math.sin(d) * L]], C.govde, S * 0.022);
    };
    const leaf = (B: Fircalar, bx: number, by: number, a: number, L: number, bend: number) => {
      if (L < 0.5) return;
      const ca = Math.cos(a),
        sa = Math.sin(a),
        px = -sa,
        py = ca;
      const ax = (u: number): Nokta => {
        const b = Math.sin(Math.PI * u) * bend * 0.15 * L;
        return [bx + ca * u * L + px * b, by + sa * u * L + py * b];
      };
      const hw = (u: number) => L * 0.18 * Math.sin(Math.PI * Math.pow(u, 0.8));
      const N = 12,
        s1: Nokta[] = [],
        s2: Nokta[] = [];
      for (let i = 0; i <= N; i++) {
        const u = i / N,
          c = ax(u),
          w = hw(u);
        s1.push([c[0] + px * w, c[1] + py * w]);
        s2.push([c[0] - px * w, c[1] - py * w]);
      }
      const tip = ax(1),
        base = ax(0);
      B.fill([base, ...s1.slice(1, N), tip, tip, ...s2.slice(1, N).reverse(), base], C.govde);
      if (L > 6) {
        const v: Nokta[] = [];
        for (let i = 0; i <= 8; i++) v.push(ax(0.08 + (0.72 * i) / 8));
        B.stroke(v, C.damar, Math.max(0.8, L * 0.03));
      }
    };
    const rose = (B: Fircalar, cx: number, cy: number, R: number, rot: number, e: Gul, a: number, tl: Nokta | null) => {
      const cr = Math.cos(rot),
        sr = Math.sin(rot);
      const tm = tl ? Math.hypot(tl[0], tl[1]) : 0,
        ux = tm && tl ? tl[0] / tm : 0,
        uy = tm && tl ? tl[1] / tm : 0,
        sq = -0.28 * tm;
      const T = (x: number, y: number, z = 0): Nokta => {
        let dx = x * cr - y * sr,
          dy = x * sr + y * cr;
        if (tm && tl) {
          const k = (dx * ux + dy * uy) * sq;
          dx += k * ux + tl[0] * R * z;
          dy += k * uy + tl[1] * R * z;
        }
        return [cx + dx, cy + dy];
      };
      // taç yaprakları, arkadan öne: [cx, cy, rx, ry, açı, derinlik, kenar]
      const P = [
        [0, -0.36, 0.56, 0.54, 0, 0, 0],
        [-0.5, -0.06, 0.6, 0.6, -0.35, 0, 0],
        [0.52, -0.06, 0.6, 0.6, 0.35, 0, 0],
        [-0.42, 0.3, 0.62, 0.48, 0.2, 0.12, 1],
        [0.47, 0.3, 0.62, 0.48, -0.2, 0.12, 1],
        [0.05, 0.42, 0.56, 0.38, 0, 0.14, 0],
      ];
      const ax0 = 0,
        ay0 = 0.5,
        lw = Math.max(0.8, R * 0.045),
        st = 85;
      P.forEach((q, i) => {
        const s = spr((a - i * st) / 1000, 8, 14);
        if (s <= 0.001) return;
        const open = (1 - Math.min(1, s)) * (q[0] < 0 ? 0.5 : -0.5),
          ang = q[4] + open,
          ca = Math.cos(ang),
          sa = Math.sin(ang);
        const pt = (th: number) => {
          const rr = 1 + 0.08 * Math.sin(3 * th + e.ph1 + i) + 0.04 * Math.sin(5 * th + e.ph2);
          const lx = Math.cos(th) * q[2] * rr,
            ly = Math.sin(th) * q[3] * rr;
          const px = q[0] + lx * ca - ly * sa,
            py = q[1] + lx * sa + ly * ca;
          return T((ax0 + (px - ax0) * s) * R, (ay0 + (py - ay0) * s) * R, q[5]);
        };
        const pts: Nokta[] = [];
        for (let k = 0; k < 26; k++) pts.push(pt((k / 26) * Math.PI * 2));
        B.fill(pts, C.cicek);
        if (q[6] && R >= 12 && s > 0.4) {
          const arc: Nokta[] = [];
          for (let k = 0; k <= 14; k++) arc.push(pt(Math.PI * (1.18 + (0.64 * k) / 14)));
          strokeRange(B, arc, 0, Math.min(1, (s - 0.4) / 0.5), C.cizgi, lw * 0.8);
        }
      });
      const fr = eo((a - P.length * st - 80) / 520);
      if (fr > 0 && R > 3) {
        const sp: Nokta[] = [],
          scl: Nokta[] = [];
        const turns = R < 20 ? Math.min(e.turns, 1.3) : R < 32 ? e.turns * 0.8 : e.turns;
        for (let i = 0; i <= 70; i++) {
          const u = i / 70,
            th = e.ph1 + u * turns * Math.PI * 2,
            rr = R * (0.08 + 0.57 * u);
          sp.push(T(Math.cos(th) * rr * 1.05, Math.sin(th) * rr * 0.72 - 0.12 * R, 0.34 - 0.24 * u));
        }
        strokeRange(B, sp, 0, fr, C.cizgi, lw);
        if (R >= 14) {
          for (let i = 0; i <= 36; i++) {
            const u = i / 36;
            scl.push(T((-0.72 + 1.5 * u) * R, 0.36 * R + 0.16 * R * Math.abs(Math.sin(u * Math.PI * 3)), 0.18));
          }
          strokeRange(B, scl, 0, fr, C.cizgi, lw);
        }
      }
    };

    /** En yakın çekim noktası: fare (dokunmatik ekranda parmak kalkınca yok) */
    const near = (): Nokta | null => (fareX != null ? [fareX, fareY] : null);
    const faceTurn = (e: Gul, x: number, y: number): Nokta => {
      let wx = 0,
        wy = 0;
      const A = near();
      if (A) {
        const dx = A[0] - x,
          dy = A[1] - y,
          d = Math.hypot(dx, dy),
          reach = 300;
        if (d < reach && d > 0.001) {
          const w = 1 - d / reach,
            s = w * w * (3 - 2 * w) * Math.min(1, d / 40);
          wx = (dx / d) * s;
          wy = (dy / d) * s;
        }
      }
      const c = fa[e.id] || [0, 0];
      c[0] += (wx - c[0]) * 0.09;
      c[1] += (wy - c[1]) * 0.09;
      fa[e.id] = c;
      return c;
    };

    let simdi = 0,
      nefes = 0;
    /** Bu karede çizilen açılmış güller (logo tuvali koordinatında) — kelebek bunlara konar */
    let tunekler: { id: number; x: number; y: number; R: number }[] = [];
    /** Bir noktanın harfe göre konumu: doğum titremesi + fareye eğilme + nefes salınımı */
    const wpt = (l: Harf, x: number, y: number): Nokta => {
      const t = (simdi - l.birth) / 1000;
      if (t > 0 && t < 2.5) {
        const hh = Math.max(0, (l.y - y) / S),
          dmp = Math.exp(-t * 3.2),
          dir = l.id % 2 ? 1 : -1;
        x += S * 0.07 * hh * dmp * Math.sin(t * 11) * dir;
        y += S * 0.035 * hh * dmp * Math.sin(t * 11 + 1.2);
      }
      const hh = Math.min(2.5, Math.max(0, (l.y - y) / S)),
        f = hh * hh * 0.5 + hh * 0.5;
      x += l.lean[0] * S * 0.1 * f;
      y += l.lean[1] * S * 0.05 * f;
      if (nefes) {
        // Aslındaki "Breathe": gövdeler boylarıyla orantılı, yavaşça sallanır
        const hb = Math.max(0, (l.y - y) / S);
        x += Math.sin(nefes + l.x * 0.004 + hb * 1.1) * S * 0.03 * hb;
        y += Math.cos(nefes + x * 0.003) * S * 0.008 * hb;
      }
      return [x, y];
    };
    const drawStem = (B: Fircalar, e: Govde, l: Harf, age: number, f: number, amp: number, layer: number, frO?: number) => {
      const fr = frO != null ? frO : eo((age - e.d0) / e.dur);
      if (fr <= 0) return;
      const j = jit(e.id, f, amp);
      const P = e.pts.map((p) => wpt(l, l.x + p[0] * S + j[0], l.y + p[1] * S + j[1]));
      for (const sg of e.segs) {
        if (sg.layer !== layer) continue;
        const b = Math.min(sg.u1, fr);
        if (b <= sg.u0) continue;
        strokeRange(B, P, sg.u0, b, C.govde, S * 0.022 * (e.w || 1));
      }
      for (const th of e.thorns) if (fr > th.u && layerAt(e.segs, th.u) === layer) thorn(B, P, th.u, th.s);
    };
    const drawEl = (B: Fircalar, e: Yaprak | Gul, l: Harf, age: number, f: number, amp: number) => {
      const j = jit(e.id, f, amp),
        wx = (x: number, y: number) => wpt(l, l.x + x * S + j[0], l.y + y * S + j[1]);
      const rw = nefes ? Math.sin(nefes + e.id * 0.7) * 0.12 : 0;
      if (e.t === "leaf") {
        const sc = spr((age - e.d0) / 1000, 7, 15);
        if (sc <= 0) return;
        const p = wx(e.x, e.y);
        leaf(B, p[0], p[1], e.a + j[2] + rw, e.L * S * sc, e.bend);
      } else {
        const a = age - e.d0;
        if (a < 0) return;
        const p = wx(e.x, e.y),
          tl = faceTurn(e, p[0], p[1]);
        if (a > 700) tunekler.push({ id: e.id, x: p[0], y: p[1], R: e.R * S });
        rose(B, p[0], p[1], e.R * S, e.rot + j[2] + rw + tl[0] * 0.22, e, a, tl);
      }
    };

    const B: Fircalar = {
      fill: (p, col) => {
        g.beginPath();
        yol(g, p, true);
        g.fillStyle = col;
        g.fill();
      },
      stroke: (p, col, w) => {
        g.beginPath();
        yol(g, p, false);
        g.strokeStyle = col;
        g.lineWidth = w;
        g.lineCap = "round";
        g.lineJoin = "round";
        g.stroke();
      },
      text: (ch, x, y, sz, col, alpha) => {
        g.globalAlpha = alpha;
        g.font = `700 ${sz}px ${F}`;
        g.textAlign = "center";
        g.textBaseline = "alphabetic";
        g.fillStyle = col;
        g.fillText(ch, x, y);
        g.globalAlpha = 1;
      },
    };

    const ciz = (now: number) => {
      simdi = now;
      tunekler = [];
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      // Harfler fareye doğru hafifçe eğilir (aslındaki "face")
      for (const l of harfler) {
        let tx = 0,
          ty = 0;
        const A = l.ch !== " " ? near() : null;
        if (A) {
          const dx = A[0] - l.x,
            dy = A[1] - (l.y - S * 0.6),
            d = Math.hypot(dx, dy),
            reach = Math.max(260, S * 3.2);
          if (d < reach && d > 1) {
            const w = 1 - d / reach,
              s = w * w * (3 - 2 * w);
            tx = (dx / d) * s;
            ty = (dy / d) * s;
          }
        }
        l.lean[0] += (tx - l.lean[0]) * 0.07;
        l.lean[1] += (ty - l.lean[1]) * 0.07;
      }
      // El çizimi titreşimi ("boil"): çizgiler 120 ms'de bir hafifçe yer değiştirir
      const f = Math.floor(now / 120),
        amp = Math.max(0.8, S * 0.01);
      /**
       * OKUNURLUK. Aslında yalnızca kendi harfinin üstüne binen gül arkaya
       * alınıyor (o da %78 ihtimalle); komşu harften uzanan gül öne düşüp
       * "Kariyer"i yarı yarıya kapatıyordu. Logo okunmalı: yazı hizasındaki
       * (taban çizgisinin biraz altından harf boyunun üstüne kadar) her gül
       * harflerin arkasında. Üstte ve altta açanlar önde kalabiliyor.
       */
      const katmani = (e: Yaprak | Gul) => (e.t === "rose" && e.y > -0.85 && e.y < 0.15 ? 0 : e.layer);
      const katman = (layer: number) => {
        harfler.forEach((l, i) => {
          if (l.ch === " " || !l.els) return;
          const age = now - l.birth;
          const each = (e: Oge) => {
            if (e.t === "stem") drawStem(B, e, l, age, f, amp, layer);
            else if (katmani(e) === layer) drawEl(B, e, l, age, f, amp);
          };
          l.els.forEach(each);
          if (l.endEls) l.endEls.forEach(each);
          const nx = harfler[i + 1];
          if (l.tend.length && (!nx || nx.ch === " ")) {
            let fr = eo((now - l.tb - 150) / 450);
            if (l.cut != null) fr *= 1 - eo((now - l.cut) / 150) * Math.min(0.85, 20 / (0.6 * S));
            for (const e of l.tend) drawStem(B, e, l, age, f, amp, layer, fr);
          }
        });
      };
      katman(0);
      for (const l of harfler) if (l.ch !== " ") B.text(l.ch, l.x, l.y, S, C.yazi, eo((now - l.birth) / 160));
      katman(1);
    };

    // ------------------------------------------------------------ kelebek
    // Tuval doğrudan body'ye, SAYFANIN başına (absolute) ekleniyor: sayfayla
    // birlikte kayıyor, kaydırırken yeniden çizim gerekmiyor. Logonun içinde
    // dursaydı başlığın açılış animasyonundaki transform onu kutuya hapsederdi.
    // Koordinatlar sayfa koordinatı: (0,0) sayfanın sol üstü.
    const kt = document.createElement("canvas");
    kt.setAttribute("aria-hidden", "true");
    Object.assign(kt.style, { position: "absolute", left: "0", top: "0", pointerEvents: "none", zIndex: "30" });
    document.body.appendChild(kt);
    const kg = kt.getContext("2d");
    /** Gezinti bölgesi: sayfa genişliği × (logonun altı + ekranın üçte biri) */
    let KW = 0,
      KH = 0,
      kdpr = 1;
    const kBoyutla = () => {
      const r = tuval.getBoundingClientRect();
      KW = document.documentElement.clientWidth;
      // Sayfadan uzun olmasın: olursa sayfaya fazladan kaydırma eklerdi
      KH = Math.min(
        document.documentElement.scrollHeight,
        Math.max(window.innerHeight * 0.7, r.bottom + window.scrollY + window.innerHeight * 0.35)
      );
      kdpr = window.devicePixelRatio || 1;
      kt.style.width = `${KW}px`;
      kt.style.height = `${KH}px`;
      kt.width = Math.round(KW * kdpr);
      kt.height = Math.round(KH * kdpr);
    };
    kBoyutla();
    /** Farenin ekran (viewport) konumu — kelebek ürksün diye; sayfaya kaydırma payıyla çevrilir */
    let fareEX: number | null = null,
      fareEY = 0;
    interface KelebekDurumu {
      x: number;
      y: number;
      vx: number;
      vy: number;
      /** gez: süzülüyor · git: güle uçuyor · kon: gülde · kac: ürktü */
      st: "gez" | "git" | "kon" | "kac";
      tx: number;
      ty: number;
      t0: number;
      ph: number;
      seed: number;
      ang: number;
      open: number;
      pid: number | null;
      /** bir sonraki karar anı (güle git / kalk) */
      sonra: number;
    }
    /**
     * Kelebeğin huyu: dikkat dağıtmayan, tatlı bir öğe. Zamanının çoğunu bir
     * gülün üstünde geçiriyor, ağır uçuyor, ancak fare çok yaklaşınca ürküyor.
     */
    const HUY = {
      ilkKonma: [2000, 4000],
      konmaIhtimali: 0.95,
      yenidenDene: [2000, 3000],
      gulde: [20000, 40000],
      kalkincaGez: [3000, 6000],
      kactiktanSonra: [4000, 7000],
      urkmeMesafesi: 80,
      kacisMesafesi: 180,
    } as const;
    const arada = ([a, b]: readonly [number, number]) => a + kr() * (b - a);
    let kel: KelebekDurumu | null = null;
    let kelebekZamani = 0,
      sonKelebek = 0;
    const kr = rng(tohumla(metin) ^ 0x9e3779b9);
    const rastgeleHedef = (): Nokta => [40 + kr() * Math.max(1, KW - 80), 60 + kr() * Math.max(1, KH - 110)];
    /** Logodaki güller, sayfa koordinatında */
    const sayfaTunekleri = () => {
      const r = tuval.getBoundingClientRect(),
        sx = window.scrollX,
        sy = window.scrollY;
      return tunekler.map((t) => ({ ...t, x: t.x + r.left + sx, y: t.y + r.top + sy }));
    };
    /** Gezinti bölgesi şu an ekranda mı (görünmüyorsa çizim durur) */
    const bolgeEkranda = () => window.scrollY < KH;
    const kelebekCiz = (x: number, y: number, s: number, ang: number, o: number) => {
      if (!kg) return;
      const ca = Math.cos(ang),
        sa = Math.sin(ang),
        T = (px: number, py: number): Nokta => [x + (px * ca - py * sa) * s, y + (px * sa + py * ca) * s];
      const kanat = (cx: number, cy: number, rx: number, ry: number, a: number, side: number) => {
        const pts: Nokta[] = [],
          c = Math.cos(a),
          sn = Math.sin(a);
        for (let k = 0; k < 22; k++) {
          const th = (k / 22) * Math.PI * 2,
            r = 1 + 0.08 * Math.sin(th * 3),
            lx = Math.cos(th) * rx * r,
            ly = Math.sin(th) * ry * r;
          pts.push(T(side * (cx + lx * c - ly * sn) * (0.12 + 0.88 * o), cy + lx * sn + ly * c));
        }
        return pts;
      };
      const dol = (p: Nokta[], col: string) => {
        kg.beginPath();
        yol(kg, p, true);
        kg.fillStyle = col;
        kg.fill();
      };
      const cek = (p: Nokta[], col: string, w: number) => {
        kg.beginPath();
        yol(kg, p, false);
        kg.strokeStyle = col;
        kg.lineWidth = w;
        kg.lineCap = "round";
        kg.stroke();
      };
      for (const sd of [-1, 1]) {
        dol(kanat(0.46, 0.28, 0.36, 0.3, 0.5, sd), C.yazi);
        dol(kanat(0.55, -0.32, 0.55, 0.36, -0.55, sd), C.yazi);
        if (o > 0.35) dol(kanat(0.66, -0.4, 0.13, 0.11, 0, sd), C.cicek);
      }
      const govde: Nokta[] = [];
      for (let k = 0; k < 18; k++) {
        const th = (k / 18) * Math.PI * 2;
        govde.push(T(Math.cos(th) * 0.08, Math.sin(th) * 0.48));
      }
      dol(govde, C.govde);
      const lw = Math.max(0.8, s * 0.05);
      cek([T(0, -0.42), T(-0.14, -0.72), T(-0.24, -0.86)], C.govde, lw);
      cek([T(0, -0.42), T(0.14, -0.72), T(0.24, -0.86)], C.govde, lw);
    };
    /** Aslındaki drawFlies hareketi; hedef seçimi ve ürkme buraya göre */
    const kelebekAdim = (now: number) => {
      if (!kg) return;
      kg.setTransform(kdpr, 0, 0, kdpr, 0, 0);
      kg.clearRect(0, 0, KW, KH);
      if (!kel) {
        if (!kelebekZamani || now < kelebekZamani) return;
        const sol = kr() < 0.5,
          [tx, ty] = rastgeleHedef();
        kel = { x: sol ? -40 : KW + 40, y: KH * (0.15 + kr() * 0.4), vx: 0, vy: 0, st: "gez", tx, ty, t0: now, ph: kr() * 6, seed: kr() * 100, ang: 0, open: 1, pid: null, sonra: now + arada(HUY.ilkKonma) };
      }
      const f = kel;
      const dt = Math.min(48, now - (sonKelebek || now));
      sonKelebek = now;
      const t = (now - f.t0) / 1000;
      const tunek = sayfaTunekleri();
      // Her kullanımda yeniden aranıyor: aynı karede "güle git" kararı verilince pid değişiyor
      const benimTunegim = () => (f.pid != null ? tunek.find((p) => p.id === f.pid) : undefined);

      // Ürkme: fare 110 px'e girerse kaçar (kalkarken de)
      if (fareEX != null && f.st !== "kac") {
        const px = fareEX + window.scrollX,
          py = fareEY + window.scrollY;
        const d = Math.hypot(px - f.x, py - f.y);
        if (d < HUY.urkmeMesafesi) {
          const ax = f.x - px,
            ay = f.y - py,
            dd = Math.hypot(ax, ay) || 1;
          f.st = "kac";
          f.pid = null;
          f.t0 = now;
          f.tx = Math.min(KW - 30, Math.max(30, f.x + (ax / dd) * HUY.kacisMesafesi));
          f.ty = Math.min(KH - 30, Math.max(30, f.y + (ay / dd) * HUY.kacisMesafesi - 40));
        }
      }
      if (f.st === "kac" && now - f.t0 > 1300) {
        f.st = "gez";
        f.sonra = now + arada(HUY.kactiktanSonra);
      }
      if (f.st === "gez") {
        if (Math.hypot(f.tx - f.x, f.ty - f.y) < 30) [f.tx, f.ty] = rastgeleHedef();
        if (now > f.sonra) {
          const adaylar = tunek.filter((p) => p.id !== f.pid);
          if (adaylar.length && kr() < HUY.konmaIhtimali) {
            f.pid = adaylar[Math.floor(kr() * adaylar.length)].id;
            f.st = "git";
          } else f.sonra = now + arada(HUY.yenidenDene);
        }
      }
      const benimTunek = benimTunegim();
      if ((f.st === "git" || f.st === "kon") && !benimTunek) {
        // Gül artık yok (logo yeniden yerleşti) — gezintiye dön
        f.st = "gez";
        f.pid = null;
        f.sonra = now + arada(HUY.yenidenDene);
      }
      if ((f.st === "git" || f.st === "kon") && benimTunek) {
        f.tx = benimTunek.x + benimTunek.R * 0.05;
        f.ty = benimTunek.y - benimTunek.R * 0.55;
      }
      if (f.st === "kon") {
        f.x += (f.tx - f.x) * 0.35;
        f.y += (f.ty - f.y) * 0.35;
        f.ang *= 0.85;
        f.ph += dt * 0.004;
        const cirpma = Math.sin((now / 1000) * 0.45 + f.seed) > 0.88;
        f.open = cirpma ? 0.2 + 0.8 * Math.abs(Math.cos((now / 1000) * 9 + f.seed)) : 0.25 + 0.15 * Math.sin(f.ph);
        if (now > f.sonra) {
          f.st = "gez";
          [f.tx, f.ty] = rastgeleHedef();
          f.ty = Math.min(f.ty, f.y - 40);
          f.sonra = now + arada(HUY.kalkincaGez);
        }
      } else {
        const dx = f.tx - f.x,
          dy = f.ty - f.y,
          d = Math.hypot(dx, dy) || 1;
        const sp = f.st === "kac" ? 0.38 : f.st === "gez" ? Math.min(0.11, 0.03 + d * 0.0006) : Math.min(0.2, 0.05 + d * 0.0012);
        const flut = Math.sin(t * 7 + f.seed) * 0.12,
          wob = Math.cos(t * 4.3 + f.seed) * 0.1;
        const ax = (dx / d) * sp + wob - f.vx,
          ay = (dy / d) * sp + flut - f.vy;
        f.vx += ((ax * 0.06 * dt) / 16);
        f.vy += ((ay * 0.06 * dt) / 16);
        f.x += f.vx * dt;
        f.y += f.vy * dt + Math.sin(t * 13 + f.seed) * 0.6;
        f.ang += (Math.max(-0.5, Math.min(0.5, f.vx * 1.4)) - f.ang) * 0.1;
        f.open = Math.abs(Math.cos(t * 17 + f.seed));
        if (f.st === "git" && d < 5) {
          f.st = "kon";
          f.ph = 0;
          f.sonra = now + arada(HUY.gulde);
        }
      }
      kelebekCiz(f.x, f.y, 13, f.ang, f.open);
    };

    // ------------------------------------------------------------ yaşam döngüsü
    let raf = 0,
      gorunur = true,
      sonKare = 0;
    let bitis = 0,
      hazir = false,
      basladi = false;
    const kare = (now: number) => {
      raf = 0;
      if (document.hidden) return;
      // Logo ekran dışındayken kelebek yine gezer; ikisi de durunca döngü de durur
      if (!gorunur && !(kel && bolgeEkranda())) {
        // Logo da kelebeğin bölgesi de ekran dışında: çizim durur
        kg?.clearRect(0, 0, kt.width, kt.height);
        return;
      }
      raf = requestAnimationFrame(kare);
      // Büyüme logo İLK GÖRÜNDÜĞÜ anda başlar: sayfa arka sekmede açıldıysa
      // tarayıcı kare çalıştırmıyor; zaman yine de işleseydi ablam sekmeye
      // döndüğünde bahçeyi çoktan açılmış bulurdu.
      if (!basladi && gorunur) {
        basladi = true;
        const t0 = now + GECIKME;
        yaz(t0);
        yerlestir();
        // Son harfin bütün öğeleri açılana kadar tam hız (en geç öğe ~2,4 sn)
        bitis = t0 + metin.length * ARALIK + 2600;
        // Kelebek bahçe açıldıktan biraz sonra gelir
        kelebekZamani = bitis + 1500;
      }
      // Büyüme bitince 30 fps yeter: salınım yavaş, titreşim zaten 120 ms'de bir
      if (now > bitis && now - sonKare < 32) return;
      sonKare = now;
      // Nefes: 3 sn'lik tam salınım (aslındaki "Breathe" ön ayarının süresi)
      nefes = (now / 3000) * Math.PI * 2;
      if (gorunur) ciz(now);
      kelebekAdim(now);
    };
    const baslat = () => {
      if (hazir && !raf && (gorunur || (kel && bolgeEkranda())) && !document.hidden) raf = requestAnimationFrame(kare);
    };

    const boyutla = () => {
      const r = kap.getBoundingClientRect();
      if (!r.width) return;
      W = r.width;
      H = r.height;
      dpr = window.devicePixelRatio || 1;
      tuval.width = Math.round(W * dpr);
      tuval.height = Math.round(H * dpr);
      yerlestir();
      kBoyutla();
    };

    let iptal = false;
    const kur = () => {
      if (iptal) return;
      olcu = {};
      hazir = true;
      boyutla();
      baslat();
    };
    // Font yüklenmeden ölçülen harf genişliği yanlış olur; önce yüklenmesi bekleniyor
    const fontHazir = document.fonts?.load ? document.fonts.load(`700 100px ${F}`, metin).catch(() => null) : Promise.resolve(null);
    void fontHazir.then(kur);

    const ro = new ResizeObserver(() => boyutla());
    ro.observe(kap);
    const io = new IntersectionObserver((girdiler) => {
      gorunur = girdiler.some((x) => x.isIntersecting);
      if (gorunur) baslat();
    });
    io.observe(kap);
    const gorunurluk = () => {
      if (!document.hidden) baslat();
    };
    document.addEventListener("visibilitychange", gorunurluk);
    const fare = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== "mouse" && e.type === "pointerup") {
        fareX = null;
        return;
      }
      const r = tuval.getBoundingClientRect();
      fareX = e.clientX - r.left;
      fareY = e.clientY - r.top;
      fareEX = e.clientX;
      fareEY = e.clientY;
    };
    const fareGitti = () => {
      fareX = null;
      fareEX = null;
    };
    window.addEventListener("resize", kBoyutla);
    window.addEventListener("scroll", baslat, { passive: true });
    window.addEventListener("pointermove", fare);
    window.addEventListener("pointerup", fare);
    document.addEventListener("pointerleave", fareGitti);

    return () => {
      iptal = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", gorunurluk);
      window.removeEventListener("pointermove", fare);
      window.removeEventListener("pointerup", fare);
      document.removeEventListener("pointerleave", fareGitti);
      window.removeEventListener("resize", kBoyutla);
      window.removeEventListener("scroll", baslat);
      kt.remove();
    };
  }, [metin, paletAnahtari]);

  return (
    <div ref={kapRef} className={className} style={{ height: yukseklik }}>
      {/* Yazının kendisi ekran okuyucu için ayrıca var (bkz. çağıran yerdeki sr-only başlık) */}
      <canvas ref={tuvalRef} aria-hidden className="block h-full w-full" />
    </div>
  );
}
