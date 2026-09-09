import { useEffect, useState } from "react";
import Breadcrumb from "../components/Breadcrumb";
import DataGrid, { GridActions } from "../components/DataGrid";
import { apiFetch } from "../utils/authSession";
import "./transportAllowanceMaster.css";
import { API_BASE_URL } from "../utils/apiConfig";

const API_URL =
    `${API_BASE_URL}/api/transport-allowance-master`;


/*
   Fallback only. The live list is loaded from SQL Server via
   GET /api/transport-allowance-master/lookups/pay-level-groups,
   which returns exactly these three groups. Kept here so the form
   still renders the correct options if that request fails.
*/
const PAY_LEVEL_GROUP_FALLBACK = [
    "Level 2 and Below",
    "Level 3-8",
    "Level 9 and Above",
];


export default function TransportAllowance({ onBack }) {

    /* =====================================================
       FORM
    ===================================================== */

    const [form, setForm] = useState({
        effectiveDate: "",
        payLevelGroup: "",
        cityClass: "",
        taAmount: "",
        description: "",
        status: "Active",
    });


    /* =====================================================
       SEARCH
    ===================================================== */

    const [search, setSearch] = useState({
        effectiveDate: "",
        payLevelGroup: "",
        cityClass: "",
        taAmount: "",
        status: "All",
    });


    /* =====================================================
       DATA
    ===================================================== */

    const [records, setRecords] = useState([]);

    const [loading, setLoading] = useState(false);

    const [saving, setSaving] = useState(false);

    const [editingId, setEditingId] = useState(null);


    /* =====================================================
       LOOKUPS (SQL-backed)
    ===================================================== */

    const [payLevelGroups, setPayLevelGroups] =
        useState(PAY_LEVEL_GROUP_FALLBACK);

    const [cityClasses, setCityClasses] = useState([]);


    /* =====================================================
       LOAD DATA
    ===================================================== */

    const loadRecords = async () => {

        try {

            setLoading(true);

            const response = await apiFetch(API_URL);

            const result = await response.json();

            if (!response.ok) {

                throw new Error(
                    result.message ||
                    "Unable to load records."
                );
            }

            setRecords(
                Array.isArray(result.data)
                    ? result.data
                    : []
            );

        } catch (error) {

            console.error(
                "Load Transport Allowance:",
                error
            );

            alert(
                error.message ||
                "Unable to load Transport Allowance records."
            );

        } finally {

            setLoading(false);
        }
    };


    const loadLookups = async () => {

        try {

            const [groupRes, cityRes] = await Promise.all([
                apiFetch(`${API_URL}/lookups/pay-level-groups`),
                apiFetch(`${API_URL}/lookups/city-classes`),
            ]);


            const groupJson = await groupRes.json();

            if (
                groupRes.ok &&
                Array.isArray(groupJson.data) &&
                groupJson.data.length > 0
            ) {
                setPayLevelGroups(groupJson.data);
            }


            const cityJson = await cityRes.json();

            if (cityRes.ok && Array.isArray(cityJson.data)) {
                setCityClasses(
                    cityJson.data
                        .map((row) => row.cityClass)
                        .filter(Boolean)
                );
            }

        } catch (error) {

            console.error(
                "Load Transport Allowance lookups:",
                error
            );
        }
    };


    /* =====================================================
       INITIAL LOAD
    ===================================================== */

    useEffect(() => {

        loadRecords();

        loadLookups();

    }, []);


    /* =====================================================
       FORM CHANGE
    ===================================================== */

    const handleChange = (e) => {

        const {
            name,
            value
        } = e.target;

        setForm((prev) => ({
            ...prev,
            [name]: value
        }));
    };


    /* =====================================================
       SEARCH CHANGE
    ===================================================== */

    const handleSearchChange = (e) => {

        const {
            name,
            value
        } = e.target;

        setSearch((prev) => ({
            ...prev,
            [name]: value
        }));
    };


    /* =====================================================
       RESET FORM
    ===================================================== */

    const handleReset = () => {

        setForm({
            effectiveDate: "",
            payLevelGroup: "",
            cityClass: "",
            taAmount: "",
            description: "",
            status: "Active",
        });

        setEditingId(null);
    };


    /* =====================================================
       SAVE / UPDATE
    ===================================================== */

    const handleSave = async (e) => {

        e.preventDefault();


        /* -----------------------------
           VALIDATION
        ----------------------------- */

        if (!form.effectiveDate) {

            alert(
                "Please select Effective Date."
            );

            return;
        }


        if (!form.payLevelGroup) {

            alert(
                "Please select Pay Level Group."
            );

            return;
        }


        if (!form.cityClass) {

            alert(
                "Please select City Class."
            );

            return;
        }


        if (
            form.taAmount === "" ||
            form.taAmount === null
        ) {

            alert(
                "Please enter TA Amount."
            );

            return;
        }


        if (
            Number.isNaN(
                Number(form.taAmount)
            )
        ) {

            alert(
                "TA Amount must be numeric."
            );

            return;
        }


        try {

            setSaving(true);


            const isEdit =
                editingId !== null;


            const url =
                isEdit
                    ? `${API_URL}/${editingId}`
                    : API_URL;


            const method =
                isEdit
                    ? "PUT"
                    : "POST";


            const response =
                await apiFetch(url, {

                    method,

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({

                        effectiveDate:
                            form.effectiveDate,

                        payLevelGroup:
                            form.payLevelGroup,

                        cityClass:
                            form.cityClass,

                        taAmount:
                            Number(form.taAmount),

                        description:
                            form.description,

                        status:
                            form.status,

                    })

                });


            const result =
                await response.json();


            if (!response.ok) {

                throw new Error(
                    result.message ||
                    "Unable to save record."
                );
            }


            alert(
                result.message ||
                (
                    isEdit
                        ? "Transport Allowance updated successfully."
                        : "Transport Allowance saved successfully."
                )
            );


            handleReset();

            await loadRecords();


        } catch (error) {

            console.error(
                "Save Transport Allowance:",
                error
            );

            alert(
                error.message ||
                "Unable to save Transport Allowance."
            );

        } finally {

            setSaving(false);
        }
    };


    /* =====================================================
       EDIT
    ===================================================== */

    const handleEdit = (record) => {

        setForm({

            effectiveDate:
                record.effectiveDate || "",

            payLevelGroup:
                record.payLevelGroup || "",

            cityClass:
                record.cityClass || "",

            taAmount:
                record.taAmount ?? "",

            description:
                record.description || "",

            status:
                record.status || "Active",

        });


        setEditingId(
            record.id
        );


        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    };


    /* =====================================================
       DELETE
    ===================================================== */

    const handleDelete = async (id) => {

        const confirmed =
            window.confirm(
                "Are you sure you want to delete this Transport Allowance record?"
            );


        if (!confirmed) {
            return;
        }


        try {

            const response =
                await apiFetch(
                    `${API_URL}/${id}`,
                    {
                        method: "DELETE",
                        headers: {
                            "Content-Type":
                                "application/json"
                        }
                    }
                );


            const result =
                await response.json();


            if (!response.ok) {

                throw new Error(
                    result.message ||
                    "Unable to delete record."
                );
            }


            alert(
                result.message ||
                "Transport Allowance deleted successfully."
            );


            await loadRecords();


        } catch (error) {

            console.error(
                "Delete Transport Allowance:",
                error
            );

            alert(
                error.message ||
                "Unable to delete record."
            );
        }
    };


    /* =====================================================
       SEARCH RESET
    ===================================================== */

    const handleSearchReset = () => {

        setSearch({
            effectiveDate: "",
            payLevelGroup: "",
            cityClass: "",
            taAmount: "",
            status: "All",
        });
    };


    /* =====================================================
       FILTER
    ===================================================== */

    const filteredRecords =
        records.filter((record) => {

            const dateMatch =
                !search.effectiveDate ||
                record.effectiveDate ===
                search.effectiveDate;


            const payLevelMatch =
                !search.payLevelGroup ||
                String(
                    record.payLevelGroup || ""
                )
                    .toLowerCase()
                    .includes(
                        search.payLevelGroup
                            .toLowerCase()
                    );


            const cityMatch =
                !search.cityClass ||
                String(
                    record.cityClass || ""
                )
                    .toLowerCase()
                    .includes(
                        search.cityClass
                            .toLowerCase()
                    );


            const amountMatch =
                !search.taAmount ||
                String(
                    record.taAmount ?? ""
                ).includes(
                    search.taAmount
                );


            const statusMatch =
                search.status === "All" ||
                record.status ===
                search.status;


            return (
                dateMatch &&
                payLevelMatch &&
                cityMatch &&
                amountMatch &&
                statusMatch
            );

        });


    /* =====================================================
       RENDER
    ===================================================== */

    return (

        <div className="ta-master">


            {/* =================================================
                BACK
            ================================================= */}

            <div className="ta-back">

                <button
                    type="button"
                    onClick={onBack}
                >
                    ← Back to Home
                </button>

            </div>


            {/* =================================================
                TITLE
            ================================================= */}

            <h1 className="ta-page-title">

                TRANSPORT ALLOWANCE MASTER

            </h1>


            {/* =================================================
                INFORMATION
            ================================================= */}

            <section className="ta-card">


                <div className="ta-card-head">

                    <span>
                        TRANSPORT ALLOWANCE INFORMATION
                    </span>


                    <span className="ta-crumb">

                        <Breadcrumb section="Masters" current="Transport Allowance Master" />

                    </span>

                </div>


                <div className="ta-card-body">


                    <form onSubmit={handleSave}>


                        <div className="ta-grid">


                            {/* EFFECTIVE DATE */}

                            <label>

                                <span className="ta-label-text">

                                    Effective Date
                                    <em>*</em>

                                </span>


                                <input
                                    type="date"
                                    name="effectiveDate"
                                    value={
                                        form.effectiveDate
                                    }
                                    onChange={
                                        handleChange
                                    }
                                    required
                                />

                            </label>


                            {/* PAY LEVEL GROUP */}

                            <label>

                                <span className="ta-label-text">

                                    Pay Level Group
                                    <em>*</em>

                                </span>


                                <select
                                    name="payLevelGroup"
                                    value={
                                        form.payLevelGroup
                                    }
                                    onChange={
                                        handleChange
                                    }
                                    required
                                >

                                    <option value="">
                                        Select Pay Level Group
                                    </option>

                                    {payLevelGroups.map(
                                        (group) => (
                                            <option
                                                key={group}
                                                value={group}
                                            >
                                                {group}
                                            </option>
                                        )
                                    )}

                                </select>

                            </label>


                            {/* CITY CLASS */}

                            <label>

                                <span className="ta-label-text">

                                    City Class
                                    <em>*</em>

                                </span>


                                <select
                                    name="cityClass"
                                    value={
                                        form.cityClass
                                    }
                                    onChange={
                                        handleChange
                                    }
                                    required
                                >

                                    <option value="">
                                        Select City Class
                                    </option>

                                    {cityClasses.map(
                                        (city) => (
                                            <option
                                                key={city}
                                                value={city}
                                            >
                                                {city}
                                            </option>
                                        )
                                    )}

                                </select>

                            </label>


                            {/* TA AMOUNT */}

                            <label>

                                <span className="ta-label-text">

                                    TA Amount
                                    <em>*</em>

                                </span>


                                <input
                                    type="number"
                                    name="taAmount"
                                    value={
                                        form.taAmount
                                    }
                                    onChange={
                                        handleChange
                                    }
                                    placeholder="Enter TA Amount"
                                    min="0"
                                    step="0.01"
                                    required
                                />

                            </label>


                            {/* DESCRIPTION */}

                            <label className="ta-description">

                                <span className="ta-label-text">

                                    Description

                                </span>


                                <input
                                    type="text"
                                    name="description"
                                    value={
                                        form.description
                                    }
                                    onChange={
                                        handleChange
                                    }
                                    placeholder="Enter Description"
                                />

                            </label>


                            {/* STATUS */}

                            <label>

                                <span className="ta-label-text">

                                    Status
                                    <em>*</em>

                                </span>


                                <select
                                    name="status"
                                    value={
                                        form.status
                                    }
                                    onChange={
                                        handleChange
                                    }
                                >

                                    <option value="Active">
                                        Active
                                    </option>

                                    <option value="Inactive">
                                        Inactive
                                    </option>

                                </select>

                            </label>


                        </div>


                        {/* BUTTONS */}

                        <div className="ta-actions">


                            <button
                                type="submit"
                                className="ta-btn primary"
                                disabled={saving}
                            >

                                {saving
                                    ? "Saving..."
                                    : editingId !== null
                                        ? "Update"
                                        : "Save"}

                            </button>


                            <button
                                type="button"
                                className="ta-btn reset"
                                onClick={
                                    handleReset
                                }
                                disabled={saving}
                            >
                                Reset
                            </button>


                            <button
                                type="button"
                                className="ta-btn cancel"
                                onClick={
                                    onBack
                                }
                            >
                                Cancel
                            </button>


                        </div>


                    </form>

                </div>

            </section>


            {/* =================================================
                SEARCH
            ================================================= */}

            <section className="ta-card">


                <div className="ta-card-head">

                    <span>
                        SEARCH TRANSPORT ALLOWANCE
                    </span>

                </div>


                <div className="ta-card-body">


                    <div className="ta-search-grid">


                        {/* DATE */}

                        <label>

                            <span>
                                Effective Date
                            </span>


                            <input
                                type="date"
                                name="effectiveDate"
                                value={
                                    search.effectiveDate
                                }
                                onChange={
                                    handleSearchChange
                                }
                            />

                        </label>


                        {/* PAY LEVEL */}

                        <label>

                            <span>
                                Pay Level Group
                            </span>


                            <select
                                name="payLevelGroup"
                                value={
                                    search.payLevelGroup
                                }
                                onChange={
                                    handleSearchChange
                                }
                            >

                                <option value="">
                                    All
                                </option>

                                {payLevelGroups.map(
                                    (group) => (
                                        <option
                                            key={group}
                                            value={group}
                                        >
                                            {group}
                                        </option>
                                    )
                                )}

                            </select>

                        </label>


                        {/* CITY */}

                        <label>

                            <span>
                                City Class
                            </span>


                            <input
                                type="text"
                                name="cityClass"
                                value={
                                    search.cityClass
                                }
                                onChange={
                                    handleSearchChange
                                }
                                placeholder="City Class"
                            />

                        </label>


                        {/* AMOUNT */}

                        <label>

                            <span>
                                TA Amount
                            </span>


                            <input
                                type="text"
                                name="taAmount"
                                value={
                                    search.taAmount
                                }
                                onChange={
                                    handleSearchChange
                                }
                                placeholder="TA Amount"
                            />

                        </label>


                        {/* STATUS */}

                        <label>

                            <span>
                                Status
                            </span>


                            <select
                                name="status"
                                value={
                                    search.status
                                }
                                onChange={
                                    handleSearchChange
                                }
                            >

                                <option value="All">
                                    All
                                </option>

                                <option value="Active">
                                    Active
                                </option>

                                <option value="Inactive">
                                    Inactive
                                </option>

                            </select>

                        </label>


                        {/* BUTTONS */}

                        <div className="ta-search-buttons">


                            <button
                                type="button"
                                className="ta-btn primary"
                                onClick={() => {}}
                            >
                                Search
                            </button>


                            <button
                                type="button"
                                className="ta-btn reset"
                                onClick={
                                    handleSearchReset
                                }
                            >
                                Reset
                            </button>


                        </div>


                    </div>

                </div>

            </section>


            {/* =================================================
                LIST
            ================================================= */}

            <section className="ta-card">


                <div className="ta-card-head">

                    <span>
                        TRANSPORT ALLOWANCE LIST
                    </span>

                </div>


                <div className="ta-card-body">


                    {loading ? (

                        <div className="ta-loading">
                            Loading Transport Allowance records...
                        </div>

                    ) : (

                        <DataGrid

                            title="Transport Allowance List"

                            rows={filteredRecords}

                            emptyText={
                                "No Transport Allowance records found."
                            }

                            columns={[

                                {
                                    key: "sr",
                                    label: "Sr. No.",
                                    type: "serial"
                                },

                                {
                                    key: "effectiveDate",
                                    label: "Effective Date",
                                    type: "date"
                                },

                                {
                                    key: "payLevelGroup",
                                    label: "Pay Level Group"
                                },

                                {
                                    key: "cityClass",
                                    label: "City Class"
                                },

                                {
                                    key: "taAmount",
                                    label: "TA Amount",
                                    type: "number"
                                },

                                {
                                    key: "description",
                                    label: "Description",
                                    align: "left"
                                },

                                {
                                    key: "status",
                                    label: "Status",
                                    type: "status"
                                },

                                {
                                    key: "actions",
                                    label: "Actions",
                                    type: "actions",
                                    sortable: false,
                                    exportable: false,

                                    render: (record) => (

                                        <GridActions

                                            onEdit={() =>
                                                handleEdit(
                                                    record
                                                )
                                            }

                                            onDelete={() =>
                                                handleDelete(
                                                    record.id
                                                )
                                            }

                                        />

                                    )
                                }

                            ]}

                        />

                    )}

                </div>

            </section>

        </div>
    );
}
