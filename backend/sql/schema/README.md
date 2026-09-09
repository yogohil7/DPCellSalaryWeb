# Safe Schema Upgrade — DPCELLSalaryWebDB

## Inspection summary (live DB)

Existing tables (17): AuditLogs, CityClasses, DAMaster, Designations, Districts, EmployeeMaster, HRAMaster, Institutes, MedicalAllowanceMaster, PayMatrixMaster, PayRevisionMaster, Roles, SalaryBillCodes, SalaryEmployeeDetails, Sections, TransportAllowanceMaster, Users

### Critical findings

1. **Institutes already linked correctly**
   - `BD-01 / ABC` → `DistrictId=1 (Ahmedabad)`, `CityClassId=1 (X)`
2. **Missing FKs before upgrade**
   - Institutes → Districts / CityClasses (IDs existed, FK missing)
   - PayMatrixMaster had **no PayRevisionId**
3. **SalaryBillCodes CONFLICT**
   - Existing table = monthly bill workflow (`AUG-2026`, OPEN/COMPLETED/LOCKED)
   - Proposed earning codes (`BASIC/DA/HRA`) were **NOT applied** (would destroy existing design)
4. **AuditLogs / Users / Sections**
   - Kept existing shapes; additive columns only
5. **Districts / CityClasses**
   - Use `Status` NVARCHAR (`Active`/`Inactive`); optional `IsActive` BIT added/synced

## Run

```powershell
cd D:\DPCellSalaryWeb\backend
node scripts/inspectSchema.js
node scripts/applySafeSchemaUpgrade.js
```

Or in SSMS, run files in `backend/sql/schema/` in order listed in `00_RunAll_SafeSchemaUpgrade.sql`.

## Scripts

| File | Purpose |
|------|---------|
| 01_CreateDatabase.sql | Create DB if missing |
| 02_CreateMasterTables.sql | Safe masters + Institutes columns |
| 03_CreateForeignKeys.sql | Add missing FKs |
| 04_CreateIndexes.sql | Indexes |
| 05_CreatePayRevision.sql | PayRevision + PayMatrix.PayRevisionId |
| 06_CreatePayMatrix.sql | Unique (PayRevisionId, Level, CellNo) |
| 07_CreateEmployeePayHistory.sql | History + employee additive cols |
| 08_CreateStoredProcedures.sql | usp_* procs |
| 09_InsertTestMasterData.sql | PR2016 + 3 matrix cells if empty |
| 10_Validation.sql | Validation queries |
