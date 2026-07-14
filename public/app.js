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

// 데일리 카드에 오늘 날짜 표시 (매일 새로워지는 느낌 강조 → 재방문 유도)
(() => {
  const b = document.getElementById("daily-badge");
  if (b) { const d = new Date(); b.textContent = `오늘 ${d.getMonth() + 1}.${d.getDate()}`; }
})();

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

// 1인 서비스 (같은 입력 폼, 서비스만 다름)
const SOLO = {
  saju: { title: "🔮 사주 풀이", desc: "", chart: "사주 원국" },
  daily: { title: "🗓️ 오늘의 운세", desc: "오늘 하루의 기운을 봐요. 매일 새로워요.", chart: "오늘의 사주" },
  yearly: { title: "💘 올해의 연애운", desc: "올해 나의 연애·인연 흐름과 좋은 시기를 봐요.", chart: "올해의 흐름" },
};
let soloService = "saju";

function hideResults() {
  chartPanel.hidden = true;
  readingPanel.hidden = true;
  chartEl.innerHTML = "";
  readingEl.innerHTML = "";
  const sb = document.getElementById("share-btn");
  if (sb) sb.hidden = true;
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
    if (SOLO[svc]) {
      soloService = svc;
      const s = SOLO[svc];
      document.getElementById("solo-title").textContent = s.title;
      const desc = document.getElementById("solo-desc");
      desc.textContent = s.desc; desc.hidden = !s.desc;
      showView("view-saju");
      return;
    }
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

    // AI 풀이 (구독 게이트는 runReading 안에서 처리)
    await runReading(data.compact, service);
  } catch (err) {
    chartPanel.hidden = false;
    showError(chartEl, err.message);
  }
}

/* ---------- 구독(페이월) + AI 풀이 실행 ---------- */
let CONFIG = { paywall: false, checkoutUrl: "" };
let pendingReading = null;
fetch("/api/config").then((r) => r.json()).then((c) => { CONFIG = c; }).catch(() => {});

const getLicense = () => localStorage.getItem("wolha_license") || "";
const setLicense = (k) => localStorage.setItem("wolha_license", k);

const paywall = document.getElementById("paywall");
const showPaywall = () => { paywall.hidden = false; };
const hidePaywall = () => { paywall.hidden = true; };

document.getElementById("paywall-close").addEventListener("click", hidePaywall);
paywall.addEventListener("click", (e) => { if (e.target === paywall) hidePaywall(); });
document.getElementById("paywall-subscribe").addEventListener("click", () => {
  if (CONFIG.checkoutUrl) window.open(CONFIG.checkoutUrl, "_blank", "noopener");
  else alert("결제 링크가 아직 설정되지 않았어요.");
});
document.getElementById("license-check").addEventListener("click", async () => {
  const input = document.getElementById("license-input");
  const msg = document.getElementById("license-msg");
  const key = input.value.trim();
  if (!key) { msg.textContent = "키를 입력해 주세요."; msg.className = "license-msg err"; return; }
  msg.textContent = "확인 중…"; msg.className = "license-msg";
  try {
    const res = await fetch("/api/license/validate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }),
    });
    const d = await res.json();
    if (d.valid) {
      setLicense(key);
      msg.textContent = "✅ 확인됐어요! 풀이를 열게요."; msg.className = "license-msg ok";
      setTimeout(() => {
        hidePaywall();
        if (pendingReading) { const p = pendingReading; pendingReading = null; runReading(p.compact, p.service); }
      }, 700);
    } else {
      msg.textContent = "❌ 유효하지 않은 키예요. (구독이 만료됐거나 오타일 수 있어요)"; msg.className = "license-msg err";
    }
  } catch {
    msg.textContent = "확인 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요."; msg.className = "license-msg err";
  }
});

async function runReading(compact, service) {
  readingPanel.hidden = false;
  readingEl.innerHTML = SKELETON;
  statusEl.className = "status loading";
  statusEl.textContent = "월하가 풀이하는 중이에요";
  try {
    const res = await fetch("/api/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ compact, service, license: getLicense() }),
    });
    const d = await res.json();
    if (res.status === 402 || d.needSubscription) {
      pendingReading = { compact, service };
      statusEl.className = "status"; statusEl.textContent = "";
      readingEl.innerHTML = '<div class="lock-note">🔒 AI 풀이는 구독자 전용이에요.<br>아래에서 구독하거나, 이미 구독했다면 라이선스 키를 넣으면 바로 열려요.</div>';
      showPaywall();
      return;
    }
    if (!res.ok) throw new Error(d.error || "풀이에 실패했어요.");
    statusEl.className = "status"; statusEl.textContent = "";
    readingEl.innerHTML = d.html;
    document.getElementById("share-btn").hidden = false;
  } catch (err) {
    statusEl.className = "status"; statusEl.textContent = "";
    showError(readingEl, err.message);
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
document.getElementById("form-saju").addEventListener("submit", withBusy(sajuBtn, "보는 중…", () =>
  runFlow({ endpoint: "/api/saju", payload: collectPerson("s"), service: soloService, chartLabel: SOLO[soloService].chart })
));

/* ---------- 결과 공유 ---------- */
function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}
const shareBtn = document.getElementById("share-btn");
shareBtn.addEventListener("click", async () => {
  const url = location.origin;
  const text = "월하에서 사주·연애운 봤어! 너도 봐봐 🌙";
  if (navigator.share) {
    try { await navigator.share({ title: "월하 · 연애·인연 사주", text, url }); } catch {}
  } else {
    try { await navigator.clipboard.writeText(url); toast("링크가 복사됐어요! 붙여넣기로 공유하세요 🌙"); }
    catch { window.prompt("이 링크를 복사해 공유하세요:", url); }
  }
});

const coupleBtn = document.getElementById("couple-submit");
document.getElementById("form-couple").addEventListener("submit", withBusy(coupleBtn, "인연 살펴보는 중…", () =>
  runFlow({
    endpoint: "/api/compat",
    payload: { mode: coupleMode, personA: collectPerson("a"), personB: collectPerson("b") },
    service: coupleMode,
    chartLabel: COUPLE[coupleMode].chart,
  })
));
