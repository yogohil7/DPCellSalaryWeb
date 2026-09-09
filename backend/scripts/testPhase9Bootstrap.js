/*
  PHASE 9 (Part B) — bootstrap admin password security.

  Offline: the SQL layer is stubbed, so this suite runs anywhere and never
  touches a database. It contains no credential literal; every password used
  here is generated at runtime and is meaningless outside this process.
*/
const fs = require("fs");
const path = require("path");
const Module = require("module");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const ROOT = path.join(__dirname, "..");
let passed = 0;
let failed = 0;
const failures = [];

function section(t) {
  console.log(`\n${t}\n${"-".repeat(t.length)}`);
}
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(`${name}: expected ${e}, got ${a}`);
    console.log(`  FAIL  ${name}`);
  }
}

/* ---- stub the db module so ensureAdminUser can be required offline ---- */
const dbPath = require.resolve(path.join(ROOT, "db"));
let queries = [];
let usersRow = null;
function installDbStub() {
  queries = [];
  const sql = {
    async query(strings, ...values) {
      const text = strings.raw ? strings.raw.join("?") : String(strings);
      queries.push({ text, values });
      if (/FROM dbo\.Roles/i.test(text)) {
        return { recordset: [{ RoleId: 1, RoleName: "Super Admin", IsActive: 1 }] };
      }
      if (/INSERT INTO dbo\.RolePermissions/i.test(text)) {
        return { recordset: [], rowsAffected: [0] };
      }
      if (/FROM dbo\.Users/i.test(text)) {
        return { recordset: usersRow ? [usersRow] : [] };
      }
      if (/INSERT INTO dbo\.Users/i.test(text)) {
        return { recordset: [{ UserId: 99 }] };
      }
      return { recordset: [], rowsAffected: [1] };
    },
  };
  const stub = new Module(dbPath, null);
  stub.filename = dbPath;
  stub.loaded = true;
  stub.exports = { sql, connectDB: async () => {} };
  require.cache[dbPath] = stub;
}
function freshEnsure() {
  delete require.cache[require.resolve(path.join(ROOT, "utils/ensureAdminUser"))];
  installDbStub();
  return require(path.join(ROOT, "utils/ensureAdminUser"));
}

/* Capture console output so we can assert nothing is logged. */
function captureLogs(fn) {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(orig)) {
    console[k] = (...a) => lines.push(a.map(String).join(" "));
  }
  return Promise.resolve()
    .then(fn)
    .then(
      (r) => {
        Object.assign(console, orig);
        return { result: r, lines };
      },
      (e) => {
        Object.assign(console, orig);
        throw e;
      }
    );
}

const source = fs.readFileSync(path.join(ROOT, "utils/ensureAdminUser.js"), "utf8");

(async function run() {
  console.log("=".repeat(76));
  console.log("PHASE 9 — BOOTSTRAP ADMIN PASSWORD SECURITY");
  console.log("=".repeat(76));

  section("B1. no plaintext bootstrap password in source");
  check("no ADMIN_PASSWORD constant remains",
    /const\s+ADMIN_PASSWORD\s*=/.test(source), false);
  check("the password is read from the environment",
    /process\.env\.BOOTSTRAP_ADMIN_PASSWORD/.test(source), true);
  {
    /* Any string literal that looks like a credential rather than SQL/prose. */
    const literals = (source.match(/"[^"\n]{6,40}"|'[^'\n]{6,40}'/g) || [])
      .filter((l) => /[A-Z]/.test(l) && /[0-9]/.test(l) && /[^A-Za-z0-9"'\s]/.test(l));
    check("no credential-shaped literal survives in the module", literals, []);
  }
  {
    const offenders = fs
      .readdirSync(path.join(ROOT, "scripts"))
      .filter((f) => f.endsWith(".js"))
      .filter((f) =>
        /(password|pwd)\s*[:=,]\s*["'][^"'\n]{6,}["']/i.test(
          fs.readFileSync(path.join(ROOT, "scripts", f), "utf8")
        )
      );
    check("no test script embeds a password literal", offenders, []);
  }

  section("B2. a missing BOOTSTRAP_ADMIN_PASSWORD skips bootstrap safely");
  delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
  usersRow = null;
  {
    const { ensureAdminUser } = freshEnsure();
    const { result, lines } = await captureLogs(() => ensureAdminUser());
    check("no admin is created", result.action, "skipped");
    check("and no user row is written",
      queries.some((q) => /INSERT INTO dbo\.Users|UPDATE dbo\.Users/i.test(q.text)), false);
    check("the skip is reported without a value",
      lines.some((l) => /not configured/i.test(l)), true);
  }

  section("B2. an existing admin is never reset when bootstrap is unset");
  {
    const otherHash = await bcrypt.hash(crypto.randomBytes(18).toString("hex"), 4);
    usersRow = { UserId: 7, UserName: "admin", PasswordHash: otherHash, RoleId: 1, IsActive: 1 };
    const { ensureAdminUser } = freshEnsure();
    const result = await captureLogs(() => ensureAdminUser()).then((r) => r.result);
    check("bootstrap is skipped", result.action, "skipped");
    check("the stored password is not rewritten",
      queries.some((q) => /PasswordHash\s*=/i.test(q.text)), false);
  }

  section("B2/B4. a valid existing hash is never overwritten, even when configured");
  {
    /* A password the configured one deliberately does NOT match. */
    const storedHash = await bcrypt.hash(crypto.randomBytes(18).toString("hex"), 4);
    process.env.BOOTSTRAP_ADMIN_PASSWORD = crypto.randomBytes(18).toString("hex");
    usersRow = { UserId: 7, UserName: "admin", PasswordHash: storedHash, RoleId: 1, IsActive: 1 };
    const { ensureAdminUser } = freshEnsure();
    const result = await captureLogs(() => ensureAdminUser()).then((r) => r.result);
    check("the admin is reported unchanged", result.action, "unchanged");
    check("PasswordHash is not written — restart is not a password reset",
      queries.some((q) => /PasswordHash\s*=/i.test(q.text)), false);
  }

  section("B3. a configured password is bcrypt-hashed before storage");
  {
    const secret = crypto.randomBytes(18).toString("hex");
    process.env.BOOTSTRAP_ADMIN_PASSWORD = secret;
    usersRow = null;
    const { ensureAdminUser } = freshEnsure();
    const { result, lines } = await captureLogs(() => ensureAdminUser());
    check("the admin is created", result.action, "created");
    const insert = queries.find((q) => /INSERT INTO dbo\.Users/i.test(q.text));
    const stored = (insert.values || []).find((v) => typeof v === "string" && /^\$2[aby]\$/.test(v));
    check("a bcrypt hash is stored", typeof stored === "string", true);
    check("the plaintext is never stored",
      (insert.values || []).includes(secret), false);
    check("the stored hash verifies against the configured password",
      await bcrypt.compare(secret, stored), true);
    check("the password is never logged",
      lines.some((l) => l.includes(secret)), false);
  }

  section("B2. a missing/corrupt hash is repaired, not silently ignored");
  {
    const secret = crypto.randomBytes(18).toString("hex");
    process.env.BOOTSTRAP_ADMIN_PASSWORD = secret;
    usersRow = { UserId: 7, UserName: "admin", PasswordHash: "", RoleId: 1, IsActive: 1 };
    const { ensureAdminUser } = freshEnsure();
    const { result, lines } = await captureLogs(() => ensureAdminUser());
    check("the invalid hash is repaired", result.action, "repaired");
    check("and the repair is not logged with the password",
      lines.some((l) => l.includes(secret)), false);
  }
  delete process.env.BOOTSTRAP_ADMIN_PASSWORD;

  section("B4. Phase 8 guarantees still hold");
  {
    const auth = fs.readFileSync(path.join(ROOT, "middleware/auth.js"), "utf8");
    check("no JWT fallback secret",
      /JWT_SECRET\s*(\|\||\?\?)\s*["'](?!\s*["'])[^"']+["']/.test(auth), false);
    check("JWT_SECRET remains mandatory",
      /JWT_SECRET is not configured/.test(auth), true);
    check("a weak secret is still rejected",
      /too short/.test(auth), true);
  }
  {
    /* Execute the guard rather than pattern-matching it. */
    const authPath = path.join(ROOT, "middleware/auth.js");
    const call = (v) => {
      delete require.cache[require.resolve(authPath)];
      if (v === null) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = v;
      installDbStub();
      try {
        require(authPath).requireJwtSecret();
        return "accepted";
      } catch {
        return "refused";
      }
    };
    const before = process.env.JWT_SECRET;
    check("missing JWT_SECRET is refused", call(null), "refused");
    check("a short JWT_SECRET is refused", call("abc"), "refused");
    check("a configured JWT_SECRET is accepted",
      call(crypto.randomBytes(32).toString("hex")), "accepted");
    if (before === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = before;
  }

  section("no secret material in this suite");
  {
    /* Built at runtime so this check cannot match its own source text. */
    const credentialShaped = new RegExp(
      ["Admin", "@", "20"].join("") + "|" +
        "password\\s*[:=]\\s*[\"'][A-Za-z0-9@#$%]{6,}[\"']",
      "i"
    );
    const self = fs.readFileSync(__filename, "utf8");
    /* Exclude the two lines that build the pattern itself. */
    const body = self
      .split("\n")
      .filter((l) => !/credentialShaped|\.join\(""\)|password\\\\s/.test(l))
      .join("\n");
    check("this file contains no credential literal", credentialShaped.test(body), false);
  }
  check(".env.example ships an empty placeholder",
    /BOOTSTRAP_ADMIN_PASSWORD=\s*$/m.test(
      fs.readFileSync(path.join(ROOT, ".env.example"), "utf8")
    ), true);

  console.log(`\n${"=".repeat(76)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  console.log("=".repeat(76));
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log("  - " + f));
  }
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("SUITE ERROR:", e.message);
  process.exit(1);
});
