// ============================================================
// Chart.js visualizations: fault categories (bar),
// severity (doughnut), human review outcomes (doughnut).
// ============================================================
import Chart from "chart.js/auto";
import { faultCategories, severity, reviewOutcomes } from "./data.js";

Chart.defaults.color = "#8b9bb4";
Chart.defaults.font.family = "Inter, system-ui, sans-serif";
Chart.defaults.font.size = 11;

const gridColor = "rgba(27,39,64,0.7)";

function legend(position = "bottom") {
  return {
    position,
    labels: { usePointStyle: true, pointStyle: "circle", padding: 14, boxWidth: 8 },
  };
}

const tooltip = {
  backgroundColor: "#0b1120",
  borderColor: "#1b2740",
  borderWidth: 1,
  titleColor: "#e6edf7",
  bodyColor: "#8b9bb4",
  padding: 10,
  cornerRadius: 8,
  displayColors: true,
  usePointStyle: true,
};

function barCategories(ctx) {
  const grad = ctx.createLinearGradient(0, 0, 0, 260);
  grad.addColorStop(0, "rgba(34,211,238,0.95)");
  grad.addColorStop(1, "rgba(8,145,178,0.35)");
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: faultCategories.map((d) => d.label),
      datasets: [
        {
          label: "Cases",
          data: faultCategories.map((d) => d.value),
          backgroundColor: grad,
          hoverBackgroundColor: "#38bdf8",
          borderRadius: 6,
          maxBarThickness: 26,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: { legend: { display: false }, tooltip },
      scales: {
        x: { grid: { color: gridColor }, ticks: { precision: 0 }, beginAtZero: true },
        y: { grid: { display: false } },
      },
    },
  });
}

function doughnut(ctx, dataset, cutout = "68%") {
  return new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: dataset.map((d) => d.label),
      datasets: [
        {
          data: dataset.map((d) => d.value),
          backgroundColor: dataset.map((d) => d.color),
          borderColor: "#0b1120",
          borderWidth: 3,
          hoverOffset: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout,
      plugins: {
        legend: legend("bottom"),
        tooltip: {
          ...tooltip,
          callbacks: {
            label(c) {
              const total = c.dataset.data.reduce((a, b) => a + b, 0);
              const pct = Math.round((c.parsed / total) * 100);
              return ` ${c.label}: ${c.parsed} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

export function initCharts() {
  const c1 = document.getElementById("chartCategories");
  const c2 = document.getElementById("chartSeverity");
  const c3 = document.getElementById("chartReview");
  if (c1) barCategories(c1.getContext("2d"));
  if (c2) doughnut(c2.getContext("2d"), severity, "62%");
  if (c3) doughnut(c3.getContext("2d"), reviewOutcomes, "68%");
}
