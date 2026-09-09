/**
 * Inspect Pay Matrix Excel template / sample for Level formats.
 */
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");

const filePath =
  process.argv[2] ||
  path.join(__dirname, "..", "templates", "PayMatrix_Import_Template.xls");

console.log("File:", filePath);
console.log("Exists:", fs.existsSync(filePath));

const buffer = fs.readFileSync(filePath);
const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
console.log("Sheets:", workbook.SheetNames);

const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const rawRows = XLSX.utils.sheet_to_json(sheet, {
  header: 1,
  defval: "",
  raw: true,
});

console.log("\nHeader row:", rawRows[0]);
console.log("Total data rows (incl header):", rawRows.length);

const header = rawRows[0] || [];
const levelIdx = header.findIndex((h) =>
  String(h || "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .includes("level")
);
const cellIdx = header.findIndex((h) =>
  /cell/i.test(String(h || "").replace(/\s+/g, ""))
);
const basicIdx = header.findIndex((h) =>
  /basic/i.test(String(h || "").replace(/\s+/g, ""))
);

console.log("\nColumn indexes:", { levelIdx, cellIdx, basicIdx });

console.log("\nFirst 10 data rows:");
for (let i = 1; i <= Math.min(10, rawRows.length - 1); i += 1) {
  const row = rawRows[i] || [];
  const level = row[levelIdx];
  const cell = row[cellIdx];
  const basic = row[basicIdx];
  console.log({
    excelRow: i + 1,
    level,
    levelType: typeof level,
    levelIsInteger: Number.isInteger(Number(level)),
    levelNumber: Number(level),
    cell,
    cellType: typeof cell,
    basic,
    basicType: typeof basic,
    full: row,
  });
}

/* Count Level validation failures with old logic */
let fail = 0;
let pass = 0;
for (let i = 1; i < rawRows.length; i += 1) {
  const row = rawRows[i] || [];
  if (row.every((c) => String(c ?? "").trim() === "")) continue;
  const level = row[levelIdx];
  const n = Number(level);
  const ok =
    Number.isFinite(n) &&
    Number.isInteger(n) &&
    String(level).trim() !== "";
  if (ok) pass += 1;
  else {
    fail += 1;
    if (fail <= 5) {
      console.log("OLD FAIL sample:", {
        row: i + 1,
        level,
        type: typeof level,
        number: n,
        isInteger: Number.isInteger(n),
      });
    }
  }
}
console.log("\nOld validator pass/fail:", { pass, fail });
