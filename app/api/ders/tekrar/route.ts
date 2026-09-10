import { NextResponse } from "next/server";
import { chatJsonOlculu } from "@/lib/ai";
import {
  hukumOneksizAciklama,
  siklariKaristir,
  onculluSiklarMi,
  sikSetiniDogrula,
  TEKRAR_SORU_SAYISI,
  yeterinceFarkli,
} from "@/lib/ders";
import { hataCevabi, kapiKontrol } from "@/lib/ders-server";
import { SIK_SAYISI, SORU_OLGU_DENETIMI, tekrarVaryantPrompt } from "@/lib/prompts";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Kategori başına saklanan pratik oturumu sayısı. Ekranda yalnızca sonuncusu
 * görünüyor; geri kalanlar "bu soru en son ne zaman soruldu" bilgisini taşıdığı
 * için duruyor. Fazlası yeni pratik açılırken siliniyor.
 */
const SAKLANAN_PRATIK = 5;

/**
 * Seçim havuzu, en uzun süredir görülmemiş soruların bu kadarına daraltılıyor;
 * rastgelelik o daraltılmış küme içinde kalıyor. Doğrudan "en eskisini seç"
 * deseydik seçim belirlenimci olur, aynı soru üst üste gelirdi.
 */
const TAZELIK_PAYI = 0.5;

// Bir kategorinin işlenmiş derslerinden PRATİK oturumu kurar ve besler.
//
// Akış bir test değil, döngü: düğmeye basınca tek bir rastgele soru gelir, ablam
// cevaplar, "başka soru" der, bir tane daha gelir. Bitiş yok — istediği yerde
// bırakır. Bu yüzden uç iki iş yapıyor:
//   sessionId YOKSA  -> yeni pratik oturumu açar ve içine `adet` soru koyar
//   sessionId VARSA  -> o oturuma `adet` soru daha ekler ve eklenenleri döndürür
// Arayüz ikinci hâlde dönen satırı listeye ekliyor; sayfa yenilenmiyor.
//
// Havuz TRANSKRİPTTEN değil, o kategoride daha önce üretilmiş ve iki katmanlı
// denetimden geçmiş sorulardan kuruluyor. Sebebi hem para (bir dersi baştan
// üretmek ~$0,20) hem de istenen şeyin ta kendisi: "şimdiye kadar işlediğimiz
// konulardan" tekrar. Transkriptten baştan üretmek yeni konu üretmek olurdu.
//
// Sorular KOPYALANIYOR, referans verilmiyor. Sebep: ders_answers'ta
// unique(question_id) var, aynı soru ikinci kez cevaplanamıyor. Kopya yeni bir
// kimlik alınca hem tekrar çözülebiliyor hem de ablamın ilk denemedeki cevabı
// ve puanı olduğu gibi kalıyor.
//
// İki mod var:
//   "kopya" (varsayılan) — sorular olduğu gibi kopyalanır. Bedava ve anında.
//   "varyant" — seçilen sorulardan AYNI BİLGİYİ ölçen yeni sorular üretilir.
//     Bir üretim + bir denetim çağrısı. Ölçüldü: girdi bir dersin dörtte biri
//     ama çıktı bir ders kadar (20 soruluk metin), yani maliyet bir dersin
//     kabaca %60'ı — ucuz değil, bilinçli tercih olmalı.
// Varyant gerektiği an havuzun tükendiği andır: ablam soruların çoğunu zaten
// cevapladıysa kopya, hatırlamayı ölçer, bilgiyi değil.
//
// Varyant üretimi başarısız olursa soru KAYBEDİLMİYOR: o slot kaynağın kopyasına
// düşüyor. Yani en kötü durumda "kopya" moduna gerilenir, hata ekranı görülmez.

interface KaynakSoru {
  id: string;
  session_id: string;
  video_id: string | null;
  kind: string;
  question: string;
  answer_key: string | null;
  key_points: unknown;
  choices: unknown;
  correct_index: number | null;
  explanation: string | null;
  topic: string | null;
  start_seconds: number | null;
}

/** Fisher-Yates */
function karistir<T>(dizi: T[]): T[] {
  const k = [...dizi];
  for (let i = k.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [k[i], k[j]] = [k[j], k[i]];
  }
  return k;
}

/**
 * Dersler arasında sırayla dolaşarak seçer: bir dersin bütün soruları alınıp
 * diğerine hiç sıra gelmemesin diye. Her dersin kendi içindeki sıra rastgele.
 *
 * Seçim BİLEREK tamamen rastgele — geçmiş performansa (yanlış/eksik/pas) göre
 * ağırlıklandırılmıyor. Zayıf konu havuzu ve aralıklı tekrar açıkça istenmedi;
 * bu özellik onların yerine geçmiyor, sadece karışık tekrar sağlıyor.
 */
function derslereYayarakSec(gruplar: KaynakSoru[][], adet: number): KaynakSoru[] {
  // GRUP SIRASI DA KARIŞTIRILIYOR. Fonksiyon 20 soruluk bir test için yazılmıştı;
  // orada sıra önemsizdi çünkü zaten her gruptan alınıyordu. Akış tek soruya
  // dönünce (adet = 1) döngü yalnızca kuyruklar[0][0]'ı alır oldu — yani ders
  // seçilmiyor, havuzun sırası neyse o belirliyordu. Grup sırası karışınca
  // adet = 1'de de her ders eşit şansa sahip oluyor.
  const kuyruklar = karistir(gruplar).map((g) => karistir(g));
  const secilen: KaynakSoru[] = [];
  let tur = 0;
  while (secilen.length < adet) {
    let buTurdaEklendi = false;
    for (const kuyruk of kuyruklar) {
      if (secilen.length >= adet) break;
      if (kuyruk.length > tur) {
        secilen.push(kuyruk[tur]);
        buTurdaEklendi = true;
      }
    }
    if (!buTurdaEklendi) break; // bütün kuyruklar tükendi
    tur++;
  }
  return secilen;
}

interface Varyant {
  question: string;
  answer_key: string | null;
  key_points: string[];
  choices: string[] | null;
  correct_index: number | null;
  explanation: string | null;
}

interface HamVaryant {
  no?: unknown;
  soru?: unknown;
  secenekler?: unknown;
  dogru?: unknown;
  aciklama?: unknown;
  anahtar?: unknown;
  kilit_kavramlar?: unknown;
}

const metin = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const dizi = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];

/**
 * Kaynak sorulardan aynı bilgiyi ölçen yeni sorular üretir.
 *
 * Dönen harita kaynak soru kimliğinden varyanta; bir soru için varyant yoksa
 * çağıran kaynağın kopyasını yazıyor. Hiçbir aşamada hata fırlatılmıyor —
 * varyant bir iyileştirme, tekrar oturumunun kendisi ona bağlı değil.
 */
async function varyantUret(kaynaklar: KaynakSoru[]): Promise<Map<string, Varyant>> {
  const sonuc = new Map<string, Varyant>();
  if (!kaynaklar.length) return sonuc;

  const liste = kaynaklar
    .map((s, i) => {
      const p = [`${i + 1}. SORU: ${s.question}`];
      if (s.kind === "coktan") {
        const sec = Array.isArray(s.choices) ? (s.choices as string[]) : [];
        const di = s.correct_index ?? 0;
        p.push(`   TÜR: çoktan seçmeli`);
        p.push(`   DOĞRU CEVAP: ${sec[di] ?? "?"}`);
        if (s.explanation) p.push(`   AÇIKLAMA: ${s.explanation}`);
      } else {
        p.push(`   TÜR: açık uçlu`);
        if (s.answer_key) p.push(`   BEKLENEN CEVAP: ${s.answer_key}`);
        const kk = Array.isArray(s.key_points) ? (s.key_points as string[]) : [];
        if (kk.length) p.push(`   KİLİT KAVRAMLAR: ${kk.join(", ")}`);
      }
      if (s.topic) p.push(`   KONU: ${s.topic}`);
      return p.join("\n");
    })
    .join("\n\n");

  let ham: { varyantlar?: HamVaryant[] };
  try {
    const cevap = await chatJsonOlculu<{ varyantlar?: HamVaryant[] }>({
      mesajlar: [
        { role: "system", content: tekrarVaryantPrompt(SIK_SAYISI) },
        { role: "user", content: liste },
      ],
      maxTokens: 32000,
    });
    ham = cevap.veri;
  } catch {
    // Üretim düşerse tekrar yine kurulur, sadece kopyalarla
    console.warn("[ders] varyant üretimi başarısız, kopyalara düşülüyor");
    return sonuc;
  }

  for (const v of ham.varyantlar ?? []) {
    const no = typeof v.no === "number" ? v.no : NaN;
    if (!Number.isInteger(no) || no < 1 || no > kaynaklar.length) continue;
    const kaynak = kaynaklar[no - 1];
    const soru = metin(v.soru);
    if (!soru) continue;

    // Kaynağın cümlesi kopyalanmışsa varyant değil; slot kopyaya düşsün.
    if (!yeterinceFarkli(soru, kaynak.question)) continue;

    if (kaynak.kind === "coktan") {
      // Şık kuralı ders üretimiyle AYNI kapıdan geçiyor (lib/ders.ts)
      const k = sikSetiniDogrula(v.secenekler, v.dogru, SIK_SAYISI);
      if (!k) continue;
      const aciklama = metin(v.aciklama);
      sonuc.set(kaynak.id, {
        question: soru,
        answer_key: null,
        key_points: [],
        choices: k.secenekler,
        correct_index: k.dogruIndeks,
        explanation: aciklama ? hukumOneksizAciklama(aciklama) : null,
      });
    } else {
      const anahtar = metin(v.anahtar);
      if (!anahtar) continue;
      // Açık uçluda varyantı asıl değiştiren şey anahtarın yeniden yazılması;
      // kaynağınkinin kopyası gelirse varyant sayılmaz.
      if (!yeterinceFarkli(anahtar, kaynak.answer_key ?? "")) continue;
      sonuc.set(kaynak.id, {
        question: soru,
        answer_key: anahtar,
        key_points: dizi(v.kilit_kavramlar),
        choices: null,
        correct_index: null,
        explanation: null,
      });
    }
  }

  await varyantlariDenetle(kaynaklar, sonuc);
  return sonuc;
}

/**
 * Varyantların olgu denetimi. Yalnızca OLGU denetimi çalışıyor, transkript
 * denetimi değil: varyantlar farklı derslerden geliyor, transkript denetimi ders
 * başına ayrı çağrı ve ayrı transkript isterdi (10 ders ≈ 100 bin token). Derse
 * sadakat kaynağın kendisinden devralınıyor — kaynak soru zaten transkript
 * denetiminden geçmişti ve prompt yeni bilgi eklemeyi yasaklıyor.
 *
 * Bu bilinçli bir zayıflama: varyant derse sadık kalmazsa yakalanmaz.
 * Hatalı bulunan varyant düzeltilmiyor, DÜŞÜRÜLÜYOR — o slot kaynağın
 * kopyasına dönüyor, yani ablam yine soru kaybetmiyor.
 */
async function varyantlariDenetle(kaynaklar: KaynakSoru[], varyantlar: Map<string, Varyant>) {
  const girdiler = kaynaklar
    .map((k, i) => ({ k, v: varyantlar.get(k.id), no: i + 1 }))
    .filter((x): x is { k: KaynakSoru; v: Varyant; no: number } => !!x.v);
  if (!girdiler.length) return;

  const liste = girdiler
    .map(({ v }, i) => {
      const p = [`${i + 1}. SORU: ${v.question}`];
      if (v.choices?.length) {
        v.choices.forEach((o, j) => p.push(`   ${"ABCDE"[j] ?? j + 1}) ${o}`));
        p.push(`   İŞARETLİ DOĞRU CEVAP: ${"ABCDE"[v.correct_index ?? 0] ?? "?"}`);
      }
      if (v.answer_key) p.push(`   anahtar: ${v.answer_key}`);
      if (v.explanation) p.push(`   aciklama: ${v.explanation}`);
      return p.join("\n");
    })
    .join("\n\n");

  try {
    const { veri } = await chatJsonOlculu<{ hatalar?: { no?: unknown }[] }>({
      mesajlar: [
        { role: "system", content: SORU_OLGU_DENETIMI },
        { role: "user", content: liste },
      ],
      maxTokens: 8000,
      rol: "denetim",
    });
    const bulgular = veri.hatalar ?? [];
    // Yarıdan fazlası işaretlendiyse hatalı olan büyük ihtimalle denetimin
    // kendisidir; ders üretimindeki emniyet valfinin aynısı.
    if (bulgular.length > girdiler.length / 2) {
      console.warn(`[ders] varyant denetimi valfe takıldı (${bulgular.length}/${girdiler.length})`);
      return;
    }
    for (const b of bulgular) {
      const no = typeof b?.no === "number" ? b.no : NaN;
      const hedef = girdiler[no - 1];
      if (!hedef) continue;
      varyantlar.delete(hedef.k.id);
      console.warn(`[ders] varyant düşürüldü: ${hedef.v.question.slice(0, 60)}`);
    }
  } catch {
    // Denetim düşerse varyantlar yine kullanılır, sadece denetlenmemiş olur
    console.warn("[ders] varyant denetimi çalışmadı");
  }
}

/** Gövde: { kategori, mod? } -> { sessionId, soruSayisi, dersSayisi, varyantSayisi } */
export async function POST(request: Request) {
  const engel = await kapiKontrol();
  if (engel) return engel;

  try {
    let govde: Record<string, unknown>;
    try {
      govde = await request.json();
    } catch {
      return NextResponse.json({ hata: "Geçersiz istek gövdesi." }, { status: 400 });
    }
    const sessionId = typeof govde.sessionId === "string" ? govde.sessionId : "";
    const adet = Math.min(Math.max(Number(govde.adet) || 1, 1), TEKRAR_SORU_SAYISI);
    let kategori = typeof govde.kategori === "string" ? govde.kategori.trim() : "";
    // Varsayılan KOPYA: bedava ve anlık olan varsayılan olsun, para harcayan
    // bilinçli tercih olsun. Ölçüldü — varyant üretimi bir dersin kabaca %60'ı
    // kadar tutuyor (girdi düşüyor ama çıktı bir ders kadar metin üretiyor).
    const mod = govde.mod === "varyant" ? "varyant" : "kopya";

    const supabase = createServerSupabaseClient();

    // Mevcut pratik oturumuna ekleme: kategori oturumdan okunuyor, çağıranın
    // göndermesine gerek yok.
    let mevcutOturum: { id: string; kategori: string | null } | null = null;
    if (sessionId) {
      const { data } = await supabase
        .from("ders_sessions")
        .select("id, kategori, tur")
        .eq("id", sessionId)
        .maybeSingle();
      if (!data || data.tur !== "tekrar") {
        return NextResponse.json({ hata: "Pratik oturumu bulunamadı." }, { status: 404 });
      }
      mevcutOturum = { id: data.id, kategori: data.kategori };
      kategori = (data.kategori ?? "").trim();
    }

    if (!kategori) {
      return NextResponse.json({ hata: "kategori gerekli." }, { status: 400 });
    }

    // "Soru Gönder" her basışta YENİ bir pratik başlatıyor; eskisine devam
    // edilmiyor. Bir pratik bittiğinde biter — sayaç da o pratiğe ait olur,
    // aylardır biriken bir toplama değil.
    //
    // Eski pratikler sınırsız birikmesin ama HEPSİ de silinmesin: son birkaçı
    // duruyor, çünkü soru seçimi "en uzun süredir görülmemiş" ölçütünü onların
    // cevaplarından çıkarıyor. Hepsi silinseydi her yeni pratikte hafıza
    // sıfırlanır ve aynı soru arka arkaya gelebilirdi.
    //
    // Arayüzde yine yalnızca EN SON pratik görünüyor (liste created_at'e göre
    // sıralı, başlık ilkini alıyor), yani "pratik bitince biter" davranışı
    // değişmiyor — saklanan şey ekranda değil, seçimde kullanılıyor.
    if (!mevcutOturum) {
      const { data: eskiler } = await supabase
        .from("ders_sessions")
        .select("id")
        .eq("kategori", kategori)
        .eq("tur", "tekrar")
        .order("created_at", { ascending: false })
        .range(SAKLANAN_PRATIK - 1, 999);
      const silinecek = (eskiler ?? []).map((o) => o.id);
      if (silinecek.length) {
        await supabase.from("ders_sessions").delete().in("id", silinecek);
      }
    }

    // Havuz: bu kategorideki TAMAMLANMIŞ ders oturumları. Tekrar oturumları
    // dışarıda — yoksa kopyanın kopyası üretilir ve aynı soru katlanarak çoğalır.
    const { data: dersler, error: dersHatasi } = await supabase
      .from("ders_sessions")
      .select("id, title, topics, video_id")
      .eq("kategori", kategori)
      .eq("tur", "ders")
      .eq("status", "hazir")
      .order("created_at", { ascending: false })
      .limit(100);

    if (dersHatasi) throw new Error(dersHatasi.message);
    if (!dersler?.length) {
      return NextResponse.json(
        { hata: `"${kategori}" kategorisinde tamamlanmış ders yok.` },
        { status: 404 }
      );
    }

    const dersKimlikleri = dersler.map((d) => d.id);
    const { data: sorular, error: soruHatasi } = await supabase
      .from("ders_questions")
      .select(
        "id, session_id, video_id, kind, question, answer_key, key_points, choices, correct_index, explanation, topic, start_seconds"
      )
      .in("session_id", dersKimlikleri)
      // Ablamın itiraz edip düzeltilemeyen soruları havuza girmiyor. Önceden
      // işaret yalnızca bir not düşüyordu ve aynı bozuk soru bir sonraki
      // pratikte yeniden karşısına çıkıyordu — itirazın hiçbir karşılığı yoktu.
      .eq("flagged", false)
      .limit(2000);

    if (soruHatasi) throw new Error(soruHatasi.message);

    let havuz = (sorular ?? []) as KaynakSoru[];

    // Aynı soruyu bu pratikte ikinci kez sormayalım. Havuz tükenirse baştan
    // başlıyoruz — döngünün durmaması, tekrar etmemesinden önemli.
    if (mevcutOturum) {
      const { data: kullanilan } = await supabase
        .from("ders_questions")
        .select("kaynak_soru_id")
        .eq("session_id", mevcutOturum.id)
        .limit(2000);
      const gorulen = new Set(
        (kullanilan ?? []).map((k) => k.kaynak_soru_id).filter(Boolean) as string[]
      );
      const kalan = havuz.filter((s) => !gorulen.has(s.id));
      if (kalan.length >= adet) havuz = kalan;
    }

    if (havuz.length < 1) {
      return NextResponse.json(
        { hata: `"${kategori}" kategorisinde soru yok.` },
        { status: 404 }
      );
    }

    // --- Tazelik: en uzun süredir görülmemiş sorulara öncelik -----------------
    //
    // Seçim önceden 110 soru arasında saf rastgeleydi; ablamın dün çözdüğü soru
    // bugün yine gelebiliyor, hiç görmediği soru ise sıraya hiç girmeyebiliyordu.
    //
    // "Görülme" hem dersin kendi çözümünü hem pratik kopyalarını kapsıyor:
    // kopyanın kaynak_soru_id'si sayesinde ikisi aynı soruya işaret ediyor.
    //
    // Bu, reddedilen "zayıf konu havuzu" DEĞİL: doğru/yanlış geçmişine
    // bakmıyor, zorluk ayarlamıyor. Yalnızca kendini tekrar etmiyor.
    const kategoriOturumlari = [...dersKimlikleri];
    {
      const { data: pratikler } = await supabase
        .from("ders_sessions")
        .select("id")
        .eq("kategori", kategori)
        .eq("tur", "tekrar")
        // Sıralama şart: sınır kadar satır çekiliyor, sırasız bırakılırsa
        // hangi pratiklerin geleceği garanti değil.
        .order("created_at", { ascending: false })
        .limit(SAKLANAN_PRATIK);
      for (const o of pratikler ?? []) kategoriOturumlari.push(o.id);
    }

    const sonGorulme = new Map<string, number>();
    if (kategoriOturumlari.length) {
      const [{ data: tumSorular }, { data: cevaplar }] = await Promise.all([
        supabase
          .from("ders_questions")
          .select("id, kaynak_soru_id")
          .in("session_id", kategoriOturumlari)
          .limit(3000),
        supabase
          .from("ders_answers")
          .select("question_id, created_at")
          .in("session_id", kategoriOturumlari)
          .limit(3000),
      ]);
      // Kopya -> kaynak eşlemesi; ders sorusu kendine işaret eder
      const kaynagi = new Map<string, string>();
      for (const q of tumSorular ?? []) kaynagi.set(q.id, q.kaynak_soru_id ?? q.id);
      for (const c of cevaplar ?? []) {
        const kaynak = kaynagi.get(c.question_id);
        if (!kaynak) continue;
        const t = new Date(c.created_at).getTime();
        if (!Number.isFinite(t)) continue;
        const onceki = sonGorulme.get(kaynak);
        if (onceki === undefined || t > onceki) sonGorulme.set(kaynak, t);
      }
    }

    // Hiç görülmemişler en başa (-1), sonra en eskiden yeniye
    const sirayaGore = [...havuz].sort(
      (a, b) => (sonGorulme.get(a.id) ?? -1) - (sonGorulme.get(b.id) ?? -1)
    );
    const pay = Math.max(adet * 10, Math.ceil(sirayaGore.length * TAZELIK_PAYI));
    havuz = sirayaGore.slice(0, Math.max(adet, Math.min(pay, sirayaGore.length)));

    // VİDEOYA göre grupla, oturuma göre değil. Aynı video iki kez işlenmişse
    // (ilk denemede bir şey ters gittiyse) iki oturum oluyor ve o ders havuzda
    // iki pay alıyordu — ölçüldü: 10 oturum ama 9 video, biri 8+7=15 soruyla
    // en büyük ikinci ders görünüyordu. Video başına gruplayınca her ders bir
    // pay alıyor; ayrıca uzun ders (20 soru) ile kısa ders (5 soru) arasındaki
    // dört kat fark da kapanıyor, çünkü seçim gruplar arasında eşit dağılıyor.
    const gruplar = new Map<string, KaynakSoru[]>();
    for (const s of havuz) {
      const anahtar = s.video_id ?? s.session_id;
      const g = gruplar.get(anahtar);
      if (g) g.push(s);
      else gruplar.set(anahtar, [s]);
    }
    const secilen = derslereYayarakSec([...gruplar.values()], adet);

    // Soru sırası da karışsın: derslere yayarak seçmek sırayı ders ders diziyor,
    // oysa istenen şey konuların birbirine karışması.
    const sirali = karistir(secilen);

    // ------------------------------------------------------------- varyant
    const varyantlar =
      mod === "varyant" ? await varyantUret(sirali) : new Map<string, Varyant>();

    // Ders sayısı da videoya göre: aynı videonun iki oturumu tek ders sayılmalı
    const kaynakDersler = new Set(sirali.map((s) => s.video_id ?? s.session_id));
    const konular = [
      ...new Set(
        dersler
          .filter((d) => kaynakDersler.has(d.id))
          .flatMap((d) => ((d.topics as string[]) ?? []))
      ),
    ].slice(0, 12);

    // Var olan pratik oturumuna ekliyorsak yenisini açmıyoruz.
    let oturumId = mevcutOturum?.id ?? "";
    if (!oturumId) {
      const { data: oturum, error: oturumHatasi } = await supabase
        .from("ders_sessions")
        .insert({
          // Pratik oturumu tek bir videoya ait değil; bu alan yalnızca NOT NULL
          // kısıtını ve yabancı anahtarı karşılıyor. Soru-video ilişkisi
          // ders_questions.video_id üzerinden kuruluyor.
          video_id: sirali[0].video_id ?? dersler[0].video_id,
          title: `${kategori} pratiği`,
          kategori,
          tur: "tekrar",
          summary: `${kategori} derslerinden karışık pratik. Sınırı yok; istediğin kadar soru çözebilirsin.`,
          topics: konular,
          status: "hazir",
        })
        .select("id")
        .single();

      if (oturumHatasi || !oturum) {
        throw new Error(`Pratik oturumu oluşturulamadı: ${oturumHatasi?.message ?? "bilinmiyor"}`);
      }
      oturumId = oturum.id;
    }

    // Ekleme modunda pozisyonlar mevcut sorulardan sonra devam etmeli
    let sonrakiPozisyon = 0;
    if (mevcutOturum) {
      const { count } = await supabase
        .from("ders_questions")
        .select("id", { count: "exact", head: true })
        .eq("session_id", oturumId);
      sonrakiPozisyon = count ?? 0;
    }

    const { data: eklenen, error: kopyaHatasi } = await supabase
      .from("ders_questions")
      .insert(
      sirali.map((s, i) => {
        // Varyant üretilemediyse slot kaynağın kopyasına düşer — soru kaybolmaz.
        const v = varyantlar.get(s.id);

        // KOPYADA ŞIKLAR YENİDEN KARIŞTIRILIYOR. Kaynağın dizilişi aynen
        // alınsaydı doğru cevap ilk çözümdeki harfte kalırdı ve ablam soruyu
        // değil "bu C'ydi"yi hatırlayarak doğru yapabilirdi — tekrarın ölçtüğü
        // şey bilgi olmaktan çıkardı. Varyantın şıkları zaten üretim sırasında
        // karıştırıldığı için ona dokunulmuyor.
        const kaynakSecenekler = Array.isArray(s.choices) ? (s.choices as string[]) : null;
        // ÖNCÜLLÜ SORULAR KARIŞTIRILMIYOR: "Yalnız I / I ve II / I, II ve III"
        // dizisi sınavdaki sırasıyla okunuyor, karıştırılınca liste okunamaz
        // hâle geliyor. Bu sorularda harf ezberi riski de düşük: cevap harfin
        // kendisi değil, öncüllerin hangisinin doğru olduğu.
        const karisik =
          !v &&
          kaynakSecenekler?.length &&
          typeof s.correct_index === "number" &&
          !onculluSiklarMi(kaynakSecenekler)
            ? siklariKaristir(kaynakSecenekler, s.correct_index)
            : null;

        return {
        session_id: oturumId,
        kaynak_soru_id: s.id,
        // Video ve zaman damgası KAYNAKTAN devralınıyor: varyant aynı bilgiyi
        // ölçtüğü için videoda aynı yerde anlatılıyor. Böylece "videoda 12:43"
        // bağlantısı ve açık uçlu değerlendiricinin transkript penceresi doğru
        // kalıyor — varyant için bunları yeniden hesaplamaya gerek yok.
        video_id: s.video_id,
        position: sonrakiPozisyon + i,
        kind: s.kind,
        question: v?.question ?? s.question,
        answer_key: v ? v.answer_key : s.answer_key,
        key_points: (v ? v.key_points : (s.key_points as string[] | null)) ?? [],
        choices: v ? v.choices : (karisik?.secenekler ?? s.choices),
        correct_index: v ? v.correct_index : (karisik?.dogruIndeks ?? s.correct_index),
        explanation: v ? v.explanation : s.explanation,
        topic: s.topic,
        start_seconds: s.start_seconds ?? 0,
        // İşaret kopyaya taşınmıyor: ablam kaynağı işaretlemiş olabilir ama
        // bu ayrı bir çözüm denemesi, kendi işaretini kendisi versin.
        flagged: false,
        };
      })
      )
      // Eklenen satırlar geri dönüyor: arayüz bunları listesine ekleyip
      // sayfayı yenilemeden sıradaki soruya geçiyor.
      .select(
        "id, session_id, video_id, kaynak_soru_id, position, kind, question, answer_key, key_points, choices, correct_index, explanation, topic, start_seconds, flagged"
      );

    if (kopyaHatasi) {
      // Yeni açılmış ama sorusuz kalan oturum listede ölü bir satır olurdu.
      // Mevcut oturuma eklerken silmiyoruz — içinde ablamın cevapları var.
      if (!mevcutOturum) await supabase.from("ders_sessions").delete().eq("id", oturumId);
      throw new Error(`Pratik soruları hazırlanamadı: ${kopyaHatasi.message}`);
    }

    return NextResponse.json({
      sessionId: oturumId,
      sorular: eklenen ?? [],
      soruSayisi: (eklenen ?? []).length,
      dersSayisi: kaynakDersler.size,
      varyantSayisi: varyantlar.size,
      mod,
    });
  } catch (err) {
    return hataCevabi(err);
  }
}
