import { apiFetch } from "./authSession";
import { API_BASE_URL } from "./apiConfig";
const API_BASE = `${API_BASE_URL}/api/salary-bill-approval`;

async function parseResponse(response) {
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(
      data?.message || `Request failed (${response.status})`
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function withActor(payload, user) {
  return {
    ...payload,
    userName: user?.userName || user?.username || "SYSTEM",
    fullName:
      user?.fullName ||
      user?.name ||
      user?.userName ||
      user?.username ||
      "SYSTEM",
    userId: user?.userId ?? user?.id ?? null,
    roleName: user?.roleName || user?.role || "",
  };
}

export async function listApprovalBills(status = "PENDING") {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  const response = await apiFetch(`${API_BASE}?${params.toString()}`);
  return parseResponse(response);
}

export async function listReturnedBills({ auditorUserId, user } = {}) {
  const params = new URLSearchParams();
  if (auditorUserId) params.set("auditorUserId", String(auditorUserId));
  if (user?.roleName || user?.role) {
    params.set("roleName", user.roleName || user.role);
  }
  if (user?.userName) params.set("userName", user.userName);
  const response = await apiFetch(`${API_BASE}/returned?${params.toString()}`);
  return parseResponse(response);
}

export async function listAuditors() {
  const response = await apiFetch(`${API_BASE}/auditors`);
  return parseResponse(response);
}

export async function getApprovalBill(idOrCode, instituteCode) {
  const params = new URLSearchParams();
  if (instituteCode) params.set("instituteCode", String(instituteCode));
  const response = await apiFetch(
    `${API_BASE}/${encodeURIComponent(idOrCode)}?${params.toString()}`
  );
  return parseResponse(response);
}

export async function verifyApprovalBill(idOrCode, instituteCode, user) {
  const response = await apiFetch(
    `${API_BASE}/${encodeURIComponent(idOrCode)}/verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withActor({ instituteCode }, user)),
    }
  );
  return parseResponse(response);
}

export async function approveApprovalBill(idOrCode, instituteCode, user) {
  const response = await apiFetch(
    `${API_BASE}/${encodeURIComponent(idOrCode)}/approve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withActor({ instituteCode }, user)),
    }
  );
  return parseResponse(response);
}

export async function lockApprovalInstitute(idOrCode, instituteCode, user) {
  const response = await apiFetch(`${API_BASE}/${encodeURIComponent(idOrCode)}/lock`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor({ instituteCode }, user)),
  });
  return parseResponse(response);
}

export async function returnApprovalBill(
  idOrCode,
  { instituteCode, returnedToAuditorId, returnedRemarks },
  user
) {
  const response = await apiFetch(
    `${API_BASE}/${encodeURIComponent(idOrCode)}/return`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        withActor(
          {
            instituteCode,
            returnedToAuditorId,
            returnedRemarks,
            returnReason: returnedRemarks,
          },
          user
        )
      ),
    }
  );
  return parseResponse(response);
}

export async function rejectApprovalBill(
  idOrCode,
  { instituteCode, rejectReason },
  user
) {
  const response = await apiFetch(
    `${API_BASE}/${encodeURIComponent(idOrCode)}/reject`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withActor({ instituteCode, rejectReason }, user)),
    }
  );
  return parseResponse(response);
}

export async function getApprovalVariationReport({
  billCode,
  instituteCode,
  previousBillCode,
  compareMode = "previousSalaryMonth",
}) {
  const params = new URLSearchParams();
  params.set("billCode", billCode);
  params.set("instituteCode", instituteCode);
  if (previousBillCode) params.set("previousBillCode", previousBillCode);
  if (compareMode) params.set("compareMode", compareMode);
  const response = await apiFetch(
    `${API_BASE}/variation-report?${params.toString()}`
  );
  return parseResponse(response);
}
