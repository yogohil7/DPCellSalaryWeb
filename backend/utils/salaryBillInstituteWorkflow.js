const { sql } = require("../db");
const { normalizeYearMonth, formatMonthLabel } = require("./salaryMonthKey");

/**
 * The canonical Bill Month label for a SalaryBillCodes row (e.g. 'AUG-2026'
 * for a bill whose SalaryMonth/SalaryYear are 'August'/2026) - the
 * identity every institute workflow row used to implicitly share before
 * migration 51 made BillMonth part of the key. Every call site that does
 * not have an explicit, already-resolved Bill Month (DA Difference bills,
 * which have no Bill Month concept of their own) uses this.
 */
function canonicalBillMonthFromBill(bill) {
  return (
    formatMonthLabel(
      normalizeYearMonth(bill?.SalaryMonth, bill?.SalaryYear, bill?.SalaryMonthNumber)
    ) || ""
  );
}

function makeRequest(transaction) {
  return transaction ? new sql.Request(transaction) : new sql.Request();
}

async function getInstituteWorkflow(billCodeId, instituteCode, billMonth, transaction) {
  /*
     A workflow row is identified by (SalaryBillCodeId, InstituteCode,
     BillMonth) - migration 51. There is deliberately NO bill+institute-only
     fallback: "the most recent row for this bill+institute" is a DIFFERENT
     Bill Month instance's row whenever more than one exists, which is how a
     JUL-2026 bill can end up showing the AUG-2026 bill's LOCKED status.
     A caller without a Bill Month is a bug and fails loudly instead.
  */
  const month = String(billMonth || "").trim();
  if (!month) {
    const err = new Error(
      "getInstituteWorkflow requires a Bill Month (SalaryBillCodeId, InstituteCode, BillMonth)."
    );
    err.status = 500;
    err.code = "WORKFLOW_BILL_MONTH_REQUIRED";
    throw err;
  }
  const req = makeRequest(transaction);
  const result = await req.query`
    SELECT TOP 1 *
    FROM dbo.SalaryBillInstituteWorkflow
    WHERE SalaryBillCodeId = ${Number(billCodeId)}
      AND InstituteCode = ${String(instituteCode || "").trim()}
      AND BillMonth = ${month}
  `;
  return result.recordset[0] || null;
}

async function writeApprovalHistory(
  transaction,
  {
    billCodeId,
    instituteCode,
    action,
    fromStatus,
    toStatus,
    actor,
    assignedToUserId,
    remarks,
  }
) {
  try {
    const req = makeRequest(transaction);
    await req.query`
      INSERT INTO dbo.SalaryBillApprovalHistory
        (
          SalaryBillCodeId, InstituteCode, Action, FromStatus, ToStatus,
          ActionBy, ActionByUserId, AssignedToUserId, Remarks
        )
      VALUES
        (
          ${Number(billCodeId)},
          ${instituteCode || null},
          ${action},
          ${fromStatus || null},
          ${toStatus || null},
          ${actor.fullName || actor.userName || "SYSTEM"},
          ${actor.userId != null ? Number(actor.userId) : null},
          ${assignedToUserId != null ? Number(assignedToUserId) : null},
          ${remarks || null}
        )
    `;
  } catch (err) {
    console.warn("Approval history insert skipped:", err.message);
  }
}

/**
 * Upsert institute workflow status for a bill+institute.
 */
async function upsertInstituteWorkflow(
  transaction,
  {
    bill,
    institute,
    nextStatus,
    actor,
    extras = {},
    billMonth,
  }
) {
  const billCodeId = Number(bill.BillCodeId);
  const instituteCode = String(institute.InstituteCode || "").trim();
  const instituteId =
    institute.InstituteId != null ? Number(institute.InstituteId) : null;
  const who = actor.fullName || actor.userName || "SYSTEM";
  const userId = actor.userId != null ? Number(actor.userId) : null;
  const status = String(nextStatus || "DRAFT").toUpperCase();
  /*
     Every workflow row is now identified by (SalaryBillCodeId,
     InstituteCode, BillMonth) - migration 51. A caller that has an actual
     Bill Month instance (Salary Entry) passes it explicitly; every other
     caller (DA Difference, which has no Bill Month concept) falls back to
     the bill's own canonical Salary Month label, which is exactly what
     every existing workflow row already meant before this change.
  */
  const instituteBillMonth =
    String(billMonth || "").trim() || canonicalBillMonthFromBill(bill);
  if (!instituteBillMonth) {
    const err = new Error(
      "Unable to resolve a Bill Month for this institute workflow row."
    );
    err.status = 400;
    throw err;
  }

  const existing = await getInstituteWorkflow(
    billCodeId,
    instituteCode,
    instituteBillMonth,
    transaction
  );
  const fromStatus = existing ? String(existing.Status || "").toUpperCase() : null;

  if (!existing) {
    const ins = makeRequest(transaction);
    await ins.query`
      INSERT INTO dbo.SalaryBillInstituteWorkflow
        (
          SalaryBillCodeId, InstituteId, InstituteCode, BillMonth, Status,
          UpdatedDate, UpdatedBy
        )
      VALUES
        (
          ${billCodeId},
          ${instituteId},
          ${instituteCode},
          ${instituteBillMonth},
          ${status},
          SYSUTCDATETIME(),
          ${who}
        )
    `;
    if (status === "SUBMITTED" || status === "RESUBMITTED") {
      const updNew = makeRequest(transaction);
      await updNew.query`
        UPDATE dbo.SalaryBillInstituteWorkflow
        SET
          SubmittedDate = SYSUTCDATETIME(),
          SubmittedBy = ${who},
          SubmittedByUserId = ${userId},
          ResubmittedDate = CASE WHEN ${status} = N'RESUBMITTED' THEN SYSUTCDATETIME() ELSE NULL END,
          ResubmittedBy = CASE WHEN ${status} = N'RESUBMITTED' THEN ${who} ELSE NULL END,
          ResubmittedByUserId = CASE WHEN ${status} = N'RESUBMITTED' THEN ${userId} ELSE NULL END
        WHERE SalaryBillCodeId = ${billCodeId}
          AND InstituteCode = ${instituteCode}
          AND BillMonth = ${instituteBillMonth}
      `;
    }
  } else {
    const upd = makeRequest(transaction);
    if (status === "DRAFT") {
      await upd.query`
        UPDATE dbo.SalaryBillInstituteWorkflow
        SET
          Status = N'DRAFT',
          InstituteId = COALESCE(${instituteId}, InstituteId),
          UpdatedDate = SYSUTCDATETIME(),
          UpdatedBy = ${who}
        WHERE WorkflowId = ${existing.WorkflowId}
      `;
    } else if (status === "SUBMITTED") {
      await upd.query`
        UPDATE dbo.SalaryBillInstituteWorkflow
        SET
          Status = N'SUBMITTED',
          InstituteId = COALESCE(${instituteId}, InstituteId),
          SubmittedDate = SYSUTCDATETIME(),
          SubmittedBy = ${who},
          SubmittedByUserId = ${userId},
          ReturnedRemarks = NULL,
          RejectReason = NULL,
          UpdatedDate = SYSUTCDATETIME(),
          UpdatedBy = ${who}
        WHERE WorkflowId = ${existing.WorkflowId}
      `;
    } else if (status === "RESUBMITTED") {
      await upd.query`
        UPDATE dbo.SalaryBillInstituteWorkflow
        SET
          Status = N'RESUBMITTED',
          InstituteId = COALESCE(${instituteId}, InstituteId),
          ResubmittedDate = SYSUTCDATETIME(),
          ResubmittedBy = ${who},
          ResubmittedByUserId = ${userId},
          SubmittedDate = ISNULL(SubmittedDate, SYSUTCDATETIME()),
          SubmittedBy = ISNULL(SubmittedBy, ${who}),
          UpdatedDate = SYSUTCDATETIME(),
          UpdatedBy = ${who}
        WHERE WorkflowId = ${existing.WorkflowId}
      `;
    } else if (status === "RETURNED") {
      await upd.query`
        UPDATE dbo.SalaryBillInstituteWorkflow
        SET
          Status = N'RETURNED',
          ReturnedDate = SYSUTCDATETIME(),
          ReturnedBy = ${who},
          ReturnedByUserId = ${userId},
          ReturnedToAuditorId = ${Number(extras.returnedToAuditorId)},
          ReturnedRemarks = ${extras.returnedRemarks || null},
          AssignedAuditorId = ${Number(extras.returnedToAuditorId)},
          UpdatedDate = SYSUTCDATETIME(),
          UpdatedBy = ${who}
        WHERE WorkflowId = ${existing.WorkflowId}
      `;
    } else if (status === "VERIFIED") {
      await upd.query`
        UPDATE dbo.SalaryBillInstituteWorkflow
        SET
          Status = N'VERIFIED',
          VerifiedDate = SYSUTCDATETIME(),
          VerifiedBy = ${who},
          UpdatedDate = SYSUTCDATETIME(),
          UpdatedBy = ${who}
        WHERE WorkflowId = ${existing.WorkflowId}
      `;
    } else if (status === "APPROVED") {
      await upd.query`
        UPDATE dbo.SalaryBillInstituteWorkflow
        SET
          Status = N'APPROVED',
          ApprovedDate = SYSUTCDATETIME(),
          ApprovedBy = ${who},
          UpdatedDate = SYSUTCDATETIME(),
          UpdatedBy = ${who}
        WHERE WorkflowId = ${existing.WorkflowId}
      `;
    } else if (status === "LOCKED") {
      await upd.query`
        UPDATE dbo.SalaryBillInstituteWorkflow SET Status = N'LOCKED',
          LockedDate = SYSUTCDATETIME(), LockedBy = ${who},
          UpdatedDate = SYSUTCDATETIME(), UpdatedBy = ${who}
        WHERE WorkflowId = ${existing.WorkflowId}
      `;
    } else if (status === "REJECTED") {
      /*
       * Phase 9: also populate ReturnedToAuditorId with the submitter's userId
       * so the bill appears in the auditor's correction queue (GET /returned).
       * extras.rejectedToAuditorId is set by the POST /reject endpoint from
       * the existing workflow row's SubmittedByUserId.
       */
      const rejectedAuditorId =
        extras.rejectedToAuditorId != null
          ? Number(extras.rejectedToAuditorId)
          : existing.ReturnedToAuditorId != null
            ? Number(existing.ReturnedToAuditorId)
            : null;
      await upd.query`
        UPDATE dbo.SalaryBillInstituteWorkflow
        SET
          Status = N'REJECTED',
          RejectedDate = SYSUTCDATETIME(),
          RejectedBy = ${who},
          RejectReason = ${extras.rejectReason || null},
          ReturnedToAuditorId = COALESCE(${rejectedAuditorId}, ReturnedToAuditorId),
          AssignedAuditorId = COALESCE(${rejectedAuditorId}, AssignedAuditorId),
          UpdatedDate = SYSUTCDATETIME(),
          UpdatedBy = ${who}
        WHERE WorkflowId = ${existing.WorkflowId}
      `;
    }
  }

  await writeApprovalHistory(transaction, {
    billCodeId,
    instituteCode,
    action: status,
    fromStatus,
    toStatus: status,
    actor,
    assignedToUserId: extras.returnedToAuditorId,
    remarks: extras.returnedRemarks || extras.rejectReason || null,
  });

  return getInstituteWorkflow(billCodeId, instituteCode, instituteBillMonth, transaction);
}

const EDITABLE_INSTITUTE_STATUSES = new Set([
  "OPEN",
  "DRAFT",
  "RETURNED",
  /*
   * Phase 9 - REJECTED is correctable (Option B).
   * The AO's rejection is assigned back to the submitting auditor via
   * ReturnedToAuditorId; the auditor can save corrections and resubmit,
   * which transitions the status to RESUBMITTED. This aligns with the
   * intent already expressed in salaryEntry.js AUDITOR_ACTIONABLE_STATUSES.
   */
  "REJECTED",
]);

function assertInstituteEditable(workflow, billCode, instituteCode) {
  if (!workflow) return null;
  const status = String(workflow.Status || "").toUpperCase();
  if (status === "LOCKED") return { status: 409, message: "This institute salary bill is locked and cannot be modified." };
  if (EDITABLE_INSTITUTE_STATUSES.has(status)) return null;
  return {
    status: 403,
    message: `Bill ${billCode} / Institute ${instituteCode} is ${status} and cannot be modified.`,
  };
}

module.exports = {
  getInstituteWorkflow,
  upsertInstituteWorkflow,
  writeApprovalHistory,
  assertInstituteEditable,
  EDITABLE_INSTITUTE_STATUSES,
  canonicalBillMonthFromBill,
};
