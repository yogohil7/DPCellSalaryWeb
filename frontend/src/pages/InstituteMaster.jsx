import { useEffect, useMemo, useState } from "react";
import Breadcrumb from "../components/Breadcrumb";
import DataGrid, { GridActions } from "../components/DataGrid";
import { listActiveSections } from "../utils/sectionApi";
import {
  listInstitutes,
  createInstitute,
  updateInstitute,
  deleteInstitute,
} from "../utils/instituteApi";
import { listActiveDistricts } from "../utils/districtApi";
import "./instituteMaster.css";

const initialForm = {
  sectionId: "",
  instituteCode: "",
  instituteName: "",
  instituteDistrict: "",
  cityClass: "",
  instituteAddress: "",
  bankAccountNumber: "",
  status: "Active",
};

export default function InstituteMaster({ onBack, user }) {
  const [form, setForm] = useState(initialForm);
  const [search, setSearch] = useState({
    instituteCode: "",
    instituteName: "",
    district: "",
    status: "",
  });
  const [institutes, setInstitutes] = useState([]);
  const [sections, setSections] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editingSectionOption, setEditingSectionOption] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sectionRows, instituteRows, districtRows] = await Promise.all([
        listActiveSections(),
        listInstitutes(),
        listActiveDistricts(),
      ]);
      setSections(Array.isArray(sectionRows) ? sectionRows : []);
      setInstitutes(Array.isArray(instituteRows) ? instituteRows : []);
      const names = (Array.isArray(districtRows) ? districtRows : [])
        .map((d) => String(d.districtName || d.DistrictName || "").trim())
        .filter((name) => name && name !== "0");
      setDistricts([...new Set(names)].sort((a, b) => a.localeCompare(b)));
    } catch (error) {
      setMessage(error.message || "Unable to load institute data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const districtOptions = useMemo(() => {
    const set = new Set(districts);
    if (form.instituteDistrict) set.add(form.instituteDistrict);
    if (search.district) set.add(search.district);
    institutes.forEach((item) => {
      const name = String(
        item.instituteDistrict || item.districtName || ""
      ).trim();
      if (name && name !== "0") set.add(name);
    });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [districts, form.instituteDistrict, search.district, institutes]);

  const sectionOptions = useMemo(() => {
    const active = sections.map((row) => ({
      sectionId: row.sectionId || row.id,
      sectionName: row.sectionName,
    }));

    if (
      editingSectionOption &&
      !active.some(
        (row) => Number(row.sectionId) === Number(editingSectionOption.sectionId)
      )
    ) {
      return [editingSectionOption, ...active];
    }

    return active;
  }, [sections, editingSectionOption]);

  const setField = (field) => (event) => {
    setForm((prev) => ({
      ...prev,
      [field]: event.target.value,
    }));
  };

  const setSearchField = (field) => (event) => {
    setSearch((prev) => ({
      ...prev,
      [field]: event.target.value,
    }));
  };

  const handleSave = async (event) => {
    event.preventDefault();

    if (!form.sectionId) {
      setMessage("Please select Institute Type.");
      return;
    }

    if (
      !form.instituteCode.trim() ||
      !form.instituteName.trim() ||
      !form.instituteDistrict ||
      !form.cityClass
    ) {
      setMessage("Please fill all required fields.");
      return;
    }

    const payload = {
      sectionId: Number(form.sectionId),
      instituteCode: form.instituteCode.trim(),
      instituteName: form.instituteName.trim(),
      instituteDistrict: form.instituteDistrict,
      cityClass: form.cityClass,
      instituteAddress: form.instituteAddress.trim(),
      bankAccountNumber: form.bankAccountNumber.trim(),
      status: form.status || "Active",
    };

    try {
      setLoading(true);
      if (editingId !== null) {
        await updateInstitute(editingId, payload, user);
        setMessage("Institute updated successfully.");
      } else {
        await createInstitute(payload, user);
        setMessage("Institute added successfully.");
      }

      setForm(initialForm);
      setEditingId(null);
      setEditingSectionOption(null);
      await loadData();
    } catch (error) {
      setMessage(error.message || "Unable to save institute.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setForm(initialForm);
    setEditingId(null);
    setEditingSectionOption(null);
    setMessage("");
  };

  const handleSearchReset = () => {
    setSearch({
      instituteCode: "",
      instituteName: "",
      district: "",
      status: "",
    });
  };

  const handleEdit = (item) => {
    setForm({
      sectionId: item.sectionId != null ? String(item.sectionId) : "",
      instituteCode: item.instituteCode || "",
      instituteName: item.instituteName || "",
      instituteDistrict:
        item.instituteDistrict ||
        item.districtName ||
        "",
      cityClass: item.cityClass || item.cityClassName || "",
      instituteAddress: item.instituteAddress || "",
      bankAccountNumber: item.bankAccountNumber || "",
      status: item.status || "Active",
    });

    if (item.sectionId) {
      setEditingSectionOption({
        sectionId: item.sectionId,
        sectionName: item.instituteType || item.sectionName || `Section ${item.sectionId}`,
      });
    } else {
      setEditingSectionOption(null);
    }

    setEditingId(item.instituteId || item.id);
    setMessage("");

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const handleDelete = async (id) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this institute?"
    );

    if (!confirmed) return;

    try {
      setLoading(true);
      await deleteInstitute(id, user);
      if (editingId === id) {
        setForm(initialForm);
        setEditingId(null);
        setEditingSectionOption(null);
      }
      setMessage("Institute deleted successfully.");
      await loadData();
    } catch (error) {
      setMessage(error.message || "Unable to delete institute.");
    } finally {
      setLoading(false);
    }
  };

  const filteredInstitutes = institutes.filter((item) => {
    const codeMatch =
      !search.instituteCode ||
      String(item.instituteCode || "")
        .toLowerCase()
        .includes(search.instituteCode.toLowerCase());

    const nameMatch =
      !search.instituteName ||
      String(item.instituteName || "")
        .toLowerCase()
        .includes(search.instituteName.toLowerCase());

    const districtMatch =
      !search.district || item.instituteDistrict === search.district;

    const statusMatch = !search.status || item.status === search.status;

    return codeMatch && nameMatch && districtMatch && statusMatch;
  });

  return (
    <div className="institute-master">
      <div className="im-top">
        <button type="button" className="im-back" onClick={onBack}>
          ← Back to Home
        </button>
        <h1>INSTITUTE MASTER</h1>
      </div>

      <section className="im-card">
        <div className="im-card-head">
          <span>INSTITUTE INFORMATION</span>
          <Breadcrumb className="im-crumb" section="Masters" current="Institute Master" />
        </div>

        <div className="im-card-body">
          <form onSubmit={handleSave}>
            <div className="im-grid">
              <label>
                Institute Type <em>*</em>
                <select
                  value={form.sectionId}
                  onChange={setField("sectionId")}
                  required
                >
                  <option value="">Select Institute Type</option>
                  {sectionOptions.map((section) => (
                    <option
                      key={section.sectionId}
                      value={section.sectionId}
                    >
                      {section.sectionName}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Institute Code <em>*</em>
                <input
                  type="text"
                  value={form.instituteCode}
                  onChange={setField("instituteCode")}
                  placeholder="Enter Institute Code"
                  required
                />
              </label>

              <label>
                Institute Name <em>*</em>
                <input
                  type="text"
                  value={form.instituteName}
                  onChange={setField("instituteName")}
                  placeholder="Enter Institute Name"
                  required
                />
              </label>

              <label>
                Institute District <em>*</em>
                <select
                  value={form.instituteDistrict}
                  onChange={setField("instituteDistrict")}
                  required
                >
                  <option value="">Select District</option>
                  {districtOptions.map((district) => (
                    <option key={district} value={district}>
                      {district}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                City Class <em>*</em>
                <select
                  value={form.cityClass}
                  onChange={setField("cityClass")}
                  required
                >
                  <option value="">Select City Class</option>
                  <option value="X">X</option>
                  <option value="Y">Y</option>
                  <option value="Z">Z</option>
                </select>
              </label>

              <label className="im-wide">
                Institute Address
                <textarea
                  value={form.instituteAddress}
                  onChange={setField("instituteAddress")}
                  placeholder="Enter Institute Address"
                />
              </label>

              <label>
                Bank Account Number
                <input
                  type="text"
                  value={form.bankAccountNumber}
                  onChange={setField("bankAccountNumber")}
                  placeholder="Enter Bank Account Number"
                />
              </label>

              <label>
                Status <em>*</em>
                <select
                  value={form.status}
                  onChange={setField("status")}
                  required
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </label>
            </div>

            <div className="im-actions">
              {message && <span className="im-message">{message}</span>}

              <button
                type="submit"
                className="im-btn primary"
                disabled={loading}
              >
                {editingId !== null ? "Update" : "Save"}
              </button>

              <button
                type="button"
                className="im-btn reset"
                onClick={handleReset}
              >
                Reset
              </button>

              <button
                type="button"
                className="im-btn cancel"
                onClick={onBack}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="im-card">
        <div className="im-card-head">SEARCH INSTITUTE</div>
        <div className="im-card-body">
          <div className="im-search-grid">
            <label>
              Institute Code
              <input
                type="text"
                value={search.instituteCode}
                onChange={setSearchField("instituteCode")}
              />
            </label>

            <label>
              Institute Name
              <input
                type="text"
                value={search.instituteName}
                onChange={setSearchField("instituteName")}
              />
            </label>

            <label>
              District
              <select
                value={search.district}
                onChange={setSearchField("district")}
              >
                <option value="">All</option>
                {districtOptions.map((district) => (
                  <option key={district} value={district}>
                    {district}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Status
              <select
                value={search.status}
                onChange={setSearchField("status")}
              >
                <option value="">All</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </label>

            <div className="im-search-buttons">
              <button type="button" className="im-btn primary">
                Search
              </button>
              <button
                type="button"
                className="im-btn reset"
                onClick={handleSearchReset}
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="im-card">
        <div className="im-card-head">INSTITUTE LIST</div>
        <div className="im-card-body">
          <DataGrid
            title="Institute List"
            rows={filteredInstitutes}
            emptyText={
              loading ? "Loading..." : "No institute records found."
            }
            columns={[
              { key: "sr", label: "Sr. No.", type: "serial" },
              {
                key: "instituteType",
                label: "Institute Type",
                align: "left",
                getValue: (row) => row.instituteType || row.sectionName || "",
              },
              { key: "instituteCode", label: "Institute Code", align: "left" },
              { key: "instituteName", label: "Institute Name", align: "left" },
              {
                key: "instituteDistrict",
                label: "District",
                align: "left",
                getValue: (row) =>
                  row.instituteDistrict ||
                  row.districtName ||
                  "",
              },
              { key: "cityClass", label: "City Class", align: "center" },
              {
                key: "bankAccountNumber",
                label: "Bank Account Number",
                align: "left",
              },
              { key: "status", label: "Status", type: "status" },
              {
                key: "actions",
                label: "Actions",
                type: "actions",
                sortable: false,
                exportable: false,
                render: (item) => (
                  <GridActions
                    onEdit={() => handleEdit(item)}
                    onDelete={() =>
                      handleDelete(item.instituteId || item.id)
                    }
                  />
                ),
              },
            ]}
          />
        </div>
      </section>
    </div>
  );
}
