import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { DEFAULT_PROFILE } from "../../lib/jobs/types";

test("PostgreSQL migration, RLS, atomic locks/budgets and profile revisions", async () => {
  const pg = new PGlite({ extensions: { pgcrypto } });
  try {
    await pg.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    const migration = await readFile(new URL("../../db/jobs.sql", import.meta.url), "utf8");
    await pg.exec(migration);
    await pg.exec(migration); // Re-running the setup must preserve data/schema.
    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222-2222-4222-8222-222222222222";
    const claim = async (id: string) => (await pg.query<{ ok: boolean }>("select job_claim_lock('worker', $1) as ok", [id])).rows[0].ok;
    assert.equal(await claim(a), true);
    assert.equal(await claim(b), false);
    await pg.query("delete from job_locks where owner=$1", [b]);
    assert.equal(await claim(b), false, "a different owner cannot release the lease");
    await pg.exec("update job_locks set expires_at=now()-interval '1 second'");
    assert.equal(await claim(b), true);
    for (const expected of [true, true, false]) {
      const r = await pg.query<{ ok: boolean }>("select job_take_budget('ai', 2) as ok");
      assert.equal(r.rows[0].ok, expected);
    }
    const p = { ...DEFAULT_PROFILE, email: "old@example.com" };
    const save = async (profile: unknown, version: number, changed: boolean) => (await pg.query<{ v: number }>("select job_save_profile($1::jsonb, $2, $3) as v", [JSON.stringify(profile), version, changed])).rows[0].v;
    assert.equal(await save(p, 0, true), 1);
    const job = (await pg.query<{ id: string }>("insert into job_listings(fingerprint,title,company,url,source,source_id,profile_version,score) values('unique','Designer','Acme','https://example.com/1','test','1',1,80) returning id")).rows[0].id;
    await pg.query("insert into job_notifications(job_id,recipient,subject,body,sender) values($1,'old@example.com','Job','Body','sender@example.com')", [job]);
    assert.equal(await save({ ...p, threshold: 85 }, 1, false), 2);
    assert.equal((await pg.query<{ v: number }>("select profile_version as v from job_listings")).rows[0].v, 2, "settings changes reuse assessments atomically");
    await assert.rejects(save(p, 1, true), /conflict/);
    assert.equal((await pg.query<{ v: number }>("select version as v from job_profile")).rows[0].v, 2);
    assert.equal(await save({ ...p, skills: "New", email: "new@example.com" }, 2, true), 3);
    assert.equal((await pg.query<{ v: number }>("select profile_version as v from job_listings")).rows[0].v, 2, "career changes queue reassessment");
    assert.equal((await pg.query("select * from job_notifications")).rows.length, 0, "unattempted old payloads can be rebuilt");
    await pg.query("insert into job_notifications(job_id,recipient,subject,body,sender,attempts) values($1,'new@example.com','Job','Body','sender@example.com',1)", [job]);
    await save({ ...p, skills: "Other" }, 3, true);
    assert.equal((await pg.query<{ status: string }>("select status from job_notifications")).rows[0].status, "cancelled", "ambiguous attempted messages are not silently mutated");
    await assert.rejects(pg.query("insert into job_listings(fingerprint,title,company,url,source,source_id) values('unique','Other','Other','https://example.com/2','test','2')"), /unique/);
    for (let i = 0; i < 11; i++) assert.equal((await pg.query<{ ok: boolean }>("select job_auth_allow('test') as ok")).rows[0].ok, i < 10);
    await pg.exec("set role anon");
    await assert.rejects(pg.query("select * from job_profile"), /permission denied/);
    await assert.rejects(pg.query("select * from job_notifications"), /permission denied/);
    await assert.rejects(pg.query("select job_take_budget('ai',999)"), /permission denied/);
    await pg.exec("reset role; set role service_role");
    assert.equal((await pg.query("select * from job_profile")).rows.length, 1);
  } finally { await pg.close(); }
});
