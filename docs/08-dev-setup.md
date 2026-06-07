# 개발 환경

Last updated: 2026-05-29

## 1. 기본 경로

프로젝트 경로:

```text
local-company-v2/
```

기본 데이터 경로:

```text
data/
```

데모 데이터 경로:

```text
data-sample/
```

## 2. 권장 런타임

| 항목 | 권장 |
| --- | --- |
| Node.js | 24 이상 |
| 패키지 매니저 | npm |
| 언어 | TypeScript |
| DB | SQLite, Node.js 내장 `node:sqlite` |
| UI | React |
| 기본 AI 실행 | `CODEX_RUNNER=mock` |
| 실제 AI 실행 | `CODEX_RUNNER=codex-cli`로 Codex CLI 연결 |

## 3. 환경변수

`.env.example`의 기본값:

```text
PORT=8788
DATA_DIR=./data
CODEX_PM_MODEL=gpt-5.5
CODEX_WORKER_MODEL=gpt-5.5
CODEX_SCRIBE_MODEL=gpt-5.5
CODEX_TIMEOUT_MS=600000
CODEX_EXEC_ARGS=
```

실제 비밀값은 `.env.example`에 넣지 않는다. 개인 환경에서만 `.env`를 만들고, `.env`는 git에서 제외한다.

## 4. 실행

```bash
npm install
npm run dev
```

기본 주소:

```text
http://127.0.0.1:8788
```

## 5. 데모 데이터

```bash
npm run seed:demo
```

PowerShell:

```powershell
$env:DATA_DIR = ".\data-sample"
npm run dev
```

macOS/Linux:

```bash
DATA_DIR=./data-sample npm run dev
```

## 6. 검증

```bash
npm run typecheck
npm run build
npm test
npm run review:phase0
npm run review:phase1
npm run review:phase2
npm run review:phase3
npm run review:phase4
npm run review:phase5
npm run review:phase6
npm run review:phase7
npm run review:phase8
npm run review:phase9
npm run check:public
```

## 7. 커밋 전 제외 대상

```text
.env
data/
.data/
data-sample/*
*.sqlite
*.sqlite-shm
*.sqlite-wal
node_modules/
dist/
coverage/
```

`data-sample/README.md`만 샘플 데이터 사용법 안내로 남긴다.
