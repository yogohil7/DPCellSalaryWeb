import React, { useEffect, useMemo, useState } from "react";
import SalaryEntry from "./SalaryEntry";
import DataGrid from "../components/DataGrid";
import { listReturnedBills } from "../utils/salaryBillApprovalApi";
import "./returningBills.css";

function formatDate(value) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function displayStatus(status) {
  const raw = String(status || "").trim().toUpperCase();
  if (!raw) return "RETURNED";
  if (raw === "RETURNED") return "RETURNED";
  if (raw === "REJECTED") return "REJECTED";
  if (raw === "RESUBMITTED") return "RESUBMITTED";
  if (raw === "SUBMITTED") return "UNDER REVIEW";
  if (raw === "VERIFIED" || raw === "AO_VERIFIED") return "UNDER REVIEW";
  if (raw.includes("CORRECTION")) return "CORRECTION REQUIRED";
  return raw.replace(/_/g, " ");
}

function assignedAuditorLabel(bill) {
  return (
    bill.assignedAuditor ||
    bill.auditorUserName ||
    (bill.returnedToAuditorId != null
      ? `Auditor #${bill.returnedToAuditorId}`
      : "-")
  );
}

export default function ReturningBills({ user, onBack }) {
  const [returnedBills, setReturnedBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [searchText, setSearchText] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [showSalaryEntry, setShowSalaryEntry] = useState(false);
  const [entryBill, setEntryBill] = useState(null);
  const [reasonBill, setReasonBill] = useState(null);
  const [showReason, setShowReason] = useState(false);

  const currentUserName =
    user?.fullName ||
    user?.name ||
    user?.username ||
    user?.userName ||
    "Auditor";

  const currentUserId = user?.userId || user?.id || null;
  const roleName = String(user?.roleName || user?.role || "").trim();
  const roleKey = roleName.toUpperCase();

  const refresh = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const result = await listReturnedBills({
        auditorUserId: currentUserId,
        user,
      });
      setReturnedBills(Array.isArray(result?.data) ? result.data : []);
    } catch (error) {
      setReturnedBills([]);
      setLoadError(error.message || "Unable to load returned salary bills.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [currentUserId]);

  const filteredBills = useMemo(() => {
    const text = appliedSearch.trim().toLowerCase();
    if (!text) return returnedBills;
    return returnedBills.filter((bill) =>
      [
        bill.billCode,
        bill.instituteCode,
        bill.instituteName,
        assignedAuditorLabel(bill),
        bill.rejectedBy,
        bill.returnedBy,
        bill.returnedRemarks,
        bill.returnReason,
        bill.rejectReason,
        bill.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(text)
    );
  }, [returnedBills, appliedSearch]);

  const handleSearch = (event) => {
    event?.preventDefault?.();
    setAppliedSearch(searchText);
  };

  const handleRefresh = () => {
    setSearchText("");
    setAppliedSearch("");
    refresh();
  };

  const handleViewCorrect = (bill) => {
    const isAdministrator =
      roleKey.includes("ADMIN") ||
      roleKey.includes("ACCOUNT OFFICER") ||
      String(currentUserName).toLowerCase().includes("admin");

    const assignedId = Number(bill.returnedToAuditorId || bill.assignedAuditorId);
    if (
      !isAdministrator &&
      currentUserId &&
      Number.isFinite(assignedId) &&
      Number(currentUserId) !== assignedId
    ) {
      alert("This returned bill is assigned to another auditor.");
      return;
    }

    setEntryBill(bill);
    setShowSalaryEntry(true);
  };

  if (showSalaryEntry && entryBill) {
    return (
      <SalaryEntry
        user={user}
        onBack={() => {
          setShowSalaryEntry(false);
          setEntryBill(null);
          refresh();
        }}
        initialBillCode={entryBill.billCode}
        initialBillMonth={entryBill.billMonth || ""}
        initialSalaryMonth={entryBill.salaryMonth || ""}
        initialInstituteCode={entryBill.instituteCode}
        returnedMode
      />
    );
  }

  const columns = [
    { key: "sr", label: "Sr. No.", type: "serial", minWidth: 60 },
    { key: "billCode", label: "Bill Code", align: "center", minWidth: 110 },
    {
      key: "instituteCode",
      label: "Institute Code",
      align: "center",
      minWidth: 110,
    },
    {
      key: "instituteName",
      label: "Institute Name",
      align: "left",
      minWidth: 180,
    },
    { key: "billMonth", label: "Bill Month", align: "center", minWidth: 100 },
    {
      key: "salaryMonth",
      label: "Salary Month",
      align: "center",
      minWidth: 100,
    },
    {
      key: "employeeCount",
      label: "Employees",
      align: "right",
      type: "number",
      minWidth: 90,
      getValue: (bill) =>
        String(bill.employeeCount ?? bill.employees ?? bill.empCount ?? 0),
    },
    {
      key: "grossAmount",
      label: "Gross Salary",
      align: "right",
      minWidth: 120,
      getValue: (bill) => money(bill.grossAmount ?? bill.grossSalary),
    },
    {
      key: "totalDeductions",
      label: "Total Deduction",
      align: "right",
      minWidth: 120,
      getValue: (bill) =>
        money(bill.totalDeductions ?? bill.totalDeduction),
    },
    {
      key: "netSalary",
      label: "Net Salary",
      align: "right",
      minWidth: 120,
      getValue: (bill) => money(bill.netSalary ?? bill.netAmount),
    },
    {
      key: "assignedAuditor",
      label: "Assigned Auditor",
      align: "left",
      minWidth: 140,
      getValue: (bill) => assignedAuditorLabel(bill),
      render: (bill) => (
        <span className="rb-auditor-name">{assignedAuditorLabel(bill)}</span>
      ),
    },
    {
      key: "returnedBy",
      label: "Returned / Rejected By",
      align: "left",
      minWidth: 140,
      getValue: (bill) =>
        bill.rejectedBy || bill.returnedBy || "-",
    },
    {
      key: "returnedDate",
      label: "Action Date",
      align: "center",
      minWidth: 110,
      getValue: (bill) =>
        formatDate(bill.rejectedDate || bill.returnedDate),
    },
    {
      key: "returnedRemarks",
      label: "Remarks / Reason",
      align: "left",
      minWidth: 180,
      getValue: (bill) =>
        bill.rejectReason || bill.returnedRemarks || bill.returnReason || "-",
      render: (bill) => (
        <span
          className="rb-reason-cell"
          title={bill.rejectReason || bill.returnedRemarks || bill.returnReason || ""}
        >
          {bill.rejectReason || bill.returnedRemarks || bill.returnReason || "-"}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      type: "status",
      align: "center",
      minWidth: 130,
      getValue: (bill) => displayStatus(bill.status),
    },
    {
      key: "actions",
      label: "Action",
      type: "actions",
      sortable: false,
      exportable: false,
      align: "center",
      minWidth: 220,
      render: (bill) => (
        <div className="rb-actions">
          <button
            type="button"
            className="dg-btn dg-btn-secondary"
            onClick={() => {
              setReasonBill(bill);
              setShowReason(true);
            }}
          >
            View
          </button>
          <button
            type="button"
            className="dg-btn dg-btn-primary"
            onClick={() => handleViewCorrect(bill)}
          >
            Edit / Correct
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="rb-page">
      <div className="rb-back">
        <button type="button" className="rb-back-btn" onClick={onBack}>
          ← Back to Home
        </button>
      </div>

      <header className="rb-header">
        <h1 className="rb-page-title">RETURNING SALARY BILLS</h1>
        <p className="rb-page-desc">
          Auditor corrections for bills returned or rejected by Accounts Officer
        </p>
        <div className="rb-role">{roleName || currentUserName}</div>
      </header>

      <section className="rb-card">
        <div className="rb-card-head">SEARCH RETURNED / REJECTED SALARY BILLS</div>
        <div className="rb-card-body">
          <form className="rb-search-row" onSubmit={handleSearch}>
            <label className="rb-search-field">
              <span>Search Bill / Institute / Auditor</span>
              <input
                type="search"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search bill code, institute, or auditor..."
                aria-label="Search returned salary bills"
              />
            </label>
            <div className="rb-search-actions">
              <button type="submit" className="rb-btn rb-btn-primary">
                Search
              </button>
              <button
                type="button"
                className="rb-btn rb-btn-secondary"
                onClick={handleRefresh}
                disabled={loading}
              >
                Refresh
              </button>
            </div>
          </form>

          <div className="rb-status-line">
            Returned / Rejected Salary Bills:{" "}
            <strong>{loading ? "…" : filteredBills.length}</strong>
          </div>
        </div>
      </section>

      <section className="rb-card rb-table-card">
        <div className="rb-card-head">RETURNED / REJECTED SALARY BILL LIST</div>
        <div className="rb-card-body">
          {loadError ? (
            <div className="rb-message is-error" role="alert">
              {loadError}
            </div>
          ) : null}

          {loading ? (
            <div className="rb-message is-loading">
              Loading returned salary bills...
            </div>
          ) : null}

          {!loading && !loadError && filteredBills.length === 0 ? (
            <div className="rb-empty-state">
              <h3>No Returned or Rejected Salary Bills</h3>
              <p>
                There are currently no salary bills returned or rejected by the
                Accounts Officer for correction.
              </p>
            </div>
          ) : null}

          {!loading && filteredBills.length > 0 ? (
            <div className="rb-grid-wrap">
              <DataGrid
                title="Returned Salary Bills"
                rows={filteredBills}
                rowKey={(row) =>
                  `${row.billCodeId || row.billCode}-${row.instituteCode}-${row.workflowId || ""}`
                }
                emptyText="No Returned Salary Bills"
                defaultPageSize={25}
                columns={columns}
              />
            </div>
          ) : null}
        </div>
      </section>

      {showReason && reasonBill ? (
        <div
          className="rb-modal-overlay"
          onClick={() => setShowReason(false)}
          role="presentation"
        >
          <div
            className="rb-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rb-remarks-title"
          >
            <div className="rb-modal-header">
              <h2 id="rb-remarks-title">
                {String(reasonBill.status || "").toUpperCase() === "REJECTED"
                  ? `Rejection Reason — ${reasonBill.billCode}`
                  : `Return Remarks — ${reasonBill.billCode}`}
              </h2>
              <button
                type="button"
                className="rb-modal-close"
                onClick={() => setShowReason(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="rb-modal-body">
              <div className="rb-reason-info">
                <div>
                  <strong>Institute:</strong>{" "}
                  {reasonBill.instituteCode}
                  {reasonBill.instituteName
                    ? ` — ${reasonBill.instituteName}`
                    : ""}
                </div>
                <div>
                  <strong>Assigned Auditor:</strong>{" "}
                  {assignedAuditorLabel(reasonBill)}
                </div>
                <div>
                  <strong>
                    {String(reasonBill.status || "").toUpperCase() === "REJECTED"
                      ? "Rejected By:"
                      : "Returned By:"}
                  </strong>{" "}
                  {reasonBill.rejectedBy || reasonBill.returnedBy || "-"}
                </div>
                <div>
                  <strong>
                    {String(reasonBill.status || "").toUpperCase() === "REJECTED"
                      ? "Rejected Date:"
                      : "Returned Date:"}
                  </strong>{" "}
                  {formatDate(reasonBill.rejectedDate || reasonBill.returnedDate)}
                </div>
                <div>
                  <strong>Status:</strong> {displayStatus(reasonBill.status)}
                </div>
              </div>
              <div className="rb-return-reason">
                <label>
                  {String(reasonBill.status || "").toUpperCase() === "REJECTED"
                    ? "Rejection Reason"
                    : "Remarks"}
                </label>
                <div className="rb-remarks-text">
                  {reasonBill.rejectReason ||
                    reasonBill.returnedRemarks ||
                    reasonBill.returnReason ||
                    "No remarks"}
                </div>
              </div>
            </div>
            <div className="rb-modal-footer">
              <button
                type="button"
                className="rb-btn rb-btn-secondary"
                onClick={() => setShowReason(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="rb-btn rb-btn-primary"
                onClick={() => {
                  setShowReason(false);
                  handleViewCorrect(reasonBill);
                }}
              >
                Edit / Correct
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
