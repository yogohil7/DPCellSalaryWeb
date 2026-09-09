/**
 * End-to-end Pay Matrix import tests for string Levels (IS-1, IS-2, ...).
 *
 * Usage:
 *   node scripts/testPayMatrixImport.js
 *   node scripts/testPayMatrixImport.js --live
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const {
  parsePayMatrixLevel,
  parsePayMatrixCellNo,
  parseBasicPay,
  parseEffectiveDate,
  readWorkbookRows,
  validateImportRows,
  buildTemplateWorkbook,
} = require("../utils/payMatrixImport");

const LIVE = process.argv.includes("--live");
const OUT_DIR = path.join(__dirname, "..", "tmp");
const TEST_XLSX = path.join(OUT_DIR, "PayMatrix_Test_IS_480.xlsx");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function build480IsWorkbook() {
  const header = ["Level", "CellNo", "BasicPay", "EffectiveDate"];
  const rows = [header];
  /* IS-1 .. IS-16 × 30 cells = 480 */
  for (let level = 1; level <= 16; level += 1) {
    const levelCode = `IS-${level}`;
    for (let cell = 1; cell <= 30; cell += 1) {
      const basic = 18000 + (level - 1) * 1000 + (cell - 1) * 100;
      rows.push([levelCode, cell + 0.0, basic.toLocaleString("en-US"), "2016-01-01"]);
    }
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "PayMatrix");
  return wb;
}

function buildEdgeCaseWorkbook() {
  const rows = [
    ["Level", "CellNo", "BasicPay", "EffectiveDate"],
    [" IS-1 ", 1.0, "18,000", "2016-01-01"],
    ["IS-1", "2.0", 18500, "01-01-2016"],
    ["IS-2", 1, "19,100.00", "2016/01/01"],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "PayMatrix");
  return wb;
}

function buildInvalidWorkbook() {
  const rows = [
    ["Level", "CellNo", "BasicPay", "EffectiveDate"],
    ["", 1, 18000, "2016-01-01"],
    ["IS-1", "", 18000, "2016-01-01"],
    ["IS-1", 1, "", "2016-01-01"],
    ["IS-1", 1, 18000, "2016-01-01"],
    ["IS-1", 1, 18500, "2016-01-01"], /* duplicate */
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "PayMatrix");
  return wb;
}

async function runParserTests() {
  console.log("\n=== Parser unit tests ===");
  assert(parsePayMatrixLevel("IS-1").value === "IS-1", "IS-1");
  assert(parsePayMatrixLevel(" IS-1 ").value === "IS-1", "trim IS-1");
  assert(parsePayMatrixLevel("IS-2").value === "IS-2", "IS-2");
  assert(parsePayMatrixLevel(1.0).value === "1", "legacy 1.0 -> '1'");
  assert(parsePayMatrixLevel("1.0").value === "1", "legacy '1.0' -> '1'");
  assert(parsePayMatrixLevel("").error, "blank rejected");
  assert(parsePayMatrixCellNo(1.0).value === 1, "cell 1.0");
  assert(parsePayMatrixCellNo(0).error, "cell 0 rejected");
  assert(parseBasicPay("18,000").value === 18000, "comma basic");
  assert(parseBasicPay("").error, "blank basic");
  assert(parseEffectiveDate(42370).value, "excel serial");
  /* Must NOT strip IS- */
  assert(parsePayMatrixLevel("IS-1").value !== "1", "do not convert IS-1 to 1");
  console.log("Parser unit tests OK");
}

async function runWorkbookTests() {
  console.log("\n=== Workbook validation tests ===");
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const tpl = buildTemplateWorkbook();
  XLSX.writeFile(tpl, path.join(OUT_DIR, "template.xls"), { bookType: "xls" });
  const tplParsed = readWorkbookRows(
    fs.readFileSync(path.join(OUT_DIR, "template.xls")),
    { debug: true }
  );
  assert(tplParsed.rows.length === 3, "template 3 rows");
  const tplValid = validateImportRows(tplParsed.rows, {
    selectedPayRevisionId: 1,
  });
  assert(tplValid.valid.length === 3 && tplValid.errors.length === 0, "template valid");
  assert(tplValid.valid[0].level === "IS-1", "template level IS-1");

  const wb480 = build480IsWorkbook();
  XLSX.writeFile(wb480, TEST_XLSX);
  const parsed480 = readWorkbookRows(fs.readFileSync(TEST_XLSX), { debug: true });
  assert(parsed480.rows.length === 480, `expected 480 got ${parsed480.rows.length}`);
  const v480 = validateImportRows(parsed480.rows, { selectedPayRevisionId: 1 });
  console.log("480-row validation:", {
    valid: v480.valid.length,
    errors: v480.errors.length,
    sampleLevel: v480.valid[0]?.level,
    firstError: v480.errors[0],
  });
  assert(v480.valid.length === 480 && v480.errors.length === 0, "480 valid");
  assert(v480.valid.every((r) => String(r.level).startsWith("IS-")), "all IS-*");

  const edge = buildEdgeCaseWorkbook();
  const edgePath = path.join(OUT_DIR, "edge.xlsx");
  XLSX.writeFile(edge, edgePath);
  const edgeParsed = readWorkbookRows(fs.readFileSync(edgePath), { debug: true });
  const edgeValid = validateImportRows(edgeParsed.rows, {
    selectedPayRevisionId: 1,
  });
  assert(edgeValid.valid.length === 3, "edge cases valid");
  assert(edgeValid.valid[0].level === "IS-1", "edge IS-1");

  const inv = buildInvalidWorkbook();
  const invPath = path.join(OUT_DIR, "invalid.xlsx");
  XLSX.writeFile(inv, invPath);
  const invParsed = readWorkbookRows(fs.readFileSync(invPath));
  const invValid = validateImportRows(invParsed.rows, {
    selectedPayRevisionId: 1,
  });
  console.log("Invalid workbook errors:", invValid.errors);
  assert(invValid.errors.some((e) => e.field === "Level"), "blank level");
  assert(invValid.errors.some((e) => e.field === "CellNo"), "blank cell");
  assert(invValid.errors.some((e) => e.field === "BasicPay"), "blank basic");
  assert(invValid.errors.some((e) => /Duplicate/i.test(e.message)), "duplicate");

  console.log("Workbook validation tests OK");
}

async function runLiveImport() {
  console.log("\n=== Live API/DB import ===");
  const { sql, connectDB } = require("../db");
  await connectDB();

  const rev = await sql.query`
    SELECT TOP 1 PayRevisionId, RevisionCode, RevisionName
    FROM dbo.PayRevisionMaster
    ORDER BY PayRevisionId
  `;
  const revision = rev.recordset[0];
  if (!revision) throw new Error("No PayRevisionMaster rows.");
  const payRevisionId = Number(revision.PayRevisionId);
  console.log("Using PayRevision:", revision);

  const before = await sql.query`
    SELECT COUNT(1) AS Cnt FROM dbo.PayMatrixMaster
  `;
  const beforeCount = Number(before.recordset[0].Cnt);
  console.log("Existing total PayMatrixMaster rows:", beforeCount);

  const col = await sql.query`
    SELECT t.name AS type_name
    FROM sys.columns c
    JOIN sys.types t ON c.user_type_id = t.user_type_id
    WHERE c.object_id = OBJECT_ID(N'dbo.PayMatrixMaster') AND c.name = N'Level'
  `;
  console.log("Level column type:", col.recordset[0]?.type_name);
  assert(col.recordset[0]?.type_name === "nvarchar", "Level must be nvarchar");

  const API = process.env.API_BASE || "http://localhost:5000/api/pay-matrix";
  if (!fs.existsSync(TEST_XLSX)) {
    XLSX.writeFile(build480IsWorkbook(), TEST_XLSX);
  }

  async function postImport(filePath) {
    const fd = new FormData();
    const bytes = fs.readFileSync(filePath);
    fd.append("file", new Blob([bytes]), path.basename(filePath));
    fd.append("payRevisionId", String(payRevisionId));
    fd.append("userName", "TEST");
    fd.append("fullName", "TEST IMPORT");
    const res = await fetch(`${API}/import`, { method: "POST", body: fd });
    const data = await res.json();
    return { status: res.status, data };
  }

  const threePath = path.join(OUT_DIR, "three_is.xlsx");
  XLSX.writeFile(buildTemplateWorkbook(), threePath);
  let r1 = await postImport(threePath);
  console.log("Import A (3 IS-1 rows):", r1.status, r1.data.summary || r1.data);
  assert(r1.status === 200, `3-row import failed: ${r1.data.message}`);

  let r2 = await postImport(TEST_XLSX);
  console.log("Import B (480 IS-*):", r2.status, r2.data.summary || r2.data);
  assert(r2.status === 200, `480 import failed: ${r2.data.message}`);
  assert(r2.data.summary.failedRows === 0, "failed should be 0");
  assert(r2.data.summary.validRows === 480, "valid 480");

  let r3 = await postImport(TEST_XLSX);
  console.log("Import C (re-import):", r3.status, r3.data.summary || r3.data);
  assert(r3.status === 200, "re-import failed");
  assert(r3.data.summary.insertedRows === 0, "re-import inserted should be 0");
  assert(r3.data.summary.updatedRows === 480, "re-import updated should be 480");

  const isCount = await sql.query`
    SELECT COUNT(1) AS Cnt FROM dbo.PayMatrixMaster WHERE Level LIKE N'IS-%'
  `;
  const total = await sql.query`SELECT COUNT(1) AS Cnt FROM dbo.PayMatrixMaster`;
  const sample = await sql.query`
    SELECT TOP 5 Level, CellNo, BasicPay FROM dbo.PayMatrixMaster
    WHERE Level LIKE N'IS-%' ORDER BY Level, CellNo
  `;
  console.log("IS-* rows:", Number(isCount.recordset[0].Cnt));
  console.log("Total rows:", Number(total.recordset[0].Cnt));
  console.log("Sample:", sample.recordset);
  console.log("Before total:", beforeCount);
  assert(Number(isCount.recordset[0].Cnt) === 480, "480 IS-* rows");
  console.log("Live import OK");
}

(async () => {
  try {
    await runParserTests();
    await runWorkbookTests();
    if (LIVE) await runLiveImport();
    else console.log("\n(Skip live — pass --live to hit API/DB)");
    console.log("\nALL TESTS PASSED");
    process.exit(0);
  } catch (err) {
    console.error("\nTEST FAILED:", err);
    process.exit(1);
  }
})();
