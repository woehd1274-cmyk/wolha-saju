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
document.querySelector('#form-consult [data-person="c"]').innerHTML = personFormHtml("c", "");
document.querySelector('#form-monthly [data-person="m"]').innerHTML = personFormHtml("m", "");
document.querySelector('#form-annual [data-person="an"]').innerHTML = personFormHtml("an", "");
document.querySelector('#form-trend [data-person="t"]').innerHTML = personFormHtml("t", "");

// 데일리 카드에 오늘 날짜 표시 (매일 새로워지는 느낌 강조 → 재방문 유도)
(() => {
  const b = document.getElementById("daily-badge");
  if (b) { const d = new Date(); b.textContent = `오늘 ${d.getMonth() + 1}.${d.getDate()}`; }
})();

// 전용 링크(?key=...)로 열면 키를 자동 저장 (운영자·지인 북마크용 — 매번 입력 불필요)
(() => {
  const p = new URLSearchParams(location.search);
  const k = p.get("key") || p.get("owner");
  if (k) {
    localStorage.setItem("wolha_license", k.trim());
    history.replaceState({}, "", location.pathname); // 주소창에서 키 숨김
    setTimeout(() => { try { toast("이용 준비 완료! 서비스를 골라 풀이를 받아보세요 🌙"); } catch {} }, 300);
  }
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
  friend: { title: "🤝 친구 궁합", desc: "두 사람의 사주로 우정 궁합을 봐요.", btn: "우정 궁합 보기", heart: "🤝", chart: "우정 지수 · 두 사람의 명식" },
  family: { title: "👨‍👩‍👧 가족 궁합", desc: "두 사람의 사주로 가족 인연을 봐요.", btn: "가족 궁합 보기", heart: "👨‍👩‍👧", chart: "가족 인연 지수 · 명식" },
};
let coupleMode = "gunghap";

// 1인 서비스 (같은 입력 폼, 서비스만 다름)
const SOLO = {
  saju: { title: "🧭 종합 사주 · 인생 분석", desc: "성격·재물·직업·연애·강점약점 + 지금의 실행 전략까지 봐요.", chart: "사주 원국 (분석 근거)" },
  daily: { title: "🗓️ 오늘의 운세", desc: "오늘 하루의 기운을 봐요. 매일 새로워요.", chart: "오늘의 사주" },
  yearly: { title: "💘 올해의 연애운", desc: "올해 나의 연애·인연 흐름과 좋은 시기를 봐요.", chart: "올해의 흐름" },
};
let soloService = "saju";
function openSolo(svc) {
  soloService = svc;
  const s = SOLO[svc];
  document.getElementById("solo-title").textContent = s.title;
  const desc = document.getElementById("solo-desc");
  desc.textContent = s.desc; desc.hidden = !s.desc;
  showView("view-saju");
}

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
  const pw = document.getElementById("paywall");
  if (pw) pw.hidden = true; // 뷰 이동 시 열려있던 구독 팝업 닫기
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function goHome() { showView("view-home"); }

document.getElementById("brand-home").addEventListener("click", goHome);
document.querySelectorAll("[data-home]").forEach((b) => b.addEventListener("click", goHome));

document.querySelectorAll(".svc-card").forEach((card) => {
  card.addEventListener("click", () => {
    const svc = card.dataset.service;
    if (svc === "tarot") { showView("view-tarot"); return; }
    if (svc === "consult") { showView("view-consult"); return; }
    if (svc === "monthly") { showView("view-monthly"); loadGoalHint(); return; }
    if (svc === "annual") { showView("view-annual"); loadGoalHint(); return; }
    if (svc === "trend") { showView("view-trend"); return; }
    if (SOLO[svc]) { openSolo(svc); return; }
    coupleMode = svc; // gunghap | jaehoe | friend | family
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
        else { toast("이제 이용하실 수 있어요! 서비스를 골라 풀이를 받아보세요 🌙"); }
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
  statusEl.textContent = "월하가 풀이하는 중이에요 (약 30초 걸려요)";
  readingPanel.scrollIntoView({ behavior: "smooth", block: "start" }); // 로딩 화면으로 이동 → 기다리는 중임을 보이게
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
      const note = d.trialExhausted
        ? '🎁 무료 체험(첫 1회)을 다 보셨어요!<br>계속 보려면 아래에서 구독하거나, 이미 구독했다면 라이선스 키를 넣어주세요.'
        : '🔒 AI 풀이는 구독자 전용이에요.<br>아래에서 구독하거나, 이미 구독했다면 라이선스 키를 넣으면 바로 열려요.';
      readingEl.innerHTML = `<div class="lock-note">${note}</div>`;
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

const tarotBtn = document.querySelector("#form-tarot .submit-btn");
document.getElementById("form-tarot").addEventListener("submit", withBusy(tarotBtn, "카드 뽑는 중…", () =>
  runFlow({ endpoint: "/api/tarot", payload: { question: document.getElementById("tarot-q").value.trim() }, service: "tarot", chartLabel: "뽑힌 카드" })
));

const consultBtn = document.querySelector("#form-consult .submit-btn");
document.getElementById("form-consult").addEventListener("submit", withBusy(consultBtn, "상담 준비 중…", () =>
  runFlow({ endpoint: "/api/consult", payload: { ...collectPerson("c"), question: document.getElementById("consult-q").value.trim() }, service: "consult", chartLabel: "상담" })
));

const monthlyBtn = document.querySelector("#form-monthly .submit-btn");
document.getElementById("form-monthly").addEventListener("submit", withBusy(monthlyBtn, "리포트 준비 중…", () =>
  runFlow({ endpoint: "/api/monthly", payload: collectPerson("m"), service: "monthly", chartLabel: "이번 달 · 사주 원국" })
));

const annualBtn = document.querySelector("#form-annual .submit-btn");
document.getElementById("form-annual").addEventListener("submit", withBusy(annualBtn, "리포트 준비 중…", () =>
  runFlow({ endpoint: "/api/annual", payload: collectPerson("an"), service: "annual", chartLabel: "올해 · 사주 원국" })
));

// 운세 흐름 — AI 없이 그래프만 (무료)
async function runTrend(payload) {
  chartTitle.textContent = "나의 운세 흐름";
  hideResults();
  chartPanel.hidden = false;
  chartEl.innerHTML = SKELETON;
  chartPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const res = await fetch("/api/fortune-trend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "계산에 실패했어요.");
    chartEl.innerHTML = d.graphHtml;
  } catch (err) {
    showError(chartEl, err.message);
  }
}
const trendBtn = document.querySelector("#form-trend .submit-btn");
document.getElementById("form-trend").addEventListener("submit", withBusy(trendBtn, "흐름 계산 중…", () => runTrend(collectPerson("t"))));

// 히어로 CTA (무료 분석 시작 / 예시 보기)
document.querySelectorAll(".cta-primary").forEach((b) => b.addEventListener("click", () => openSolo("saju")));
document.querySelectorAll("[data-scroll]").forEach((b) => b.addEventListener("click", () => {
  const el = document.getElementById(b.dataset.scroll);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}));

/* ---------- 로그인 / 마이페이지 ---------- */
const authArea = document.getElementById("auth-area");
const loginBtn = document.getElementById("login-btn");
const mypageBtn = document.getElementById("mypage-btn");
let ME = { authOn: false, user: null };

async function refreshAuth() {
  try {
    const r = await fetch("/api/me");
    ME = await r.json();
  } catch { ME = { authOn: false, user: null }; }
  if (!ME.authOn) { authArea.hidden = true; return; }
  authArea.hidden = false;
  if (ME.user) {
    loginBtn.hidden = true;
    mypageBtn.hidden = false;
    document.getElementById("my-nick").textContent = ME.user.nickname || "회원";
    loadGoal();
  } else {
    loginBtn.hidden = false;
    mypageBtn.hidden = true;
  }
}

loginBtn.addEventListener("click", () => { window.location.href = "/auth/kakao"; });
mypageBtn.addEventListener("click", () => { showView("view-mypage"); loadHistory(); loadGoal(); loadMyReview(); });
document.getElementById("logout-btn").addEventListener("click", async () => {
  try { await fetch("/api/logout", { method: "POST" }); } catch {}
  await refreshAuth();
  goHome();
  toast("로그아웃했어요. 다음에 또 만나요 🌙");
});

const SVC_EMOJI = { saju: "🧭", consult: "💬", daily: "🗓️", yearly: "💘", tarot: "🃏", jaehoe: "🕯️", gunghap: "💞", friend: "🤝", family: "👨‍👩‍👧", monthly: "📅", annual: "📊" };
function fmtDate(iso) {
  try { const d = new Date(iso); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`; } catch { return ""; }
}
function ymKey(iso) {
  try { const d = new Date(iso); return `${d.getFullYear()}년 ${d.getMonth() + 1}월`; } catch { return "기타"; }
}
const histCardHtml = (it) =>
  `<button class="hist-card" data-id="${it.id}">
    <span class="hist-emoji">${SVC_EMOJI[it.service] || "🔮"}</span>
    <span class="hist-text"><b>${(it.title || "분석").replace(/</g, "&lt;")}</b><small>${fmtDate(it.created_at)}</small></span>
    <span class="svc-arrow">›</span>
  </button>`;

async function loadHistory() {
  const list = document.getElementById("history-list");
  const summary = document.getElementById("mypage-summary");
  list.innerHTML = '<div class="hist-empty">불러오는 중…</div>';
  if (summary) summary.hidden = true;
  try {
    const r = await fetch("/api/history");
    const d = await r.json();
    const items = d.readings || [];
    if (!items.length) {
      list.innerHTML = '<div class="hist-empty">아직 저장된 분석이 없어요.<br>서비스를 이용하면 여기에 기록이 쌓여요 🌱</div>';
      return;
    }
    // 성장 요약 (총 분석 · 활동한 달 · 최근 활동)
    if (summary) {
      const monthsActive = new Set(items.map((it) => ymKey(it.created_at))).size;
      summary.innerHTML =
        `<div class="ms-stat"><b>${items.length}</b><span>총 분석</span></div>` +
        `<div class="ms-stat"><b>${monthsActive}</b><span>활동한 달</span></div>` +
        `<div class="ms-stat"><b>${fmtDate(items[0].created_at)}</b><span>최근 활동</span></div>`;
      summary.hidden = false;
    }
    // 월별 타임라인 그룹 (items는 최신순)
    const groups = [];
    const idx = {};
    items.forEach((it) => {
      const k = ymKey(it.created_at);
      if (!(k in idx)) { idx[k] = groups.length; groups.push([k, []]); }
      groups[idx[k]][1].push(it);
    });
    list.innerHTML = groups.map(([k, arr]) =>
      `<div class="hist-month">${k} <span>${arr.length}개</span></div>` + arr.map(histCardHtml).join("")
    ).join("");
    list.querySelectorAll(".hist-card").forEach((b) =>
      b.addEventListener("click", () => openHistory(b.dataset.id))
    );
  } catch {
    list.innerHTML = '<div class="hist-empty">기록을 불러오지 못했어요.</div>';
  }
}

/* ---------- 후기 (수집·게시) ---------- */
function starStr(n) { n = Math.max(0, Math.min(5, n | 0)); return "★".repeat(n) + "☆".repeat(5 - n); }
function maskNick(n) { n = (n || "회원").trim(); if (n.length <= 1) return n + "님"; return n[0] + "*".repeat(Math.min(2, n.length - 1)) + "님"; }
async function loadReviews() {
  const box = document.getElementById("reviews-list");
  if (!box) return;
  try {
    const r = await fetch("/api/reviews");
    const d = await r.json();
    const items = d.reviews || [];
    if (!items.length) return; // placeholder 유지
    box.innerHTML = items.map((v) =>
      `<div class="review-card"><div class="review-stars">${starStr(v.rating)}</div><p>${(v.text || "").replace(/</g, "&lt;")}</p><div class="review-by">— ${maskNick(v.nickname)}</div></div>`
    ).join("");
  } catch {}
}
let reviewRating = 0;
function paintStars() { document.querySelectorAll("#star-pick .star").forEach((s) => s.classList.toggle("on", +s.dataset.v <= reviewRating)); }
document.getElementById("star-pick")?.addEventListener("click", (e) => {
  const b = e.target.closest(".star"); if (!b) return;
  reviewRating = +b.dataset.v; paintStars();
});
async function loadMyReview() {
  try {
    const r = await fetch("/api/my-review");
    const d = await r.json();
    if (d.review) { reviewRating = d.review.rating || 0; document.getElementById("review-text").value = d.review.text || ""; paintStars(); }
  } catch {}
}
document.getElementById("review-save")?.addEventListener("click", async () => {
  const text = document.getElementById("review-text").value.trim();
  const msg = document.getElementById("review-msg");
  if (!reviewRating || !text) { msg.textContent = "별점과 후기를 입력해 주세요."; msg.className = "goal-msg err"; return; }
  msg.textContent = "등록 중…"; msg.className = "goal-msg";
  try {
    const r = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: reviewRating, text }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "실패");
    msg.textContent = "✅ 후기 감사해요! 홈에 소개될게요."; msg.className = "goal-msg ok";
    loadReviews();
  } catch (e) {
    msg.textContent = "등록 실패: " + e.message; msg.className = "goal-msg err";
  }
});
loadReviews();

/* ---------- 나의 목표 (성장 파트너) ---------- */
let GOAL = { goal: "", category: "" };
async function loadGoal() {
  try { const r = await fetch("/api/goal"); GOAL = await r.json(); } catch { GOAL = { goal: "", category: "" }; }
  const input = document.getElementById("goal-input");
  if (input) input.value = GOAL.goal || "";
  document.querySelectorAll(".goal-cat").forEach((b) => b.classList.toggle("on", !!GOAL.category && b.dataset.cat === GOAL.category));
}
function loadGoalHint() {
  const has = GOAL && GOAL.goal;
  const html = has ? `🎯 반영될 내 목표: <b>${GOAL.category ? "[" + GOAL.category + "] " : ""}${GOAL.goal.replace(/</g, "&lt;")}</b>` : "";
  document.querySelectorAll(".goal-hint-auto").forEach((hint) => {
    hint.innerHTML = html;
    hint.hidden = !has;
  });
}
document.getElementById("goal-cats")?.addEventListener("click", (e) => {
  const b = e.target.closest(".goal-cat");
  if (!b) return;
  const already = b.classList.contains("on");
  document.querySelectorAll(".goal-cat").forEach((x) => x.classList.remove("on"));
  if (!already) b.classList.add("on");
});
document.getElementById("goal-save")?.addEventListener("click", async () => {
  const goal = document.getElementById("goal-input").value.trim();
  const catBtn = document.querySelector(".goal-cat.on");
  const category = catBtn ? catBtn.dataset.cat : "";
  const msg = document.getElementById("goal-msg");
  msg.textContent = "저장 중…"; msg.className = "goal-msg";
  try {
    const r = await fetch("/api/goal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal, category }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "저장 실패");
    GOAL = { goal, category };
    msg.textContent = "✅ 저장됐어요! 이번 달 리포트에 반영돼요."; msg.className = "goal-msg ok";
  } catch (e) {
    msg.textContent = "저장 실패: " + e.message; msg.className = "goal-msg err";
  }
});
document.getElementById("goal-monthly")?.addEventListener("click", () => { showView("view-monthly"); loadGoalHint(); });

async function openHistory(id) {
  hideResults();
  readingPanel.hidden = false;
  readingEl.innerHTML = SKELETON;
  statusEl.className = "status loading"; statusEl.textContent = "불러오는 중…";
  readingPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const r = await fetch(`/api/history/${id}`);
    const d = await r.json();
    if (!r.ok) throw new Error("불러오지 못했어요.");
    statusEl.className = "status"; statusEl.textContent = "";
    readingEl.innerHTML = d.html;
  } catch (err) {
    statusEl.className = "status"; statusEl.textContent = "";
    showError(readingEl, err.message);
  }
}

// 로그인 결과 메시지 (?login=1 / fail)
(() => {
  const p = new URLSearchParams(location.search);
  const l = p.get("login");
  if (l) {
    history.replaceState({}, "", location.pathname);
    if (l === "1") setTimeout(() => toast("로그인했어요! 이제 분석 기록이 저장돼요 🌙"), 300);
    else if (l === "fail") setTimeout(() => toast("로그인에 실패했어요. 다시 시도해 주세요."), 300);
  }
})();

refreshAuth();
