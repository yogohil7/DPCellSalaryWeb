const { sql } = require("../db");

function makeRequest(transaction) {
  return transaction ? new sql.Request(transaction) : new sql.Request();
}

async function getInstituteWorkflow(billCodeId, instituteCode, transaction) {
  const req = makeRequest(transaction);
  const result = await req.query`
    SELECT TOP 1 *
    FROM dbo.SalaryBillInstituteWorkflow
    WHERE SalaryBillCodeId = ${Number(billCodeId)}
      AND InstituteCode = ${String(instituteCode || "").trim()}
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
  }
) {
  const billCodeId = Number(bill.BillCodeId);
  const instituteCode = String(institute.InstituteCode || "").trim();
  const instituteId =
    institute.InstituteId != null ? Number(institute.InstituteId) : null;
  const who = actor.fullName || actor.userName || "SYSTEM";
  const userId = actor.userId != null ? Number(actor.userId) : null;
  const status = String(nextStatus || "DRAFT").toUpperCase();

  const existing = await getInstituteWorkflow(
    billCodeId,
    instituteCode,
    transaction
  );
  const fromStatus = existing ? String(existing.Status || "").toUpperCase() : null;

  if (!existing) {
    const ins = makeRequest(transaction);
    await ins.query`
      INSERT INTO dbo.SalaryBillInstituteWorkflow
        (
          SalaryBillCodeId, InstituteId, InstituteCode, Status,
          UpdatedDate, UpdatedBy
        )
      VALUES
        (
          ${billCodeId},
          ${instituteId},
          ${instituteCode},
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

  return getInstituteWorkflow(billCodeId, instituteCode, transaction);
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
};
