import { apiFetch } from "./authSession";
import { API_BASE_URL } from "./apiConfig";
const API_BASE = `${API_BASE_URL}/api/salary-bill-codes`;

async function parseResponse(response) {
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const detail = data?.error ? ` ${data.error}` : "";
    const error = new Error(
      `${data?.message || `Request failed (${response.status})`}${detail}`
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

/** Normalize list payloads: { data: [] } or bare array. */
function asList(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  return [];
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
  };
}

export async function listSalaryBillCodes(options = {}) {
  const params = new URLSearchParams();
  if (options.status) params.set("status", String(options.status));
  if (options.category) params.set("category", String(options.category));
  if (options.includeArchived) params.set("includeArchived", "1");
  const qs = params.toString();
  const response = await apiFetch(qs ? `${API_BASE}?${qs}` : API_BASE);
  const result = await parseResponse(response);
  return asList(result);
}

export async function getSalaryBillCode(billCode) {
  const response = await apiFetch(
    `${API_BASE}/${encodeURIComponent(billCode)}`
  );
  const result = await parseResponse(response);
  return result?.data ?? result;
}

export async function createSalaryBillCode(payload, user) {
  const response = await apiFetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function updateSalaryBillCode(id, payload, user) {
  const response = await apiFetch(`${API_BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function deleteSalaryBillCode(id, user) {
  const response = await apiFetch(`${API_BASE}/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor({}, user)),
  });
  return parseResponse(response);
}

export async function completeSalaryBillCode(id, user) {
  const response = await apiFetch(`${API_BASE}/${id}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor({}, user)),
  });
  return parseResponse(response);
}

export async function lockSalaryBillCode(id, user) {
  const response = await apiFetch(`${API_BASE}/${id}/lock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor({}, user)),
  });
  return parseResponse(response);
}

export async function copySalaryBillCode(id, payload, user) {
  const response = await apiFetch(`${API_BASE}/${id}/copy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withActor(payload, user)),
  });
  return parseResponse(response);
}

export async function guardSalaryBillCode(billCode) {
  const response = await apiFetch(
    `${API_BASE}/guard/${encodeURIComponent(billCode)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }
  );
  return parseResponse(response);
}

export async function listBillEmployees(billCode) {
  const response = await apiFetch(
    `${API_BASE}/${encodeURIComponent(billCode)}/employees`
  );
  const result = await parseResponse(response);
  return asList(result);
}

export async function saveBillEmployees(billCode, employees, extra = {}, user) {
  const response = await apiFetch(
    `${API_BASE}/${encodeURIComponent(billCode)}/employees`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        withActor(
          {
            employees,
            instituteCode: extra.instituteCode,
            billMonth: extra.billMonth,
            salaryMonth: extra.salaryMonth,
          },
          user
        )
      ),
    }
  );
  return parseResponse(response);
}

export async function saveBillEmployeeOrder(billCode, order, user) {
  const response = await apiFetch(
    `${API_BASE}/${encodeURIComponent(billCode)}/employee-order`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withActor({ order }, user)),
    }
  );
  return parseResponse(response);
}
