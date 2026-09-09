const STORAGE_KEY = "dp_cell_salary_bills";

/* -------------------------------------------------------
   GET ALL SALARY BILLS
------------------------------------------------------- */
export function getSalaryBills() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);

    if (!data) {
      return [];
    }

    const bills = JSON.parse(data);

    return Array.isArray(bills) ? bills : [];
  } catch (error) {
    console.error("Error reading salary bills:", error);
    return [];
  }
}

/* -------------------------------------------------------
   SAVE ALL SALARY BILLS
------------------------------------------------------- */
export function saveSalaryBills(bills) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bills));
    return true;
  } catch (error) {
    console.error("Error saving salary bills:", error);
    return false;
  }
}

/* -------------------------------------------------------
   GET ONE BILL
------------------------------------------------------- */
export function getSalaryBill(billId) {
  const bills = getSalaryBills();

  return bills.find(
    (bill) =>
      String(bill.id) === String(billId) ||
      String(bill.billCode) === String(billId)
  );
}

/* -------------------------------------------------------
   ADD NEW BILL
------------------------------------------------------- */
export function addSalaryBill(bill) {
  const bills = getSalaryBills();

  const newBill = {
    id:
      bill.id ||
      `BILL-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 7)}`,

    ...bill,

    createdDate:
      bill.createdDate ||
      new Date().toISOString(),

    updatedDate:
      new Date().toISOString(),
  };

  bills.push(newBill);

  saveSalaryBills(bills);

  return newBill;
}

/* -------------------------------------------------------
   UPDATE BILL
------------------------------------------------------- */
export function updateSalaryBill(billId, changes) {
  const bills = getSalaryBills();

  const index = bills.findIndex(
    (bill) =>
      String(bill.id) === String(billId)
  );

  if (index === -1) {
    console.warn("Salary bill not found:", billId);
    return null;
  }

  bills[index] = {
    ...bills[index],
    ...changes,
    updatedDate: new Date().toISOString(),
  };

  saveSalaryBills(bills);

  return bills[index];
}

/* -------------------------------------------------------
   RETURN BILL TO AUDITOR
------------------------------------------------------- */
export function returnSalaryBill({
  billId,
  auditorId,
  auditorName,
  returnedBy,
  returnReason,
}) {
  const bill = getSalaryBill(billId);

  if (!bill) {
    throw new Error("Salary bill not found.");
  }

  if (!auditorId) {
    throw new Error("Please select an Auditor.");
  }

  if (!returnReason || !returnReason.trim()) {
    throw new Error("Return reason is required.");
  }

  return updateSalaryBill(billId, {
    status: "RETURNED",

    assignedAuditorId: auditorId,
    assignedAuditor: auditorName,

    returnedBy:
      returnedBy || "Accounts Officer",

    returnedDate: new Date().toISOString(),

    returnReason: returnReason.trim(),

    /* Clear approval information */
    approvedBy: "",
    approvedDate: null,

    /* Keep submission information */
    submittedStatus: "RETURNED",
  });
}

/* -------------------------------------------------------
   RESUBMIT RETURNED BILL
------------------------------------------------------- */
export function resubmitSalaryBill(billId, user) {
  const bill = getSalaryBill(billId);

  if (!bill) {
    throw new Error("Salary bill not found.");
  }

  return updateSalaryBill(billId, {
    status: "RESUBMITTED",

    resubmittedBy:
      user?.userName ||
      user?.username ||
      user?.name ||
      "Auditor",

    resubmittedDate:
      new Date().toISOString(),

    /* Keep auditor assignment */
    assignedAuditorId:
      bill.assignedAuditorId,

    assignedAuditor:
      bill.assignedAuditor,

    /* Clear previous return message only after
       it has been displayed during correction */
    returnReason:
      bill.returnReason,
  });
}

/* -------------------------------------------------------
   DELETE BILL
------------------------------------------------------- */
export function deleteSalaryBill(billId) {
  const bills = getSalaryBills();

  const filtered = bills.filter(
    (bill) =>
      String(bill.id) !== String(billId)
  );

  saveSalaryBills(filtered);

  return true;
}

/* -------------------------------------------------------
   CLEAR ALL BILLS
   DEVELOPMENT / TESTING ONLY
------------------------------------------------------- */
export function clearSalaryBills() {
  localStorage.removeItem(STORAGE_KEY);
}