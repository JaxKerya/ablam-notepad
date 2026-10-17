/**
 * Ablam Kanvas çizim katmanı: zemin deseni ve öğeler. React'ten bağımsız; tahta
 * bileşeni her karede bunları çağırıyor. Öğe çizimleri DÜNYA koordinatında —
 * çağıran taraf bağlamın dönüşümünü (kamera) önceden kuruyor.
 */
import { getStroke } from "perfect-freehand";
import { renkHex, SATIR, ZEMIN, type Desen, type KalemVeri, type Oge, type SekilVeri, type Ton } from "@/lib/kanvas";

export interface Kamera { x: number; y: number; z: number }

/** perfect-freehand'in dış hat noktalarını yumuşak bir yola çevirir (kütüphanenin önerdiği yöntem) */
function hatYolu(hat: number[][]): Path2D {
  const yol = new Path2D();
  if (hat.length < 2) return yol;
  yol.moveTo(hat[0][0], hat[0][1]);
  for (let i = 1; i < hat.length; i++) {
    const [x0, y0] = hat[i];
    const [x1, y1] = hat[(i + 1) % hat.length];
    yol.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  yol.closePath();
  return yol;
}

/**
 * Fare noktalarını düzleştirir: önce çizgi boyunca EŞİT aralıkla yeniden
 * örnekler, sonra kısa bir kayan ortalama alır. Uçlar yerinde kalır.
 *
 * Neden: fare noktaları tam piksellerde gelir. Yakın zoomda dikey bir çizgi
 * "3 nokta aynı x, sonra 1 piksel kayma" diye merdiven olur; uzak zoomda ya da
 * hızlı çizimde noktalar seyrekleşir ve köşelenir. perfect-freehand'in kendi
 * yumuşatması nokta SAYISINA göre çalıştığı için ikisini de düzeltemiyordu
 * (17.10.2026, ablamın çizgilerinde görüldü). Aralık çizgi kalınlığına bağlı:
 * ince kalemde ayrıntı korunur, kalın kalemde daha çok düzleşir.
 */
function duzlestir(n: number[], aralik: number): number[][] {
  const p: number[][] = [[n[0], n[1]]];
  let ax = n[0], ay = n[1], birikim = 0;
  for (let i = 2; i < n.length; i += 2) {
    const bx = n[i], by = n[i + 1];
    let parca = Math.hypot(bx - ax, by - ay);
    while (birikim + parca >= aralik && parca > 0) {
      const t = (aralik - birikim) / parca;
      ax += (bx - ax) * t;
      ay += (by - ay) * t;
      p.push([ax, ay]);
      parca = Math.hypot(bx - ax, by - ay);
      birikim = 0;
    }
    birikim += parca;
    ax = bx;
    ay = by;
  }
  const sx = n[n.length - 2], sy = n[n.length - 1];
  const son = p[p.length - 1];
  if (p.length === 1 || Math.hypot(sx - son[0], sy - son[1]) > aralik * 0.25) p.push([sx, sy]);

  // Kayan ortalama (±3 nokta); uçlara yaklaştıkça pencere daralıyor ki çizgi kısalmasın
  const P = 3;
  return p.map((q, i) => {
    const w = Math.min(P, i, p.length - 1 - i);
    if (w <= 0) return q;
    let tx = 0, ty = 0;
    for (let j = i - w; j <= i + w; j++) {
      tx += p[j][0];
      ty += p[j][1];
    }
    return [tx / (2 * w + 1), ty / (2 * w + 1)];
  });
}

/**
 * Çizildiği anda bir ekran pikselinin dünya birimi karşılığı. Kayıtlı değilse
 * (17.10.2026 öncesi çizgiler) noktaların oturduğu ızgaradan tahmin ediliyor:
 * fare tam piksellerde geldiği için ardışık noktaların x/y farkları hep o adımın
 * katı — en küçük sık görülen fark bir pikseldir.
 */
function pikselBoyu(v: KalemVeri): number {
  if (v.z && v.z > 0) return 1 / v.z;
  const farklar: number[] = [];
  for (let i = 2; i < v.n.length; i += 2) {
    const dx = Math.abs(v.n[i] - v.n[i - 2]), dy = Math.abs(v.n[i + 1] - v.n[i - 1]);
    if (dx > 0.05) farklar.push(dx);
    if (dy > 0.05) farklar.push(dy);
  }
  if (farklar.length < 4) return 1;
  farklar.sort((a, b) => a - b);
  return Math.min(15, Math.max(0.1, farklar[Math.floor(farklar.length * 0.1)]));
}

/**
 * Kalem çizgisinin dolgu yolu. Fare basınç bildirmediği için basınç hızdan
 * türetiliyor (simulatePressure) ama hafifçe: güçlü inceltmede yavaşlayan yer
 * şişip hızlanan yer inceliyor, çizgi dalgalı görünüyordu. Fosforlu kalemde
 * inceltme yok.
 */
export function kalemYolu(v: KalemVeri, bitti: boolean): Path2D {
  // Aralık hem kalınlığa hem çizim anındaki piksele bağlı: uzak zoomda çizilen
  // çizginin 1 piksellik basamakları yaklaşınca kocaman köşe oluyordu (Kanvas 7)
  const noktalar = v.n.length >= 4 ? duzlestir(v.n, Math.max(0.35, v.k * 0.3, pikselBoyu(v) * 1.5)) : [[v.n[0], v.n[1]]];
  const hat = getStroke(noktalar, {
    size: v.k * (v.f ? 1 : 1.6),
    thinning: v.f ? 0 : 0.22,
    smoothing: 0.62,
    streamline: 0.32,
    simulatePressure: !v.f,
    last: bitti,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
  });
  return hatYolu(hat);
}

/** Bitmiş kalem çizgilerinin yolu öğe başına bir kez hesaplanıyor; veri değişince (taşıma) yeniden */
const yolOnbellegi = new WeakMap<KalemVeri, Path2D>();
function onbellekliYol(v: KalemVeri) {
  let y = yolOnbellegi.get(v);
  if (!y) {
    y = kalemYolu(v, true);
    yolOnbellegi.set(v, y);
  }
  return y;
}

/** Resimler adrese göre bir kez yükleniyor; yüklenince tahta yeniden çizilsin diye geri çağrı */
const resimler = new Map<string, HTMLImageElement>();
export function resimAl(url: string, yuklenince: () => void): HTMLImageElement | null {
  let r = resimler.get(url);
  if (!r) {
    r = new Image();
    // PNG olarak indirirken tuval "kirlenmesin": depolama CORS başlığı veriyor
    r.crossOrigin = "anonymous";
    r.onload = yuklenince;
    r.src = url;
    resimler.set(url, r);
  }
  return r.complete && r.naturalWidth ? r : null;
}

/**
 * Kanvas yazıları Excalidraw'ın el yazısı fontuyla (app/kanvas/excalifont.css).
 * Fontta olmayan karakterler (², √, ≤…) sitenin yazı tipinden geliyor.
 */
let yedekAile = "";
export function yaziFontu(boyut: number) {
  if (!yedekAile && typeof document !== "undefined") yedekAile = getComputedStyle(document.body).fontFamily || "sans-serif";
  return `400 ${boyut}px Excalifont, ${yedekAile || "sans-serif"}`;
}

/** Yazı kutusunun boyu — yazan bunu ölçüp öğeye kaydediyor */
export function yaziOlc(ctx: CanvasRenderingContext2D, metin: string, boyut: number) {
  ctx.save();
  ctx.font = yaziFontu(boyut);
  const satirlar = metin.split("\n");
  const w = Math.max(boyut * 0.5, ...satirlar.map((s) => ctx.measureText(s).width));
  ctx.restore();
  return { w: Math.ceil(w) + 2, h: Math.ceil(satirlar.length * boyut * SATIR) };
}

function sekilCiz(ctx: CanvasRenderingContext2D, v: SekilVeri, renk: string) {
  const { a, b, k, s } = v;
  ctx.strokeStyle = renk;
  ctx.lineWidth = k;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (s === "cizgi" || s === "ok") {
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    if (s === "ok" && (a[0] !== b[0] || a[1] !== b[1])) {
      const aci = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const boy = 6 + k * 2.5;
      for (const d of [-0.5, 0.5]) {
        ctx.moveTo(b[0], b[1]);
        ctx.lineTo(b[0] - boy * Math.cos(aci + d), b[1] - boy * Math.sin(aci + d));
      }
    }
  } else if (s === "dikdortgen") {
    ctx.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  } else {
    const rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2;
    ctx.ellipse(Math.min(a[0], b[0]) + rx, Math.min(a[1], b[1]) + ry, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
  }
  ctx.stroke();
}

/**
 * Tek öğe. `taslak`: çizilmekte olan kalem çizgisi — her karede değiştiği için
 * önbelleğe alınmıyor ve ucu açık bırakılıyor.
 */
export function ogeCiz(ctx: CanvasRenderingContext2D, o: Oge, ton: Ton, yeniden: () => void, taslak = false) {
  switch (o.tur) {
    case "kalem": {
      ctx.fillStyle = renkHex(o.veri.r, ton);
      if (o.veri.f) {
        ctx.save();
        ctx.globalAlpha = ton === "koyu" ? 0.38 : 0.32;
        ctx.fill(taslak ? kalemYolu(o.veri, false) : onbellekliYol(o.veri));
        ctx.restore();
      } else {
        ctx.fill(taslak ? kalemYolu(o.veri, false) : onbellekliYol(o.veri));
      }
      return;
    }
    case "sekil":
      sekilCiz(ctx, o.veri, renkHex(o.veri.r, ton));
      return;
    case "yazi": {
      const v = o.veri;
      ctx.fillStyle = renkHex(v.r, ton);
      ctx.font = yaziFontu(v.b);
      ctx.textBaseline = "top";
      v.m.split("\n").forEach((s, i) => ctx.fillText(s, v.x, v.y + i * v.b * SATIR + v.b * (SATIR - 1) / 2));
      return;
    }
    case "resim": {
      const v = o.veri;
      const r = resimAl(v.u, yeniden);
      if (r) ctx.drawImage(r, v.x, v.y, v.w, v.h);
      else {
        // Yüklenene kadar yer tutucu
        ctx.fillStyle = ton === "koyu" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";
        ctx.fillRect(v.x, v.y, v.w, v.h);
      }
      return;
    }
  }
}

/**
 * Zemin deseni EKRAN koordinatında çiziliyor (dönüşüm kurulmadan): çizgiler her
 * yakınlıkta bir piksel kalsın. Aralık uzaklaştıkça 5'er katlanıyor, sık ızgara
 * ekranı doldurmasın.
 */
export function zeminCiz(ctx: CanvasRenderingContext2D, w: number, h: number, kam: Kamera, desen: Desen, ton: Ton) {
  const z = ZEMIN[ton];
  ctx.fillStyle = z.zemin;
  ctx.fillRect(0, 0, w, h);
  if (desen === "bos") return;

  let aralik = 24;
  while (aralik * kam.z < 14) aralik *= 5;
  const ekranAralik = aralik * kam.z;
  const bx = Math.floor(kam.x / aralik), by = Math.floor(kam.y / aralik);
  const ox = (bx * aralik - kam.x) * kam.z, oy = (by * aralik - kam.y) * kam.z;

  if (desen === "noktali") {
    const yaricap = Math.min(1.6, Math.max(0.9, ekranAralik / 22));
    for (let i = 0, x = ox; x <= w; i++, x += ekranAralik) {
      for (let j = 0, y = oy; y <= h; j++, y += ekranAralik) {
        ctx.fillStyle = (bx + i) % 5 === 0 && (by + j) % 5 === 0 ? z.kalin : z.ince;
        ctx.beginPath();
        ctx.arc(Math.round(x), Math.round(y), yaricap * ((bx + i) % 5 === 0 && (by + j) % 5 === 0 ? 1.4 : 1), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return;
  }

  ctx.lineWidth = 1;
  for (let i = 0, x = ox; x <= w; i++, x += ekranAralik) {
    ctx.strokeStyle = (bx + i) % 5 === 0 ? z.kalin : z.ince;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, h);
    ctx.stroke();
  }
  for (let j = 0, y = oy; y <= h; j++, y += ekranAralik) {
    ctx.strokeStyle = (by + j) % 5 === 0 ? z.kalin : z.ince;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(w, Math.round(y) + 0.5);
    ctx.stroke();
  }
}
