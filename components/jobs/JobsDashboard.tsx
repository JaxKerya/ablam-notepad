"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Bell, Bookmark, BriefcaseBusiness, Check, ChevronLeft, ChevronRight, CircleAlert, Clock3, Compass, ExternalLink, Heart, LoaderCircle, LockKeyhole, LogOut, MapPin, Pause, Play, Radio, RefreshCw, Search, Send, Settings2, Sparkles, UserRound } from "lucide-react";
import type { Dashboard, Job, JobStatus, Profile, SetupCheck } from "@/lib/jobs/types";
import ProfileForm from "./ProfileForm";
import s from "./jobs.module.css";

const date = (value: string | null) => value ? new Date(value).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Henüz yok";
const categories = { direct: "Doğrudan eşleşme", transferable: "Becerilerine yakın", explore: "Keşfetmeye değer", unsuitable: "Koşullar uymuyor" };
const filters = [["matched", "Sana uygun"], ["all", "Tüm ilanlar"], ["saved", "Kaydettiklerin"], ["applied", "Başvurdukların"], ["pending", "AI kuyruğu"], ["dismissed", "Gizlenenler"]];
async function api(path = "", init?: RequestInit) {
  const response = await fetch(`/api/jobs${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers }, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "İşlem tamamlanamadı.");
  return data;
}

export default function JobsDashboard() {
  const [session, setSession] = useState<{ authenticated: boolean; setup: SetupCheck[] } | null>(null);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [tab, setTab] = useState("jobs");
  const [filter, setFilter] = useState("matched");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [list, setList] = useState<{ jobs: Job[]; total: number } | null>(null);
  const [listError, setListError] = useState("");
  const [listLoading, setListLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(async () => {
    const next = await api() as Dashboard;
    setData(next);
    setRevision(v => v + 1);
  }, []);
  const initialize = useCallback(async () => {
    try {
      const next = await api("/session");
      setSession(next);
      if (next.authenticated) await reload();
    } catch (e) { setError((e as Error).message); }
  }, [reload]);
  useEffect(() => { void initialize(); }, [initialize]);
  useEffect(() => {
    if (!session?.authenticated) return;
    const timer = setInterval(() => { void reload().catch(e => setError(e.message)); }, 60000);
    return () => clearInterval(timer);
  }, [session?.authenticated, reload]);
  useEffect(() => {
    if (!data) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setListLoading(true);
      try {
        const result = await api(`?view=list&filter=${filter}&q=${encodeURIComponent(search)}&page=${page}`, { signal: abort.signal });
        setList(result); setListError("");
      } catch (e) { if (!abort.signal.aborted) setListError((e as Error).message); }
      finally { if (!abort.signal.aborted) setListLoading(false); }
    }, 200);
    return () => { clearTimeout(timer); abort.abort(); };
  // Dashboard refresh increments revision; the complete object isn't a list dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!data, filter, search, page, revision]);

  async function action(name: string, work: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(name); setError(""); setNotice("");
    try { await work(); setNotice(success); }
    catch (e) { setError((e as Error).message); }
    finally {
      try { if (session?.authenticated && name !== "logout") await reload(); } catch (e) { setError((e as Error).message); }
      setBusy("");
    }
  }
  const save = (profile: Profile) => action("profile", () => api("", { method: "POST", body: JSON.stringify({ action: "profile", profile, version: data?.profileVersion }) }), "Profilin kaydedildi. Sonraki tarama güncel tercihlerini kullanacak.");
  const status = (id: string, value: JobStatus) => action(id, () => api("", { method: "POST", body: JSON.stringify({ action: "status", id, status: value }) }), "İlan durumu güncellendi.");
  const lastScheduler = data?.runs.find(r => r.trigger === "scheduler");
  const schedulerRecent = !!lastScheduler && Date.now() - Date.parse(lastScheduler.started_at) < 15 * 60000;
  const healthy = data?.profile.enabled && schedulerRecent && lastScheduler.status === "completed";
  const changeFilter = (value: string) => { setFilter(value); setPage(0); setTab("jobs"); };

  return <main className={s.page}><div className={s.shell}>
    <nav className={s.nav} aria-label="Uygulamalar"><Link href="/"><ArrowLeft size={14} /> Ana sayfa</Link><div className={s.actions}><Link href="/sheets">Sheets</Link><span aria-hidden="true">/</span><Link href="/ders">Ders</Link>{session?.authenticated && <button className={s.button} aria-label="İş Fırsatları oturumunu kapat" onClick={() => void action("logout", async () => { await api("/session", { method: "DELETE" }); setSession(v => v ? { ...v, authenticated: false } : v); setData(null); setList(null); }, "Oturum kapatıldı.")} disabled={!!busy}><LogOut size={13} /></button>}</div></nav>
    <header className={s.hero}><div><div className={s.eyebrow}><span className={s.dot} /> ABLAM İÇİN, BİR ADIM DAHA</div><h1>Güzel bir iş, yeni bir başlangıç.</h1><p className={s.muted}>Senin yeteneklerin, senin hayallerin. Sana uyan fırsatları<br className="hidden sm:block" /> birlikte bulalım; bir sonraki adımın burada başlasın.</p></div><div className={s.heroIcon}><BriefcaseBusiness size={32} strokeWidth={1.3} /></div></header>
    {error && <div role="alert" className={s.alert}><CircleAlert size={16} /><span>{error}</span><button onClick={() => setError("")} aria-label="Uyarıyı kapat" style={{ marginLeft: "auto" }}>×</button></div>}
    {notice && <div role="status" className={`${s.alert} ${s.success}`}><Check size={16} /><span>{notice}</span></div>}
    {!session && <div className={s.empty}><LoaderCircle className={s.spinner} size={24} /><p className={s.muted}>İş Fırsatları hazırlanıyor…</p>{error && <button className={s.button} onClick={() => void initialize()}>Yeniden dene</button>}</div>}
    {session && !session.authenticated && <section className={`${s.panel} ${s.login}`}><h2 className={s.sectionTitle}><LockKeyhole size={19} /> Sana özel bir alan</h2><p className={s.muted}>Profilin, iş tercihlerin ve e-posta adresin bu özel alanda saklanır. İş Fırsatları parolanla devam et.</p>
      <form onSubmit={e => { e.preventDefault(); const password = String(new FormData(e.currentTarget).get("password") || ""); void action("login", async () => { await api("/session", { method: "POST", body: JSON.stringify({ password }) }); await initialize(); }, "Hoş geldin. Birlikte fırsatlara bakalım."); }}><label className={s.field}>İş Fırsatları parolası<input name="password" type="password" className={s.input} autoComplete="current-password" required maxLength={200} placeholder="Özel alan parolan" /></label><button className={`${s.button} ${s.primary}`} disabled={!!busy}>{busy === "login" ? <LoaderCircle size={15} className={s.spinner} /> : <ArrowRight size={15} />} Devam et</button></form>
      {session.setup.some(c => !c.ready) && <details className={s.details} style={{ marginTop: 22 }}><summary>İlk kurulum ve bağlantılar</summary><p>Henüz ilk kurulum tamamlanmamış olabilir. Sunucu ayarları bir kez yapıldıktan sonra profilini buradan ekleyebilirsin.</p><Setup checks={session.setup} /><Link className={s.button} href="/is/kurulum">Kurulum rehberini aç <ArrowRight size={13} /></Link></details>}
    </section>}
    {session?.authenticated && !data && <div className={`${s.panel} ${s.empty}`}><Settings2 size={26} /><h2>Bağlantıyı tamamlayalım</h2><p className={s.muted}>Profil ekranı için veritabanı tablolarının kurulmuş olması gerekiyor. Bağlantı hazırsa yeniden deneyebilirsin.</p><div className={s.actions}><button className={s.button} onClick={() => void reload().catch(e => setError(e.message))}>Yeniden dene</button><Link href="/is/kurulum" className={`${s.button} ${s.primary}`}>Kurulum rehberi</Link></div></div>}
    {data && session?.authenticated && <>
      <section className={`${s.panel} ${s.status}`} aria-label="Takip durumu"><div><div className={s.statusTitle}><span className={`${s.dot} ${!healthy ? s.dotOff : ""}`} />{!data.profile.enabled ? "Takip duraklatıldı" : healthy ? "Fırsatların takip ediliyor" : schedulerRecent ? "Takip açık · kontrol gerekli" : "Takip açık · zamanlayıcı bekleniyor"}</div><p className={s.muted} style={{ fontSize: 11, marginTop: 5 }}>{lastScheduler ? `Son otomatik çalışma: ${date(lastScheduler.started_at)}` : "Henüz otomatik tarama kaydı yok."} · {data.sources.length} seçili kaynak panosu</p></div><div className={s.actions}><button className={s.button} disabled={!!busy} onClick={() => void save({ ...data.profile, enabled: !data.profile.enabled })}>{data.profile.enabled ? <Pause size={14} /> : <Play size={14} />}{data.profile.enabled ? "Duraklat" : "Takibi başlat"}</button><button className={`${s.button} ${s.primary}`} disabled={!!busy || !data.profile.enabled} onClick={() => void action("scan", async () => { const result = await api("/scan", { method: "POST" }); if (result.status === "busy" || result.status === "cooldown") throw new Error(result.message); if (result.status === "partial") throw new Error("Tarama bazı uyarılarla tamamlandı. Sistem günlüğünden ayrıntıları görebilirsin."); }, "Tarama turu tamamlandı. Kaynak aralıkları ve günlük sınırlar uygulandı.")}>{busy === "scan" ? <LoaderCircle className={s.spinner} size={14} /> : <RefreshCw size={14} />}{busy === "scan" ? "Taranıyor…" : "Şimdi kontrol et"}</button></div></section>
      <div className={s.stats}>{[
        { label: "Sana uygun", value: data.stats.matched, hint: "Güncel profiline göre", icon: Sparkles, filter: "matched" },
        { label: "İncelenecek", value: data.stats.pending, hint: "AI değerlendirme kuyruğu", icon: Compass, filter: "pending" },
        { label: "Kaydettiklerin", value: data.stats.saved, hint: "Sonra bakmak için", icon: Bookmark, filter: "saved" },
        { label: "Başvurdukların", value: data.stats.applied, hint: "Attığın güzel adımlar", icon: Send, filter: "applied" },
      ].map(item => <button key={item.label} className={`${s.panel} ${s.stat}`} onClick={() => changeFilter(item.filter)}><span className={s.statTop}>{item.label}<item.icon size={15} /></span><strong style={item.filter === "matched" ? { color: "var(--accent)" } : undefined}>{item.value}</strong><span className={s.muted} style={{ fontSize: 10 }}>{item.hint}</span></button>)}</div>
      <nav className={s.tabs} aria-label="İş Fırsatları bölümleri">{[{ key: "jobs", title: "Fırsatlar", icon: BriefcaseBusiness }, { key: "profile", title: "Profilim", icon: UserRound }, { key: "sources", title: "Kaynaklar", icon: Radio }, { key: "activity", title: "Sistem günlüğü", icon: Clock3 }].map(t => <button key={t.key} className={`${s.tab} ${tab === t.key ? s.tabActive : ""}`} aria-current={tab === t.key ? "page" : undefined} onClick={() => setTab(t.key)}><t.icon size={15} />{t.title}</button>)}</nav>
      <section hidden={tab !== "jobs"} aria-label="Fırsatlar">
        {!data.profile.roles.length && <div className={s.note} style={{ marginBottom: 20 }}>İlk adım küçük: mesleklerini ve becerilerini ekle. <button style={{ textDecoration: "underline", color: "var(--accent-light)" }} onClick={() => setTab("profile")}>Profilini oluşturmaya başla →</button></div>}
        <div className={s.toolbar}><div className={s.filters}>{filters.map(([key, title]) => <button key={key} className={`${s.chip} ${filter === key ? s.chipActive : ""}`} aria-pressed={filter === key} onClick={() => changeFilter(key)}>{title}</button>)}</div><label className={s.search}><Search size={15} /><input className={s.input} aria-label="İlan, şirket veya şehir ara" placeholder="İlan, şirket veya şehir ara" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} /></label></div>
        {listError ? <div role="alert" className={s.alert}><CircleAlert size={15} />{listError}<button onClick={() => setRevision(v => v + 1)} className={s.button}>Yeniden dene</button></div> : listLoading || !list ? <div className={s.empty}><LoaderCircle className={s.spinner} size={25} /><p className={s.muted}>Fırsatlar yükleniyor…</p></div> : list.jobs.length ? <><p className={s.muted} style={{ fontSize: 11, marginBottom: 12 }}>{list.total} ilan · Uygunluk puanına göre sıralı</p><div className={s.grid}>{list.jobs.map(job => <JobCard key={job.id} job={job} version={data.profileVersion} busy={!!busy} onStatus={status} />)}</div><div className={s.pagination}><button className={s.button} disabled={page === 0} onClick={() => setPage(v => v - 1)} aria-label="Önceki sayfa"><ChevronLeft size={15} /></button><span>{page + 1} / {Math.max(1, Math.ceil(list.total / 24))}</span><button className={s.button} disabled={(page + 1) * 24 >= list.total} onClick={() => setPage(v => v + 1)} aria-label="Sonraki sayfa"><ChevronRight size={15} /></button></div></> : <div className={`${s.panel} ${s.empty}`}><div className={s.emptyIcon}><Compass size={27} strokeWidth={1.4} /></div><h2>{search ? "Bu aramada bir ilan bulunamadı" : filter === "matched" ? "Yeni fırsatlar için yerin hazır" : "Burada henüz bir ilan yok"}</h2><p className={s.muted}>{search ? "Farklı bir şirket, şehir veya meslek adı deneyebilirsin." : filter === "matched" ? "Profilini tamamlayıp takibi açtığında, sana uygun bulunan gerçek ilanlar gerekçeleriyle burada görünecek." : "İlanlar toplandıkça ve sen kaydedip başvurdukça bu bölüm dolacak."}</p>{!search && <button className={s.button} onClick={() => setTab(filter === "matched" ? "profile" : "sources")}>{filter === "matched" ? "Profilime göz at" : "Kaynakları kontrol et"}<ArrowRight size={14} /></button>}</div>}
      </section>
      <section hidden={tab !== "profile"} aria-label="Profilim"><ProfileForm key={data.profileVersion} profile={data.profile} busy={!!busy} onSave={p => void save(p)} onTest={() => void action("test", () => api("", { method: "POST", body: JSON.stringify({ action: "test-email" }) }), "Test e-postası gönderim servisine iletildi. Gelen kutunu ve spam klasörünü kontrol et.")} /></section>
      <section hidden={tab !== "sources"} aria-label="Kaynaklar"><div className={s.formLayout}><div className={s.stack}><div className={s.panel}><h2 className={s.sectionTitle}><Radio size={17} /> Aramanın ulaştığı yerler</h2><p className={s.muted}>Kaynak başına son sonuç ve hatalar. Şirket panoları tüm açık pozisyonları; arama kaynakları sıradaki meslek ve şehri tarar.</p>{data.sources.length ? data.sources.map(source => <div key={source.id} className={s.source}><div><h3 className={s.sectionTitle}>{source.kind === "google" ? "Google İşler" : source.kind === "jooble" ? "Jooble" : source.kind === "lever" ? "Lever" : "Greenhouse"}{source.board && ` · ${source.board}`}</h3><p className={s.muted} style={{ fontSize: 11 }}>Son başarı: {date(source.last_success)} · {source.last_count} ilan<br />{source.last_query || "Henüz taranmadı"}<br />Sıradaki tarama: {date(source.next_run)}</p>{source.last_error && <p style={{ color: "#ffe1b3", fontSize: 12, marginTop: 9 }}>{source.last_error}</p>}</div><span className={s.badge}>{source.last_error ? "Kontrol gerekli" : source.last_success ? "Bağlantı kuruldu" : "Bekliyor"}</span></div>) : <div className={s.empty}><Radio size={25} /><p className={s.muted}>Seçtiğin kaynaklar ilk taramadan sonra burada görünür.</p><button className={s.button} onClick={() => setTab("profile")}>Kaynak seç</button></div>}</div><div className={s.note}>Her iş sitesinin herkese açık bir veri erişimi yok. LinkedIn, Kariyer.net veya İŞKUR için doğrudan bağlantı kurulmuş sayılmaz; ilanları yalnızca bağlı arama sağlayıcıları döndürürse bulunabilir. Her tur en fazla 4 kaynak panosu işlenir; sorgu başına ilk 5 sayfa taranır. Yeni ilanların yakalanması sağlayıcının güncelleme hızına ve kuyruk yoğunluğuna bağlıdır.</div></div><aside className={s.stack}><div className={s.panel}><h2 className={s.sectionTitle}><Sparkles size={16} /> Aranan meslekler</h2><p className={s.muted}>Profilindeki roller ve AI&apos;ın bulduğu yakın fırsatlar.</p><div className={s.filters} style={{ marginTop: 15 }}>{(data.queries.length ? data.queries : data.profile.roles).map(q => <span className={s.chip} style={{ cursor: "default" }} key={q}>{q}</span>)}</div></div><div className={s.panel}><h2 className={s.sectionTitle}>Bugünkü kullanım</h2><p className={s.muted}>AI: {data.daily.ai} / {data.daily.aiLimit} çağrı<br />Kaynaklar: {data.daily.searches} / {data.daily.searchLimit} çağrı</p><p className={s.muted} style={{ fontSize: 11, marginTop: 10 }}>Sınır dolarsa kuyruk korunur; UTC gece yarısından sonra devam eder.</p></div></aside></div></section>
      <section hidden={tab !== "activity"} aria-label="Sistem günlüğü"><div className={s.formLayout}><div className={s.stack}>
        <section className={s.panel}><h2 className={s.sectionTitle}><Clock3 size={17} /> Son çalışmalar</h2>{!schedulerRecent && <div className={s.alert} style={{ marginTop: 16 }}><CircleAlert size={15} />Son 15 dakika içinde otomatik çalışma kaydı yok. Sunucu zamanlayıcısını kontrol et.</div>}{data.runs.length ? data.runs.map(run => <div className={s.source} key={run.id}><div><h3 className={s.sectionTitle} style={{ fontSize: 12 }}>{date(run.started_at)} · {run.trigger === "scheduler" ? "Otomatik" : "Elle başlatıldı"}</h3><p className={s.muted} style={{ fontSize: 11 }}>{run.found} yeni ilan · {run.evaluated} değerlendirme · {run.sent} e-posta</p>{run.errors.map((e, i) => <p key={i} className={s.muted} style={{ fontSize: 11, color: "#ffe1b3" }}>{e}</p>)}</div><span className={s.badge}>{{ completed: "Tamamlandı", partial: "Uyarılı", failed: "Hata", paused: "Duraklatıldı", running: "Çalışıyor", interrupted: "Kesildi" }[run.status] || run.status}</span></div>) : <p className={s.muted}>İlk taramanın kaydı burada görünecek.</p>}</section>
        <section className={s.panel}><h2 className={s.sectionTitle}><Bell size={17} /> E-posta geçmişi</h2><p className={s.muted}>“Servise iletildi” e-posta sağlayıcısının kabul ettiğini gösterir; gelen kutusuna teslim teyidi değildir.</p>{data.notifications.length ? data.notifications.map(n => <div className={s.source} key={n.id}><div><h3 className={s.sectionTitle} style={{ fontSize: 12 }}>{n.subject}</h3><p className={s.muted} style={{ fontSize: 11 }}>{n.recipient} · {date(n.sent_at || n.created_at)} · {n.attempts} deneme</p>{n.last_error && <p className={s.muted} style={{ fontSize: 11, color: "#ffe1b3" }}>{n.last_error}</p>}</div><span className={s.badge}>{n.status === "sent" ? "Servise iletildi" : n.status === "cancelled" ? "İptal edildi" : "Kuyrukta"}</span></div>) : <p className={s.muted} style={{ marginTop: 14 }}>Henüz e-posta gönderilmedi.</p>}</section></div><aside className={s.panel}><h2 className={s.sectionTitle}><Settings2 size={17} /> Kurulum durumu</h2><Setup checks={data.setup} /><Link href="/is/kurulum" className={s.button}>Kurulum rehberi <ArrowRight size={13} /></Link><p className={s.muted} style={{ marginTop: 15, fontSize: 11 }}>Bağlantı ayarlarının bulunması, servisin erişilebilir olduğunu garanti etmez. Gerçek sonuçlar çalışma günlüğünde görünür.</p></aside></div></section>
    </>}
    <footer className={s.footer}><Heart size={11} style={{ display: "inline", marginRight: 5, color: "var(--accent)" }} /> Abla sevgisi ile yapılmıştır.<br />Her güzel başlangıç, küçük bir adımla.</footer>
  </div></main>;
}

function Setup({ checks }: { checks: SetupCheck[] }) {
  return <div style={{ margin: "12px 0 20px" }}>{checks.map(c => <div key={c.label} style={{ padding: "9px 0", fontSize: 12 }}><div className={s.actions}>{c.ready ? <Check size={13} color="var(--accent)" /> : <CircleAlert size={13} color="#ffe1b3" />}{c.label}<span className={s.badge} style={{ marginLeft: "auto" }}>{c.ready ? "Tanımlı" : "Eksik"}</span></div>{!c.ready && <p className={s.muted} style={{ fontSize: 10, marginTop: 4, overflowWrap: "anywhere" }}>{c.help}</p>}</div>)}</div>;
}
function JobCard({ job, version, busy, onStatus }: { job: Job; version: number; busy: boolean; onStatus: (id: string, status: JobStatus) => void }) {
  const a = job.assessment;
  const current = job.profile_version === version;
  return <article className={`${s.panel} ${s.card}`}><div className={s.cardTop}><div><p className={s.company}>{job.company}</p><h2>{job.title}</h2><div className={s.meta}><span><MapPin size={12} />{job.location || "Konum belirtilmemiş"}</span><span><Clock3 size={12} />{job.published_at ? date(job.published_at) : "Yayın tarihi bilinmiyor"}</span></div></div>{a && current ? <div className={s.score}>{a.score}<small>uygunluk / 100</small></div> : <span className={s.badge}>AI bekliyor</span>}</div>
    {a ? <div className={s.reason}><div className={s.reasonTitle}><Sparkles size={13} />{categories[a.category]}{!current && " · önceki profil"}</div>{a.reason}</div> : <p className={s.muted}>{job.last_error ? "Değerlendirme yeniden denenecek. İlanı bu sırada açabilirsin." : "Profilinle karşılaştırılmak için değerlendirme kuyruğunda."}</p>}
    <details className={s.details}><summary>İlan ve değerlendirme ayrıntıları</summary>{a && <>{[["Güçlü eşleşmeler", a.strengths], ["Eksikler", a.gaps], ["Başvurmadan önce sor", a.questions]].map(([title, items]) => (items as string[]).length > 0 && <div key={title as string}><h3>{title}</h3><ul>{(items as string[]).map((item, i) => <li key={i}>{item}</li>)}</ul></div>)}</>}<h3>İlan açıklaması</h3><p>{job.description || "Kaynak açıklama paylaşmadı. Ayrıntılar için ilanı aç."}</p><p className={s.muted} style={{ fontSize: 10, marginTop: 10 }}>İlk görülme: {date(job.first_seen)}. Uygunluk bir AI tahminidir; başvuru öncesi koşulları ve ilanın hâlâ açık olduğunu doğrula.</p></details>
    <div className={s.cardBottom}><span className={s.badge}>{job.source}</span><div className={s.actions}><button className={s.button} title={job.status === "saved" ? "Kaydı kaldır" : "Sonra bakmak için kaydet"} aria-label={job.status === "saved" ? "Kaydı kaldır" : "İlanı kaydet"} onClick={() => onStatus(job.id, job.status === "saved" ? "new" : "saved")} disabled={busy}><Bookmark size={14} fill={job.status === "saved" ? "currentColor" : "none"} /></button><a href={job.url} target="_blank" rel="noopener noreferrer" className={`${s.button} ${s.primary}`}>İlanı aç <ExternalLink size={13} /></a></div></div>
    <label className={s.field}><span className="sr-only">{job.title} başvuru durumu</span><select className={s.input} style={{ padding: "7px 10px", fontSize: 11 }} value={job.status} disabled={busy} onChange={e => onStatus(job.id, e.target.value as JobStatus)}><option value="new">Henüz başvurmadım</option><option value="saved">Sonra bakmak için kaydettim</option><option value="applied">Başvurdum</option><option value="dismissed">İlgilenmiyorum, gizle</option></select></label>
  </article>;
}
