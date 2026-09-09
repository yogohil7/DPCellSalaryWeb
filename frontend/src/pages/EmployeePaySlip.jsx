import { useEffect, useState } from "react";
import { getPaySlipOptions, getPaySlips } from "../utils/employeePaySlipApi";
import "./employeePaySlip.css";

/* Same amount formatting the other reports use. */
function money(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function Row({ label, value }) {
  return (
    <div className="eps-meta-row">
      <span className="eps-meta-label">{label}</span>
      <span className="eps-meta-value">{value || "—"}</span>
    </div>
  );
}

/* One employee's Pay Slip. Every value is rendered exactly as the server
   sent it; nothing is computed here. */
function Slip({ slip }) {
  return (
    <div className="eps-slip">
      <div className="eps-head">
        {slip.heading.map((line, index) => (
          <div
            key={line}
            className={`eps-head-line${index === 0 ? " eps-gov" : ""}`}
          >
            {line}
          </div>
        ))}
        <div className="eps-title">{slip.title}</div>
      </div>

      <div className="eps-meta">
        <Row label="Salary Month" value={slip.bill.salaryMonth} />
        <Row label="Bill Month" value={slip.bill.billMonth} />
        <Row label="Salary Type" value={slip.bill.salaryType} />
        <Row label="Bill Code" value={slip.bill.billCode} />
        <Row label="Bill No." value={slip.bill.billNo} />
        <Row label="Bill Date" value={slip.bill.billDate} />
        <Row label="Institute Code" value={slip.institute.instituteCode} />
        <Row label="Institute Name" value={slip.institute.instituteName} />
        <Row label="NPS Schedule No." value={slip.bill.npsScheduleNo} />
      </div>

      <div className="eps-section-title">EMPLOYEE INFORMATION</div>
      <div className="eps-meta" style={{ border: "1px solid #94a3b8", padding: "6px 8px" }}>
        <Row label="Employee ID" value={slip.employee.employeeId} />
        <Row label="Employee Name" value={slip.employee.employeeName} />
        <Row label="Designation" value={slip.employee.designation} />
        <Row label="Employee Type" value={slip.employee.employeeType} />
        <Row label="Pension" value={slip.employee.pension} />
        <Row label="Bank Account No." value={slip.employee.bankAccountNumber} />
      </div>

      <div className="eps-columns">
        <table className="eps-table">
          <thead>
            <tr>
              <th>Earnings</th>
              <th className="eps-amt">Amount</th>
            </tr>
          </thead>
          <tbody>
            {slip.earnings.map((line) => (
              <tr key={line.key}>
                <td>{line.label}</td>
                <td className="eps-amt">{money(line.amount)}</td>
              </tr>
            ))}
            <tr className="eps-total">
              <td>GROSS SALARY</td>
              <td className="eps-amt">{money(slip.grossSalary)}</td>
            </tr>
          </tbody>
        </table>

        <table className="eps-table">
          <thead>
            <tr>
              <th>Deductions</th>
              <th className="eps-amt">Amount</th>
            </tr>
          </thead>
          <tbody>
            {slip.deductions.map((line) => (
              <tr key={line.key}>
                <td>{line.label}</td>
                <td className="eps-amt">{money(line.amount)}</td>
              </tr>
            ))}
            <tr className="eps-total">
              <td>TOTAL DEDUCTION</td>
              <td className="eps-amt">{money(slip.totalDeduction)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="eps-net">
        <span>NET SALARY</span>
        <span>{money(slip.netSalary)}</span>
      </div>

      <div className="eps-words">
        <span className="eps-words-label">Rupees in Words:</span>
        {slip.netSalaryInWords}
      </div>

      <div className="eps-foot">
        <div className="eps-office">
          <div>Office / Institute:</div>
          <div>{slip.institute.instituteName}</div>
        </div>
        <div className="eps-sign">
          <div>Authorized Officer</div>
          <div>Directorate of Social Defence</div>
        </div>
      </div>

      <div className="eps-disclaimer">{slip.disclaimer}</div>
    </div>
  );
}

export default function EmployeePaySlip({ user, onBack }) {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [sectionId, setSectionId] = useState("");
  const [instituteCode, setInstituteCode] = useState("");
  const [billCodeId, setBillCodeId] = useState("");
  const [employeeId, setEmployeeId] = useState("");

  const [options, setOptions] = useState({
    years: [], sections: [], institutes: [], bills: [], employees: [],
  });
  const [slips, setSlips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  /* The pickers are driven by the same approved rows the slips come from, so
     a selection can only ever be one that really has an official slip. */
  useEffect(() => {
    let active = true;
    getPaySlipOptions({ month, year, sectionId, instituteCode, billCodeId })
      .then((res) => {
        if (!active) return;
        setOptions(
          res?.data || {
            years: [], sections: [], institutes: [], bills: [], employees: [],
          }
        );
      })
      .catch(() => {
        if (active) {
          setOptions({
            years: [], sections: [], institutes: [], bills: [], employees: [],
          });
        }
      });
    return () => {
      active = false;
    };
  }, [month, year, sectionId, instituteCode, billCodeId]);

  async function load(scope) {
    setLoading(true);
    setMessage("");
    try {
      const res = await getPaySlips({
        month,
        year,
        sectionId: sectionId || undefined,
        instituteCode: instituteCode || undefined,
        billCodeId: billCodeId || undefined,
        /* "all" is the bulk print: same selection, employee left open. */
        employeeId: scope === "all" ? undefined : employeeId || undefined,
      });
      const list = res?.data?.slips || [];
      setSlips(list);
      if (!list.length) {
        setMessage(
          "No approved or locked salary bill found for this selection."
        );
      }
    } catch (error) {
      setSlips([]);
      setMessage(error.message || "Could not generate the Pay Slip.");
    } finally {
      setLoading(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div className="eps-page">
      <div className="eps-toolbar no-print">
        <button type="button" className="eps-link" onClick={onBack}>
          ← Back
        </button>
      </div>

      <form
        className="eps-filters no-print"
        onSubmit={(event) => {
          event.preventDefault();
          load("one");
        }}
      >
        <div className="eps-field">
          <label>Salary Month</label>
          <select
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setSectionId(""); setInstituteCode(""); setBillCodeId(""); setEmployeeId("");
              setSlips([]);
            }}
          >
            {MONTHS.map((name, index) => (
              <option key={name} value={String(index + 1)}>{name}</option>
            ))}
          </select>
        </div>

        <div className="eps-field">
          <label>Year</label>
          {options.years?.length ? (
            <select
              value={year}
              onChange={(e) => {
                setYear(e.target.value);
                setSectionId(""); setInstituteCode(""); setBillCodeId(""); setEmployeeId("");
                setSlips([]);
              }}
            >
              {options.years.map((y) => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          )}
        </div>

        <div className="eps-field">
          <label>Section</label>
          <select
            value={sectionId}
            onChange={(e) => {
              setSectionId(e.target.value);
              setInstituteCode(""); setBillCodeId(""); setEmployeeId("");
              setSlips([]);
            }}
          >
            <option value="">All Sections</option>
            {(options.sections || []).map((s) => (
              <option key={s.sectionId} value={s.sectionId}>
                {s.sectionName}
              </option>
            ))}
          </select>
        </div>

        <div className="eps-field">
          <label>Institute</label>
          <select
            value={instituteCode}
            onChange={(e) => {
              setInstituteCode(e.target.value);
              setBillCodeId(""); setEmployeeId("");
              setSlips([]);
            }}
          >
            <option value="">All Institutes</option>
            {(options.institutes || []).map((i) => (
              <option key={i.instituteCode} value={i.instituteCode}>
                {i.instituteCode} — {i.instituteName}
              </option>
            ))}
          </select>
        </div>

        <div className="eps-field">
          <label>Bill</label>
          <select
            value={billCodeId}
            onChange={(e) => {
              setBillCodeId(e.target.value);
              setEmployeeId("");
              setSlips([]);
            }}
          >
            <option value="">All Bills</option>
            {(options.bills || []).map((b) => (
              <option key={b.billCodeId} value={b.billCodeId}>
                {b.billCode} ({b.salaryType} · Bill Month {b.billMonth})
              </option>
            ))}
          </select>
        </div>

        <div className="eps-field">
          <label>Employee</label>
          <select
            value={employeeId}
            onChange={(e) => {
              setEmployeeId(e.target.value);
              setSlips([]);
            }}
          >
            <option value="">All Employees</option>
            {(options.employees || []).map((emp) => (
              <option key={emp.employeeId} value={emp.employeeId}>
                {emp.employeeName}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="eps-btn" disabled={loading}>
          {loading ? "Loading..." : "Show Pay Slip"}
        </button>
        <button
          type="button"
          className="eps-btn eps-btn-ghost"
          disabled={loading}
          onClick={() => load("all")}
        >
          All Employees of Selection
        </button>
      </form>

      {message ? <div className="eps-message no-print">{message}</div> : null}

      {slips.length ? (
        <>
          <div className="eps-actions no-print">
            <button type="button" className="eps-btn" onClick={handlePrint}>
              Print / PDF
            </button>
            <span style={{ alignSelf: "center", fontSize: 13, color: "#5b6b7f" }}>
              {slips.length} Pay Slip{slips.length > 1 ? "s" : ""} — one per page
            </span>
          </div>

          {slips.map((slip) => (
            <Slip
              key={`${slip.bill.billCodeId}-${slip.institute.instituteCode}-${slip.employee.employeeId}`}
              slip={slip}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}
