// 월하(月下) — 연애·인연 전문 사주 서버
// - ssaju 라이브러리로 생년월일시 -> 사주팔자(만세력) 계산
// - 오행 색상 명식 / 인연 지수 궁합 엔진 렌더링
// - Claude Agent SDK(구독 OAuth 토큰)로 사주/궁합/재회 풀이
import fs from "fs";
import express from "express";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import { marked } from "marked";
import { calculateSaju } from "ssaju";
import { query } from "@anthropic-ai/claude-agent-sdk";
import Anthropic from "@anthropic-ai/sdk";
import pkg from "pg";
import jwt from "jsonwebtoken";
const { Pool } = pkg;

// .env 파일이 있으면 읽어서 환경변수로 로드 (의존성 없는 간단 파서)
// 예: CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat-...
try {
  let envText = fs.readFileSync(new URL("./.env", import.meta.url), "utf8");
  if (envText.charCodeAt(0) === 0xfeff) envText = envText.slice(1); // UTF-8 BOM 제거
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trimStart().startsWith("#") && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  /* .env 없으면 무시 */
}

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.SAJU_MODEL || "claude-sonnet-5";

// AI 인증 방식: ANTHROPIC_API_KEY가 있으면 API(공개 배포·과금), 없으면 구독 로그인(로컬 무료)
const USE_API_KEY = !!process.env.ANTHROPIC_API_KEY;
const anthropic = USE_API_KEY ? new Anthropic() : null;

// 구독 결제(Gumroad): 판매 링크가 설정되면 AI 풀이를 '구독자 전용'으로 잠금.
// 설정 전에는 잠금이 꺼져 있어 누구나 무료로 사용(=지금 상태 유지).
// GUMROAD_PRODUCT_URL: 손님이 구독하는 판매 링크 (예: https://xxxx.gumroad.com/l/wolha)
// GUMROAD_PRODUCT_ID: 라이선스 키 검증용 상품 ID (판매 페이지에서 자동 추출해 설정)
const CHECKOUT_URL = process.env.GUMROAD_PRODUCT_URL || "";
const GUMROAD_PRODUCT_ID = process.env.GUMROAD_PRODUCT_ID || "";
const PAYWALL_ON = !!CHECKOUT_URL;
// 주인 키: 이 비밀 코드를 라이선스 칸에 넣으면 결제 없이 항상 잠금 해제 (운영자·지인 무료 이용)
const OWNER_KEY = process.env.OWNER_KEY || "";
// 구독자 공용 코드: Gumroad 구매 후 안내문(콘텐츠)에 이 코드를 적어두면, 구독자가 입력해 잠금 해제.
// (라이선스 키를 켤 수 없을 때의 대체 수단 — 라이선스 키가 켜지면 그쪽이 우선)
const SUBSCRIBER_CODE = process.env.SUBSCRIBER_CODE || "";
// 첫 1회 무료 체험 (IP당). 서버 재시작 시 초기화됨.
const FREE_TRIAL_COUNT = Number(process.env.FREE_TRIAL_COUNT || 1);
const freeTrialUsed = new Map(); // ip -> 사용횟수
// 간단 방문 통계 (메모리 — 재배포 시 초기화)
const stats = { visits: 0, readings: {}, subscribersUnlocked: 0, since: new Date().toISOString() };

// ── 로그인·기록 저장 (카카오 + Postgres). 미설정이면 로그인 기능만 꺼지고 사이트는 그대로 작동. ──
const DATABASE_URL = process.env.DATABASE_URL || "";
const KAKAO_CLIENT_ID = process.env.KAKAO_CLIENT_ID || "";
const KAKAO_CLIENT_SECRET = process.env.KAKAO_CLIENT_SECRET || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "wolha-dev-secret-change-me";
const BASE_URL = (process.env.BASE_URL || "https://wolha-saju-production.up.railway.app").replace(/\/$/, "");
const AUTH_ON = !!(DATABASE_URL && KAKAO_CLIENT_ID && KAKAO_CLIENT_SECRET);
const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL.includes("railway.internal") ? false : { rejectUnauthorized: false } })
  : null;
let DB_READY = false;
async function initDb() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    kakao_id TEXT UNIQUE NOT NULL,
    nickname TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )`);
  // 목표 설정(성장 파트너) — 기존 테이블에도 안전하게 컬럼 추가
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS goal TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS goal_category TEXT`);
  // 실제 후기(회원 1인 1건 · 홈에 게시)
  await pool.query(`CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    nickname TEXT,
    rating INTEGER,
    text TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS readings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    service TEXT,
    title TEXT,
    markdown TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )`);
  DB_READY = true;
  console.log("[db] 준비 완료 ✅");
}
initDb().catch((e) => console.error("[db] init 실패:", e.message));

app.use(express.json({ limit: "64kb" }));
app.use(cookieParser());
app.set("trust proxy", 1); // 배포(프록시) 환경에서 실제 접속자 IP 인식

// 세션(JWT 쿠키) 헬퍼
function setSession(res, userId) {
  const token = jwt.sign({ uid: userId }, SESSION_SECRET, { expiresIn: "30d" });
  res.cookie("wolha_session", token, { httpOnly: true, sameSite: "lax", secure: true, maxAge: 30 * 24 * 3600 * 1000 });
}
function getUserId(req) {
  try {
    const t = req.cookies?.wolha_session;
    if (!t) return null;
    return jwt.verify(t, SESSION_SECRET).uid;
  } catch {
    return null;
  }
}
const SERVICE_LABEL = {
  saju: "🧭 종합 사주 · 인생 분석", consult: "💬 AI 상담", daily: "🗓️ 오늘의 운세",
  yearly: "💘 올해의 연애운", tarot: "🃏 타로 풀이", jaehoe: "🕯️ 재회 가능성",
  gunghap: "💞 연인 궁합", friend: "🤝 친구 궁합", family: "👨‍👩‍👧 가족 궁합",
  monthly: "📅 이번 달 리포트", annual: "📊 올해 종합 리포트",
};

// 악용 방지: AI 풀이 요청을 IP당 시간당 횟수 제한 (요금 폭탄 방지)
const interpretLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_PER_HOUR || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "요청이 많아 잠시 제한됐어요. 한 시간 뒤 다시 시도해 주세요." },
});

app.use(express.static("public"));

/* ---------- 공통 헬퍼 ---------- */
const EL_CLASS = { 목: "wood", 화: "fire", 토: "earth", 금: "metal", 수: "water" };
const elc = (e) => "el-" + (EL_CLASS[e] || "earth");
const STEM_EL = { 甲: "목", 乙: "목", 丙: "화", 丁: "화", 戊: "토", 己: "토", 庚: "금", 辛: "금", 壬: "수", 癸: "수" };
const BRANCH_EL = { 子: "수", 丑: "토", 寅: "목", 卯: "목", 辰: "토", 巳: "화", 午: "화", 未: "토", 申: "금", 酉: "금", 戌: "토", 亥: "수" };
const STEMS_SEQ = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
const BRANCHES_SEQ = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
// 오행 상생(생)·상극(극) 관계
const EL_GEN = { 목: "화", 화: "토", 토: "금", 금: "수", 수: "목" }; // X가 Y를 생함
const EL_CTRL = { 목: "토", 토: "수", 수: "화", 화: "금", 금: "목" }; // X가 Y를 극함
// 그날 기운(D) 대비 나(일간 오행 U)의 관계 점수
function relScore(U, D) {
  if (D === U) return 68;          // 비겁
  if (EL_GEN[D] === U) return 88;  // 그날이 나를 생함 → 인성(도움)
  if (EL_GEN[U] === D) return 62;  // 내가 그날을 생함 → 식상(소모)
  if (EL_CTRL[D] === U) return 42; // 그날이 나를 극함 → 관성(압박)
  if (EL_CTRL[U] === D) return 78; // 내가 그날을 극함 → 재성(기회)
  return 60;
}
const mod = (n, m) => ((n % m) + m) % m;
const STRENGTH_KO = { strong: "신강", weak: "신약", neutral: "중화" };
const pad = (n) => String(n).padStart(2, "0");

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function normalizeInput(body) {
  const { name, year, month, day, hour, minute, gender, calendar, leap } = body || {};
  const hourKnown = !(hour === "" || hour == null);
  return {
    name: (name || "").slice(0, 20),
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: hourKnown ? Number(hour) : 12,
    minute: minute === "" || minute == null ? 0 : Number(minute),
    hourKnown,
    gender: gender === "여" ? "여" : "남",
    calendar: calendar === "lunar" ? "lunar" : "solar",
    leap: Boolean(leap),
  };
}

function runSaju(input) {
  return calculateSaju({
    year: input.year, month: input.month, day: input.day,
    hour: input.hour, minute: input.minute,
    gender: input.gender, calendar: input.calendar, leap: input.leap,
    timezone: "Asia/Seoul",
  });
}

/* ---------- 명식 렌더링 ---------- */
function pillarColumn(label, d, tg, unsung, isDay) {
  const stemTg = isDay ? "일원" : tg.stem;
  const hidden = Object.values(d.hiddenStems).filter(Boolean).join("") || "-";
  return `
    <div class="ms-col${isDay ? " ms-day" : ""}">
      <div class="ms-head">${label}</div>
      <div class="ms-tg">${esc(stemTg)}</div>
      <div class="ms-cell ${elc(d.element.stem)}">
        <span class="ms-han">${esc(d.stem)}</span>
        <span class="ms-ko">${esc(d.stemKo)}·${esc(d.element.stem)}</span>
      </div>
      <div class="ms-cell ${elc(d.element.branch)}">
        <span class="ms-han">${esc(d.branch)}</span>
        <span class="ms-ko">${esc(d.branchKo)}·${esc(d.element.branch)}</span>
      </div>
      <div class="ms-tg lower">${esc(tg.branch)}</div>
      <div class="ms-meta"><span>운성 <b>${esc(unsung)}</b></span><span>장간 <b>${esc(hidden)}</b></span></div>
    </div>`;
}

function myeongsikGrid(r, short, mini) {
  const pd = r.pillarDetails;
  const bong = r.stages12.bong;
  const cols = short
    ? [["시", "hour", false], ["일", "day", true], ["월", "month", false], ["연", "year", false]]
    : [["시주", "hour", false], ["일주", "day", true], ["월주", "month", false], ["연주", "year", false]];
  const grid = cols.map(([label, k, isDay]) => pillarColumn(label, pd[k], r.tenGods[k], bong[k], isDay)).join("");
  return `<div class="myeongsik${mini ? " mini" : ""}">${grid}</div>`;
}

function daeunHtml(r) {
  const curGz = r.daeun?.current?.ganzhi;
  const cards = (r.daeun?.list || [])
    .map((d) => {
      const active = d.ganzhi === curGz ? " active" : "";
      const sal = (d.sal || []).join(",");
      return `<div class="du-card${active}">
        ${active ? '<span class="du-now">지금</span>' : ""}
        <div class="du-age">${d.startAge}세</div>
        <div class="du-gz">
          <span class="du-c ${elc(STEM_EL[d.stem])}">${esc(d.stem)}</span>
          <span class="du-c ${elc(BRANCH_EL[d.branch])}">${esc(d.branch)}</span>
        </div>
        <div class="du-tg">${esc(d.stemTenGod)}·${esc(d.branchTenGod)}</div>
        <div class="du-yr">${d.startYear}~${sal ? " · " + esc(sal) : ""}</div>
      </div>`;
    })
    .join("");
  return `<div class="daeun-scroll"><div class="daeun">${cards}</div></div>`;
}

function renderChart(r, input) {
  const pd = r.pillarDetails;
  const a = r.advanced;

  const calKo = input.calendar === "lunar" ? (input.leap ? "음력(윤달)" : "음력") : "양력";
  const genderKo = input.gender === "여" ? "여자" : "남자";
  const timeStr = input.hourKnown ? `${pad(input.hour)}:${pad(input.minute)}` : "시각 모름";
  const nameLine = input.name ? `<span class="hd-name">${esc(input.name)}</span>` : "";

  const feOrder = ["목", "화", "토", "금", "수"];
  const total = feOrder.reduce((s, e) => s + (r.fiveElements[e] || 0), 0) || 1;
  const bars = feOrder
    .map((e) => {
      const n = r.fiveElements[e] || 0;
      return `<div class="oh-row"><span class="oh-tag ${elc(e)}">${e}</span>
        <div class="oh-track"><i class="${elc(e)}" style="width:${Math.round((n / total) * 100)}%"></i></div>
        <span class="oh-num">${n}</span></div>`;
    })
    .join("");

  const maxN = Math.max(...feOrder.map((e) => r.fiveElements[e] || 0));
  const strong = feOrder.filter((e) => (r.fiveElements[e] || 0) === maxN && maxN > 0);
  const missing = feOrder.filter((e) => (r.fiveElements[e] || 0) === 0);
  const balanceNote =
    `<div class="oh-note">강한 기운 <b>${strong.join("·") || "-"}</b>` +
    (missing.length ? ` · 비어 있는 기운 <b>${missing.join("·")}</b>` : "") +
    `</div>`;

  const strengthKo = STRENGTH_KO[a.dayStrength.strength] || a.dayStrength.strength;
  const gong = (r.gongmang?.branchesKo || []).join(", ") || "-";
  const gil = (a.sinsal?.gilsin || []).join(", ") || "-";
  const hyung = (a.sinsal?.hyungsin || []).join(", ") || "-";

  return `
    <div class="hd">
      ${nameLine}
      <div class="hd-line">${input.year}년 ${input.month}월 ${input.day}일 · ${timeStr} · ${genderKo} · ${calKo}</div>
    </div>

    <div class="sum">
      <div class="sum-item"><span>일간</span><b class="${elc(pd.day.element.stem)} chip-el">${esc(r.dayStem)}(${esc(pd.day.stemKo)})</b></div>
      <div class="sum-item"><span>강약</span><b>${esc(strengthKo)} · ${a.dayStrength.score}</b></div>
      <div class="sum-item"><span>격국</span><b>${esc(a.geukguk)}</b></div>
      <div class="sum-item"><span>용신</span><b>${esc((a.yongsin || []).join(" "))}</b></div>
    </div>

    <div class="basis-note">🔎 <b>이 풀이의 근거</b> — 아래 <b>일간·오행 분포·대운·세운</b>을 종합해 분석했어요. 결과만이 아니라 ‘왜 그런지’도 함께 봐 주세요.</div>

    <h3 class="sec">사주 명식</h3>
    ${myeongsikGrid(r, false, false)}

    <h3 class="sec">오행 분포</h3>
    <div class="ohaeng">${bars}</div>
    ${balanceNote}

    <h3 class="sec">대운</h3>
    ${daeunHtml(r)}

    <div class="misc">
      <span>공망 <b>${esc(gong)}</b></span>
      <span>길신 <b>${esc(gil)}</b></span>
      <span>흉신 <b>${esc(hyung)}</b></span>
    </div>`;
}

/* ---------- 궁합 엔진 (전통 이론 단순화 모델) ---------- */
const STEM_HAP = { 甲: "己", 己: "甲", 乙: "庚", 庚: "乙", 丙: "辛", 辛: "丙", 丁: "壬", 壬: "丁", 戊: "癸", 癸: "戊" };
const BRANCH_YUKHAP = { 子: "丑", 丑: "子", 寅: "亥", 亥: "寅", 卯: "戌", 戌: "卯", 辰: "酉", 酉: "辰", 巳: "申", 申: "巳", 午: "未", 未: "午" };
const SAMHAP_GROUPS = [["申", "子", "辰"], ["亥", "卯", "未"], ["寅", "午", "戌"], ["巳", "酉", "丑"]];
const BRANCH_CHUNG = { 子: "午", 午: "子", 丑: "未", 未: "丑", 寅: "申", 申: "寅", 卯: "酉", 酉: "卯", 辰: "戌", 戌: "辰", 巳: "亥", 亥: "巳" };
const BRANCH_HAE = { 子: "未", 未: "子", 丑: "午", 午: "丑", 寅: "巳", 巳: "寅", 卯: "辰", 辰: "卯", 申: "亥", 亥: "申", 酉: "戌", 戌: "酉" };
const HYEONG_PAIRS = [["寅", "巳"], ["巳", "申"], ["寅", "申"], ["丑", "戌"], ["戌", "未"], ["丑", "未"], ["子", "卯"]];
const SHENG = { 목: "화", 화: "토", 토: "금", 금: "수", 수: "목" }; // A가 B를 생함
const KEK = { 목: "토", 토: "수", 수: "화", 화: "금", 금: "목" }; // A가 B를 극함

const isHyeong = (a, b) => HYEONG_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
const dominantElements = (fe) => {
  const order = ["목", "화", "토", "금", "수"];
  const max = Math.max(...order.map((e) => fe[e] || 0));
  return order.filter((e) => (fe[e] || 0) === max && max > 0);
};

// 천간 음양 + 십성 계산 (일간 기준 상대 천간이 무슨 십성인가)
const STEM_YY = { 甲: "양", 丙: "양", 戊: "양", 庚: "양", 壬: "양", 乙: "음", 丁: "음", 己: "음", 辛: "음", 癸: "음" };
function tenGodOf(dayStem, otherStem) {
  const dE = STEM_EL[dayStem], oE = STEM_EL[otherStem];
  if (!dE || !oE) return null;
  const same = STEM_YY[dayStem] === STEM_YY[otherStem];
  if (dE === oE) return same ? "비견" : "겁재";
  if (SHENG[dE] === oE) return same ? "식신" : "상관";
  if (KEK[dE] === oE) return same ? "편재" : "정재";
  if (KEK[oE] === dE) return same ? "편관" : "정관";
  if (SHENG[oE] === dE) return same ? "편인" : "정인";
  return null;
}
// 배우자 인연 점수: 남자는 상대가 재성, 여자는 상대가 관성일 때 (정=안정, 편=인연)
function spouseStarPoints(viewerGender, tg) {
  if (viewerGender === "남") return tg === "정재" ? 10 : tg === "편재" ? 5 : 0;
  return tg === "정관" ? 10 : tg === "편관" ? 5 : 0;
}

// 두 지지(地支) 사이 관계 판정 (합이 충보다 우선)
function branchRelation(a, b) {
  if (!a || !b || a === b) return null;
  if (BRANCH_YUKHAP[a] === b) return "yukhap";
  if (SAMHAP_GROUPS.some((g) => g.includes(a) && g.includes(b))) return "samhap";
  if (BRANCH_CHUNG[a] === b) return "chung";
  if (isHyeong(a, b)) return "hyeong";
  if (BRANCH_HAE[a] === b) return "hae";
  return null;
}
// 관계 유형별 한글 + 의미
const REL_KO = {
  yukhap: ["육합", "서로 끌리고 잘 맞아요"],
  samhap: ["삼합", "함께 뭔가를 이뤄가기 좋아요"],
  chung: ["충(沖)", "부딪힘이 있어 서로의 배려가 필요해요"],
  hyeong: ["형(刑)", "갈등·다툼이 생기기 쉬워요"],
  hae: ["해(害)", "은근한 서운함이 쌓일 수 있어요"],
};
// 자리별 가중치 (일지 > 월지 > 시지). 시지는 두 사람 모두 태어난 시각을 알 때만 반영.
const BRANCH_POS = [
  { key: "day", name: "일지", note: "배우자 자리", needHour: false, w: { yukhap: 22, samhap: 14, chung: -20, hyeong: -12, hae: -8 } },
  { key: "month", name: "월지", note: "생활·기질 자리", needHour: false, w: { yukhap: 10, samhap: 7, chung: -10, hyeong: -6, hae: -4 } },
  { key: "hour", name: "시지", note: "미래·마음 자리", needHour: true, w: { yukhap: 8, samhap: 5, chung: -8, hyeong: -5, hae: -3 } },
];

function computeRelationship(rA, rB, mA, mB, mode) {
  const isLove = mode !== "friend" && mode !== "family"; // 연애 계열만 배우자 인연 반영
  const aDay = rA.pillarDetails.day, bDay = rB.pillarDetails.day;
  const aStem = aDay.stem, bStem = bDay.stem;
  const aStemEl = STEM_EL[aStem], bStemEl = STEM_EL[bStem];
  const bothHourKnown = !!(mA?.hourKnown && mB?.hourKnown);

  let score = 50;
  const factors = [];
  const add = (delta, label, detail) => { score += delta; factors.push({ effect: delta, label, detail }); };

  // 일간(日干) 관계 — 두 사람의 본질
  if (STEM_HAP[aStem] === bStem) add(25, "일간 천간합", `본질이 되는 일간(${aStem}·${bStem})이 서로 끌어당기는 합(合) 관계예요.`);
  else if (aStemEl && bStemEl) {
    if (KEK[aStemEl] === bStemEl || KEK[bStemEl] === aStemEl) add(-10, "일간 상극", `두 사람의 기본 기운(${aStemEl}·${bStemEl})이 서로 부딪히기 쉬워요.`);
    else if (SHENG[aStemEl] === bStemEl || SHENG[bStemEl] === aStemEl) add(10, "일간 상생", `한쪽이 다른 쪽을 북돋아 주는(${aStemEl}·${bStemEl}) 흐름이에요.`);
    else if (aStemEl === bStemEl) add(4, "일간 같은 오행", "기본 기질이 비슷해 서로 편안함을 느껴요.");
  }

  // 지지(地支) 관계 — 일지(배우자) · 월지(생활) · 시지(미래) 자리
  for (const pos of BRANCH_POS) {
    if (pos.needHour && !bothHourKnown) continue; // 시각 모르면 시지 생략
    const rel = branchRelation(rA.pillarDetails[pos.key].branch, rB.pillarDetails[pos.key].branch);
    if (!rel) continue;
    const [ko, meaning] = REL_KO[rel];
    add(pos.w[rel], `${pos.name} ${ko}`, `${pos.note}(${pos.name})가 ${ko} — ${meaning}.`);
  }

  // 오행 보완 — 상대의 강한 기운이 내 용신(필요한 기운)을 채워주는지
  const aYong = (rA.advanced?.yongsin || []).map((s) => STEM_EL[s]).filter(Boolean);
  const bYong = (rB.advanced?.yongsin || []).map((s) => STEM_EL[s]).filter(Boolean);
  const aStrong = dominantElements(rA.fiveElements);
  const bStrong = dominantElements(rB.fiveElements);
  const bHelpsA = bStrong.some((e) => aYong.includes(e));
  const aHelpsB = aStrong.some((e) => bYong.includes(e));
  if (bHelpsA && aHelpsB) add(12, "서로 보완", "서로에게 필요한 기운을 채워 주는 좋은 보완 관계예요.");
  else if (bHelpsA || aHelpsB) add(7, "한쪽 보완", "한 사람이 다른 사람에게 필요한 기운을 채워 줘요.");

  // 음양 조화
  if (aDay.yinYang.stem !== bDay.yinYang.stem) add(8, "음양 조화", "음(陰)과 양(陽)이 어우러져 균형이 좋아요.");
  else add(0, "같은 음양", "두 사람의 음양이 같아, 비슷한 만큼 부딪힐 수도 있어요.");

  // 배우자 인연성 (서로의 일간이 상대에게 어떤 십성인가) — 연애 계열에서만
  if (isLove) {
    const nameA = mA?.name || "A", nameB = mB?.name || "B";
    const aToB = tenGodOf(aStem, bStem); // A가 볼 때 상대 B의 십성
    const bToA = tenGodOf(bStem, aStem); // B가 볼 때 상대 A의 십성
    const pA = spouseStarPoints(mA?.gender === "여" ? "여" : "남", aToB);
    const pB = spouseStarPoints(mB?.gender === "여" ? "여" : "남", bToA);
    if (pA) add(pA, `배우자 인연 · ${esc(nameA)}`, `${esc(nameA)}에게 ${esc(nameB)}은(는) ${aToB} — ${pA >= 10 ? "안정적인" : "인연이 되는"} 배우자 자리의 기운이에요.`);
    if (pB) add(pB, `배우자 인연 · ${esc(nameB)}`, `${esc(nameB)}에게 ${esc(nameA)}은(는) ${bToA} — ${pB >= 10 ? "안정적인" : "인연이 되는"} 배우자 자리의 기운이에요.`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const oneLine =
    score >= 80 ? "아주 잘 맞는 인연" :
    score >= 65 ? "잘 어울리는 인연" :
    score >= 50 ? "노력으로 깊어지는 인연" :
    score >= 35 ? "배려가 많이 필요한 인연" : "쉽지 않은 인연";
  return { score, factors, oneLine };
}

// 재회·연애에 유리한 연도(세운) — A(질문자) 기준. 현재~미래만.
function favorableYears(rA, mA) {
  const loveStars = mA.gender === "여" ? ["정관", "편관"] : ["정재", "편재"];
  const dayBranch = rA.pillarDetails.day.branch;
  return (rA.seyun || [])
    .filter((s) => s.year >= rA.currentYear)
    .map((s) => {
      const reasons = [];
      if (loveStars.includes(s.tenGodStem) || loveStars.includes(s.tenGodBranch)) reasons.push("인연운");
      const rel = branchRelation(dayBranch, s.branch);
      if (rel === "yukhap" || rel === "samhap") reasons.push("배우자궁 합");
      const caution = rel === "chung";
      return { year: s.year, ganzhi: s.ganzhi, stem: s.stem, branch: s.branch, good: reasons.length > 0, caution, reasons };
    });
}

function yearsStrip(years, name) {
  if (!years || !years.length) return "";
  const cards = years
    .map((y) => {
      const cls = y.caution ? " caution" : y.good ? " good" : "";
      const tag = y.caution ? "변동 조심" : y.good ? y.reasons.join("·") : "무난";
      return `<div class="yr-card${cls}">
        <div class="yr-y">${y.year}</div>
        <div class="yr-gz"><span class="yr-c ${elc(STEM_EL[y.stem])}">${esc(y.stem)}</span><span class="yr-c ${elc(BRANCH_EL[y.branch])}">${esc(y.branch)}</span></div>
        <div class="yr-tag">${esc(tag)}</div>
      </div>`;
    })
    .join("");
  return `<h3 class="sec">유리한 시기 (세운)</h3>
    <p class="sec-note">${esc(name || "내")} 사주 기준, 인연·관계 기운이 드나드는 해예요. 정해진 것이 아니라 흐름의 참고랍니다.</p>
    <div class="years-scroll"><div class="years">${cards}</div></div>`;
}

// 재회 가능성 판정 문구 (헛된 희망 금지 · 낮을수록 자기돌봄으로)
function jaehoeVerdict(score) {
  if (score >= 80) return "다시 이어질 여지가 충분해요";
  if (score >= 65) return "가능성이 열려 있는 흐름이에요";
  if (score >= 50) return "시간과 노력이 필요한 흐름이에요";
  if (score >= 35) return "쉽지 않지만, 나를 돌보며 지켜볼 때예요";
  return "지금은 놓아주는 것이 나를 위한 길일 수 있어요";
}

/* ---------- 궁합/재회 렌더링 ---------- */
function personCard(r, m) {
  const genderKo = m.gender === "여" ? "여자" : "남자";
  const timeStr = m.hourKnown ? `${pad(m.hour)}:${pad(m.minute)}` : "시각 모름";
  const nm = m.name || "이름 없음";
  return `<div class="cp-person">
    <div class="cp-name">${esc(nm)}</div>
    <div class="cp-birth">${m.year}.${m.month}.${m.day} · ${timeStr} · ${genderKo}</div>
    <div class="cp-day ${elc(r.pillarDetails.day.element.stem)}">일간 ${esc(r.dayStem)}(${esc(r.pillarDetails.day.stemKo)})</div>
    ${myeongsikGrid(r, true, true)}
  </div>`;
}

function renderCompat(rA, rB, rel, mA, mB, mode, years) {
  const isJ = mode === "jaehoe";
  const title = { jaehoe: "재회 인연 지수", gunghap: "인연 지수", friend: "우정 지수", family: "가족 인연 지수" }[mode] || "인연 지수";
  const nameA = mA.name || "그대", nameB = mB.name || "그 사람";
  const banner = isJ
    ? `<div class="jaehoe-banner">🕯️ ${esc(nameA)} 님과 ${esc(nameB)} 님,<br>다시 이어질 수 있을까요?</div>`
    : "";
  const factorsHtml = rel.factors
    .filter((f) => f.effect !== 0)
    .map((f) => {
      const pos = f.effect > 0;
      return `<div class="factor ${pos ? "pos" : "neg"}">
        <span class="factor-eff">${pos ? "+" : ""}${f.effect}</span>
        <div class="factor-body"><b>${esc(f.label)}</b><span>${esc(f.detail)}</span></div>
      </div>`;
    })
    .join("");
  const timing = mode === "jaehoe"
    ? `${yearsStrip(years, mA.name)}
       <h3 class="sec">지금의 흐름 (내 대운)</h3>
       <p class="sec-note">헤어짐과 만남의 시기는 정해진 것이 아니라 흐름의 참고예요.</p>${daeunHtml(rA)}`
    : "";

  return `
    ${banner}
    <div class="score-wrap${isJ ? " jaehoe" : ""}">
      ${isJ ? '<div class="verdict-tag">🕯️ 재회 가능성</div>' : ""}
      <div class="score-title">${title}</div>
      <div class="score-ring" style="--pct:${rel.score}">
        <div class="score-inner"><span class="score-num">${rel.score}</span><span class="score-unit">점</span></div>
      </div>
      <div class="score-line">${esc(isJ ? jaehoeVerdict(rel.score) : rel.oneLine)}</div>
      ${isJ ? `<div class="score-sub">${esc(rel.oneLine)}</div>` : ""}
      <div class="score-note">전통 궁합 이론을 단순화한 참고 지표예요. 정해진 결론이 아니라 흐름의 참고랍니다.</div>
    </div>

    <div class="cp-people">${personCard(rA, mA)}${personCard(rB, mB)}</div>

    <h3 class="sec">관계 요인</h3>
    <div class="factors">${factorsHtml}</div>

    ${timing}`;
}

function compatCompact(rA, rB, rel, mA, mB, mode, years) {
  const facts = rel.factors.map((f) => `${f.effect >= 0 ? "+" : ""}${f.effect} ${f.label}: ${f.detail}`).join("\n");
  let extra = "";
  if (mode === "jaehoe" && years?.length) {
    const good = years.filter((y) => y.good && !y.caution).map((y) => `${y.year}(${y.ganzhi})`).join(", ") || "뚜렷한 해 없음";
    const caution = years.filter((y) => y.caution).map((y) => y.year).join(", ") || "없음";
    extra = `\n\n# 유리한 시기 (세운, ${mA.name || "A"} 기준)\n인연·관계운 좋은 해: ${good}\n변동 조심 해: ${caution}`;
  }
  return `# 사람A (${mA.name || "A"})
${rA.toCompact()}

# 사람B (${mB.name || "B"})
${rB.toCompact()}

# 관계 계산 (간이 궁합 모델)
인연 지수: ${rel.score}/100 (${rel.oneLine})
${facts}${extra}`;
}

/* ---------- 타로 (메이저 아르카나 22장 · 3장 스프레드) ---------- */
const TAROT_DECK = [
  { ko: "바보", en: "The Fool", emoji: "🎒" }, { ko: "마법사", en: "The Magician", emoji: "🎩" },
  { ko: "여사제", en: "The High Priestess", emoji: "🌙" }, { ko: "여황제", en: "The Empress", emoji: "👑" },
  { ko: "황제", en: "The Emperor", emoji: "🏛️" }, { ko: "교황", en: "The Hierophant", emoji: "📿" },
  { ko: "연인", en: "The Lovers", emoji: "💕" }, { ko: "전차", en: "The Chariot", emoji: "🛞" },
  { ko: "힘", en: "Strength", emoji: "🦁" }, { ko: "은둔자", en: "The Hermit", emoji: "🏮" },
  { ko: "운명의 수레바퀴", en: "Wheel of Fortune", emoji: "☸️" }, { ko: "정의", en: "Justice", emoji: "⚖️" },
  { ko: "매달린 사람", en: "The Hanged Man", emoji: "🙃" }, { ko: "죽음", en: "Death", emoji: "🦋" },
  { ko: "절제", en: "Temperance", emoji: "🍶" }, { ko: "악마", en: "The Devil", emoji: "😈" },
  { ko: "탑", en: "The Tower", emoji: "🗼" }, { ko: "별", en: "The Star", emoji: "⭐" },
  { ko: "달", en: "The Moon", emoji: "🌕" }, { ko: "태양", en: "The Sun", emoji: "☀️" },
  { ko: "심판", en: "Judgement", emoji: "🎺" }, { ko: "세계", en: "The World", emoji: "🌍" },
];
const TAROT_POSITIONS = ["과거 · 그동안의 흐름", "현재 · 지금의 상황", "미래 · 앞으로의 흐름"];

function drawTarot() {
  const idx = [...Array(TAROT_DECK.length).keys()];
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx.slice(0, 3).map((i) => ({ ...TAROT_DECK[i], reversed: Math.random() < 0.5 }));
}

function renderTarot(question, cards) {
  const q = question ? `<div class="tarot-q">🔮 “${esc(question)}”</div>` : "";
  const cardsHtml = cards.map((c, i) => `
    <div class="tarot-card${c.reversed ? " rev" : ""}">
      <div class="tarot-pos">${TAROT_POSITIONS[i]}</div>
      <div class="tarot-emoji">${c.emoji}</div>
      <div class="tarot-name">${esc(c.ko)}</div>
      <div class="tarot-orient">${c.reversed ? "역방향" : "정방향"}</div>
    </div>`).join("");
  return `${q}<div class="tarot-spread">${cardsHtml}</div>`;
}

function tarotCompact(question, cards) {
  const lines = cards.map((c, i) => `${TAROT_POSITIONS[i]}: ${c.ko}(${c.en}) ${c.reversed ? "역방향" : "정방향"}`).join("\n");
  return `# 질문\n${question || "(연애·인연 전반)"}\n\n# 뽑힌 타로 카드 (3장 스프레드)\n${lines}`;
}

/* ---------- 페르소나(시스템 프롬프트) ---------- */
const SAJU_PROMPT = `당신은 '월하(月下)'라는 이름의 따뜻한 'AI 인생 파트너'입니다.
전달받은 사주 명식(만세력 계산 결과)을 바탕으로 성향·운의 흐름·강점과 약점을 종합적으로
분석하고, '지금 더 나은 선택'을 돕는 실용적인 조언까지 건넵니다.

가장 중요한 태도:
- 사주는 '정해진 운명'이 아니라 '타고난 기질과 흐름의 참고'입니다. 운명을 단정하지 말 것.
- 결과만 나열하지 말고, 왜 그런지(일간·오행·대운 등)를 쉬운 말로 근거와 함께 설명.
- 예언보다 '그래서 지금 무엇을 하면 좋은지' 실천 가능한 조언에 무게를 둘 것.
- 건강/재물/수명에 대한 공포 조장·단정적 예언은 하지 말 것.

작성 규칙(마크다운, 아래 순서의 소제목을 사용):
  ## 한눈에 보는 나
  ## 타고난 성격·기질
  ## 재물운
  ## 직업·사업운
  ## 연애·인연
  ## 강점과 약점
  ## 삶의 큰 흐름 (대운)
  ## 지금의 실행 전략
- '지금의 실행 전략'에는 일·공부·인간관계·건강·돈 관리 중 지금 도움이 될 구체적 행동을 2~4가지 제안.
- 전문 용어는 쉬운 말로 풀고, 각 소제목은 2~4문장으로.`;

const GUNGHAP_PROMPT = `당신은 '월하(月下)'라는 이름의 따뜻한 사주 상담가입니다.
전달받은 두 사람의 사주와 '간이 궁합 점수'를 바탕으로 연인 궁합을 다정하고 담백하게 풀이합니다.

작성 규칙:
- 존댓말로, 따뜻하게. 궁합 점수는 참고일 뿐이며 단정하지 말 것.
- 어느 한쪽을 비난하거나 우열을 가리지 말 것. 관계는 서로의 노력으로 좋아질 수 있다는 태도.
- 전문 용어(일간, 일지, 합·충, 오행 등)는 쉬운 말로 풀어서 설명.
- 계산된 '관계 요인'을 근거로 삼되, 사람 사이의 이야기로 따뜻하게 옮길 것.
- 마크다운으로 작성하고, 아래 순서의 소제목을 사용:
  ## 두 사람, 한눈에
  ## 잘 맞는 점
  ## 부딪히기 쉬운 점
  ## 관계를 좋게 하는 팁
  ## 다정한 한마디
- 각 소제목은 2~4문장.`;

const JAEHOE_PROMPT = `당신은 '월하(月下)'라는 이름의 따뜻하고 사려 깊은 사주 상담가입니다.
헤어진 두 사람의 사주와 관계 흐름을 바탕으로 '재회 가능성'을 따뜻하되 현실적으로 풀이합니다.

가장 중요한 태도:
- 헛된 희망을 심거나 "반드시 재회한다"고 단정하지 말 것. 가능성은 '높다/낮다'로 못박지 말고 흐름과 조건으로 이야기.
- 상대를 조종하거나, 집착하거나, 매달리게 만드는 조언은 절대 하지 말 것.
- 상대와의 재회만큼이나 '지금의 나를 돌보는 것'이 중요하다는 메시지를 반드시 담을 것.
- 시기(재회의 때)는 세운(연운) 흐름을 '참고'로만 부드럽게 언급.

작성 규칙:
- 존댓말로, 다정하고 차분하게. 전문 용어는 쉬운 말로 풀어서 설명.
- 마크다운으로 작성하고, 아래 순서의 소제목을 사용:
  ## 지금 두 사람의 인연
  ## 재회 가능성의 흐름
  ## 다시 이어지려면
  ## 마음이 힘들 때 (조심할 점)
  ## 나를 위한 한마디
- 각 소제목은 2~4문장.`;

const DAILY_PROMPT = `당신은 '월하(月下)'라는 이름의 다정한 사주 상담가입니다.
전달받은 사주와 '오늘의 일진(그날의 기운)'을 바탕으로, 오늘 하루의 운세를 산뜻하고 가볍게 알려줍니다.

작성 규칙:
- 존댓말로, 따뜻하고 짧게. 겁주지 말 것.
- '오늘/올해 참고'에 있는 오늘 일진과 사주의 관계를 근거로, 철저히 '오늘 하루'에 집중.
- 실천 가능한 작은 조언 위주. 전문 용어는 쉽게.
- 마크다운 소제목:
  ## 오늘의 한마디
  ## 연애·인연
  ## 일·컨디션·돈
  ## 오늘의 실행 전략
- '오늘의 실행 전략'에는 오늘 하기 좋은 일 / 조심하면 좋은 것을 구체적으로 1~3가지.
- 각 소제목은 2~3문장으로 짧게.`;

const YEARLY_PROMPT = `당신은 '월하(月下)'라는 이름의 다정한 사주 상담가입니다.
전달받은 사주와 '올해 세운(연운)'을 바탕으로, 올해의 연애·인연 흐름을 중심으로 풀이합니다.

작성 규칙:
- 존댓말로, 다정하게. 올해(현재 연도)에 집중하고 연애·인연을 중심으로.
- 좋은 시기·조심할 시기를 월운 흐름을 참고로 부드럽게 제시(단정 금지).
- 전문 용어는 쉽게 풀어서.
- 마크다운 소제목:
  ## 올해의 나, 한눈에
  ## 올해의 연애·인연 흐름
  ## 좋은 시기 · 조심할 시기
  ## 올해를 잘 보내는 법
  ## 다정한 한마디
- 각 소제목은 2~4문장.`;

const TAROT_PROMPT = `당신은 '월하(月下)'라는 이름의 따뜻한 타로 리더입니다.
전달받은 질문과 뽑힌 타로 카드 3장(과거·현재·미래)을 바탕으로 다정하게 풀이합니다.

작성 규칙:
- 존댓말로, 따뜻하고 희망적이되 솔직하게. 겁주거나 단정하지 말 것.
- 각 카드의 의미(정방향/역방향)를 질문과 연결해 이야기로 풀어낼 것.
- 연애·인연 관점을 자연스럽게 곁들이되 질문에 맞게.
- 마크다운으로 작성하고, 아래 순서의 소제목을 사용:
  ## 카드가 전하는 한마디
  ## 과거 · 그동안의 흐름
  ## 현재 · 지금의 상황
  ## 미래 · 앞으로의 흐름
  ## 다정한 조언
- 각 소제목은 2~4문장.`;

const FRIEND_PROMPT = `당신은 '월하(月下)'라는 이름의 따뜻한 사주 상담가입니다.
전달받은 두 사람의 사주와 관계 계산 결과를 바탕으로 '두 사람의 우정 궁합'을 풀이합니다.

작성 규칙:
- 존댓말로, 따뜻하게. 점수는 참고일 뿐 단정하지 말 것. 연애가 아니라 '친구·동료 관계' 관점.
- 전문 용어는 쉬운 말로 풀 것. 계산된 관계 요인을 근거로 삼되 사람 이야기로 옮길 것.
- 마크다운 소제목:
  ## 두 사람, 한눈에
  ## 잘 통하는 점
  ## 부딪히기 쉬운 점
  ## 오래 좋은 친구가 되려면
  ## 다정한 한마디
- 각 소제목은 2~4문장.`;

const FAMILY_PROMPT = `당신은 '월하(月下)'라는 이름의 따뜻한 사주 상담가입니다.
전달받은 두 사람의 사주와 관계 계산 결과를 바탕으로 '가족(부모·자녀·형제 등) 인연 궁합'을 풀이합니다.

작성 규칙:
- 존댓말로, 따뜻하게. 점수는 참고일 뿐 단정하지 말 것. '가족·혈연 관계'로서의 조화 관점.
- 전문 용어는 쉬운 말로 풀 것. 계산된 관계 요인을 근거로 삼되 사람 이야기로 옮길 것.
- 마크다운 소제목:
  ## 두 사람, 한눈에
  ## 잘 맞는 점
  ## 서로 이해가 필요한 점
  ## 관계를 따뜻하게 하는 법
  ## 다정한 한마디
- 각 소제목은 2~4문장.`;

const CONSULT_PROMPT = `당신은 '월하(月下)'라는 이름의 따뜻한 'AI 인생 파트너' 상담가입니다.
전달받은 한 사람의 사주 명식과 '상담 질문'을 바탕으로, 그 사람의 고민에 맞춤 조언을 드립니다.

작성 규칙:
- 존댓말로, 다정하고 현실적으로. 사주는 '정해진 운명'이 아니라 참고이며, 운명을 단정하지 말 것.
- 질문(연애·직업·재물·인간관계·선택 등 무엇이든)에 사주의 기질·흐름을 근거로 삼아 답할 것.
- 예언보다 '그래서 지금 무엇을 하면 좋은지' 실천 가능한 조언을 반드시 포함.
- 마크다운 소제목:
  ## 질문에 대한 답
  ## 사주로 본 이유
  ## 지금의 실행 전략
  ## 다정한 한마디
- 각 소제목은 2~4문장.`;

const MONTHLY_PROMPT = `당신은 '월하(月下)'라는 이름의 따뜻한 'AI 인생 파트너'입니다.
전달받은 사주와 '이번 달(현재 연·월) 만세력', 그리고 회원이 설정한 '나의 목표'가 있다면 그것을 바탕으로, 이번 한 달의 실행 리포트를 작성합니다.

작성 규칙:
- 존댓말로, 다정하되 현실적으로. 이번 '한 달'에 철저히 집중(연간·평생 아님).
- '오늘/올해 참고'의 올해 세운·이번달 정보를 근거로 이번 달의 기운과 흐름을 짚을 것.
- '나의 목표'가 주어지면, 그 목표를 이번 달에 어떻게 진전시킬지 구체적으로 연결할 것. 목표가 없으면 그 소제목은 일반적인 이번 달 실행 조언으로 대체.
- 예언보다 '이번 달에 무엇을 하면 좋은지' 실천 가능한 행동 위주. 전문 용어는 쉽게.
- 마크다운 소제목:
  ## 이번 달, 한눈에
  ## 이번 달의 기회
  ## 이번 달 조심할 점
  ## 나의 목표를 위한 이번 달 실행 전략
  ## 다정한 한마디
- 각 소제목은 2~4문장. '실행 전략'에는 이번 달에 바로 할 수 있는 행동을 1~3가지 구체적으로.`;

const ANNUAL_PROMPT = `당신은 '월하(月下)'라는 이름의 따뜻한 'AI 인생 파트너'입니다.
전달받은 사주와 '올해(현재 연도) 세운', 그리고 회원이 설정한 '나의 목표'가 있다면 그것을 바탕으로, 올해 1년의 종합 리포트를 작성합니다.

작성 규칙:
- 존댓말로, 다정하되 현실적으로. 연애뿐 아니라 재물·직업·건강·관계까지 '올해 한 해'를 종합적으로.
- '오늘/올해 참고'의 올해 세운을 근거로 올해의 큰 흐름과 분기별(상·하반기) 리듬을 짚을 것.
- '나의 목표'가 주어지면 올해 그 목표를 어떻게 이룰지 구체적으로 연결. 없으면 일반 조언으로 대체.
- 예언보다 '올해 무엇을 하면 좋은지' 실천 가능한 전략 위주. 전문 용어는 쉽게. 단정 금지.
- 마크다운 소제목:
  ## 올해의 나, 한눈에
  ## 재물·일·직업운
  ## 연애·인간관계
  ## 건강·리듬
  ## 상반기 · 하반기 흐름
  ## 나의 목표를 위한 올해 전략
  ## 다정한 한마디
- 각 소제목은 2~4문장. '올해 전략'에는 올해 안에 실천할 행동을 2~4가지 구체적으로.`;

const PROMPTS = { saju: SAJU_PROMPT, gunghap: GUNGHAP_PROMPT, jaehoe: JAEHOE_PROMPT, daily: DAILY_PROMPT, yearly: YEARLY_PROMPT, tarot: TAROT_PROMPT, friend: FRIEND_PROMPT, family: FAMILY_PROMPT, consult: CONSULT_PROMPT, monthly: MONTHLY_PROMPT, annual: ANNUAL_PROMPT };
const USER_INTRO = {
  annual: "아래는 한 사람의 사주와 올해(현재 연도) 세운, 그리고 (있다면) 회원의 목표입니다. 규칙에 맞게 올해 종합 리포트를 작성해 주세요.",
  monthly: "아래는 한 사람의 사주와 이번 달(현재 연·월) 만세력, 그리고 (있다면) 회원의 목표입니다. 규칙에 맞게 이번 달 실행 리포트를 작성해 주세요.",
  saju: "아래는 한 사람의 사주 명식(만세력 계산 결과)입니다. 규칙에 맞게 풀이해 주세요.",
  gunghap: "아래는 두 사람의 사주와 간이 궁합 계산 결과입니다. 규칙에 맞게 두 사람의 연인 궁합을 풀이해 주세요.",
  jaehoe: "아래는 헤어진 두 사람(사람A의 관점)의 사주와 관계 계산 결과입니다. 규칙에 맞게 재회 가능성을 풀이해 주세요.",
  daily: "아래는 한 사람의 사주와 오늘 날짜의 만세력 정보입니다. 규칙에 맞게 오늘의 운세를 풀이해 주세요.",
  yearly: "아래는 한 사람의 사주와 올해 세운 정보입니다. 규칙에 맞게 올해의 연애운과 흐름을 풀이해 주세요.",
  tarot: "아래는 질문과 뽑힌 타로 카드 3장입니다. 규칙에 맞게 타로 풀이를 해 주세요.",
  friend: "아래는 두 사람의 사주와 간이 궁합 계산 결과입니다. 규칙에 맞게 두 사람의 우정 궁합을 풀이해 주세요.",
  family: "아래는 두 사람의 사주와 간이 궁합 계산 결과입니다. 규칙에 맞게 두 사람의 가족 인연 궁합을 풀이해 주세요.",
  consult: "아래는 한 사람의 사주와 상담 질문입니다. 규칙에 맞게 맞춤 상담을 해 주세요.",
};

/* ---------- 1) 사주 계산 (1인) ---------- */
app.post("/api/saju", (req, res) => {
  try {
    const input = normalizeInput(req.body);
    if (!input.year || !input.month || !input.day) {
      return res.status(400).json({ error: "생년월일(년/월/일)은 반드시 입력해야 합니다." });
    }
    const result = runSaju(input);
    // 오늘의 운세·올해운을 위해 오늘/올해 만세력 정보를 압축본에 덧붙임
    const ref = result.reference || {};
    const codes = ref.codes || {};
    const todayInfo = `\n\n# 오늘/올해 참고\n지금: ${ref.now || "-"}\n오늘 일진: ${codes.today || "-"} / 내일: ${codes.tomorrow || "-"}\n올해: ${codes.thisYear || "-"} / 이번달: ${codes.thisMonth || "-"}`;
    res.json({ chartHtml: renderChart(result, input), compact: result.toCompact() + todayInfo });
  } catch (err) {
    console.error("[saju] 계산 오류:", err);
    res.status(500).json({ error: "사주 계산 중 문제가 생겼습니다. 입력값을 확인해 주세요." });
  }
});

/* ---------- 1-b) 월간 리포트 (1인 + 이번 달 + 나의 목표) ---------- */
app.post("/api/monthly", async (req, res) => {
  try {
    const input = normalizeInput(req.body);
    if (!input.year || !input.month || !input.day) {
      return res.status(400).json({ error: "생년월일(년/월/일)은 반드시 입력해야 합니다." });
    }
    const result = runSaju(input);
    const ref = result.reference || {};
    const codes = ref.codes || {};
    const now = new Date();
    const ym = `${now.getFullYear()}년 ${now.getMonth() + 1}월`;
    let monthInfo = `\n\n# 이번 달 참고\n이번 달: ${ym}\n지금: ${ref.now || "-"}\n올해 세운: ${codes.thisYear || "-"} / 이번달: ${codes.thisMonth || "-"}`;

    // 로그인 회원이면 저장된 목표를 함께 전달
    const uid = getUserId(req);
    if (uid && pool) {
      try {
        const g = await pool.query("SELECT goal, goal_category FROM users WHERE id = $1", [uid]);
        const goal = g.rows[0]?.goal;
        const cat = g.rows[0]?.goal_category;
        if (goal) monthInfo += `\n\n# 나의 목표\n${cat ? "[" + cat + "] " : ""}${goal}`;
      } catch {}
    }

    const banner = `<div class="month-banner">📅 <b>${esc(ym)}</b> 이번 달 리포트</div>`;
    res.json({ chartHtml: banner + renderChart(result, input), compact: result.toCompact() + monthInfo });
  } catch (err) {
    console.error("[monthly] 계산 오류:", err);
    res.status(500).json({ error: "월간 리포트 준비 중 문제가 생겼습니다. 입력값을 확인해 주세요." });
  }
});

/* ---------- 1-d) 연간 종합 리포트 (1인 + 올해 세운 + 나의 목표) ---------- */
app.post("/api/annual", async (req, res) => {
  try {
    const input = normalizeInput(req.body);
    if (!input.year || !input.month || !input.day) {
      return res.status(400).json({ error: "생년월일(년/월/일)은 반드시 입력해야 합니다." });
    }
    const result = runSaju(input);
    const ref = result.reference || {};
    const codes = ref.codes || {};
    const yr = new Date().getFullYear();
    let info = `\n\n# 올해 참고\n올해: ${yr}년\n지금: ${ref.now || "-"}\n올해 세운: ${codes.thisYear || "-"} / 내년: ${codes.nextYear || "-"}`;
    const uid = getUserId(req);
    if (uid && pool) {
      try {
        const g = await pool.query("SELECT goal, goal_category FROM users WHERE id = $1", [uid]);
        const goal = g.rows[0]?.goal, cat = g.rows[0]?.goal_category;
        if (goal) info += `\n\n# 나의 목표\n${cat ? "[" + cat + "] " : ""}${goal}`;
      } catch {}
    }
    const banner = `<div class="month-banner">📊 <b>${yr}년</b> 올해 종합 리포트</div>`;
    res.json({ chartHtml: banner + renderChart(result, input), compact: result.toCompact() + info });
  } catch (err) {
    console.error("[annual] 계산 오류:", err);
    res.status(500).json({ error: "연간 리포트 준비 중 문제가 생겼습니다. 입력값을 확인해 주세요." });
  }
});

/* ---------- 1-c) 운세 흐름 추적 (앞으로 28일 일진 기운 그래프 · AI 없음/무료) ---------- */
app.post("/api/fortune-trend", (req, res) => {
  try {
    const input = normalizeInput(req.body);
    if (!input.year || !input.month || !input.day) {
      return res.status(400).json({ error: "생년월일(년/월/일)은 반드시 입력해야 합니다." });
    }
    const result = runSaju(input);
    const userEl = result.pillarDetails?.day?.element?.stem; // 나의 일간 오행(목화토금수)
    const todayGz = (result.reference?.codes?.today || "").trim();
    if (!userEl || todayGz.length < 2) return res.status(500).json({ error: "운세 계산에 필요한 정보를 얻지 못했어요." });
    const si = STEMS_SEQ.indexOf(todayGz[0]);
    const bi = BRANCHES_SEQ.indexOf(todayGz[1]);

    const WD = ["일", "월", "화", "수", "목", "금", "토"];
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    const ty = kst.getUTCFullYear(), tm = kst.getUTCMonth(), tdd = kst.getUTCDate();

    const COUNT = 28;
    const days = [];
    for (let k = 0; k < COUNT; k++) {
      const stem = STEMS_SEQ[mod(si + k, 10)];
      const branch = BRANCHES_SEQ[mod(bi + k, 12)];
      const score = Math.round(0.7 * relScore(userEl, STEM_EL[stem]) + 0.3 * relScore(userEl, BRANCH_EL[branch]));
      const dt = new Date(Date.UTC(ty, tm, tdd + k));
      const wd = dt.getUTCDay();
      days.push({
        label: `${dt.getUTCMonth() + 1}.${dt.getUTCDate()}`,
        wd: WD[wd], weekend: wd === 0 || wd === 6,
        score, isToday: k === 0,
      });
    }

    const tier = (s) => (s >= 80 ? "hi" : s >= 66 ? "mid" : s >= 52 ? "lo" : "dn");
    const h = (s) => Math.max(18, Math.min(100, Math.round((s - 35) * 1.7)));
    const bars = days.map((d) =>
      `<div class="trend-col${d.isToday ? " today" : ""}">
        <div class="trend-bar ${tier(d.score)}" style="height:${h(d.score)}%"><span class="trend-score">${d.score}</span></div>
        <div class="trend-day">${d.isToday ? "오늘" : d.label}</div>
        <div class="trend-wd${d.weekend ? " we" : ""}">${d.wd}</div>
      </div>`
    ).join("");

    const sorted = [...days].map((d, i) => ({ ...d, i }));
    const best = [...sorted].sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 3);
    const caution = [...sorted].sort((a, b) => a.score - b.score || a.i - b.i).slice(0, 2);
    const fmt = (d) => `${d.isToday ? "오늘" : d.label}(${d.wd})`;
    const goodTxt = best.map((d) => `<b>${fmt(d)}</b>`).join(" · ");
    const cautTxt = caution.map((d) => `<b>${fmt(d)}</b>`).join(" · ");

    const graphHtml = `<div class="trend-wrap">
      <div class="trend-legend">📈 앞으로 4주, 나의 기운 흐름 <small>(그날 일진과 내 사주의 관계 · 참고용)</small></div>
      <div class="trend-bars">${bars}</div>
      <div class="trend-summary">
        <div class="ts-good">🌟 <span>기운 좋은 날</span> ${goodTxt}</div>
        <div class="ts-caution">🌫️ <span>차분히 갈 날</span> ${cautTxt}</div>
      </div>
      <div class="trend-note">숫자는 그날의 <b>일진(日辰)</b>과 내 <b>일간(${esc(userEl)})</b>의 오행 관계로 낸 참고 지수예요. 낮은 날이 '나쁜 날'이 아니라 <b>무리하지 말고 정비할 날</b>이에요. 🌙</div>
    </div>`;
    res.json({ graphHtml });
  } catch (err) {
    console.error("[trend] 오류:", err);
    res.status(500).json({ error: "운세 흐름을 계산하는 중 문제가 생겼습니다." });
  }
});

/* ---------- 2) 궁합 / 재회 (2인) ---------- */
app.post("/api/compat", (req, res) => {
  try {
    const mode = ["jaehoe", "gunghap", "friend", "family"].includes(req.body?.mode) ? req.body.mode : "gunghap";
    const mA = normalizeInput(req.body?.personA);
    const mB = normalizeInput(req.body?.personB);
    if (!mA.year || !mA.month || !mA.day || !mB.year || !mB.month || !mB.day) {
      return res.status(400).json({ error: "두 사람의 생년월일을 모두 입력해 주세요." });
    }
    const rA = runSaju(mA);
    const rB = runSaju(mB);
    const rel = computeRelationship(rA, rB, mA, mB, mode);
    const years = mode === "jaehoe" ? favorableYears(rA, mA) : null;
    res.json({
      chartHtml: renderCompat(rA, rB, rel, mA, mB, mode, years),
      compact: compatCompact(rA, rB, rel, mA, mB, mode, years),
      score: rel.score,
    });
  } catch (err) {
    console.error("[compat] 계산 오류:", err);
    res.status(500).json({ error: "궁합 계산 중 문제가 생겼습니다. 입력값을 확인해 주세요." });
  }
});

/* ---------- 구독(라이선스) 검증 ---------- */
const licCache = new Map(); // key -> { valid, status, exp }

async function validateLicense(key) {
  if (!key || typeof key !== "string" || key.length < 6 || key.length > 200) return { valid: false };
  if (OWNER_KEY && key.trim().toLowerCase() === OWNER_KEY.toLowerCase()) return { valid: true, status: "owner" }; // 주인 키 — 결제 없이 통과 (대소문자 무시)
  if (SUBSCRIBER_CODE && key.trim().toLowerCase() === SUBSCRIBER_CODE.toLowerCase()) return { valid: true, status: "subscriber" }; // 구독자 공용 코드
  if (!GUMROAD_PRODUCT_ID) return { valid: false }; // 상품 ID 미설정 시 검증 불가
  try {
    // Gumroad 라이선스 검증 (액세스 토큰 불필요 · 공개 엔드포인트)
    const resp = await fetch("https://api.gumroad.com/v2/licenses/verify", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ product_id: GUMROAD_PRODUCT_ID, license_key: key.trim(), increment_uses_count: "false" }),
    });
    const data = await resp.json();
    const p = data?.purchase || {};
    // 유효 조건: 검증 성공 + 환불 안 됨 + 구독 종료/실패 안 됨 (해지 후 잔여기간은 유지)
    const active = !!data.success && !p.refunded && !p.disputed && !p.subscription_ended_at && !p.subscription_failed_at;
    const status = !data.success ? "invalid" : p.subscription_ended_at ? "ended" : p.subscription_cancelled_at ? "cancelling" : "active";
    return { valid: active, status };
  } catch (e) {
    console.error("[license] 검증 오류:", e.message);
    return { valid: false, error: true };
  }
}

async function validateLicenseCached(key) {
  const now = Date.now();
  const c = licCache.get(key);
  if (c && c.exp > now) return c;
  const r = await validateLicense(key);
  if (!r.error) licCache.set(key, { ...r, exp: now + 5 * 60 * 1000 }); // 5분 캐시
  return r;
}

// 풀이 생성: API 키가 있으면 Messages API(빠름·과금), 없으면 구독(Agent SDK)
async function generateReading(systemPrompt, userPrompt) {
  if (USE_API_KEY) {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000, // 종합 사주(8개 섹션) 등 긴 풀이가 잘리지 않도록
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    return msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  }
  let text = "";
  for await (const message of query({
    prompt: userPrompt,
    options: { systemPrompt, model: MODEL, allowedTools: [], maxTurns: 1 },
  })) {
    if (message.type === "result" && typeof message.result === "string") text = message.result;
  }
  return text;
}

/* ---------- 앱 설정 / 구독 확인 ---------- */
app.get("/api/config", (req, res) => {
  stats.visits++;
  res.json({ paywall: PAYWALL_ON, checkoutUrl: CHECKOUT_URL, freeTrial: FREE_TRIAL_COUNT });
});

app.post("/api/license/validate", async (req, res) => {
  const r = await validateLicense(req.body?.key);
  res.json({ valid: r.valid, status: r.status || null });
});

// 운영자 전용 방문 통계 (주인 키로 접근)
app.get("/api/stats", (req, res) => {
  if (!OWNER_KEY || req.query.key !== OWNER_KEY) return res.status(403).json({ error: "권한 없음" });
  const totalReadings = Object.values(stats.readings).reduce((a, b) => a + b, 0);
  res.json({ ...stats, totalReadings, freeTrialIPs: freeTrialUsed.size });
});

/* ---------- 로그인(카카오) · 세션 · 마이페이지 ---------- */
// 로그인 시작 → 카카오 동의 화면으로
app.get("/auth/kakao", (req, res) => {
  if (!AUTH_ON) return res.status(503).send("로그인은 준비 중이에요. 잠시만 기다려 주세요.");
  const redirectUri = `${BASE_URL}/auth/kakao/callback`;
  const url =
    `https://kauth.kakao.com/oauth/authorize?response_type=code` +
    `&client_id=${encodeURIComponent(KAKAO_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.redirect(url);
});

// 카카오 콜백 → 토큰 교환 → 프로필 조회 → 회원 upsert → 세션 발급
app.get("/auth/kakao/callback", async (req, res) => {
  if (!AUTH_ON || !pool) return res.redirect("/?login=off");
  try {
    const code = req.query.code;
    if (!code) return res.redirect("/?login=fail");
    const redirectUri = `${BASE_URL}/auth/kakao/callback`;
    const tokResp = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: KAKAO_CLIENT_ID,
        client_secret: KAKAO_CLIENT_SECRET,
        redirect_uri: redirectUri,
        code,
      }),
    });
    const tok = await tokResp.json();
    if (!tok.access_token) throw new Error("토큰 교환 실패: " + JSON.stringify(tok));
    const meResp = await fetch("https://kapi.kakao.com/v2/user/me", {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const me = await meResp.json();
    const kakaoId = String(me.id);
    const nickname = me.kakao_account?.profile?.nickname || me.properties?.nickname || "회원";
    const r = await pool.query(
      `INSERT INTO users (kakao_id, nickname) VALUES ($1, $2)
       ON CONFLICT (kakao_id) DO UPDATE SET nickname = EXCLUDED.nickname
       RETURNING id`,
      [kakaoId, nickname]
    );
    setSession(res, r.rows[0].id);
    res.redirect("/?login=1");
  } catch (e) {
    console.error("[kakao] 로그인 오류:", e.message);
    res.redirect("/?login=fail");
  }
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("wolha_session");
  res.json({ ok: true });
});

// 현재 로그인 상태
app.get("/api/me", async (req, res) => {
  if (!AUTH_ON || !pool) return res.json({ authOn: false, user: null });
  const uid = getUserId(req);
  if (!uid) return res.json({ authOn: true, user: null });
  try {
    const r = await pool.query("SELECT id, nickname FROM users WHERE id = $1", [uid]);
    res.json({ authOn: true, user: r.rows[0] || null });
  } catch {
    res.json({ authOn: true, user: null });
  }
});

// 나의 목표 조회 / 저장 (성장 파트너)
app.get("/api/goal", async (req, res) => {
  const uid = getUserId(req);
  if (!uid || !pool) return res.json({ goal: "", category: "" });
  try {
    const r = await pool.query("SELECT goal, goal_category FROM users WHERE id = $1", [uid]);
    res.json({ goal: r.rows[0]?.goal || "", category: r.rows[0]?.goal_category || "" });
  } catch {
    res.json({ goal: "", category: "" });
  }
});
app.post("/api/goal", async (req, res) => {
  const uid = getUserId(req);
  if (!uid || !pool) return res.status(401).json({ error: "로그인이 필요해요." });
  const goal = (req.body?.goal || "").toString().slice(0, 200);
  const category = (req.body?.category || "").toString().slice(0, 40);
  try {
    await pool.query("UPDATE users SET goal = $1, goal_category = $2 WHERE id = $3", [goal, category, uid]);
    res.json({ ok: true, goal, category });
  } catch (e) {
    console.error("[goal] 저장 실패:", e.message);
    res.status(500).json({ error: "저장 중 문제가 생겼어요." });
  }
});

// 후기: 게시된 목록 (홈에 노출 · 공개)
app.get("/api/reviews", async (req, res) => {
  if (!pool) return res.json({ reviews: [] });
  try {
    const r = await pool.query("SELECT id, nickname, rating, text, created_at FROM reviews ORDER BY created_at DESC LIMIT 30");
    res.json({ reviews: r.rows });
  } catch {
    res.json({ reviews: [] });
  }
});
// 내 후기 (수정용 프리필)
app.get("/api/my-review", async (req, res) => {
  const uid = getUserId(req);
  if (!uid || !pool) return res.json({ review: null });
  try {
    const r = await pool.query("SELECT rating, text FROM reviews WHERE user_id = $1", [uid]);
    res.json({ review: r.rows[0] || null });
  } catch {
    res.json({ review: null });
  }
});
// 후기 작성/수정 (회원 1인 1건)
app.post("/api/reviews", async (req, res) => {
  const uid = getUserId(req);
  if (!uid || !pool) return res.status(401).json({ error: "로그인이 필요해요." });
  const rating = Math.max(1, Math.min(5, parseInt(req.body?.rating, 10) || 0));
  const text = (req.body?.text || "").toString().trim().slice(0, 300);
  if (!rating || !text) return res.status(400).json({ error: "별점과 후기 내용을 입력해 주세요." });
  try {
    const u = await pool.query("SELECT nickname FROM users WHERE id = $1", [uid]);
    const nickname = u.rows[0]?.nickname || "회원";
    await pool.query(
      `INSERT INTO reviews (user_id, nickname, rating, text) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET nickname = EXCLUDED.nickname, rating = EXCLUDED.rating, text = EXCLUDED.text, created_at = now()`,
      [uid, nickname, rating, text]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[review] 저장 실패:", e.message);
    res.status(500).json({ error: "후기 저장 중 문제가 생겼어요." });
  }
});
// 후기 삭제 (운영자 전용 · 부적절 후기 관리)
app.delete("/api/reviews/:id", async (req, res) => {
  if (!OWNER_KEY || req.query.key !== OWNER_KEY) return res.status(403).json({ error: "권한 없음" });
  if (!pool) return res.status(503).json({ error: "DB 없음" });
  try {
    await pool.query("DELETE FROM reviews WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "삭제 실패" });
  }
});

// 내 기록 목록
app.get("/api/history", async (req, res) => {
  const uid = getUserId(req);
  if (!uid || !pool) return res.json({ readings: [] });
  try {
    const r = await pool.query(
      "SELECT id, service, title, created_at FROM readings WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100",
      [uid]
    );
    res.json({ readings: r.rows });
  } catch {
    res.json({ readings: [] });
  }
});

// 기록 상세
app.get("/api/history/:id", async (req, res) => {
  const uid = getUserId(req);
  if (!uid || !pool) return res.status(404).json({ error: "없음" });
  try {
    const r = await pool.query(
      "SELECT service, title, markdown, created_at FROM readings WHERE id = $1 AND user_id = $2",
      [req.params.id, uid]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "없음" });
    const row = r.rows[0];
    res.json({ ...row, html: marked.parse(row.markdown || "") });
  } catch {
    res.status(404).json({ error: "없음" });
  }
});

/* ---------- 타로: 카드 뽑기 ---------- */
app.post("/api/tarot", (req, res) => {
  try {
    const question = (req.body?.question || "").slice(0, 120);
    const cards = drawTarot();
    res.json({ chartHtml: renderTarot(question, cards), compact: tarotCompact(question, cards) });
  } catch (err) {
    console.error("[tarot] 오류:", err);
    res.status(500).json({ error: "카드를 뽑는 중 문제가 생겼습니다." });
  }
});

/* ---------- AI 상담: 생년월일 + 질문 ---------- */
app.post("/api/consult", (req, res) => {
  try {
    const input = normalizeInput(req.body);
    const question = (req.body?.question || "").slice(0, 200);
    if (!input.year || !input.month || !input.day) return res.status(400).json({ error: "생년월일을 입력해 주세요." });
    if (!question) return res.status(400).json({ error: "상담할 질문을 입력해 주세요." });
    const result = runSaju(input);
    const chartHtml = `<div class="consult-q">💬 “${esc(question)}”</div>` + renderChart(result, input);
    const compact = `# 상담 질문\n${question}\n\n# 사주\n${result.toCompact()}`;
    res.json({ chartHtml, compact });
  } catch (err) {
    console.error("[consult] 오류:", err);
    res.status(500).json({ error: "상담 준비 중 문제가 생겼습니다. 입력값을 확인해 주세요." });
  }
});

/* ---------- 3) AI 풀이 (서비스별 프롬프트 · 요청 제한 · 구독 게이트) ---------- */
app.post("/api/interpret", interpretLimiter, async (req, res) => {
  try {
    const service = PROMPTS[req.body?.service] ? req.body.service : "saju";

    // 구독 잠금: 유효 라이선스/주인 키가 있거나, 무료 체험(IP당 1회)이 남았으면 통과
    if (PAYWALL_ON) {
      const key = req.body?.license || req.get("x-license-key");
      const lic = await validateLicenseCached(key);
      if (lic.valid) {
        stats.subscribersUnlocked++;
      } else {
        const ip = req.ip || "unknown";
        const used = freeTrialUsed.get(ip) || 0;
        if (used >= FREE_TRIAL_COUNT) {
          return res.status(402).json({ error: "구독이 필요해요.", needSubscription: true, trialExhausted: true });
        }
        freeTrialUsed.set(ip, used + 1); // 무료 체험 1회 소진
      }
    }

    const { compact } = req.body;
    if (!compact || typeof compact !== "string") return res.status(400).json({ error: "풀이할 데이터가 없습니다." });
    if (compact.length > 6000) return res.status(400).json({ error: "요청 데이터가 너무 큽니다." });

    const userPrompt = `${USER_INTRO[service]}\n\n${compact}`;
    const text = await generateReading(PROMPTS[service], userPrompt);

    if (!text) return res.status(502).json({ error: "AI 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요." });
    stats.readings[service] = (stats.readings[service] || 0) + 1; // 서비스별 통계

    // 로그인한 회원이면 기록 저장 (실패해도 응답에는 영향 없음)
    const uid = getUserId(req);
    if (uid && pool) {
      const title = (typeof req.body?.title === "string" && req.body.title.trim())
        ? req.body.title.trim().slice(0, 80)
        : (SERVICE_LABEL[service] || service);
      pool
        .query("INSERT INTO readings (user_id, service, title, markdown) VALUES ($1, $2, $3, $4)", [uid, service, title, text])
        .catch((e) => console.error("[save] 기록 저장 실패:", e.message));
    }

    res.json({ html: marked.parse(text), markdown: text });
  } catch (err) {
    console.error("[interpret] 풀이 오류:", err);
    const hint = (USE_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN)
      ? "AI 호출 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요."
      : "AI 인증이 안 됐어요. (로컬은 `claude auth login`, 공개 배포는 ANTHROPIC_API_KEY 필요)";
    res.status(500).json({ error: hint });
  }
});

app.listen(PORT, () => {
  console.log(`\n🌙 월하 — 연애·인연 사주가 http://localhost:${PORT} 에서 준비됐어요.`);
  if (USE_API_KEY) {
    console.log(`🔑 API 키 모드 (공개 배포용 · 사용한 만큼 과금) · 모델 ${MODEL} · 시간당 IP 제한 ${process.env.RATE_LIMIT_PER_HOUR || 20}회`);
  } else {
    console.log("🙂 구독 로그인 모드 (로컬 무료). 공개 배포 시 ANTHROPIC_API_KEY 를 설정하면 자동으로 API 모드로 바뀝니다.");
  }
});
