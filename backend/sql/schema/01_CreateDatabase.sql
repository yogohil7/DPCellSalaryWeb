/*
  01_CreateDatabase.sql
  SAFE: Creates DPCELLSalaryWebDB only if missing. Never drops.
*/

IF DB_ID(N'DPCELLSalaryWebDB') IS NULL
BEGIN
    CREATE DATABASE DPCELLSalaryWebDB;
    PRINT 'Created database DPCELLSalaryWebDB.';
END
ELSE
BEGIN
    PRINT 'Database DPCELLSalaryWebDB already exists — skipped create.';
END
GO

USE DPCELLSalaryWebDB;
GO
