// ============================================================
// NetSage AI dashboard — single-page entry point.
// ============================================================
import { initUI } from "./ui.js";
import { initCharts } from "./charts.js";
import { initNetwork3D } from "./network3d.js";
import { initAnalyze } from "./analyze.js";

function boot() {
  initUI();
  initCharts();
  initNetwork3D();
  initAnalyze();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
