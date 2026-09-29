import { useEffect, useState } from "react";

import Header from "./Header";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";
import Dashboard from "./Dashboard";
import PageErrorBoundary from "./PageErrorBoundary";

import ChangePassword from "../pages/ChangePassword";
import EmployeeMaster from "../pages/EmployeeMaster";
import PayrollConfiguration from "../pages/PayrollConfiguration";
import InstituteMaster from "../pages/InstituteMaster";
import DesignationMaster from "../pages/DesignationMaster";
import DAMaster from "../pages/DAMaster";
import DADifferenceMaster from "../pages/DADifferenceMaster";
import IncrementMaster from "../pages/IncrementMaster";
import HRAMaster from "../pages/HRAMaster";
import TransportAllowanceMaster from "../pages/TransportAllowanceMaster";
import CLAMaster from "../pages/CLAMaster";
import MedicalAllowanceMaster from "../pages/MedicalAllowanceMaster";
import PayMatrixMaster from "../pages/PayMatrixMaster";
import PayRevisionMaster from "../pages/PayRevisionMaster";
import SalaryComponentMaster from "../pages/SalaryComponentMaster";
import UserMaster from "../pages/UserMaster";
import RolePermissionMaster from "../pages/RolePermissionMaster";
import SalaryBillCodeMaster from "../pages/SalaryBillCodeMaster";
import SectionMaster from "../pages/SectionMaster";

import SalaryEntry from "../pages/SalaryEntry";
import DADifferenceEntry from "../pages/DADifferenceEntry";
import SalaryVariationReport from "../pages/SalaryVariationReport";
import FinalSalaryBill from "../pages/FinalSalaryBill";
import AccountOfficerBills from "../pages/AccountOfficerBills";
import ReturningBills from "../pages/ReturningBills";
import ChequeRegister from "../pages/ChequeRegister";
import BankCopy from "../pages/BankCopy";
import SectionSummary from "../pages/SectionSummary";
import GpfSummary from "../pages/GpfSummary";
import InstituteWiseGpfSummary from "../pages/InstituteWiseGpfSummary";
import NpsSummary from "../pages/NpsSummary";
import NpsInstituteWiseSummary from "../pages/NpsInstituteWiseSummary";
import NpsGpfDeduction from "../pages/NpsGpfDeduction";
import NpsScheduleSummary from "../pages/NpsScheduleSummary";
import EmployeeWiseSalary from "../pages/EmployeeWiseSalary";
import EmployeePaySlip from "../pages/EmployeePaySlip";
import SalaryRegister from "../pages/SalaryRegister";
import SalaryRegisterDetail from "../pages/SalaryRegisterDetail";
import IncomeTaxProfessionalTax from "../pages/IncomeTaxProfessionalTax";
import EmployeeReport from "../pages/EmployeeReport";
import InstituteWiseSalary from "../pages/InstituteWiseSalary";
import MonthWiseEmployeeSalary from "../pages/MonthWiseEmployeeSalary";


import { TITLES } from "../modules";
import {
  canAccessPage,
  defaultHomePage,
  isKnownPage,
  readHashPage,
  readHashParams,
  writeHashPage,
} from "../utils/accessControl";

export default function AppShell({ user, onLogout }) {
  const [page, setPage] = useState(() => {
    const fromHash = readHashPage();
    /* "home" is honoured for every role that may open it, so a refresh or a
       direct Dashboard URL stays on the Dashboard (an Account Officer's
       *landing* page is still Salary Approval, set at login by App.jsx). */
    const preferred = fromHash || defaultHomePage(user);
    return canAccessPage(user, preferred)
      ? preferred
      : defaultHomePage(user);
  });
  /* Restored from the hash's own query string ONLY when the page we are
     actually mounting with is the one the hash named (fromHash) — a denied
     or stale hash falls back to defaultHomePage above and must not inherit
     that unrelated page's params. This is what makes a drill-down (e.g.
     Salary Register -> its detail view) survive a browser refresh: the
     bill/workflow identity travels in the URL, not only in memory. */
  const [pageParams, setPageParams] = useState(() => {
    const fromHash = readHashPage();
    if (fromHash && fromHash !== "home" && canAccessPage(user, fromHash)) {
      return readHashParams();
    }
    return {};
  });
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accessNotice, setAccessNotice] = useState("");

  const isHome = page === "home";
  const showSidebar = isHome && canAccessPage(user, "home");

  const safeNavigate = (id, params = {}, { silent = false } = {}) => {
    const target = String(id || defaultHomePage(user));
    if (!canAccessPage(user, target)) {
      const fallback = defaultHomePage(user);
      /* An unregistered id (e.g. a removed module's old link) is not an
         access problem: redirect quietly. */
      if (!silent && isKnownPage(target)) {
        setAccessNotice(
          `Access denied to "${TITLES[target] || target}". Redirected to an allowed page.`
        );
      }
      setPage(fallback);
      setPageParams({});
      writeHashPage(fallback);
      setMobileOpen(false);
      return;
    }
    setAccessNotice("");
    setPage(target);
    const safeParams = params && typeof params === "object" ? params : {};
    setPageParams(safeParams);
    writeHashPage(target, safeParams);
    setMobileOpen(false);
  };

  const goHome = () => {
    safeNavigate(defaultHomePage(user));
  };

  const navigate = (id, params = {}) => safeNavigate(id, params);

  useEffect(() => {
    writeHashPage(page, pageParams);
  }, [page, pageParams]);

  /*
     Re-validate the current page whenever the signed-in user changes.

     `page` is initialised once from the URL hash. If the user prop later
     changes (session restored, re-login as a different role, permissions
     refreshed), a page id that is no longer allowed would otherwise stay in
     state and the whole <main> would render nothing.
  */
  useEffect(() => {
    if (!canAccessPage(user, page)) {
      safeNavigate(defaultHomePage(user), {}, { silent: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, page]);

  useEffect(() => {
    /* readHashParams() carries a drill-down's params through Back/Forward. */
    const onHashChange = () => {
      const hashPage = readHashPage();
      safeNavigate(hashPage || defaultHomePage(user), readHashParams(), { silent: false });
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [user]);

  /* Ctrl/Cmd + K opens the navigation command palette. */
  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleSidebar = () => {
    if (window.innerWidth <= 860) {
      setMobileOpen((v) => !v);
    } else {
      setCollapsed((v) => !v);
    }
  };

  /*
     Renders a page only when it is the active page AND the user may see it.

     A denied page returns an explicit notice rather than null: returning
     null produced a completely blank screen.
  */
  const renderAuthorized = (pageId, node) => {
    if (page !== pageId) return null;

    if (!canAccessPage(user, pageId)) {
      return (
        <div
          role="alert"
          style={{
            margin: "16px",
            padding: "14px 18px",
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            borderRadius: 4,
            color: "#7c2d12",
            fontSize: 13,
          }}
        >
          You do not have access to{" "}
          <strong>{TITLES[pageId] || pageId}</strong>.
          <button
            type="button"
            onClick={goHome}
            style={{
              marginLeft: 12,
              height: 28,
              padding: "0 12px",
              borderRadius: 3,
              border: "1px solid #c2410c",
              background: "#ffffff",
              color: "#7c2d12",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Go to Home
          </button>
        </div>
      );
    }

    return (
      <PageErrorBoundary pageId={pageId} onBack={goHome}>
        {node}
      </PageErrorBoundary>
    );
  };

  return (
    <div
      className={`app-shell ${
        showSidebar ? "has-sidebar" : "full-module"
      } ${collapsed ? "sidebar-collapsed" : ""}`}
    >
      <Header
        user={user}
        page={page}
        onNavigate={navigate}
        onLogout={onLogout}
        showSidebarToggle={showSidebar}
        onToggleSidebar={toggleSidebar}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      <CommandPalette
        user={user}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={navigate}
      />

      {showSidebar && (
        <Sidebar
          user={user}
          page={page}
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onNavigate={navigate}
          onToggle={() => setCollapsed((v) => !v)}
          onClose={() => setMobileOpen(false)}
        />
      )}

      <main className="app-main">
        {/*
          Keyed by the current page so it remounts on navigation and the
          short fade/lift runs once. Presentation only: it wraps the same
          children in the same order, changes no route, no permission check
          and no data flow, and stays interactive throughout the animation.
        */}
        <div className="page-transition" key={page}>
        {accessNotice ? (
          <div
            role="alert"
            style={{
              margin: "12px 16px 0",
              padding: "10px 14px",
              borderRadius: 8,
              background: "#fef2f2",
              color: "#991b1b",
              border: "1px solid #fecaca",
            }}
          >
            {accessNotice}
          </div>
        ) : null}

        {renderAuthorized(
          "home",
          <Dashboard user={user} onNavigate={navigate} />
        )}

        {renderAuthorized(
          "employee-master",
          <EmployeeMaster onBack={goHome} user={user} />
        )}
        {renderAuthorized(
          "payroll-configuration",
          <PayrollConfiguration onBack={goHome} user={user} />
        )}
        {renderAuthorized(
          "section-master",
          <SectionMaster onBack={goHome} user={user} />
        )}
        {renderAuthorized(
          "institute-master",
          <InstituteMaster onBack={goHome} user={user} />
        )}
        {renderAuthorized(
          "designation-master",
          <DesignationMaster onBack={goHome} user={user} />
        )}
        {renderAuthorized("da-master", <DAMaster onBack={goHome} user={user} />)}
        {renderAuthorized("hra-master", <HRAMaster onBack={goHome} user={user} />)}
        {renderAuthorized("cla-master", <CLAMaster onBack={goHome} user={user} />)}
        {renderAuthorized(
          "medical-allowance",
          <MedicalAllowanceMaster onBack={goHome} />
        )}
        {renderAuthorized(
          "transport-allowance-master",
          <TransportAllowanceMaster onBack={goHome} user={user} />
        )}
        {renderAuthorized(
          "pay-revision-master",
          <PayRevisionMaster onBack={goHome} user={user} />
        )}
        {renderAuthorized(
          "pay-matrix",
          <PayMatrixMaster onBack={goHome} user={user} />
        )}
        {renderAuthorized(
          "salary-component-master",
          <SalaryComponentMaster onBack={goHome} user={user} />
        )}
        {renderAuthorized(
          "user-master",
          <UserMaster onBack={goHome} user={user} />
        )}
        {renderAuthorized(
          "role-permission-master",
          <RolePermissionMaster onBack={goHome} user={user} />
        )}
        {renderAuthorized(
          "salary-bill-code-master",
          <SalaryBillCodeMaster onBack={goHome} user={user} />
        )}
        {renderAuthorized(
          "da-difference-master",
          <DADifferenceMaster onBack={goHome} user={user} />
        )}
        {renderAuthorized(
          "increment-master",
          <IncrementMaster onBack={goHome} user={user} />
        )}
        {renderAuthorized(
          "change-password",
          <ChangePassword onBack={goHome} />
        )}
        {renderAuthorized(
          "salary-entry",
          <SalaryEntry
            user={user}
            onBack={goHome}
            onOpenVariation={(params) =>
              navigate("variation-report", params || {})
            }
          />
        )}
        {renderAuthorized(
          "variation-report",
          <SalaryVariationReport
            onBack={goHome}
            initialPreviousBillCode={pageParams.previousBillCode || ""}
            initialCurrentBillCode={pageParams.currentBillCode || ""}
            initialInstituteCode={pageParams.instituteCode || ""}
            initialInstituteId={pageParams.instituteId || null}
          />
        )}
        {renderAuthorized(
          "final-salary-bill",
          <FinalSalaryBill user={user} onBack={goHome} />
        )}
        {renderAuthorized(
          "da-difference-entry",
          <DADifferenceEntry user={user} onBack={goHome} />
        )}
        {renderAuthorized(
          "salary-approval",
          <AccountOfficerBills user={user} onBack={goHome} />
        )}
        {renderAuthorized(
          "returning-bills",
          <ReturningBills user={user} onBack={goHome} />
        )}
        {renderAuthorized(
          "cheque-register",
          <ChequeRegister user={user} onBack={goHome} />
        )}
        {renderAuthorized(
          "bank-copy",
          <BankCopy user={user} onBack={goHome} />
        )}
        {renderAuthorized(
          "section-summary",
          <SectionSummary user={user} onBack={goHome} />
        )}
        {renderAuthorized(
          "gpf-summary",
          <GpfSummary user={user} onBack={goHome} />
        )}
        {renderAuthorized(
          "institute-wise-gpf",
          <InstituteWiseGpfSummary user={user} onBack={goHome} />
        )}
        {renderAuthorized(
          "nps-summary",
          <NpsSummary user={user} onBack={goHome} />
        )}
        {renderAuthorized(
          "nps-institute-wise",
          <NpsInstituteWiseSummary user={user} onBack={goHome} />
        )}
        {renderAuthorized(
          "nps-deduction",
          <NpsGpfDeduction user={user} onBack={goHome} />
        )}
        {renderAuthorized(
          "nps-schedule",
          <NpsScheduleSummary user={user} onBack={goHome} />
        )}
        {renderAuthorized(
          "employee-wise-salary",
          <EmployeeWiseSalary user={user} onBack={goHome} />
        )}
        {renderAuthorized(
          "employee-pay-slip",
          <EmployeePaySlip user={user} onBack={goHome} />
        )}
        {renderAuthorized(
          "salary-register",
          <SalaryRegister
            user={user}
            onBack={goHome}
            pageParams={pageParams}
            onOpenDetail={(params) => navigate("salary-register-detail", params || {})}
          />
        )}
        {renderAuthorized(
          "salary-register-detail",
          <SalaryRegisterDetail
            user={user}
            pageParams={pageParams}
            onBack={(filters) => navigate("salary-register", filters || {})}
          />
        )}
        {renderAuthorized(
          "income-tax-professional-tax",
          <IncomeTaxProfessionalTax user={user} onBack={goHome} />
        )}
        {renderAuthorized(
          "employee-report",
          <EmployeeReport user={user} onBack={goHome} />
        )}
        {renderAuthorized(
          "institute-wise-salary",
          <InstituteWiseSalary user={user} onBack={goHome} />
        )}
        {renderAuthorized(
          "month-wise-employee-salary",
          <MonthWiseEmployeeSalary user={user} onBack={goHome} />
        )}

        </div>
      </main>
    </div>
  );
}
