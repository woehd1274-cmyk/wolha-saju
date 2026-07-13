# 🌙 월하(月下) — 연애·인연 전문 사주 앱

생년월일시를 입력하면 **만세력 라이브러리(ssaju)**로 사주팔자를 계산하고,
**Claude**가 다정하게 풀이해 주는 개인용 웹앱입니다. 이름 '월하'는 인연을 붉은 실로 묶는 월하노인(月下老人)에서 따왔어요.

**서비스 3가지**
- 🔮 **사주 풀이** — 한 사람의 타고난 기질과 삶의 흐름
- 💞 **연인 궁합** — 두 사람의 사주로 인연 지수(점수)와 관계 기질
- 🕯️ **재회 가능성** — 헤어진 두 사람의 사주·흐름을 따뜻하되 현실적으로

- 내 컴퓨터에서만 도는 로컬 앱 (회원가입·결제 없음)
- AI 풀이는 **Claude 구독(정액제)**으로 호출 — 쓴 만큼 돈 나가는 API 요금이 아님
- 궁합 점수는 일간 합/극·**일지·월지·시지** 합·충·형·해·오행 보완·**배우자 인연(십성)**을 코드로 계산한 **참고 지표**(전통 이론 단순화)
- 재회 모드는 질문자 사주 기준 **유리한 시기(세운)**를 함께 표시

---

## 준비물

- **Node.js 18 이상**
- **Claude 구독**(Pro / Max 등) 계정
- Claude Code CLI (구독 토큰 발급용) — 없으면 아래에서 설치

## 1. 패키지 설치

```powershell
npm install
```

## 2. 구독 토큰 발급 (AI 풀이용 열쇠)

AI 풀이는 내 구독 계정으로 호출하기 위해 **OAuth 토큰**(구독을 증명하는 긴 열쇠)이 필요합니다.
터미널에서 아래를 실행하면 브라우저 로그인 후 토큰이 출력됩니다.

```powershell
claude setup-token
```

> Claude Code CLI가 없다면 먼저 설치: `npm install -g @anthropic-ai/claude-code`

출력된 토큰을 환경변수로 설정합니다. (이 창에서만 유효)

```powershell
$env:CLAUDE_CODE_OAUTH_TOKEN = "발급받은-토큰-붙여넣기"
```

> 토큰은 **1년간 유효**하며 내 구독으로 인증됩니다.
> 참고: 구독 토큰은 개인/내부용입니다. 자동화로 과도하게 호출하면 사용량 제한에 걸릴 수 있어요.

## 3. 실행

```powershell
npm start
```

브라우저에서 **http://localhost:3000** 접속 → 생년월일시 입력 → 사주 명식과 풀이 확인.

---

## 살짝 뜯어보기

| 파일 | 역할 |
|------|------|
| `server.js` | Node 서버. `ssaju`로 사주 계산, 궁합 엔진(`computeRelationship`), Claude 풀이 |
| `public/index.html` | 홈 메뉴 + 서비스별 뷰(결과 화면 골격) |
| `public/app.js` | 폼 동적 생성·뷰 전환·서버 호출·화면 표시 |
| `public/style.css` | 디자인(다크+골드, 오행 색상, 인연 지수 게이지) |

### 흐름
```
사주 풀이(1인) : 브라우저 → /api/saju   → ssaju 명식 계산 → 표로 표시
궁합/재회(2인) : 브라우저 → /api/compat → 두 사주 + 궁합 점수 계산 → 게이지·요인·명식
공통           : → /api/interpret {service} → Claude가 풀이(사주/궁합/재회 프롬프트) → 글로 표시
```

### 바꿔볼 만한 것
- **풀이 모델**: 환경변수 `SAJU_MODEL`로 교체 (기본 `claude-sonnet-5`, 더 깊게 원하면 `claude-opus-4-8`)
  ```powershell
  $env:SAJU_MODEL = "claude-opus-4-8"
  ```
- **풀이 말투/구성**: `server.js`의 `SAJU_PROMPT` · `GUNGHAP_PROMPT` · `JAEHOE_PROMPT` 수정
- **궁합 점수 가중치**: `server.js`의 `computeRelationship` 안 점수 규칙
- **포트**: 환경변수 `PORT`

---

## 인터넷에 공개 배포하기 (누구나 접속)

로컬은 내 구독으로 무료지만, **공개 서비스는 API 키(사용한 만큼 과금)**를 써야 합니다.

1. **API 키 발급**: [console.anthropic.com](https://console.anthropic.com) → 결제수단 등록 → **월 사용 한도(Spend limit) 설정** → API 키 생성
2. **환경변수 설정**: 배포하는 호스팅의 환경변수에 `ANTHROPIC_API_KEY=sk-ant-api03-...` 를 넣으면 자동으로 API 모드로 전환됩니다.
3. **악용 방지**: 기본으로 IP당 시간당 20회 제한이 걸려 있어요. `RATE_LIMIT_PER_HOUR` 로 조절 가능.
4. **호스팅**: Node 서버라 정적 호스팅은 안 되고 Node 호스팅이 필요해요 (예: Render, Railway). `PORT` 환경변수를 자동으로 인식합니다.
   - 시작 명령: `npm start` / 빌드 명령: `npm install`

> AI 인증은 **자동 판별**: `ANTHROPIC_API_KEY`가 있으면 API 모드(공개), 없으면 `claude auth login` 구독 모드(로컬).

## 주의

사주는 정해진 운명이 아니라 타고난 기질과 흐름을 참고하는 재미로 봐 주세요.
만세력 계산은 라이브러리(ssaju, 한국천문연구원 데이터 기반)에 의존하며,
경계 날짜·시주 등에서 다른 만세력과 값이 다를 수 있습니다.
