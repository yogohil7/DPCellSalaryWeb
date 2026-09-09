/**
 * Inspect existing DPCELLSalaryWebDB schema (read-only).
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { sql, connectDB } = require("../db");

async function q(label, queryText) {
  console.log(`\n=== ${label} ===`);
  const request = new sql.Request();
  const result = await request.query(queryText);
  return result.recordset;
}

async function main() {
  await connectDB();

  const tables = await q(
    "TABLES",
    `
    SELECT t.name AS TableName
    FROM sys.tables t
    WHERE t.is_ms_shipped = 0
    ORDER BY t.name
    `
  );
  console.log(tables.map((r) => r.TableName).join(", "));

  const columns = await q(
    "COLUMNS",
    `
    SELECT
      t.name AS TableName,
      c.name AS ColumnName,
      ty.name AS DataType,
      c.max_length AS MaxLength,
      c.precision AS PrecisionVal,
      c.scale AS ScaleVal,
      c.is_nullable AS IsNullable,
      c.is_identity AS IsIdentity,
      c.column_id AS ColumnId
    FROM sys.tables t
    INNER JOIN sys.columns c ON c.object_id = t.object_id
    INNER JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    WHERE t.is_ms_shipped = 0
    ORDER BY t.name, c.column_id
    `
  );

  const pks = await q(
    "PRIMARY KEYS",
    `
    SELECT
      t.name AS TableName,
      kc.name AS ConstraintName,
      c.name AS ColumnName
    FROM sys.key_constraints kc
    INNER JOIN sys.tables t ON t.object_id = kc.parent_object_id
    INNER JOIN sys.index_columns ic
      ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
    INNER JOIN sys.columns c
      ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE kc.type = 'PK'
    ORDER BY t.name, ic.key_ordinal
    `
  );

  const fks = await q(
    "FOREIGN KEYS",
    `
    SELECT
      fk.name AS ForeignKeyName,
      OBJECT_NAME(fk.parent_object_id) AS ParentTable,
      COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS ParentColumn,
      OBJECT_NAME(fk.referenced_object_id) AS ReferencedTable,
      COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS ReferencedColumn
    FROM sys.foreign_keys fk
    INNER JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    ORDER BY ParentTable, ForeignKeyName
    `
  );

  const uniques = await q(
    "UNIQUE CONSTRAINTS / INDEXES",
    `
    SELECT
      t.name AS TableName,
      i.name AS IndexName,
      i.is_unique AS IsUnique,
      i.is_unique_constraint AS IsUniqueConstraint,
      STUFF((
        SELECT ',' + c2.name
        FROM sys.index_columns ic2
        INNER JOIN sys.columns c2
          ON c2.object_id = ic2.object_id AND c2.column_id = ic2.column_id
        WHERE ic2.object_id = i.object_id AND ic2.index_id = i.index_id
        ORDER BY ic2.key_ordinal
        FOR XML PATH(''), TYPE
      ).value('.', 'NVARCHAR(MAX)'), 1, 1, '') AS Columns
    FROM sys.indexes i
    INNER JOIN sys.tables t ON t.object_id = i.object_id
    WHERE i.is_hypothetical = 0
      AND i.type > 0
      AND (i.is_unique = 1 OR i.is_unique_constraint = 1)
    ORDER BY t.name, i.name
    `
  );

  const procs = await q(
    "PROCEDURES",
    `
    SELECT name AS ProcedureName
    FROM sys.procedures
    WHERE is_ms_shipped = 0
    ORDER BY name
    `
  );

  const views = await q(
    "VIEWS",
    `
    SELECT name AS ViewName
    FROM sys.views
    WHERE is_ms_shipped = 0
    ORDER BY name
    `
  );

  // Sample key tables
  const sampleTables = [
    "Institutes",
    "Districts",
    "CityClasses",
    "Sections",
    "Designations",
    "PayRevisionMaster",
    "PayMatrixMaster",
    "DAMaster",
    "HRAMaster",
    "MedicalAllowanceMaster",
    "TransportAllowanceMaster",
    "SalaryBillCodes",
    "SalaryEmployeeDetails",
    "Users",
    "Roles",
    "AuditLogs",
    "EmployeeMaster",
    "Employees",
  ];

  const samples = {};
  for (const name of sampleTables) {
    const exists = tables.some((t) => t.TableName === name);
    if (!exists) {
      samples[name] = { exists: false };
      continue;
    }
    const cols = columns.filter((c) => c.TableName === name);
    let rowCount = 0;
    let topRows = [];
    try {
      const requestCnt = new sql.Request();
      const cnt = await requestCnt.query(`SELECT COUNT(1) AS Cnt FROM dbo.[${name}]`);
      rowCount = cnt.recordset[0].Cnt;
      const requestTop = new sql.Request();
      const top = await requestTop.query(`SELECT TOP 5 * FROM dbo.[${name}]`);
      topRows = top.recordset;
    } catch (e) {
      topRows = [{ error: e.message }];
    }
    samples[name] = {
      exists: true,
      rowCount,
      columns: cols.map((c) => ({
        name: c.ColumnName,
        type: c.DataType,
        nullable: !!c.IsNullable,
        identity: !!c.IsIdentity,
      })),
      topRows,
    };
  }

  // Institute join validation
  let instituteJoin = [];
  if (
    tables.some((t) => t.TableName === "Institutes") &&
    tables.some((t) => t.TableName === "Districts") &&
    tables.some((t) => t.TableName === "CityClasses")
  ) {
    try {
      const join = await sql.query`
        SELECT TOP 20
          i.InstituteId,
          i.InstituteCode,
          i.InstituteName,
          i.DistrictId,
          d.DistrictName,
          i.CityClassId,
          cc.CityClassName,
          i.InstituteDistrict,
          i.CityClass
        FROM dbo.Institutes i
        LEFT JOIN dbo.Districts d ON i.DistrictId = d.DistrictId
        LEFT JOIN dbo.CityClasses cc ON i.CityClassId = cc.CityClassId
        ORDER BY i.InstituteId
      `;
      instituteJoin = join.recordset;
    } catch (e) {
      instituteJoin = [{ error: e.message }];
    }
  }

  const report = {
    database: process.env.DB_DATABASE,
    server: process.env.DB_SERVER,
    tables: tables.map((t) => t.TableName),
    columnCount: columns.length,
    columns,
    primaryKeys: pks,
    foreignKeys: fks,
    uniqueIndexes: uniques,
    procedures: procs.map((p) => p.ProcedureName),
    views: views.map((v) => v.ViewName),
    samples,
    instituteJoin,
  };

  const outPath = path.join(__dirname, "..", "sql", "_schema_inspection.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nWrote inspection report: ${outPath}`);
  console.log(`Tables (${tables.length}):`, tables.map((t) => t.TableName).join(", "));
  console.log(`PKs: ${pks.length}, FKs: ${fks.length}, Procs: ${procs.length}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
