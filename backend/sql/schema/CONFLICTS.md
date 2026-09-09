# Schema conflicts / deferred changes

## STOPPED: SalaryBillCodes redesign

**Existing purpose:** Monthly salary bill workflow  
Examples: `AUG-2026`, statuses `OPEN` / `COMPLETED` / `LOCKED`, used by Salary Entry + SalaryEmployeeDetails.

**Proposed purpose:** Earning/deduction component codes (`BASIC`, `DA`, `HRA`, …).

These are different domains. Replacing the table would break Salary Entry.

**Safe future option:** create a new table, e.g. `dbo.SalaryComponentCodes`, and leave `dbo.SalaryBillCodes` unchanged.

## Preserved text columns

Institutes still has display columns:

- `InstituteDistrict` / `District` (text)
- `CityClass` (text)

Authoritative FKs:

- `DistrictId` → `Districts.DistrictId`
- `CityClassId` → `CityClasses.CityClassId`

Do not delete the text columns until the application fully switches to IDs.
