/*
 * Report-scoped print page (2026-09-24).
 *
 * While a report is mounted, its own @page rule (A4 portrait, or A4
 * landscape for Cheque Register only — see reportPdfConfig.js) is the only
 * one in the document, so Ctrl+P, the page's Print button and "Save as PDF"
 * all use that report's orientation and nothing leaks into other reports.
 * Nested reports (Variation Report inside Salary Entry / Approval) stack:
 * the most recently mounted wins and the previous one is restored on unmount.
 */
import { useEffect } from "react";
import { REPORT_PRINT_STYLE_ID, getReportPdfOptions, reportPrintStyleCss } from "./reportPdfConfig";

const active = [];

function render() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  let el = document.getElementById(REPORT_PRINT_STYLE_ID);
  const top = active[active.length - 1];
  if (!top) {
    if (el) el.remove();
    root.removeAttribute("data-print-report");
    root.removeAttribute("data-print-orientation");
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = REPORT_PRINT_STYLE_ID;
  }
  /* Always last in <head>, after the bundled CSS. */
  document.head.appendChild(el);
  el.textContent = reportPrintStyleCss(top.name);
  root.setAttribute("data-print-report", top.name);
  root.setAttribute("data-print-orientation", getReportPdfOptions(top.name).orientation);
}

export function activateReportPrintPage(reportName) {
  const token = { name: String(reportName || "") };
  active.push(token);
  render();
  return () => {
    const index = active.indexOf(token);
    if (index >= 0) active.splice(index, 1);
    render();
  };
}

/* Print the page that is on screen with this report's page setup. */
export function printReport(reportName) {
  if (typeof window === "undefined") return;
  const release = activateReportPrintPage(reportName);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    window.removeEventListener("afterprint", finish);
    release();
  };
  window.addEventListener("afterprint", finish);
  window.setTimeout(finish, 120000);
  window.print();
}

export default function useReportPrintPage(reportName) {
  useEffect(() => activateReportPrintPage(reportName), [reportName]);
}
