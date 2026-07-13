// 월하 프론트엔드 — 홈 메뉴 / 1인·2인 폼 / 궁합·재회
"use strict";

/* ---------- 사람 입력 폼(동적 생성) ---------- */
function personFormHtml(p, heading) {
  const h = heading ? `<div class="person-head">${heading}</div>` : "";
  return `${h}
    <div class="fld">
      <label for="${p}-name">이름 <small>(선택)</small></label>
      <input type="text" id="${p}-name" maxlength="20" placeholder="홍길동" />
    </div>
    <div class="fld two-col">
      <div>
        <label>성별</label>
        <div class="seg">
          <input type="radio" name="${p}-gender" id="${p}-g-f" value="여" />
          <label for="${p}-g-f">여자</label>
          <input type="radio" name="${p}-gender" id="${p}-g-m" value="남" checked />
          <label for="${p}-g-m">남자</label>
        </div>
      </div>
      <div>
        <label>달력</label>
        <div class="seg">
          <input type="radio" name="${p}-cal" id="${p}-cal-s" value="solar" class="cal-radio" data-prefix="${p}" checked />
          <label for="${p}-cal-s">양력</label>
          <input type="radio" name="${p}-cal" id="${p}-cal-l" value="lunar" class="cal-radio" data-prefix="${p}" />
          <label for="${p}-cal-l">음력</label>
        </div>
        <label class="chk leap" id="${p}-leap-field" hidden>
          <input type="checkbox" id="${p}-leap" /> <span>윤달</span>
        </label>
      </div>
    </div>
    <div class="fld">
      <label>생년월일</label>
      <div class="grid3">
        <input type="number" id="${p}-year" placeholder="1995" min="1900" max="2050" required />
        <input type="number" id="${p}-month" placeholder="3" min="1" max="12" required />
        <input type="number" id="${p}-day" placeholder="21" min="1" max="31" required />
      </div>
    </div>
    <div class="fld">
      <label>태어난 시각</label>
      <div class="grid2">
        <input type="number" id="${p}-hour" placeholder="시 (0~23)" min="0" max="23" />
        <input type="number" id="${p}-minute" placeholder="분" min="0" max="59" />
      </div>
      <label class="chk"><input type="checkbox" id="${p}-hourunknown" class="hour-unknown" data-prefix="${p}" /> <span>태어난 시각을 몰라요</span></label>
    </div>`;
}

function collectPerson(p) {
  const g = (id) => document.getElementById(`${p}-${id}`);
  const hu = g("hourunknown").checked;
  return {
    name: g("name").value.trim(),
    gender: document.querySelector(`input[name="${p}-gender"]:checked`).value,
    calendar: document.querySelector(`input[name="${p}-cal"]:checked`).value,
    leap: g("leap").checked,
    year: g("year").value,
    month: g("month").value,
    day: g("day").value,
    hour: hu ? "" : g("hour").value,
    minute: hu ? "" : g("minute").value,
  };
}

// 폼 주입
document.querySelector('#form-saju [data-person="s"]').innerHTML = personFormHtml("s", "");
document.querySelector('#form-couple [data-person="a"]').innerHTML = personFormHtml("a", "🙋 나의 정보");
document.querySelector('#form-couple [data-person="b"]').innerHTML = personFormHtml("b", "💌 상대의 정보");

/* ---------- 폼 상호작용(위임) ---------- */
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.classList.contains("cal-radio")) {
    const p = t.dataset.prefix;
    const lunar = document.getElementById(`${p}-cal-l`).checked;
    document.getElementById(`${p}-leap-field`).hidden = !lunar;
    if (!lunar) document.getElementById(`${p}-leap`).checked = false;
  }
  if (t.classList.contains("hour-unknown")) {
    const p = t.dataset.prefix;
    const off = t.checked;
    const h = document.getElementById(`${p}-hour`), mi = document.getElementById(`${p}-minute`);
    h.disabled = off; mi.disabled = off;
    if (off) { h.value = ""; mi.value = ""; }
  }
});

/* ---------- 뷰 라우팅 ---------- */
const chartPanel = document.getElementById("chart-panel");
const chartEl = document.getElementById("chart");
const chartTitle = document.getElementById("chart-title");
const readingPanel = document.getElementById("reading-panel");
const readingEl = document.getElementById("reading");
const statusEl = document.getElementById("reading-status");

const COUPLE = {
  gunghap: { title: "💞 연인 궁합", desc: "두 사람의 사주로 궁합과 관계 기질을 봐요.", btn: "궁합 보기", heart: "💞", chart: "인연 지수 · 두 사람의 명식" },
  jaehoe: { title: "🕯️ 재회 가능성", desc: "헤어진 두 사람의 사주와 흐름을 따뜻하되 현실적으로 봐요.", btn: "재회 가능성 보기", heart: "🕯️", chart: "재회 인연 지수 · 흐름" },
};
let coupleMode = "gunghap";

function hideResults() {
  chartPanel.hidden = true;
  readingPanel.hidden = true;
  chartEl.innerHTML = "";
  readingEl.innerHTML = "";
}
function showView(id) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== id));
  hideResults();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function goHome() { showView("view-home"); }

document.getElementById("brand-home").addEventListener("click", goHome);
document.querySelectorAll("[data-home]").forEach((b) => b.addEventListener("click", goHome));

document.querySelectorAll(".svc-card").forEach((card) => {
  card.addEventListener("click", () => {
    const svc = card.dataset.service;
    if (svc === "saju") { showView("view-saju"); return; }
    coupleMode = svc; // gunghap | jaehoe
    const c = COUPLE[svc];
    document.getElementById("couple-title").textContent = c.title;
    document.getElementById("couple-desc").textContent = c.desc;
    document.getElementById("couple-submit").textContent = c.btn;
    document.getElementById("couple-heart").textContent = c.heart;
    showView("view-couple");
  });
});

/* ---------- 결과 흐름 ---------- */
const SKELETON = `<div class="sk">
  <div class="sk-line title"></div>
  <div class="sk-line"></div><div class="sk-line"></div><div class="sk-line short"></div>
  <div class="sk-line title"></div>
  <div class="sk-line"></div><div class="sk-line short"></div>
</div>`;
const showError = (el, msg) => { el.innerHTML = `<div class="error">${msg}</div>`; };

async function runFlow({ endpoint, payload, service, chartLabel }) {
  chartTitle.textContent = chartLabel;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "계산에 실패했어요.");

    chartEl.innerHTML = data.chartHtml;
    chartPanel.hidden = false;
    chartPanel.scrollIntoView({ behavior: "smooth", block: "start" });

    // AI 풀이
    readingPanel.hidden = false;
    readingEl.innerHTML = SKELETON;
    statusEl.className = "status loading";
    statusEl.textContent = "월하가 풀이하는 중이에요";

    const readRes = await fetch("/api/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ compact: data.compact, service }),
    });
    const readData = await readRes.json();
    if (!readRes.ok) throw new Error(readData.error || "풀이에 실패했어요.");

    statusEl.className = "status";
    statusEl.textContent = "";
    readingEl.innerHTML = readData.html;
  } catch (err) {
    if (chartPanel.hidden) { chartPanel.hidden = false; showError(chartEl, err.message); }
    else { readingPanel.hidden = false; statusEl.className = "status"; statusEl.textContent = ""; showError(readingEl, err.message); }
  }
}

function withBusy(btn, busyText, fn) {
  return async (e) => {
    e.preventDefault();
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = busyText;
    try { await fn(); } finally { btn.disabled = false; btn.textContent = original; }
  };
}

const sajuBtn = document.querySelector("#form-saju .submit-btn");
document.getElementById("form-saju").addEventListener("submit", withBusy(sajuBtn, "사주 뽑는 중…", () =>
  runFlow({ endpoint: "/api/saju", payload: collectPerson("s"), service: "saju", chartLabel: "사주 원국" })
));

const coupleBtn = document.getElementById("couple-submit");
document.getElementById("form-couple").addEventListener("submit", withBusy(coupleBtn, "인연 살펴보는 중…", () =>
  runFlow({
    endpoint: "/api/compat",
    payload: { mode: coupleMode, personA: collectPerson("a"), personB: collectPerson("b") },
    service: coupleMode,
    chartLabel: COUPLE[coupleMode].chart,
  })
));
