import { useEffect, useState } from "react";

import Header from "./Header";
import Sidebar from "./Sidebar";
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
import IncomeTaxProfessionalTax from "../pages/IncomeTaxProfessionalTax";
import EmployeeReport from "../pages/EmployeeReport";
import InstituteWiseSalary from "../pages/InstituteWiseSalary";

import GenericModule from "../pages/GenericModule";

import { TITLES } from "../modules";
import {
  canAccessPage,
  defaultHomePage,
  readHashPage,
  writeHashPage,
} from "../utils/accessControl";

export default function AppShell({ user, onLogout }) {
  const [page, setPage] = useState(() => {
    const fromHash = readHashPage();
    const preferred =
      fromHash && fromHash !== "home" ? fromHash : defaultHomePage(user);
    return canAccessPage(user, preferred)
      ? preferred
      : defaultHomePage(user);
  });
  const [pageParams, setPageParams] = useState({});
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accessNotice, setAccessNotice] = useState("");

  const isHome = page === "home";
  const showSidebar = isHome && canAccessPage(user, "home");

  const safeNavigate = (id, params = {}, { silent = false } = {}) => {
    const target = String(id || defaultHomePage(user));
    if (!canAccessPage(user, target)) {
      const fallback = defaultHomePage(user);
      if (!silent) {
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
    setPageParams(params && typeof params === "object" ? params : {});
    writeHashPage(target);
    setMobileOpen(false);
  };

  const goHome = () => {
    safeNavigate(defaultHomePage(user));
  };

  const navigate = (id, params = {}) => safeNavigate(id, params);

  useEffect(() => {
    writeHashPage(page);
  }, [page]);

  /*
     Re-validate the current page whenever the signed-in user changes.

     `page` is initialised once from the URL hash. If the user prop later
     changes (session restored, re-login as a different role, permissions
     refreshed), a page id that is no longer allowed would otherwise stay in
     state — and because renderAuthorized() returned null for it while the
     GenericModule fallback excludes every registered id, the whole <main>
     rendered nothing and the screen went blank.
  */
  useEffect(() => {
    if (!canAccessPage(user, page)) {
      safeNavigate(defaultHomePage(user), {}, { silent: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, page]);

  useEffect(() => {
    const onHashChange = () => {
      const hashPage = readHashPage();
      safeNavigate(hashPage || defaultHomePage(user), {}, { silent: false });
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [user]);

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
     null produced a completely blank screen, because the GenericModule
     fallback below excludes every registered page id.
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
          <SalaryRegister user={user} onBack={goHome} />
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

        {!isHome &&
          canAccessPage(user, page) &&
          page !== "change-password" &&
          page !== "employee-master" &&
          page !== "payroll-configuration" &&
          page !== "section-master" &&
          page !== "institute-master" &&
          page !== "designation-master" &&
          page !== "pay-revision-master" &&
          page !== "da-master" &&
          page !== "hra-master" &&
          page !== "transport-allowance-master" &&
          page !== "cla-master" &&
          page !== "medical-allowance" &&
          page !== "pay-matrix" &&
          page !== "salary-component-master" &&
          page !== "user-master" &&
          page !== "role-permission-master" &&
          page !== "salary-bill-code-master" &&
          page !== "da-difference-master" &&
          page !== "increment-master" &&
          page !== "da-difference-entry" &&
          page !== "salary-entry" &&
          page !== "variation-report" &&
          page !== "final-salary-bill" &&
          page !== "salary-approval" &&
          page !== "returning-bills" &&
          page !== "cheque-register" &&
          page !== "bank-copy" &&
          page !== "section-summary" &&
          page !== "gpf-summary" &&
          page !== "institute-wise-gpf" &&
          page !== "nps-summary" &&
          page !== "nps-institute-wise" &&
          page !== "nps-deduction" &&
          page !== "nps-schedule" &&
          page !== "employee-wise-salary" &&
          page !== "employee-pay-slip" &&
          page !== "salary-register" &&
          page !== "income-tax-professional-tax" &&
          page !== "institute-wise-salary" && (
            <GenericModule
              title={TITLES[page] || page}
              pageId={page}
              onBack={goHome}
            />
          )}
        </div>
      </main>
    </div>
  );
}
