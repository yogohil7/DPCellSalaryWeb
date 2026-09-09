import React, { useEffect, useMemo, useState } from "react";
import DataGrid, { GridToolbar } from "../components/DataGrid";
import {
  listApprovalBills,
  getApprovalBill,
  verifyApprovalBill,
  approveApprovalBill,
  lockApprovalInstitute,
  returnApprovalBill,
  listAuditors,
} from "../utils/salaryBillApprovalApi";
import SalaryEntryVariationReport from "./SalaryEntryVariationReport";
import { calculateChequeAmount } from "../utils/salaryBasicCalc";
import "./accountOfficerBills.css";

function money(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

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

function mapApiBill(bill) {
  if (!bill) return null;
  const status = String(bill.status || "").toUpperCase();
  const displayStatus = status === "VERIFIED" ? "AO_VERIFIED" : status;
  const instituteCode = bill.instituteCode || "";
  const isDaDifference = Boolean(
    bill.isDaDifference ||
      String(bill.billCategory || "").toUpperCase() === "DIFFERENCE" ||
      String(bill.billType || "").toUpperCase() === "DA DIFFERENCE"
  );
  return {
    ...bill,
    id: bill.id || `${bill.billCodeId}__${instituteCode}`,
    billCodeId: bill.billCodeId ?? bill.billId ?? bill.id,
    status: displayStatus,
    instituteCode,
    instituteName: bill.instituteName || instituteCode || "-",
    isDaDifference,
    billCategory: bill.billCategory || "",
    billType: bill.billType || (isDaDifference ? "DA Difference" : ""),
    differencePeriod: bill.differencePeriod || "",
    employees: bill.employeeCount ?? bill.employees ?? 0,
    employeeCount: bill.employeeCount ?? bill.employees ?? 0,
    grossAmount:
      bill.totals?.grossAmount ??
      bill.totals?.totalDifferenceAmount ??
      bill.totalEarnings ??
      bill.grossAmount ??
      0,
    totalDeduction:
      bill.totals?.totalDeduction ??
      bill.totals?.totalNpsDeduction ??
      bill.totalDeductions ??
      bill.totalDeduction ??
      0,
    totalDeductions:
      bill.totals?.totalDeduction ??
      bill.totals?.totalNpsDeduction ??
      bill.totalDeductions ??
      bill.totalDeduction ??
      0,
    netSalary:
      bill.totals?.netSalary ??
      bill.totals?.totalNetDifferenceAmount ??
      bill.netSalary ??
      0,
    chequeAmount:
      bill.totals?.chequeAmount ??
      bill.totals?.totalNetDifferenceAmount ??
      bill.chequeAmount ??
      0,
    masterStatus: bill.masterStatus || "",
    submittedDate: bill.submittedDate || null,
    submittedBy: bill.submittedBy || "",
    submittedByUserId: bill.submittedByUserId ?? null,
    assignedAuditor: bill.assignedAuditor || bill.auditorUserName || "-",
    assignedAuditorId:
      bill.assignedAuditorId ||
      bill.returnedToAuditorId ||
      bill.submittedByUserId ||
      "",
    returnedToAuditorId: bill.returnedToAuditorId ?? null,
    returnedRemarks: bill.returnedRemarks || bill.returnReason || "",
    returnReason: bill.returnedRemarks || bill.returnReason || "",
    salaryLines: Array.isArray(bill.salaryLines)
      ? bill.salaryLines
      : Array.isArray(bill.employees)
        ? bill.employees
        : [],
    monthDetails: Array.isArray(bill.monthDetails) ? bill.monthDetails : [],
    history: Array.isArray(bill.history) ? bill.history : [],
  };
}

function isAuditorRole(roleName) {
  return String(roleName || "").trim().toUpperCase() === "AUDITOR";
}

export default function AccountOfficerBills({ user, onBack }) {
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedBill, setSelectedBill] = useState(null);

  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [auditors, setAuditors] = useState([]);
  const [selectedAuditorId, setSelectedAuditorId] = useState("");
  const [returnError, setReturnError] = useState("");

  const [showApproveModal, setShowApproveModal] = useState(false);

  const [showVerifyModal, setShowVerifyModal] = useState(false);

  const [showVariation, setShowVariation] = useState(false);

  const [showAllColumns, setShowAllColumns] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const currentUser =
    user?.fullName ||
    user?.name ||
    user?.username ||
    user?.userName ||
    "Accounts Officer";

  const refreshBills = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const result = await listApprovalBills("PENDING");
      const rows = Array.isArray(result?.data) ? result.data : [];
      setBills(rows.map(mapApiBill));
    } catch (error) {
      setBills([]);
      setLoadError(error.message || "Unable to load salary bills for approval.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshBills();
  }, []);

  const filteredBills = useMemo(() => {
    const text = search.trim().toLowerCase();
    const pending = bills.filter((bill) =>
      ["SUBMITTED", "RESUBMITTED", "AO_VERIFIED", "VERIFIED", "APPROVED", "LOCKED"].includes(
        String(bill.status || "").toUpperCase()
      )
    );

    if (!text) return pending;

    return pending.filter((bill) => {
      const searchable = [
        bill.billCode,
        bill.instituteCode,
        bill.instituteName,
        bill.billMonth,
        bill.salaryMonth,
        bill.billType,
        bill.billCategory,
        bill.differencePeriod,
        bill.assignedAuditor,
        bill.status,
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(text);
    });
  }, [bills, search]);

  const openBill = async (bill) => {
    try {
      setActionBusy(true);
      const result = await getApprovalBill(
        bill.billCodeId || bill.billCode,
        bill.instituteCode
      );
      const mapped = mapApiBill(result?.data || bill);
      setSelectedBill(mapped);
    } catch (error) {
      alert(error.message || "Unable to open salary bill.");
    } finally {
      setActionBusy(false);
    }
  };

  const closeBill = () => {
    setSelectedBill(null);
    setShowReturnModal(false);
    setShowApproveModal(false);
    setShowVerifyModal(false);
    setShowVariation(false);
    setReturnReason("");
    setSelectedAuditorId("");
    refreshBills();
  };

  const openReturnModal = async () => {
    try {
      const result = await listAuditors();
      const list = (Array.isArray(result?.data) ? result.data : []).filter(
        (row) => isAuditorRole(row.roleName)
      );
      setAuditors(list);

      const preferredIds = [
        selectedBill?.assignedAuditorId,
        selectedBill?.submittedByUserId,
        selectedBill?.returnedToAuditorId,
      ]
        .map((id) => String(id || "").trim())
        .filter(Boolean);

      const preferred = preferredIds.find((id) =>
        list.some((auditor) => String(auditor.userId) === id)
      );

      setSelectedAuditorId(preferred || "");
      setReturnReason(selectedBill?.returnedRemarks || "");
      setReturnError("");
      setShowReturnModal(true);
    } catch (error) {
      alert(error.message || "Unable to load auditors.");
    }
  };

  const verifyBill = async () => {
    if (!selectedBill) return;
    try {
      setActionBusy(true);
      const result = await verifyApprovalBill(
        selectedBill.billCodeId || selectedBill.billCode,
        selectedBill.instituteCode,
        user
      );
      const mapped = mapApiBill(result?.data || {});
      setSelectedBill(mapped);
      setShowVerifyModal(false);
      alert(`${mapped.billCode} / ${mapped.instituteCode} verified.`);
      await refreshBills();
    } catch (error) {
      alert(error.message || "Unable to verify salary bill.");
    } finally {
      setActionBusy(false);
    }
  };

  const approveBill = async () => {
    if (!selectedBill) return;

    const status = String(selectedBill.status || "").toUpperCase();
    if (
      status !== "AO_VERIFIED" &&
      status !== "VERIFIED" &&
      status !== "SUBMITTED" &&
      status !== "RESUBMITTED"
    ) {
      alert("Bill cannot be approved in the current status.");
      return;
    }

    try {
      setActionBusy(true);
      const result = await approveApprovalBill(
        selectedBill.billCodeId || selectedBill.billCode,
        selectedBill.instituteCode,
        user
      );
      const mapped = mapApiBill(result?.data || {});
      setSelectedBill(mapped);
      setShowApproveModal(false);
      alert(`${mapped.billCode} / ${mapped.instituteCode} approved.`);
      await refreshBills();
    } catch (error) {
      alert(error.message || "Unable to approve salary bill.");
    } finally {
      setActionBusy(false);
    }
  };

  const lockInstitute = async () => {
    if (!selectedBill) return;
    try {
      setActionBusy(true);
      const result = await lockApprovalInstitute(selectedBill.billCodeId || selectedBill.billCode, selectedBill.instituteCode, user);
      setSelectedBill((current) => ({ ...current, status: "LOCKED", monthLocked: Boolean(result.monthLocked) }));
      await refreshBills();
    } catch (error) {
      setLoadError(error.message || "Unable to lock institute salary bill.");
    } finally { setActionBusy(false); }
  };

  const returnBill = async () => {
    if (!selectedBill) return;

    if (!selectedAuditorId) {
      setReturnError("Please select an Auditor.");
      return;
    }

    const selected = auditors.find(
      (auditor) => String(auditor.userId) === String(selectedAuditorId)
    );
    if (!selected || !isAuditorRole(selected.roleName)) {
      setReturnError("Return target must be an active Auditor.");
      return;
    }

    if (!returnReason.trim()) {
      setReturnError("Return remarks are required.");
      return;
    }

    try {
      setActionBusy(true);
      const result = await returnApprovalBill(
        selectedBill.billCodeId || selectedBill.billCode,
        {
          instituteCode: selectedBill.instituteCode,
          returnedToAuditorId: Number(selectedAuditorId),
          returnedRemarks: returnReason.trim(),
        },
        user
      );
      const mapped = mapApiBill(result?.data || {});
      setSelectedBill(mapped);
      setShowReturnModal(false);
      setReturnReason("");
      setSelectedAuditorId("");
      setReturnError("");
      alert(`${mapped.billCode} / ${mapped.instituteCode} returned to auditor.`);
      await refreshBills();
    } catch (error) {
      alert(error.message || "Unable to return salary bill.");
    } finally {
      setActionBusy(false);
    }
  };

  const printBill = () => {
    window.print();
  };

  const calculateBill = (bill) => {
    const lines = (bill.salaryLines || []).map((line) => {
      const totalBasic =
        Number(line.basicPay || 0) + Number(line.gradePay || line.fixBasic || 0);

      const gross =
        Number(line.grossSalary || line.grossAmount || 0) ||
        totalBasic +
          Number(line.da || 0) +
          Number(line.hra || 0) +
          Number(line.ma || 0) +
          Number(line.ta || 0) +
          Number(line.cla || 0) +
          Number(line.specialAllowance || 0) +
          Number(line.washingAllowance || 0);

      const totalDeduction =
        Number(line.totalDeduction || 0) ||
        Number(line.gpfSubscription || 0) +
          Number(line.nps || 0) +
          Number(line.incomeTax || 0) +
          Number(line.professionalTax || line.professionTax || 0) +
          Number(line.otherDeduction || 0);

      const netSalary =
        Number(line.netSalary || 0) || gross - totalDeduction;
      const chequeAmount = calculateChequeAmount({
        netSalary,
        incomeTax: line.incomeTax,
        professionalTax: line.professionalTax ?? line.professionTax,
      });

      return {
        ...line,
        totalBasic,
        grossAmount: gross,
        totalDeduction,
        netSalary,
        chequeAmount,
      };
    });

    const totals = lines.reduce(
      (acc, line) => {
        acc.grossAmount += Number(line.grossAmount || 0);
        acc.totalDeduction += Number(line.totalDeduction || 0);
        acc.netSalary += Number(line.netSalary || 0);
        acc.chequeAmount += Number(line.chequeAmount || 0);
        return acc;
      },
      {
        grossAmount: 0,
        totalDeduction: 0,
        netSalary: 0,
        chequeAmount: 0,
      }
    );

    return {
      ...bill,
      salaryLines: lines,
      employees: lines.length,
      ...totals,
    };
  };

  const showCalculatedBill = () => {
    if (!selectedBill) return;
    const calculated = calculateBill(selectedBill);
    setSelectedBill(calculated);
  };

  const returnCount = bills.filter(
    (bill) => String(bill.status || "").toUpperCase() === "RETURNED"
  ).length;


  if (selectedBill) {
    const isLocked = selectedBill.status === "LOCKED";
    const isDaDifference = Boolean(selectedBill.isDaDifference);

    return (
      <div className="ao-page">
        <div className="ao-back">
          <button
            type="button"
            className="ao-link-button"
            onClick={closeBill}
          >
            ← Back to Salary Approval
          </button>
        </div>

        <div className="ao-title-row">
          <div>
            <h1>SALARY BILL APPROVAL</h1>
            <p>
              {isDaDifference
                ? "Accounts Officer — DA Difference Bill Verification & Approval"
                : "Accounts Officer Bill Verification & Approval"}
            </p>
          </div>

          <div className={`ao-status ao-status-${selectedBill.status}`}>
            {selectedBill.status}
          </div>
        </div>

        <section className="ao-card">
          <div className="ao-section-title">
            Bill Information
          </div>

          <div className="ao-info-grid">
            <Info label="Bill Code" value={selectedBill.billCode} />
            <Info
              label="Institute Code"
              value={selectedBill.instituteCode}
            />
            <Info
              label="Institute Name"
              value={selectedBill.instituteName}
            />
            <Info
              label="Bill Month"
              value={selectedBill.billMonth}
            />
            <Info
              label="Bill Type"
              value={selectedBill.billType || (isDaDifference ? "DA Difference" : "-")}
            />
            {isDaDifference ? (
              <>
                <Info
                  label="Difference Period"
                  value={selectedBill.differencePeriod || "-"}
                />
                <Info
                  label="Payment Month"
                  value={
                    selectedBill.paymentSalaryMonth
                      ? `${selectedBill.paymentSalaryMonth} ${selectedBill.paymentSalaryYear || ""}`.trim()
                      : "-"
                  }
                />
              </>
            ) : null}
            <Info
              label="Assigned Auditor"
              value={selectedBill.assignedAuditor}
            />
            <Info
              label="Auditor ID"
              value={selectedBill.assignedAuditorId}
            />
            <Info
              label="Submitted Date"
              value={selectedBill.submittedDate}
            />
          </div>
        </section>

        <section className="ao-summary-grid">
          <Summary
            label="Employees"
            value={selectedBill.employees || 0}
          />
          <Summary
            label={isDaDifference ? "Total DA Difference" : "Gross Amount"}
            value={`₹ ${money(selectedBill.grossAmount)}`}
          />
          <Summary
            label={isDaDifference ? "Total NPS Deduction" : "Total Deduction"}
            value={`₹ ${money(selectedBill.totalDeduction)}`}
          />
          <Summary
            label={isDaDifference ? "Total Net Difference" : "Net Salary"}
            value={`₹ ${money(selectedBill.netSalary)}`}
          />
          <Summary
            label={isDaDifference ? "Payable Net" : "Cheque Amount"}
            value={`₹ ${money(selectedBill.chequeAmount)}`}
          />
        </section>

        <section className="ao-card">
          <div className="ao-section-title ao-flex-title">
            <span>
              {isDaDifference
                ? "DA Difference Employee Details"
                : "Employee Salary Details"}
            </span>

            {!isDaDifference ? (
              <button
                type="button"
                className="ao-small-button"
                onClick={() =>
                  setShowAllColumns((value) => !value)
                }
              >
                {showAllColumns
                  ? "Hide Some Columns"
                  : "Show All Columns"}
              </button>
            ) : null}
          </div>

          {isDaDifference ? (
            <div className="ao-table-wrapper data-grid-container">
              <table className="ao-salary-table data-grid">
                <thead>
                  <tr>
                    <th>Sr. No.</th>
                    <th>Employee Name</th>
                    <th>Designation</th>
                    <th>Employee Type</th>
                    <th>Total DA Difference</th>
                    <th>Total NPS Deduction</th>
                    <th>Total Net Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedBill.salaryLines || []).map((line, index) => (
                    <tr key={`${selectedBill.id}-da-${index}`}>
                      <td>{index + 1}</td>
                      <td>{line.employeeName}</td>
                      <td>{line.designation || "-"}</td>
                      <td>{line.employeeType || "-"}</td>
                      <td>
                        {money(
                          line.totalDifferenceAmount ?? line.grossAmount ?? 0
                        )}
                      </td>
                      <td>
                        {money(line.totalNpsDeduction ?? line.nps ?? 0)}
                      </td>
                      <td className="ao-net-cell">
                        {money(
                          line.totalNetDifferenceAmount ?? line.netSalary ?? 0
                        )}
                      </td>
                    </tr>
                  ))}
                  {(!selectedBill.salaryLines ||
                    selectedBill.salaryLines.length === 0) && (
                    <tr>
                      <td colSpan="7" className="ao-empty">
                        No DA Difference employee details found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <>
          <GridToolbar
            title="Employee Salary Details"
            /* Same columns, same order and same rows as the table above, so
               CSV / Excel / PDF / Print can never disagree with the screen. */
            columns={[
              { key: "employeeName", label: "Employee Name" },
              { key: "designation", label: "Designation" },
              { key: "employeeType", label: "Employee Type" },
              { key: "basicPay", label: "Basic Pay" },
              { key: "gradePay", label: "Grade Pay" },
              { key: "totalBasic", label: "Total Basic" },
              { key: "da", label: "DA" },
              { key: "hra", label: "HRA" },
              { key: "ma", label: "MA" },
              { key: "ta", label: "TA" },
              { key: "cla", label: "CLA" },
              { key: "specialAllowance", label: "Special Allow." },
              { key: "washingAllowance", label: "Washing Allow." },
              { key: "grossSalary", label: "Gross Salary" },
              { key: "gpfSubscription", label: "GPF Subscription" },
              { key: "gpfAdv", label: "GPF Adv." },
              { key: "nps", label: "NPS" },
              { key: "incomeTax", label: "Income Tax" },
              { key: "professionalTax", label: "Professional Tax" },
              { key: "otherDeduction", label: "Other Deduction" },
              { key: "totalDeduction", label: "Total Deduction" },
              { key: "netSalary", label: "Net Salary" },
              { key: "chequeAmount", label: "Cheque Amount" },
            ]}
            rows={selectedBill.salaryLines || []}
            visibleKeys={{}}
            search=""
            showSearch={false}
          />

          <div className="ao-table-wrapper data-grid-container">
            <table className="ao-salary-table data-grid">
              <thead>
                <tr>
                  <th rowSpan="2">Sr. No.</th>
                  <th rowSpan="2">Employee Name</th>
                  <th rowSpan="2">Designation</th>
                  <th rowSpan="2">Employee Type</th>

                  <th colSpan="11" className="ao-group earning">
                    EARNING
                  </th>

                  <th colSpan="6" className="ao-group deduction">
                    DEDUCTION
                  </th>

                  <th rowSpan="2">Total Deduction</th>
                  <th rowSpan="2">Net Salary</th>
                  <th rowSpan="2">Cheque Amount</th>
                </tr>

                <tr>
                  <th>Basic Pay</th>
                  <th>Grade Pay</th>
                  <th>Total Basic</th>
                  <th>DA</th>
                  <th>HRA</th>
                  <th>MA</th>
                  <th>TA</th>
                  <th>CLA</th>
                  <th>Special Allow.</th>
                  <th>Washing Allow.</th>
                  <th>Gross Salary</th>

                  <th>GPF Subscription</th>
                  <th>GPF Adv.</th>
                  <th>NPS</th>
                  <th>Income Tax</th>
                  <th>Professional Tax</th>
                  <th>Other Deduction</th>
                </tr>
              </thead>

              <tbody>
                {(selectedBill.salaryLines || []).map(
                  (line, index) => (
                    <tr key={`${selectedBill.id}-${index}`}>
                      <td className="sticky-col sticky-1">
                        {line.srNo || index + 1}
                      </td>

                      <td className="sticky-col sticky-2">
                        {line.employeeName}
                      </td>

                      <td className="sticky-col sticky-3">
                        {line.designation}
                      </td>

                      <td className="sticky-col sticky-4">
                        <span
                          className={
                            line.employeeType === "NPS"
                              ? "ao-nps"
                              : "ao-gpf"
                          }
                        >
                          {line.employeeType}
                        </span>
                      </td>

                      <td>{money(line.basicPay)}</td>
                      <td>{money(line.gradePay)}</td>
                      <td>{money(line.totalBasic)}</td>
                      <td>{money(line.da)}</td>
                      <td>{money(line.hra)}</td>
                      <td>{money(line.ma)}</td>
                      <td>{money(line.ta)}</td>
                      <td>{money(line.cla)}</td>
                      <td>{money(line.specialAllowance)}</td>
                      <td>{money(line.washingAllowance)}</td>
                      {/*
                         dbo.SalaryEmployeeDetails.GrossSalary, printed as it
                         was saved. No gross is computed here: grossAmount is
                         only the value calculateBill already resolved for this
                         same row, used when a row carries no stored gross.
                      */}
                      <td>{money(line.grossSalary || line.grossAmount)}</td>

                      <td>{money(line.gpfSubscription)}</td>
                      <td>{money(line.gpfAdv)}</td>
                      <td>{money(line.nps)}</td>
                      <td>{money(line.incomeTax)}</td>
                      <td>{money(line.professionalTax)}</td>
                      <td>{money(line.otherDeduction)}</td>

                      <td className="ao-total-cell">
                        {money(line.totalDeduction)}
                      </td>

                      <td className="ao-net-cell">
                        {money(line.netSalary)}
                      </td>

                      <td className="ao-cheque-cell">
                        {money(line.chequeAmount)}
                      </td>
                    </tr>
                  )
                )}

                {(!selectedBill.salaryLines ||
                  selectedBill.salaryLines.length === 0) && (
                  <tr>
                    <td colSpan="24" className="ao-empty">
                      No employee salary details found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
            </>
          )}
        </section>

        <section className="ao-card">
          <div className="ao-section-title">
            Remarks / Return Information
          </div>

          <div className="ao-remarks">
            {selectedBill.returnedToAuditorId || selectedBill.returnReason ? (
              <>
                <div>
                  <strong>Returned To:</strong>{" "}
                  {selectedBill.assignedAuditor || "-"}
                  {selectedBill.assignedAuditorId
                    ? ` (UserId ${selectedBill.assignedAuditorId})`
                    : ""}
                </div>
                <div>
                  <strong>Returned Date:</strong>{" "}
                  {formatDate(selectedBill.returnedDate)}
                </div>
                <div>
                  <strong>Return Remarks:</strong>{" "}
                  {selectedBill.returnReason || "-"}
                </div>
                {selectedBill.resubmittedDate ? (
                  <>
                    <div>
                      <strong>Resubmitted By:</strong>{" "}
                      {selectedBill.resubmittedBy || "-"}
                    </div>
                    <div>
                      <strong>Resubmitted Date:</strong>{" "}
                      {formatDate(selectedBill.resubmittedDate)}
                    </div>
                  </>
                ) : null}
              </>
            ) : (
              selectedBill.remarks || "No remarks"
            )}
          </div>
        </section>

        <section className="ao-card">
          <div className="ao-section-title">
            Status History
          </div>

          <div className="ao-history-grid">
            <Info
              label="Submitted By"
              value={selectedBill.submittedBy || "-"}
            />

            <Info
              label="Submitted Date"
              value={selectedBill.submittedDate || "-"}
            />

            <Info
              label="Verified By"
              value={selectedBill.verifiedBy || "-"}
            />

            <Info
              label="Verified Date"
              value={selectedBill.verifiedDate || "-"}
            />

            <Info
              label="Approved By"
              value={selectedBill.approvedBy || "-"}
            />

            <Info
              label="Approved Date"
              value={selectedBill.approvedDate || "-"}
            />

            <Info
              label="Returned By"
              value={selectedBill.returnedBy || "-"}
            />

            <Info
              label="Returned Date"
              value={selectedBill.returnedDate || "-"}
            />

            <Info
              label="Institute Bill Status"
              value={selectedBill.status}
            />

            <Info
              label="Salary Bill Code Master"
              value={selectedBill.masterStatus || "-"}
            />
          </div>
        </section>

        <div className="ao-action-bar">
          <button
            type="button"
            className="ao-btn secondary"
            onClick={closeBill}
          >
            Close
          </button>

          <button
            type="button"
            className="ao-btn info"
            onClick={showCalculatedBill}
          >
            Calculate
          </button>

          <button
            type="button"
            className="ao-btn variation"
            onClick={() => setShowVariation(true)}
          >
            Variation Report
          </button>

          <button
            type="button"
            className="ao-btn preview"
            onClick={() => window.print()}
          >
            Preview
          </button>

          <button
            type="button"
            className="ao-btn print"
            onClick={printBill}
          >
            Print
          </button>

          {!isLocked &&
            (selectedBill.status === "SUBMITTED" ||
              selectedBill.status === "RESUBMITTED") && (
              <>
                <button
                  type="button"
                  className="ao-btn verify"
                  onClick={() => setShowVerifyModal(true)}
                >
                  ✓ Verify
                </button>

                <button
                  type="button"
                  className="ao-btn approve"
                  onClick={() => setShowApproveModal(true)}
                >
                  ✓ Approve
                </button>

                <button
                  type="button"
                  className="ao-btn return"
                  onClick={openReturnModal}
                  disabled={actionBusy}
                >
                  ↩ Return
                </button>
              </>
            )}

          {selectedBill.status === "AO_VERIFIED" && (
            <>
              <button
                type="button"
                className="ao-btn approve"
                onClick={() => setShowApproveModal(true)}
              >
                ✓ Approve
              </button>

              <button
                type="button"
                className="ao-btn return"
                onClick={openReturnModal}
                disabled={actionBusy}
              >
                ↩ Return
              </button>
            </>
          )}

          {selectedBill.status === "APPROVED" && (
            <button type="button" className="ao-btn approve" onClick={lockInstitute} disabled={actionBusy}>
              🔒 Lock Institute
            </button>
          )}
        </div>

        {showVerifyModal && (
          <Modal
            title="Verify Salary Bill"
            onClose={() => setShowVerifyModal(false)}
          >
            <p>
              Are you sure you want to verify this salary bill?
            </p>

            <div className="ao-modal-buttons">
              <button
                type="button"
                className="ao-btn secondary"
                onClick={() => setShowVerifyModal(false)}
              >
                Cancel
              </button>

              <button
                type="button"
                className="ao-btn verify"
                onClick={() => {
                  setShowVerifyModal(false);
                  verifyBill();
                }}
              >
                ✓ Verify Bill
              </button>
            </div>
          </Modal>
        )}

        {showApproveModal && (
          <Modal
            title="Approve Salary Bill"
            onClose={() => setShowApproveModal(false)}
          >
            <div className="ao-approval-warning">
              <strong>Important:</strong>
              <p>
                Approval is institute-wise. Use “Lock Institute” after approval
                to make this institute read-only; the month is finalized only
                when every institute has been locked.
              </p>
            </div>

            <div className="ao-approval-summary">
              <Info
                label="Bill Code"
                value={selectedBill.billCode}
              />
              <Info
                label="Institute"
                value={selectedBill.instituteName}
              />
              <Info
                label="Net Salary"
                value={`₹ ${money(selectedBill.netSalary)}`}
              />
              <Info
                label="Cheque Amount"
                value={`₹ ${money(selectedBill.chequeAmount)}`}
              />
            </div>

            <div className="ao-modal-buttons">
              <button
                type="button"
                className="ao-btn secondary"
                onClick={() => setShowApproveModal(false)}
              >
                Cancel
              </button>

              <button
                type="button"
                className="ao-btn approve"
                onClick={approveBill}
              >
                ✓ Approve
              </button>
            </div>
          </Modal>
        )}

        {showReturnModal && (
          <Modal
            title="Return Salary Bill"
            onClose={() => setShowReturnModal(false)}
          >
            <div className="ao-return-info">
              <strong>Bill Code:</strong> {selectedBill.billCode}
              <br />
              <strong>Institute:</strong>{" "}
              {selectedBill.instituteCode} — {selectedBill.instituteName}
            </div>

            <label className="ao-field-label">
              Return To Auditor *
            </label>
            <select
              className="ao-return-select"
              value={selectedAuditorId}
              onChange={(event) => { setSelectedAuditorId(event.target.value); setReturnError(""); }}
              style={{ width: "100%", marginBottom: 12, minHeight: 36 }}
            >
              <option value="">Select Auditor</option>
              {auditors.map((auditor) => (
                <option key={auditor.userId} value={auditor.userId}>
                  {auditor.fullName} ({auditor.userName}) — {auditor.roleName}
                </option>
              ))}
            </select>

            <label className="ao-field-label">
              Remarks *
            </label>
            <textarea
              className="ao-return-textarea"
              value={returnReason}
              onChange={(event) => { setReturnReason(event.target.value); setReturnError(""); }}
              placeholder="Enter remarks for returning this salary bill..."
              rows="5"
            />
            {returnError ? <div className="ao-inline-error" role="alert">{returnError}</div> : null}

            <div className="ao-modal-buttons">
              <button
                type="button"
                className="ao-btn secondary"
                onClick={() => setShowReturnModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ao-btn return"
                onClick={returnBill}
                disabled={actionBusy}
              >
                ↩ Return Bill
              </button>
            </div>
          </Modal>
        )}

        {showVariation && (
          <SalaryEntryVariationReport
            billCode={selectedBill.billCode}
            billMonth={selectedBill.billMonth}
            salaryMonth={selectedBill.salaryMonth}
            instituteCode={selectedBill.instituteCode}
            source="approval"
            compareMode="previousSalaryMonth"
            onClose={() => setShowVariation(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="ao-page">
      <div className="ao-back">
        <button
          type="button"
          className="ao-link-button"
          onClick={onBack}
        >
          ← Back to Home
        </button>
      </div>

      <div className="ao-title-row">
        <div>
          <h1>SALARY BILL APPROVAL</h1>
          <p>
            Accounts Officer — Submitted Salary Bills
          </p>
        </div>

        <div className="ao-user-box">
          {currentUser}
        </div>
      </div>

      <section className="ao-card">
        <div className="ao-section-title">
          SUBMITTED SALARY BILLS
        </div>

        <div className="ao-toolbar">
          <div className="ao-count">
            Bills Pending for Approval:{" "}
            <strong>{filteredBills.length}</strong>
          </div>
          <button
            type="button"
            className="ao-link-button"
            onClick={() => refreshBills()}
            disabled={loading || actionBusy}
          >
            Refresh
          </button>
        </div>

        {loadError ? (
          <div style={{ color: "#b91c1c", marginBottom: 12 }}>{loadError}</div>
        ) : null}
        {loading ? (
          <div style={{ marginBottom: 12 }}>
            Loading salary bills from SQL Server…
          </div>
        ) : null}

        <DataGrid
          title="Submitted Salary Bills"
          rows={filteredBills}
          emptyText="No salary bills pending for approval."
          columns={[
            { key: "sr", label: "Sr. No.", type: "serial" },
            { key: "billCode", label: "Bill Code", align: "center" },
            { key: "instituteCode", label: "Institute Code", align: "center" },
            {
              key: "billType",
              label: "Bill Type",
              align: "center",
              getValue: (bill) =>
                bill.billType ||
                (bill.isDaDifference ? "DA Difference" : "Regular Salary"),
            },
            { key: "billMonth", label: "Bill Month", align: "center" },
            {
              key: "salaryMonth",
              label: "Salary / Period",
              align: "center",
              getValue: (bill) =>
                bill.isDaDifference && bill.differencePeriod
                  ? bill.differencePeriod
                  : bill.salaryMonth || "-",
            },
            {
              key: "submittedBy",
              label: "Submitted By",
              align: "left",
              getValue: (bill) =>
                bill.submittedBy || bill.assignedAuditor || "-",
            },
            {
              key: "submittedDate",
              label: "Submitted Date",
              align: "center",
              getValue: (bill) => formatDate(bill.submittedDate),
            },
            {
              key: "employees",
              label: "Employees",
              align: "center",
              getValue: (bill) => bill.employeeCount ?? bill.employees ?? 0,
            },
            {
              key: "grossAmount",
              label: "Gross / DA Diff",
              type: "number",
              getValue: (bill) => money(bill.grossAmount),
            },
            {
              key: "netSalary",
              label: "Net / Net Diff",
              type: "number",
              getValue: (bill) => money(bill.netSalary),
            },
            {
              key: "chequeAmount",
              label: "Cheque Amount",
              type: "number",
              getValue: (bill) => money(bill.chequeAmount),
            },
            { key: "status", label: "Status", type: "status" },
            {
              key: "actions",
              label: "Action",
              type: "actions",
              sortable: false,
              exportable: false,
              render: (bill) => (
                <button
                  type="button"
                  className="dg-btn dg-btn-primary"
                  disabled={actionBusy}
                  onClick={() => openBill(bill)}
                >
                  View / Approve
                </button>
              ),
            },
          ]}
        />
      </section>

      <section className="ao-card ao-info-card">
        <div className="ao-section-title">
          WORKFLOW
        </div>

        <div className="ao-workflow">
          <div>
            <span>1</span>
            Auditor
            <small>Submit Bill</small>
          </div>

          <div className="arrow">→</div>

          <div>
            <span>2</span>
            Accounts Officer
            <small>Verify</small>
          </div>

          <div className="arrow">→</div>

          <div>
            <span>3</span>
            Approval
            <small>Approve & Lock</small>
          </div>

          <div className="arrow">OR</div>

          <div className="return-workflow">
            <span>↩</span>
            Return
            <small>Same Auditor</small>
          </div>
        </div>

        <div className="ao-return-note">
          <strong>Return Rule:</strong> When an Accounts Officer
          returns a bill, it is returned to the
          <strong> same Auditor who submitted the bill</strong>.
          The Auditor will see it in Returning Bills.
        </div>
      </section>

      <div className="ao-footer-actions">
        <button
          type="button"
          className="ao-btn secondary"
          onClick={onBack}
        >
          Close
        </button>
      </div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="ao-info">
      <span className="ao-info-label">{label}</span>
      <strong className="ao-info-value">
        {value ?? "-"}
      </strong>
    </div>
  );
}

function Summary({ label, value }) {
  return (
    <div className="ao-summary">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="ao-modal-overlay">
      <div className="ao-modal">
        <div className="ao-modal-header">
          <h2>{title}</h2>

          <button
            type="button"
            className="ao-modal-close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="ao-modal-body">
          {children}
        </div>
      </div>
    </div>

  );
}
