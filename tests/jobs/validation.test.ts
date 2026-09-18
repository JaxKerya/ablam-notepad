import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROFILE, type Assessment, type Listing } from "../../lib/jobs/types";
import { isRecent, matchingProfile, plainText, safeUrl, shouldNotify, validateAssessment, validateProfile } from "../../lib/jobs/validation";

test("Profile rejects malformed input and cannot enable an incomplete search", () => {
  assert.deepEqual(validateProfile(DEFAULT_PROFILE), DEFAULT_PROFILE);
  assert.throws(() => validateProfile({ ...DEFAULT_PROFILE, enabled: true }));
  assert.throws(() => validateProfile({ ...DEFAULT_PROFILE, sources: ["unknown"] }));
  assert.throws(() => validateProfile({ ...DEFAULT_PROFILE, roles: "designer" }));
  assert.throws(() => validateProfile({ ...DEFAULT_PROFILE, threshold: NaN }));
  assert.throws(() => validateProfile({ ...DEFAULT_PROFILE, intervalMinutes: 0 }));
  assert.throws(() => validateProfile({ ...DEFAULT_PROFILE, email: "bad@" }));
  assert.throws(() => validateProfile({ ...DEFAULT_PROFILE, greenhouseBoards: ["../../admin"] }));
  const p = validateProfile({ ...DEFAULT_PROFILE, roles: ["Tasarımcı", "Tasarımcı"], skills: "Figma", locations: ["İstanbul"], email: "test@example.com", enabled: true });
  assert.deepEqual(p.roles, ["Tasarımcı"]);
});
test("Only safe outbound web links survive; tracking parameters are canonicalized", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "https://user:pass@example.com", "http://127.0.0.1/", "http://192.168.1.2/", "http://localhost/", "http://169.254.169.254/"]) assert.equal(safeUrl(url), null, url);
  assert.equal(safeUrl("https://example.com/job?id=12&utm_source=google#top"), "https://example.com/job?id=12");
  assert.equal(safeUrl("https://example.com/job?id=13"), "https://example.com/job?id=13");
});
test("Unknown dates remain visible and expired dates are filtered", () => {
  assert.equal(isRecent({ published_at: null } as Listing, 30), true);
  assert.equal(isRecent({ published_at: "2020-01-01T00:00:00Z" } as Listing, 30), false);
  assert.equal(isRecent({ published_at: new Date().toISOString() } as Listing, 30), true);
});
const match: Assessment = { score: 80, category: "transferable", reason: "Beceriler örtüşüyor.", strengths: ["Tasarım"], gaps: [], questions: [], eligible: true };
test("AI output is validated; high score cannot override a hard exclusion", () => {
  assert.deepEqual(validateAssessment(match), match);
  assert.throws(() => validateAssessment({ ...match, score: 200 }));
  assert.throws(() => validateAssessment({ ...match, eligible: "yes" }));
  assert.throws(() => validateAssessment({ ...match, category: "perfect" }));
  assert.throws(() => validateAssessment({ ...match, strengths: [123] }));
  assert.equal(shouldNotify(match, 70, "new"), true);
  assert.equal(shouldNotify(match, 85, "new"), false);
  assert.equal(shouldNotify(match, 70, "applied"), false);
  assert.equal(shouldNotify(match, 70, "dismissed"), false);
  assert.equal(shouldNotify({ ...match, eligible: false, score: 99 }, 70, "new"), false);
  assert.equal(shouldNotify({ ...match, category: "unsuitable", score: 99 }, 70, "new"), false);
});
test("Contact settings don't invalidate matches but career/age criteria do", () => {
  assert.equal(matchingProfile(DEFAULT_PROFILE), matchingProfile({ ...DEFAULT_PROFILE, email: "new@example.com", threshold: 90 }));
  assert.notEqual(matchingProfile(DEFAULT_PROFILE), matchingProfile({ ...DEFAULT_PROFILE, skills: "New skill" }));
  assert.notEqual(matchingProfile(DEFAULT_PROFILE), matchingProfile({ ...DEFAULT_PROFILE, maxAgeDays: 60 }));
});
test("Provider HTML is kept as plain text, never executed", () => {
  assert.equal(plainText('<script>alert(1)</script><b>Merhaba &amp; dünya</b>'), "Merhaba & dünya");
});
