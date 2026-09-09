import ModuleFrame from "../components/ModuleFrame";
import DataGrid from "../components/DataGrid";

const REPORT_COLUMNS = {
  "salary-register": [
    { key: "sr", label: "Sr. No.", type: "serial" },
    { key: "employeeName", label: "Employee Name", align: "left" },
    { key: "designation", label: "Designation", align: "left" },
    { key: "instituteName", label: "Institute", align: "left" },
    { key: "grossAmount", label: "Gross Amount", type: "number" },
    { key: "totalDeduction", label: "Total Deduction", type: "number" },
    { key: "netSalary", label: "Net Salary", type: "number" },
    { key: "status", label: "Status", type: "status" },
  ],
  "cheque-register": [
    { key: "sr", label: "Sr. No.", type: "serial" },
    { key: "billCode", label: "Bill Code", align: "center" },
    { key: "instituteName", label: "Institute", align: "left" },
    { key: "chequeNo", label: "Cheque No", align: "center" },
    { key: "chequeDate", label: "Cheque Date", type: "date" },
    { key: "chequeAmount", label: "Cheque Amount", type: "number" },
    { key: "status", label: "Status", type: "status" },
  ],
  "institute-wise-salary": [
    { key: "sr", label: "Sr. No.", type: "serial" },
    { key: "instituteCode", label: "Institute Code", align: "center" },
    { key: "instituteName", label: "Institute Name", align: "left" },
    { key: "employees", label: "Employees", align: "center" },
    { key: "grossAmount", label: "Gross Amount", type: "number" },
    { key: "netSalary", label: "Net Salary", type: "number" },
  ],
  "employee-wise-salary": [
    { key: "sr", label: "Sr. No.", type: "serial" },
    { key: "employeeName", label: "Employee Name", align: "left" },
    { key: "designation", label: "Designation", align: "left" },
    { key: "employeeType", label: "Employee Type", align: "center" },
    { key: "netSalary", label: "Net Salary", type: "number" },
  ],
  "section-summary": [
    { key: "sr", label: "Sr. No.", type: "serial" },
    { key: "section", label: "Section", align: "left" },
    { key: "employees", label: "Employees", align: "center" },
    { key: "grossAmount", label: "Gross Amount", type: "number" },
    { key: "netSalary", label: "Net Salary", type: "number" },
  ],
  "institute-wise-gpf": [
    { key: "sr", label: "Sr. No.", type: "serial" },
    { key: "instituteName", label: "Institute", align: "left" },
    { key: "gpfSubscription", label: "GPF Subscription", type: "number" },
    { key: "gpfAdv", label: "GPF Advance", type: "number" },
  ],
  "nps-summary": [
    { key: "sr", label: "Sr. No.", type: "serial" },
    { key: "employeeName", label: "Employee Name", align: "left" },
    { key: "nps", label: "NPS", type: "number" },
    { key: "status", label: "Status", type: "status" },
  ],
  "nps-deduction": [
    { key: "sr", label: "Sr. No.", type: "serial" },
    { key: "employeeName", label: "Employee Name", align: "left" },
    { key: "nps", label: "NPS Deduction", type: "number" },
  ],
  "nps-schedule": [
    { key: "sr", label: "Sr. No.", type: "serial" },
    { key: "scheduleNo", label: "Schedule No", align: "center" },
    { key: "instituteName", label: "Institute", align: "left" },
    { key: "nps", label: "NPS Amount", type: "number" },
  ],
  "variation-report": [
    { key: "sr", label: "Sr. No.", type: "serial" },
    { key: "employeeName", label: "Employee Name", align: "left" },
    { key: "fieldName", label: "Field", align: "left" },
    { key: "physicalAmount", label: "Physical", type: "number" },
    { key: "entryAmount", label: "Salary Entry", type: "number" },
    { key: "difference", label: "Difference", type: "number" },
    { key: "status", label: "Status", type: "status" },
  ],
};

const SAMPLE_ROWS = [
  {
    id: 1,
    employeeName: "Ramesh Patel",
    designation: "Accountant",
    employeeType: "GPF",
    instituteCode: "INS001",
    instituteName: "Observation Home, Ahmedabad",
    billCode: "AUG-2026",
    chequeNo: "CHQ001",
    chequeDate: "24-08-2026",
    chequeAmount: "191300.00",
    employees: 3,
    grossAmount: "207110.00",
    totalDeduction: "15810.00",
    netSalary: "191300.00",
    gpfSubscription: "2500.00",
    gpfAdv: "0.00",
    nps: "3960.00",
    section: "Accounts",
    scheduleNo: "NPS-AUG-001",
    fieldName: "Basic Pay",
    physicalAmount: "25500.00",
    entryAmount: "25500.00",
    difference: "0.00",
    status: "Approved",
  },
];

export default function GenericModule({ title, pageId, onBack }) {
  const columns = REPORT_COLUMNS[pageId] || [
    { key: "sr", label: "Sr. No.", type: "serial" },
    { key: "description", label: "Description", align: "left" },
    { key: "status", label: "Status", type: "status" },
  ];

  const rows = REPORT_COLUMNS[pageId]
    ? SAMPLE_ROWS
    : [{ id: 1, description: "This module is available as a full-page screen.", status: "Active" }];

  return (
    <ModuleFrame title={title} onBack={onBack}>
      <div className="full-form">
        <DataGrid
          title={title}
          columns={columns}
          rows={rows}
          emptyText="No records found."
        />
      </div>
    </ModuleFrame>
  );
}
