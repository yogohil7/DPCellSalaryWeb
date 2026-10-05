/**
 * Government report style — Arial + visible borders, reports only.
 *
 * Verifies the shared system in frontend/src/pages/reportCommon.css:
 *  1. Every report scope resolves to Arial, Helvetica, sans-serif.
 *  2. Every report table has outer + every-cell + header borders.
 *  3. Filter panels/controls and result containers are bordered.
 *  4. Print Times-serif exceptions are overridden to Arial.
 *  5. The global application font is untouched (reports-only change).
 *  6. The PDF pipeline already emits Arial.
 *
 * Runs offline. Usage: cd backend && npm run test:report-styling
 */

const fs = require("fs");
const path = require("path");

const FRONT = path.join(__dirname, "..", "..", "frontend", "src");
const PAGES = path.join(FRONT, "pages");
const commonCss = fs.readFileSync(path.join(PAGES, "reportCommon.css"), "utf8");
const appCss = fs.readFileSync(path.join(FRONT, "App.css"), "utf8");
const pdfConfig = fs.readFileSync(
  path.join(FRONT, "utils", "reportPdfConfig.js"),
  "utf8"
);

const SCOPES = [
  "cr-page", "bc-page", "eps-page", "emprep-page", "ews-page", "fsb-page",
  "gs-page", "itp-page", "iwg-page", "iws-page", "mw-page", "ngd-page",
  "npsiw-page", "nsch-page", "nps-page", "sr-page", "svr-page", "ss-page",
  "ser-overlay",
];
const TABLES = [
  "cr-table", "bc-table", "ss-table", "gs-table", "iwg-table", "nps-table",
  "npsiw-table", "nsch-table", "ngd-table", "ews-table", "iws-table",
  "eps-table", "sr-table", "itp-table", "mw-table", "emprep-table",
  "fsb-table", "svr-table", "ser-table",
];
const FILTERS = [
  "cr-filters", "bc-filters", "ss-filters", "gs-filters", "iwg-filters",
  "nps-filters", "npsiw-filters", "nsch-filters", "ngd-filters",
  "ews-filters", "iws-filters", "eps-filters", "sr-filters", "itp-filters",
  "mw-filters", "emprep-filters", "fsb-filters", "svr-filters",
  "svr-secondary-filters",
];
/* The three print blocks that historically forced Times serif (overridden). */
const KNOWN_PRINT_SERIF = [
  "gpfSummary.css",
  "instituteWiseGpf.css",
  "sectionSummary.css",
];

let passed = 0;
let failed = 0;
const failures = [];
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
    console.log(`        expected ${e}`);
    console.log(`        actual   ${a}`);
  }
}
function section(t) {
  console.log(`\n${t}`);
  console.log("-".repeat(t.length));
}

function main() {
  console.log("=".repeat(72));
  console.log("Report style — Arial + visible borders (reports only)");
  console.log("=".repeat(72));

  section("1 — Every report scope resolves to Arial");
  const missingScopes = SCOPES.filter((s) => !commonCss.includes(`.${s}`));
  check("1. all 19 report scopes present in reportCommon.css", missingScopes, []);
  check(
    "1. Arial stack declared",
    commonCss.includes("font-family: Arial, Helvetica, sans-serif"),
    true
  );
  check(
    "1. report font token redefined (not app-global)",
    commonCss.includes("--font-family-base: Arial, Helvetica, sans-serif"),
    true
  );

  section("2 — Every report table has visible borders");
  const missingTables = TABLES.filter((t) => !commonCss.includes(`.${t}`));
  check("2. all 19 report tables covered", missingTables, []);
  check("2. table outer border #9aa7b5", commonCss.includes("border: 1px solid #9aa7b5"), true);
  check("2. cell borders #b8c4d1", commonCss.includes("border: 1px solid #b8c4d1"), true);
  check("2. header cell borders #8fa0b2", commonCss.includes("border: 1px solid #8fa0b2"), true);
  check("2. collapse preserved", commonCss.includes("border-collapse: collapse"), true);

  section("3 — Panels, controls and result containers");
  const missingFilters = FILTERS.filter((f) => !commonCss.includes(`.${f}`));
  check("3. all filter panels covered", missingFilters, []);
  check("3. panel border #cbd5e1", commonCss.includes("border: 1px solid #cbd5e1"), true);
  check(
    "3. border rules are screen-only (print keeps its own format)",
    commonCss.includes("@media screen"),
    true
  );

  section("4 — Print serif exceptions overridden to Arial");
  const serifFiles = fs
    .readdirSync(PAGES)
    .filter((f) => f.endsWith(".css"))
    .filter((f) => {
      const src = fs.readFileSync(path.join(PAGES, f), "utf8");
      return /font-family:[^;]*Times New Roman/.test(src);
    })
    .sort();
  check("4. only the 3 known print serif blocks exist", serifFiles, [...KNOWN_PRINT_SERIF].sort());
  ["gs-page .gs-sheet", "iwg-page .iwg-sheet", "ss-page .ss-sheet"].forEach((sel) =>
    check(`4. print override for ${sel}`, commonCss.includes(sel), true)
  );
  check("4. PDF pipeline emits Arial", pdfConfig.includes("font-family: Arial, Helvetica, sans-serif"), true);

  section("5 — Global application font untouched");
  check(
    "5. app base font still the application stack",
    /--font-family-base:\s*"Anthropic Sans",\s*"Inter",\s*"Segoe UI",\s*Arial/.test(appCss),
    true
  );
  check(
    "5. no report scope leaks onto body/app shell",
    /\.cr-page[\s\S]{0,400}body\s*\{/.test(commonCss) || /body\s*\{[^}]*Arial/.test(commonCss),
    false
  );

  section("6 — One border system, no heavy screen blacks");
  const screenBlock = commonCss.slice(commonCss.indexOf("@media screen"));
  check("6. no #000 borders in shared screen rules", screenBlock.includes("#000"), false);
  const palette = ["#cbd5e1", "#9aa7b5", "#b8c4d1", "#8fa0b2"];
  check(
    "6. only the approved palette in shared screen rules",
    [...screenBlock.matchAll(/#[0-9a-fA-F]{3,6}/g)].map((m) => m[0].toLowerCase()).filter((c) => !palette.includes(c)),
    []
  );

  console.log("\n" + "=".repeat(72));
  console.log(`Passed: ${passed}   Failed: ${failed}`);
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log("  - " + f));
  }
  console.log("=".repeat(72));
  process.exit(failed ? 1 : 0);
}

main();
