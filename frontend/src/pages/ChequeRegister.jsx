import React, { useEffect, useMemo, useState } from "react";
import { GridToolbar } from "../components/DataGrid";
import {
  getChequeRegister,
  getChequeRegisterMeta,
  downloadChequeRegisterExcel,
} from "../utils/chequeRegisterApi";
import "./chequeRegister.css";
import useReportPrintPage, { printReport } from "../utils/useReportPrintPage";

function money(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value) {
  if (!value) return "-";
  const raw = String(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return `${iso[3]}-${iso[2]}-${iso[1]}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return raw;
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

const MONEY_KEYS = [
  "basic",
  "gradePay",
  "totalPay",
  "da",
  "hra",
  "cla",
  "medical",
  "specialAllowance",
  "ta",
  "grossAmount",
  "gpfAmount",
  "nps",
  "incomeTax",
  "professionalTax",
  "otherDeductions",
  "netAmount",
  "chequeAmount",
];

const COLUMNS = [
  { key: "srNo", label: "Sr. No." },
  { key: "instituteName", label: "Name of Institute" },
  { key: "place", label: "Place" },
  { key: "billNo", label: "Bill No." },
  { key: "date", label: "Date" },
  { key: "billMonth", label: "Bill Month" },
  { key: "type", label: "TYPE" },
  { key: "group", label: "Group" },
  { key: "emp", label: "EMP" },
  { key: "basic", label: "Basic" },
  { key: "gradePay", label: "G.P." },
  { key: "totalPay", label: "T.Pay" },
  { key: "da", label: "D.A." },
  { key: "hra", label: "H.R.A." },
  { key: "cla", label: "C.L.A." },
  { key: "medical", label: "Medical" },
  { key: "specialAllowance", label: "Special Allowance" },
  { key: "ta", label: "T.A." },
  { key: "grossAmount", label: "Gross Amt." },
  { key: "gpfAmount", label: "GPF AMT" },
  { key: "nps", label: "NPS" },
  { key: "incomeTax", label: "IT Tax" },
  { key: "professionalTax", label: "P.Tax" },
  { key: "otherDeductions", label: "Other Deduction" },
  { key: "netAmount", label: "Net Amt." },
  { key: "chequeAmount", label: "Cheque Amt." },
];

export default function ChequeRegister({ user, onBack }) {
  /* LEGAL LANDSCAPE for this report only — utils/reportPdfConfig.js */
  useReportPrintPage("chequeRegister");
  const now = new Date();
  const [meta, setMeta] = useState(null);
  const [table, setTable] = useState("ALL");
  const [sectionId, setSectionId] = useState("");
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [format, setFormat] = useState("SCREEN");
  const [salaryTime, setSalaryTime] = useState("ALL");
  /* Bill Month filter: "" (Auto) = every approved Bill Month instance of the
     selected Salary Month; a selected month = only that Bill Month's
     instances. Each row always shows its own instance Bill Month. */
  const [billMonth, setBillMonth] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState("CHEQUE REGISTER");
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let alive = true;
    getChequeRegisterMeta()
      .then((res) => {
        if (!alive) return;
        const data = res.data || res;
        setMeta(data);
        if (Array.isArray(data.years) && data.years.length) {
          setYear(String(data.years[0]));
        }
      })
      .catch((err) => {
        if (alive) {
          setMessage(err.message || "Unable to load Cheque Register filters.");
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const years = useMemo(() => {
    const list = Array.isArray(meta?.years) ? meta.years.map(String) : [];
    if (year && !list.includes(String(year))) list.unshift(String(year));
    return list.length ? list : [String(now.getFullYear())];
  }, [meta, year, now]);

  const months = meta?.months || [
    { value: 1, label: "January" },
    { value: 2, label: "February" },
    { value: 3, label: "March" },
    { value: 4, label: "April" },
    { value: 5, label: "May" },
    { value: 6, label: "June" },
    { value: 7, label: "July" },
    { value: 8, label: "August" },
    { value: 9, label: "September" },
    { value: 10, label: "October" },
    { value: 11, label: "November" },
    { value: 12, label: "December" },
  ];

  /* Never a hard-coded fixed list of years — always the currently selected
     Year plus the year before it, covering a Bill Month that falls just
     before a January Salary Month. */
  const MONTH_LABELS = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
  ];
  const billMonthOptions = useMemo(() => {
    const y = Number(year) || now.getFullYear();
    const opts = [];
    for (const yy of [y, y - 1]) {
      for (let m = 11; m >= 0; m -= 1) {
        opts.push(`${MONTH_LABELS[m]}-${yy}`);
      }
    }
    return opts;
  }, [year, now]);

  const tables = meta?.tables || [
    { value: "ALL", label: "All" },
    { value: "REGULAR", label: "Regular Salary (incl. Old)" },
    { value: "OLD", label: "Old Salary" },
    { value: "DA_DIFFERENCE", label: "DA Difference" },
  ];

  const sections = meta?.sections || [{ sectionId: null, sectionName: "All" }];
  const formats = meta?.formats || [
    { value: "SCREEN", label: "Screen" },
    { value: "PRINT", label: "Print" },
  ];
  const salaryTimes = meta?.salaryTimes || [
    { value: "ALL", label: "All" },
    { value: "REGULAR", label: "Regular Salary (incl. Old)" },
    { value: "DA_DIFFERENCE", label: "DA Difference" },
  ];

  /*
     Bill Month = the approved INSTANCE's own Bill Month, from the backend
     (the workflow row's BillMonth): AUG-2026 and JUL-2026 instances of the
     same AUG-2026 bill show AUG-2026 and JUL-2026. TYPE is REGULAR when it
     equals the Salary Month, else OLD (computed by the backend).
     There is no separate Salary Month column (removed 2026-09-24, user
     decision): the report's Month/Year filter and title already give it.
  */
  const billMonthOf = (row) =>
    row.billMonthQueried || row.billMonth || "-";

  /* Screen, CSV, PDF, Copy and Print all read from these same rows. */
  const exportRows = useMemo(() => {
    const mapped = rows.map((row) => ({
      ...row,
      date: formatDate(row.date || row.billDate),
      billNo: row.billNo || "",
      billMonth: billMonthOf(row),
      ...Object.fromEntries(MONEY_KEYS.map((key) => [key, money(row[key])])),
    }));

    /*
       The screen shows a TOTAL line in <tfoot>; CSV / PDF / Copy read this
       array, so the same totals must travel with them. Built from the very
       same `totals` object the table foot renders — nothing is recomputed
       here, so no amount can drift between screen and export.
    */
    if (!totals || mapped.length === 0) return mapped;

    return [
      ...mapped,
      {
        srNo: "TOTAL",
        instituteName: "",
        place: "",
        billNo: "",
        date: "",
        billMonth: "",
        type: "",
        group: "",
        emp: totals.emp,
        ...Object.fromEntries(MONEY_KEYS.map((key) => [key, money(totals[key])])),
      },
    ];
  }, [rows, totals]);

  async function handleShow(event) {
    event?.preventDefault?.();
    setLoading(true);
    setMessage("");
    try {
      const res = await getChequeRegister({
        table,
        sectionId: sectionId || undefined,
        month,
        year,
        format,
        salaryTime,
        billMonth: billMonth || undefined,
      });
      const data = res.data || res;
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setTotals(data.totals || null);
      setTitle(data.title || "CHEQUE REGISTER");
      setShown(true);
      if (!(data.rows || []).length) {
        setMessage(
          "No Accounts Officer–approved salary bills found for the selected filters."
        );
      }
    } catch (err) {
      setRows([]);
      setTotals(null);
      setShown(true);
      setMessage(err.message || "Unable to load Cheque Register.");
    } finally {
      setLoading(false);
    }
  }

  function handlePrint() {
    printReport("chequeRegister");
  }

  /* Real .xlsx, built by the backend from the same filters as the screen. */
  async function handleExcel() {
    if (!rows.length) {
      setMessage("Nothing to export. Click Show first.");
      return;
    }
    setExporting(true);
    setMessage("");
    try {
      await downloadChequeRegisterExcel({
        table,
        sectionId: sectionId || undefined,
        sectionName: sectionHeading,
        month,
        year,
        salaryTime,
        format,
        billMonth: billMonth || undefined,
      });
    } catch (err) {
      setMessage(err.message || "Unable to export the Cheque Register.");
    } finally {
      setExporting(false);
    }
  }

  const sectionHeading =
    sections.find((s) => String(s.sectionId ?? "") === String(sectionId))
      ?.sectionName || "All Sections";

  return (
    <div
      className={`cr-page ${format === "PRINT" ? "cr-print-format" : ""}`}
    >
      <div className="cr-toolbar no-print">
        <button type="button" className="cr-back" onClick={onBack}>
          ← Back
        </button>
        {/* Excel and Print now live BELOW the report — see cr-report-actions. */}
      </div>

      <header className="cr-header">
        <h1>CHEQUE REGISTER</h1>
        <p>
          Shows only Salary Bills approved by the Accounts Officer. TYPE is
          REGULAR when Salary Month equals Bill Month; otherwise OLD.
        </p>
      </header>

      <form className="cr-filters no-print" onSubmit={handleShow}>
        <label>
          Table / Salary Type
          <select value={table} onChange={(e) => setTable(e.target.value)}>
            {tables.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Section Name
          <select
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
          >
            {sections.map((item) => (
              <option
                key={String(item.sectionId ?? "all")}
                value={item.sectionId == null ? "" : String(item.sectionId)}
              >
                {item.sectionName || "All"}
              </option>
            ))}
          </select>
        </label>

        <label>
          Month
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((item) => (
              <option key={item.value} value={String(item.value)}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Year
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>

        <label>
          Format
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            {formats.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Salary Time
          <select
            value={salaryTime}
            onChange={(e) => setSalaryTime(e.target.value)}
          >
            {salaryTimes.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Bill Month
          <select
            value={billMonth}
            onChange={(e) => setBillMonth(e.target.value)}
            title="Auto lists every approved Bill Month of the selected Salary Month, each row showing its own Bill Month and TYPE. Selecting a Bill Month lists only that Bill Month's approved bills."
          >
            <option value="">Auto (all Bill Months of this Salary Month)</option>
            {billMonthOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>

        <div className="cr-filter-actions">
          <button type="submit" className="cr-btn cr-btn-primary" disabled={loading}>
            {loading ? "Loading..." : "SHOW"}
          </button>
        </div>
      </form>

      {message ? <div className="cr-message no-print">{message}</div> : null}

      {shown ? (
        <section className="cr-result">
          <div className="cr-result-head">
            <div>
              <div className="cr-section-label">{sectionHeading}</div>
              <h2>{title}</h2>
              <p className="cr-user-line">
                Prepared for {user?.fullName || user?.userName || "User"}
              </p>
            </div>
          </div>

          <div className="cr-table-wrap">
            <table className="cr-table">
              <thead>
                <tr>
                  {COLUMNS.map((col) => (
                    <th key={col.key}>{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length} className="cr-empty">
                      No approved records found.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={`${row.billCodeId}-${row.instituteCode}-${row.srNo}`}>
                      <td>{row.srNo}</td>
                      <td className="cr-left">{row.instituteName}</td>
                      <td className="cr-left">{row.place || "-"}</td>
                      <td>{row.billNo || "-"}</td>
                      <td>{formatDate(row.date || row.billDate)}</td>
                      <td>{billMonthOf(row)}</td>
                      <td>
                        <span
                          className={`cr-type ${
                            row.type === "OLD" ? "is-old" : "is-regular"
                          }`}
                        >
                          {row.type}
                        </span>
                      </td>
                      <td>{row.group || "-"}</td>
                      <td>{row.emp}</td>
                      {MONEY_KEYS.map((key) => (
                        <td key={key} className="cr-num">
                          {money(row[key])}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
              {totals && rows.length > 0 ? (
                <tfoot>
                  <tr>
                    <td colSpan={8} className="cr-left">
                      TOTAL
                    </td>
                    <td>{totals.emp}</td>
                    {MONEY_KEYS.map((key) => (
                      <td key={key} className="cr-num">
                        {money(totals[key])}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>

          {/*
             Report actions live BELOW the table, right aligned:
                 [Cheque Register table]
                 [Totals]
                                    [Excel] [Print]
             Excel and Print are this page's own (real .xlsx, full-page
             print). The shared toolbar keeps Copy / CSV / PDF / Column
             Visibility and hides only its duplicate Excel and Print.
          */}
          <div className="cr-report-actions no-print">
            <GridToolbar
              reportName="chequeRegister"
              subtitle={[sectionHeading, title]}
              title="Cheque Register"
              columns={COLUMNS}
              rows={exportRows}
              showSearch={false}
              hiddenActions={["excel", "print"]}
            />
            <div className="cr-report-actions-main">
              <button
                type="button"
                className="cr-btn cr-btn-excel"
                onClick={handleExcel}
                disabled={exporting || !rows.length}
              >
                {exporting ? "Exporting..." : "Excel"}
              </button>
              <button
                type="button"
                className="cr-btn cr-btn-print"
                onClick={handlePrint}
                disabled={!rows.length}
              >
                Print
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
