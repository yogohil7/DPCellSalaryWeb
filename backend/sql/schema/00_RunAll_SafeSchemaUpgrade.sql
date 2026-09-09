/*
  00_RunAll_SafeSchemaUpgrade.sql
  Ordered runner for existing DPCELLSalaryWebDB.
  NEVER drops database/tables/data.
*/

:r .\01_CreateDatabase.sql
:r .\02_CreateMasterTables.sql
:r .\05_CreatePayRevision.sql
:r .\07_CreateEmployeePayHistory.sql
:r .\06_CreatePayMatrix.sql
:r .\03_CreateForeignKeys.sql
:r .\04_CreateIndexes.sql
:r .\08_CreateStoredProcedures.sql
:r .\09_InsertTestMasterData.sql
:r .\10_Validation.sql
:r .\11_CreateSalaryComponentTables.sql
:r .\12_SalaryComponentConstraints.sql
:r .\13_SeedSalaryComponentMaster.sql
:r .\14_SalaryComponentProcedures.sql
:r .\15_ValidateSalaryComponents.sql
:r .\16_EmployeePayLevelColumns.sql
:r .\17_EmployeeMaster_PayMatrixId_Nullable.sql
:r .\18_UpdateSalaryCalcEmployeeType.sql
:r .\19_SalaryVariationReport.sql
:r .\20_PayMatrix_ImportProc.sql
:r .\21_EmployeePayrollConfiguration.sql
