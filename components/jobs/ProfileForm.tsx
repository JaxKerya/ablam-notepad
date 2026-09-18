"use client";
import { BriefcaseBusiness, Compass, GraduationCap, Mail, Save, SlidersHorizontal, UserRound } from "lucide-react";
import type { Profile } from "@/lib/jobs/types";
import s from "./jobs.module.css";

const listFields = ["roles", "sectors", "interests", "locations", "greenhouseBoards", "leverBoards"] as const;
export default function ProfileForm({ profile, busy, onSave, onTest }: { profile: Profile; busy: boolean; onSave: (p: Profile) => void; onTest: () => void }) {
  return <form onSubmit={e => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const p = { ...profile };
    for (const name of listFields) p[name] = String(data.get(name) || "").split(/[,\n]/).map(v => v.trim()).filter(Boolean);
    for (const name of ["name", "skills", "experience", "education", "languages", "constraints", "email"] as const) p[name] = String(data.get(name) || "");
    for (const name of ["threshold", "intervalMinutes", "maxAgeDays"] as const) p[name] = Number(data.get(name));
    p.workModes = data.getAll("workModes") as string[];
    p.sources = data.getAll("sources") as Profile["sources"];
    p.emailEnabled = data.get("emailEnabled") === "on";
    p.enabled = data.get("enabled") === "on";
    onSave(p);
  }}>
    <div className={s.formLayout}>
      <div className={s.stack}>
        <section className={s.panel}>
          <h2 className={s.sectionTitle}><UserRound size={17} /> Seni tanıyalım</h2>
          <p className={s.muted}>Ne yaptığını ve neler yapabileceğini anlat. Eşleşmeler bu bilgilerle anlam kazanacak.</p>
          <div className={s.formGrid}>
            <Field label="Adın" name="name" value={profile.name} placeholder="Sana nasıl hitap edelim?" max={100} />
            <Field label="Yaşadığın / çalışabileceğin şehirler" name="locations" value={profile.locations.join(", ")} placeholder="İstanbul, Ankara" hint="Şehirleri virgülle ayır. Ülke dışı aramalarda ülke adını da yaz." />
            <Field label="Yetkin olduğun meslekler" name="roles" value={profile.roles.join(", ")} placeholder="Yapabildiğin pozisyonları yaz" wide hint="Virgülle ayır. İlk aramalar bu mesleklerden başlayacak." />
            <Field label="Deneyimli olduğun sektörler" name="sectors" value={profile.sectors.join(", ")} placeholder="Örn. eğitim, perakende, animasyon" wide />
            <Field label="Becerilerin ve kullandığın araçlar" name="skills" value={profile.skills} placeholder="Yapabildiğin işleri, programları ve güçlü yanlarını anlat…" area wide />
            <Field label="İş deneyimin" name="experience" value={profile.experience} placeholder="Görevlerin, kaç yıl çalıştığın ve yaptığın işler…" area wide />
          </div>
        </section>
        <section className={s.panel}>
          <h2 className={s.sectionTitle}><Compass size={17} /> Yeni ihtimallere de bakalım</h2>
          <p className={s.muted}>AI, becerilerinin işe yarayabileceği yakın meslekleri de araştırır.</p>
          <div className={s.formGrid}>
            <Field label="İlgini çeken başka işler" name="interests" value={profile.interests.join(", ")} placeholder="Denemeye açık olduğun meslekler" wide hint="Virgülle ayır. Buraya yazdıkların aramalara dahil edilir." />
            <Field label="Eğitim ve sertifikalar" name="education" value={profile.education} placeholder="Bölüm, diploma, sertifika…" area />
            <Field label="Bildiğin diller ve seviyeleri" name="languages" value={profile.languages} placeholder="Örn. İngilizce B2" area />
            <div className={`${s.field} ${s.wide}`}><span>Çalışma biçimi</span><div className={s.actions}>{["Ofis", "Hibrit", "Uzaktan"].map(mode => <label key={mode} className={s.check}><input type="checkbox" name="workModes" value={mode} defaultChecked={profile.workModes.includes(mode)} />{mode}</label>)}</div></div>
            <Field label="Vazgeçilmezlerin ve istemediklerin" name="constraints" value={profile.constraints} placeholder="Ücret beklentisi (para birimi ve aylık/yıllık), çalışma saatleri, ulaşım, taşınma ve çalışma izni gibi koşullar…" area wide hint="Kesin şartlarını açık yaz. Belirtilmeyen bilgiler varsayılmaz." />
          </div>
        </section>
        <section className={s.panel}>
          <h2 className={s.sectionTitle}><BriefcaseBusiness size={17} /> Nerelerde arayalım?</h2>
          <p className={s.muted}>Genel aramaların yanına ilgilendiğin şirketlerin kariyer panolarını ekleyebilirsin.</p>
          <div className={s.formGrid}>
            <div className={s.wide}>{[["jooble", "Jooble — farklı iş sitelerinden ilanlar"], ["google", "Google İşler — web genelindeki iş ilanları"], ["greenhouse", "Greenhouse — seçtiğin şirketler"], ["lever", "Lever — seçtiğin şirketler"]].map(([key, title]) => <label key={key} className={s.check}><input type="checkbox" name="sources" value={key} defaultChecked={profile.sources.includes(key as Profile["sources"][number])} />{title}</label>)}</div>
            <Field label="Greenhouse şirket panoları" name="greenhouseBoards" value={profile.greenhouseBoards.join(", ")} placeholder="sirketadi, digersirket" hint="boards.greenhouse.io/sirketadi adresindeki kısa ad. En fazla 10." />
            <Field label="Lever şirket panoları" name="leverBoards" value={profile.leverBoards.join(", ")} placeholder="sirketadi, digersirket" hint="jobs.lever.co/sirketadi adresindeki kısa ad. En fazla 10; global Lever panoları desteklenir." />
          </div>
        </section>
      </div>
      <aside className={s.stack}>
        <section className={s.panel}>
          <h2 className={s.sectionTitle}><Mail size={17} /> Sana haber verelim</h2>
          <div className={s.stack} style={{ marginTop: 18 }}>
            <Field label="E-posta adresin" name="email" type="email" value={profile.email} placeholder="ornek@eposta.com" max={254} />
            <label className={s.check}><input name="emailEnabled" type="checkbox" defaultChecked={profile.emailEnabled} /> Uygun ilanları e-posta ile gönder</label>
            <label className={s.field}>Bildirim için en düşük uygunluk puanı<input className={s.input} name="threshold" type="number" min={0} max={100} required defaultValue={profile.threshold} /><small>70 iyi bir başlangıç. Daha düşük puan, daha fazla keşif fırsatı demek.</small></label>
            <button type="button" onClick={onTest} disabled={busy || !profile.email} className={s.button}><Mail size={14} /> Kayıtlı adrese test gönder</button>
          </div>
        </section>
        <section className={s.panel}>
          <h2 className={s.sectionTitle}><SlidersHorizontal size={17} /> Takip tercihleri</h2>
          <div className={s.stack} style={{ marginTop: 18 }}>
            <label className={s.field}>Kaynak tarama aralığı<select name="intervalMinutes" className={s.input} defaultValue={profile.intervalMinutes}>{[15, 30, 60, 180, 360, 1440].map(n => <option key={n} value={n}>{n < 60 ? `${n} dakika` : `${n / 60} saat`}</option>)}</select><small>Meslek ve şehir sorguları sırayla taranır. Tüm sorguların tamamlanması birden fazla tur sürebilir.</small></label>
            <label className={s.field}>En fazla kaç günlük ilanları inceleyelim?<input className={s.input} name="maxAgeDays" type="number" min={1} max={90} required defaultValue={profile.maxAgeDays} /><small>Tarihi bilinmeyen ilanlar ayrıca işaretlenir.</small></label>
            <label className={s.check}><input type="checkbox" name="enabled" defaultChecked={profile.enabled} /> Otomatik takip açık</label>
          </div>
        </section>
        <div className={s.note}><GraduationCap size={17} style={{ marginBottom: 8 }} />Becerilerin arttıkça profilini güncelle. AI, güncel ilanları yeni profiline göre yeniden değerlendirir. Adın ve e-posta adresin AI değerlendirmesine gönderilmez.</div>
        <button className={`${s.button} ${s.primary}`} disabled={busy} type="submit"><Save size={15} />{busy ? "Kaydediliyor…" : "Profili ve tercihleri kaydet"}</button>
        <p className={s.muted}>Takibi açmadan da profilini kaydedebilirsin. Otomatik çalışma için bir defalık sunucu kurulumu gerekir.</p>
      </aside>
    </div>
  </form>;
}
function Field({ label, name, value, placeholder, hint, area, wide, type = "text", max = 5000 }: { label: string; name: string; value: string; placeholder: string; hint?: string; area?: boolean; wide?: boolean; type?: string; max?: number }) {
  return <label className={`${s.field} ${wide ? s.wide : ""}`}><span>{label}</span>{area ? <textarea name={name} className={s.input} rows={3} defaultValue={value} placeholder={placeholder} maxLength={max} /> : <input name={name} type={type} className={s.input} defaultValue={value} placeholder={placeholder} maxLength={max} />}{hint && <small>{hint}</small>}</label>;
}
