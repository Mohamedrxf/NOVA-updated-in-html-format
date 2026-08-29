// ============================================================
// DOM rendering for KPIs, pipeline, cases table, review states,
// safety grid, plus scroll-reveal + count-up animations.
// ============================================================
import { kpis, pipeline, cases, reviewStates, safetyPoints } from "./data.js";

const ICONS = {
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5 5h14l3 7v6a2 2 0 01-2 2H4a2 2 0 01-2-2v-6l3-7z"/>',
  rules: '<path d="M9 3v18M4 7h5M4 12h5M4 17h5"/><path d="M14 6h6M14 12h6M14 18h6"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/><path d="M9.5 12l1.8 1.8L15 10"/>',
  user: '<circle cx="12" cy="8" r="3.2"/><path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5"/>',
};

const svg = (name, cls = "") =>
  `<svg class="${cls}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;

const toneMap = {
  cyan: { text: "text-cyan", bg: "bg-cyan/10", border: "border-cyan/30", dot: "bg-cyan" },
  emerald: { text: "text-emerald-300", bg: "bg-emerald-500/10", border: "border-emerald-500/30", dot: "bg-emerald-400" },
  amber: { text: "text-amber-300", bg: "bg-amber-500/10", border: "border-amber-500/30", dot: "bg-amber-400" },
  rose: { text: "text-rose-300", bg: "bg-rose-500/10", border: "border-rose-500/30", dot: "bg-rose-400" },
};

// ---------- KPI cards ----------
function renderKpis() {
  const el = document.getElementById("kpis");
  el.innerHTML = kpis
    .map((k, i) => {
      const t = toneMap[k.tone];
      return `
      <div class="reveal group rounded-2xl border border-line glass p-5 transition duration-300 hover:-translate-y-1 hover:border-cyan/40 hover:shadow-glow" style="transition-delay:${i * 60}ms">
        <div class="flex items-start justify-between">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-muted">${k.label}</span>
          <span class="grid h-9 w-9 place-items-center rounded-lg border ${t.border} ${t.bg} ${t.text}">${svg(k.icon)}</span>
        </div>
        <p class="mt-4 text-4xl font-extrabold tracking-tight ${t.text}"><span class="countup" data-target="${k.value}" data-suffix="${k.suffix}">0${k.suffix}</span></p>
        <p class="mt-1 text-[13px] text-ink/90">${k.desc}</p>
        <p class="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted"><span class="h-1.5 w-1.5 rounded-full ${t.dot}"></span>${k.trend}</p>
      </div>`;
    })
    .join("");
}

// ---------- Pipeline ----------
function statusBadge(status) {
  const map = {
    COMPLETED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    "IN REVIEW": "border-amber-500/30 bg-amber-500/10 text-amber-300",
    PENDING: "border-line bg-panel2 text-muted",
  };
  return `<span class="rounded-md border ${map[status]} px-2 py-0.5 text-[9px] font-semibold tracking-wide">${status}</span>`;
}

function renderPipeline() {
  const el = document.getElementById("pipeline");
  el.innerHTML = pipeline
    .map((p) => {
      const emph = p.emphasize
        ? "border-amber-500/40 bg-amber-500/[0.06] shadow-[0_0_0_1px_rgba(245,158,11,0.15)]"
        : "border-line bg-panel/50";
      const iconTone = p.emphasize ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-cyan/30 bg-cyan/10 text-cyan";
      return `
      <div class="relative rounded-xl border ${emph} p-4 transition hover:-translate-y-0.5">
        <div class="flex items-center justify-between">
          <span class="grid h-8 w-8 place-items-center rounded-lg border ${iconTone}">${svg(p.icon)}</span>
          <span class="font-mono text-[11px] text-muted">0${p.step}</span>
        </div>
        <p class="mt-3 text-[13px] font-semibold leading-tight">${p.title}</p>
        <p class="mt-1 text-[11px] leading-relaxed text-muted">${p.desc}</p>
        <div class="mt-3">${statusBadge(p.status)}</div>
      </div>`;
    })
    .join("");
}

// ---------- Cases table ----------
function pill(text, cls) {
  return `<span class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${cls}">${text}</span>`;
}

function renderCases() {
  const body = document.getElementById("casesBody");
  const reviewCls = {
    Accepted: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    Edited: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    Rejected: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  };
  const statusCls = {
    Verified: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    "Needs Review": "border-amber-500/30 bg-amber-500/10 text-amber-300",
  };
  body.innerHTML = cases
    .map((c) => {
      const agree = c.agreement
        ? `<span class="inline-flex items-center gap-1 text-emerald-300 text-[12px] font-medium"><span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>Yes</span>`
        : `<span class="inline-flex items-center gap-1 text-rose-300 text-[12px] font-medium"><span class="h-1.5 w-1.5 rounded-full bg-rose-400"></span>No</span>`;
      return `
      <tr class="border-b border-line/60 transition hover:bg-panel2/60">
        <td class="px-3 py-3 font-mono text-[12px] text-cyan">${c.id}</td>
        <td class="px-3 py-3 text-[13px]">${c.issue}</td>
        <td class="px-3 py-3 text-[12px] text-muted">${c.category}</td>
        <td class="px-3 py-3"><span class="font-mono text-[11px] text-ink/80">${c.layer}</span></td>
        <td class="px-3 py-3 text-[12px] text-muted">${c.ai}</td>
        <td class="px-3 py-3">${pill(c.review, reviewCls[c.review])}</td>
        <td class="px-3 py-3">${agree}</td>
        <td class="px-3 py-3">${pill(c.status, statusCls[c.status])}</td>
      </tr>`;
    })
    .join("");
}

// ---------- Review states ----------
function renderReviewStates() {
  const el = document.getElementById("reviewStates");
  el.innerHTML = reviewStates
    .map((r) => {
      const t = toneMap[r.tone];
      return `
      <div class="flex items-center justify-between rounded-xl border ${t.border} ${t.bg} px-4 py-3">
        <div class="flex items-center gap-3">
          <span class="h-2.5 w-2.5 rounded-full ${t.dot}"></span>
          <div>
            <p class="text-[13px] font-semibold ${t.text}">${r.label}</p>
            <p class="text-[11px] text-muted">${r.desc}</p>
          </div>
        </div>
        <span class="font-mono text-lg font-bold ${t.text}">${r.value}</span>
      </div>`;
    })
    .join("");
}

// ---------- Safety grid ----------
function renderSafety() {
  const el = document.getElementById("safetyGrid");
  el.innerHTML = safetyPoints
    .map(
      (p) => `
      <div class="flex items-start gap-3 rounded-xl border border-line bg-panel/50 p-4 transition hover:border-cyan/30">
        <span class="mt-0.5 text-cyan">${svg("check")}</span>
        <p class="text-[13px] leading-relaxed text-ink/90">${p}</p>
      </div>`
    )
    .join("");
}

// ---------- Animations ----------
function animateCountUps() {
  document.querySelectorAll(".countup").forEach((node) => {
    const target = Number(node.dataset.target);
    const suffix = node.dataset.suffix || "";
    const dur = 1100;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      node.textContent = Math.round(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function setupReveal() {
  const items = document.querySelectorAll(".reveal");
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  items.forEach((i) => io.observe(i));
}

export function initUI() {
  renderKpis();
  renderPipeline();
  renderCases();
  renderReviewStates();
  renderSafety();
  setupReveal();
  // count-ups run once KPI cards are visible
  const kpiSection = document.getElementById("kpis");
  const io = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          animateCountUps();
          obs.disconnect();
        }
      });
    },
    { threshold: 0.3 }
  );
  io.observe(kpiSection);
}
