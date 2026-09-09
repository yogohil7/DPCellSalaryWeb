import { useEffect, useMemo, useState } from "react";
import {
  getEmployeeWiseSalary,
  getEmployeeWiseSalaryMeta,
  downloadEmployeeWiseSalaryExcel,
} from "../utils/employeeWiseSalaryApi";
import { listActiveSections } from "../utils/sectionApi";
import { listEmployees } from "../utils/employeeApi";
import { GridToolbar } from "../components/DataGrid";
import "./employeeWiseSalary.css";

/*
  Money: stored values, en-IN with paise. An exact zero prints as "0"
  (the legacy report convention) instead of "0.00".
*/
function money(value) {
  /*
    null/undefined means the field does not exist for this record — a DA
    Difference row has no Basic, DA, HRA, GPF or tax columns at all. Showing
    an em dash keeps that distinct from a genuine stored zero.
  */
  if (value == null) return "\u2014";
  const n = Number(value || 0);
  if (n === 0) return "0";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/* Screen, CSV, PDF, Copy and Print all read these columns. */
const COLUMNS = [
  { key: "srNo", label: "#" },
  { key: "salaryMonth", label: "Salary Month" },
  { key: "paidMonth", label: "Paid Month" },
  { key: "type", label: "Type" },
  { key: "basic", label: "Basic" },
  { key: "gradePay", label: "G.P." },
  { key: "da", label: "D.A." },
  { key: "hra", label: "HRA" },
  { key: "medical", label: "Medical" },
  { key: "ta", label: "T.A." },
  { key: "cla", label: "C.L.A." },
  { key: "specialAllowance", label: "Spl.All." },
  { key: "washingAllowance", label: "Wash.All." },
  { key: "total", label: "TOTAL" },
  { key: "gpf", label: "GPF" },
  { key: "gpfAdvance", label: "GPF Adv." },
  { key: "nps", label: "NPS" },
  { key: "incomeTax", label: "I.Tax" },
  { key: "professionalTax", label: "P.Tax" },
  { key: "otherDeduction", label: "Other" },
  { key: "totalDeduction", label: "Tot.Ded." },
  { key: "net", label: "Net" },
  { key: "chequeAmount", label: "Cheque Amt." },
];

const MONEY_KEYS = COLUMNS.filter((c) =>
  [
    "basic", "gradePay", "da", "hra", "medical", "ta", "cla",
    "specialAllowance", "washingAllowance", "total", "gpf", "gpfAdvance",
    "nps", "incomeTax", "professionalTax", "otherDeduction",
    "totalDeduction", "net", "chequeAmount",
  ].includes(c.key)
).map((c) => c.key);

const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

function thisYear() {
  return new Date().getFullYear();
}

export default function EmployeeWiseSalary({ user, onBack }) {
  const now = new Date();
  const [sections, setSections] = useState([]);
  const [allEmployees, setAllEmployees] = useState([]);
  const [metaYears, setMetaYears] = useState([]);

  const [sectionId, setSectionId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [fromMonth, setFromMonth] = useState("1");
  const [fromYear, setFromYear] = useState(String(thisYear()));
  const [toMonth, setToMonth] = useState(String(now.getMonth() + 1));
  const [toYear, setToYear] = useState(String(thisYear()));
  const [allMonths, setAllMonths] = useState(false);
  const [salaryType, setSalaryType] = useState("ALL");

  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [report, setReport] = useState(null);

  const years = useMemo(() => {
    if (metaYears.length) return metaYears;
    const y = thisYear();
    return [0, 1, 2, 3, 4, 5].map((n) => String(y - n));
  }, [metaYears]);

  /* Sections + report years, same sources the other reports use. */
  useEffect(() => {
    let active = true;
    listActiveSections()
      .then((rows) => {
        if (!active) return;
        const list = (Array.isArray(rows) ? rows : [])
          .map((r) => ({ id: r.sectionId ?? r.id, name: r.sectionName || "" }))
          .filter((r) => r.id != null && r.name);
        setSections(list);
      })
      .catch(() => {
        if (active) setSections([]);
      });
    getEmployeeWiseSalaryMeta()
      .then((res) => {
        if (!active) return;
        const list = res?.data?.years || [];
        if (list.length) {
          setMetaYears(list);
          if (!list.includes(String(thisYear()))) {
            setFromYear(list[list.length - 1]);
            setToYear(list[0]);
          }
        }
      })
      .catch(() => {
        if (active) setMetaYears([]);
      });
    return () => {
      active = false;
    };
  }, []);

  /* Employee master list for the employee dropdown. */
  useEffect(() => {
    let active = true;
    listEmployees()
      .then((rows) => {
        if (active) setAllEmployees(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (active) setAllEmployees([]);
      });
    return () => {
      active = false;
    };
  }, []);

  /* The employee dropdown follows the selected section. */
  const visibleEmployees = useMemo(() => {
    const list = allEmployees
      .map((e) => ({
        id: e.employeeId ?? e.id,
        name: e.employeeName || "",
        sectionId: e.sectionId,
      }))
      .filter((e) => e.id != null && e.name);
    if (!sectionId) return list;
    return list.filter((e) => String(e.sectionId) === String(sectionId));
  }, [allEmployees, sectionId]);

  /* Changing section clears an employee that is not in that section. */
  useEffect(() => {
    if (!employeeId || !sectionId) return;
    const stillThere = allEmployees.some(
      (e) =>
        String(e.employeeId ?? e.id) === String(employeeId) &&
        String(e.sectionId) === String(sectionId)
    );
    if (!stillThere) setEmployeeId("");
  }, [sectionId, employeeId, allEmployees]);

  const filters = {
    sectionId: sectionId || undefined,
    employeeId: employeeId || undefined,
    fromMonth: allMonths ? undefined : fromMonth,
    fromYear: allMonths ? undefined : fromYear,
    toMonth: allMonths ? undefined : toMonth,
    toYear: allMonths ? undefined : toYear,
    allMonths: allMonths || undefined,
    salaryType,
  };

  async function handleShow(event) {
    event?.preventDefault?.();
    setLoading(true);
    setMessage("");
    try {
      const res = await getEmployeeWiseSalary(filters);
      const data = res?.data || null;
      setReport(data);
      if (!data || (data.rowCount || 0) === 0) {
        setMessage("No salary records found for the selected criteria.");
      } else if (data.truncated) {
        setMessage(
          `Showing first ${data.maxRows} of ${data.rowCount} records. Narrow the filters to see the rest.`
        );
      }
    } catch (error) {
      setReport(null);
      setMessage(error.message || "Could not load the Employee Wise Salary Report.");
    } finally {
      setLoading(false);
    }
  }

  /*
    Print / PDF both go through Chrome's own print pipeline (no popup window,
    no separate HTML report).  Fonts are awaited first so Inter is loaded
    before layout, then one animation frame lets the print stylesheet paint.
    document.fonts is guarded: on a browser without the Font Loading API an
    unguarded await would throw and the print dialog would never open.
  */
  async function handlePrint() {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
    requestAnimationFrame(() => {
      window.print();
    });
  }

  async function handleExcel() {
    setExporting(true);
    setMessage("");
    try {
      await downloadEmployeeWiseSalaryExcel(filters);
    } catch (error) {
      setMessage(error.message || "Excel export failed.");
    } finally {
      setExporting(false);
    }
  }

  const groups = report?.employees || [];

  /* One flat export array across groups, each group followed by its TOTAL. */
  const exportRows = useMemo(() => {
    const out = [];
    for (const group of groups) {
      for (const row of group.rows) {
        const mapped = { ...row };
        MONEY_KEYS.forEach((k) => {
          mapped[k] = money(row[k]);
        });
        out.push(mapped);
      }
      if (group.rows.length > 0) {
        const totalRow = { srNo: "TOTAL", salaryMonth: "", paidMonth: "", type: "" };
        MONEY_KEYS.forEach((k) => {
          totalRow[k] = money(group.total[k]);
        });
        totalRow.employeeCode = group.employee.employeeCode;
        totalRow.employeeName = group.employee.employeeName;
        totalRow.instituteName = group.employee.instituteName;
        out.push(totalRow);
      }
    }
    return out;
  }, [groups]);

  function employeeInfoEntries(employee) {
    return [
      ["Section", employee.sectionName],
      ["Institute", employee.instituteName],
      ["Designation", employee.designation],
      ["Employee Type", employee.employeeType],
      ["A/C No", employee.accountNo],
      ["GPF/NPS No", [employee.gpfNpsType, employee.gpfNpsNumber].filter(Boolean).join(" ")],
      ["D.O.B", employee.dateOfBirth],
      ["Joining Date", employee.joiningDate],
      ["Retired Date", employee.retiredDate],
      ["Class", employee.className],
      ["CCC Pass Date", employee.cccPassDate],
      ["Pay Fix", employee.payFixDetail],
    ];
  }

  return (
    <div className="ews-page">
      <div className="ews-toolbar no-print">
        <button type="button" className="ews-link" onClick={onBack}>
          ← Back
        </button>
      </div>

      <form className="ews-filters no-print" onSubmit={handleShow}>
        <div className="ews-field">
          <label htmlFor="ews-section">Section</label>
          <select
            id="ews-section"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
          >
            <option value="">All Sections</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="ews-field ews-field-wide">
          <label htmlFor="ews-employee">Employee</label>
          <select
            id="ews-employee"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">All Employees</option>
            {visibleEmployees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.id} - {e.name}
              </option>
            ))}
          </select>
        </div>

        <div className="ews-field">
          <label htmlFor="ews-from-month">Month From</label>
          <div className="ews-month-pair">
            <select
              id="ews-from-month"
              value={fromMonth}
              disabled={allMonths}
              onChange={(e) => setFromMonth(e.target.value)}
            >
              {MONTHS.map((name, index) => (
                <option key={name} value={String(index + 1)}>
                  {name.slice(0, 3)}
                </option>
              ))}
            </select>
            <select
              aria-label="From year"
              value={fromYear}
              disabled={allMonths}
              onChange={(e) => setFromYear(e.target.value)}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="ews-field">
          <label htmlFor="ews-to-month">Month To</label>
          <div className="ews-month-pair">
            <select
              id="ews-to-month"
              value={toMonth}
              disabled={allMonths}
              onChange={(e) => setToMonth(e.target.value)}
            >
              {MONTHS.map((name, index) => (
                <option key={name} value={String(index + 1)}>
                  {name.slice(0, 3)}
                </option>
              ))}
            </select>
            <select
              aria-label="To year"
              value={toYear}
              disabled={allMonths}
              onChange={(e) => setToYear(e.target.value)}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="ews-field ews-field-check">
          <label htmlFor="ews-all">Month Range</label>
          <label className="ews-check">
            <input
              id="ews-all"
              type="checkbox"
              checked={allMonths}
              onChange={(e) => setAllMonths(e.target.checked)}
            />
            ALL
          </label>
        </div>

        <div className="ews-field">
          <label htmlFor="ews-type">Salary Type</label>
          <select
            id="ews-type"
            value={salaryType}
            onChange={(e) => setSalaryType(e.target.value)}
          >
            <option value="ALL">All</option>
            <option value="REGULAR">Regular Salary (incl. Old)</option>
            <option value="OLD">Old Salary</option>
            <option value="DA_DIFFERENCE">DA Difference</option>
          </select>
        </div>

        <button type="submit" className="ews-btn" disabled={loading}>
          {loading ? "Loading..." : "Show"}
        </button>
      </form>

      {message ? <div className="ews-message no-print">{message}</div> : null}

      {report && groups.length > 0 ? (
        <div className="ews-sheet">
          <div className="ews-head">
            <div className="ews-head-line">{report.sectionTitle}</div>
            <div className="ews-head-line">{report.heading}</div>
            <div className="ews-head-line">
              {report.monthLine} ({report.salaryType})
            </div>
            <div className="ews-head-line">{report.subHeading}</div>
          </div>

          {groups.map((group) => (
            <section
              className="ews-emp-block"
              key={`${group.employee.employeeId}-${group.employee.instituteCode}`}
            >
              <div className="ews-emp-title">EMPLOYEE DETAIL</div>
              <div className="ews-emp-name">
                NAME :- {group.employee.employeeName}
                <span className="ews-emp-code">
                  ({group.employee.employeeCode})
                </span>
              </div>

              <div className="ews-emp-info">
                {employeeInfoEntries(group.employee).map(([label, value]) => (
                  <div className="ews-emp-info-cell" key={label}>
                    <span className="ews-emp-info-label">{label}</span>
                    <span className="ews-emp-info-value">{value || "-"}</span>
                  </div>
                ))}
              </div>

              <div className="ews-table-wrap">
                <table className="ews-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Salary Month</th>
                      <th>Paid Month</th>
                      <th>Type</th>
                      <th>Basic</th>
                      <th>G.P.</th>
                      <th>D.A.</th>
                      <th>HRA</th>
                      <th>Medical</th>
                      <th>T.A.</th>
                      <th>C.L.A.</th>
                      <th>Spl.All.</th>
                      <th>Wash.All.</th>
                      <th>TOTAL</th>
                      <th>GPF</th>
                      <th>GPF Adv.</th>
                      <th>NPS</th>
                      <th>I.Tax</th>
                      <th>P.Tax</th>
                      <th>Other</th>
                      <th>Tot.Ded.</th>
                      <th>Net</th>
                      <th>Cheque Amt.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row) => (
                      <tr key={`${row.detailId || row.billCodeId}-${row.srNo}`}>
                        <td className="ews-c">{row.srNo}</td>
                        <td className="ews-c">{row.salaryMonth}</td>
                        <td className="ews-c">{row.paidMonth}</td>
                        <td className="ews-c">{row.type === "OLD" ? "Old" : "Reg"}</td>
                        <td className="ews-n">{money(row.basic)}</td>
                        <td className="ews-n">{money(row.gradePay)}</td>
                        <td className="ews-n">{money(row.da)}</td>
                        <td className="ews-n">{money(row.hra)}</td>
                        <td className="ews-n">{money(row.medical)}</td>
                        <td className="ews-n">{money(row.ta)}</td>
                        <td className="ews-n">{money(row.cla)}</td>
                        <td className="ews-n">{money(row.specialAllowance)}</td>
                        <td className="ews-n">{money(row.washingAllowance)}</td>
                        <td className="ews-n ews-bold">{money(row.total)}</td>
                        <td className="ews-n">{money(row.gpf)}</td>
                        <td className="ews-n">{money(row.gpfAdvance)}</td>
                        <td className="ews-n">{money(row.nps)}</td>
                        <td className="ews-n">{money(row.incomeTax)}</td>
                        <td className="ews-n">{money(row.professionalTax)}</td>
                        <td className="ews-n">{money(row.otherDeduction)}</td>
                        <td className="ews-n">{money(row.totalDeduction)}</td>
                        <td className="ews-n ews-bold">{money(row.net)}</td>
                        <td className="ews-n">{money(row.chequeAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="ews-c ews-bold" colSpan={4}>
                        TOTAL
                      </td>
                      <td className="ews-n">{money(group.total.basic)}</td>
                      <td className="ews-n">{money(group.total.gradePay)}</td>
                      <td className="ews-n">{money(group.total.da)}</td>
                      <td className="ews-n">{money(group.total.hra)}</td>
                      <td className="ews-n">{money(group.total.medical)}</td>
                      <td className="ews-n">{money(group.total.ta)}</td>
                      <td className="ews-n">{money(group.total.cla)}</td>
                      <td className="ews-n">{money(group.total.specialAllowance)}</td>
                      <td className="ews-n">{money(group.total.washingAllowance)}</td>
                      <td className="ews-n">{money(group.total.total)}</td>
                      <td className="ews-n">{money(group.total.gpf)}</td>
                      <td className="ews-n">{money(group.total.gpfAdvance)}</td>
                      <td className="ews-n">{money(group.total.nps)}</td>
                      <td className="ews-n">{money(group.total.incomeTax)}</td>
                      <td className="ews-n">{money(group.total.professionalTax)}</td>
                      <td className="ews-n">{money(group.total.otherDeduction)}</td>
                      <td className="ews-n">{money(group.total.totalDeduction)}</td>
                      <td className="ews-n">{money(group.total.net)}</td>
                      <td className="ews-n">{money(group.total.chequeAmount)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          ))}

          <div className="ews-sign">
            <div>Account Officer</div>
            <div>Social Defence Department</div>
            <div>Gandhinagar, Gujarat State</div>
          </div>

          <div className="ews-actions no-print">
            <GridToolbar
              title="Employee Wise Salary"
              columns={COLUMNS}
              rows={exportRows}
              showSearch={false}
              hiddenActions={["excel", "print", "pdf"]}
            />
            <div className="ews-actions-main">
              <button
                type="button"
                className="ews-btn"
                onClick={handleExcel}
                disabled={exporting}
              >
                {exporting ? "Exporting..." : "Excel"}
              </button>
              <button
                type="button"
                className="ews-btn"
                onClick={handlePrint}
              >
                PDF
              </button>
              <button
                type="button"
                className="ews-btn"
                onClick={handlePrint}
              >
                Print
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
