# 설치 매뉴얼

Last updated: 2026-05-29

## 준비물

- Node.js 24 이상
- Windows PowerShell, macOS Terminal, 또는 Linux shell
- 이 프로젝트 폴더

기본 설치는 로컬 `mock` 실행으로 동작하므로 OpenAI API 키가 없어도 데모를 볼 수 있다.

실제 Codex CLI를 연결하려면 [Codex 연결 안내](codex-connection.md)를 먼저 확인하고 `.env`에서 `CODEX_RUNNER=codex-cli`로 바꾼다.

## 처음 설치

```bash
npm install
```

환경변수를 바꾸고 싶다면 `.env.example`을 `.env`로 복사한 뒤 수정한다.

```bash
cp .env.example .env
```

Windows PowerShell에서는 다음처럼 복사할 수 있다.

```powershell
Copy-Item .env.example .env
```

## 개발 서버 실행

Windows에서는 프로젝트 폴더의 `start-local-company.cmd`를 더블클릭해도 된다. 이 파일은 필요한 패키지가 없으면 설치하고, 로컬 서버를 켠 뒤 브라우저에서 앱 주소를 연다.

```bash
npm run dev
```

브라우저에서 다음 주소를 연다.

```text
http://127.0.0.1:8788
```

처음 실행하면 `DATA_DIR` 아래에 SQLite DB와 기본 폴더가 자동으로 만들어진다.

## 데모 데이터 실행

개인정보 없는 데모 캠페인을 만들려면 다음을 실행한다.

```bash
npm run seed:demo
```

데모 데이터는 기본적으로 `data-sample/`에 생성된다. 데모를 앱에서 보려면 서버 실행 전에 `DATA_DIR`을 `data-sample`로 지정한다.

PowerShell:

```powershell
$env:DATA_DIR = ".\data-sample"
npm run dev
```

macOS/Linux:

```bash
DATA_DIR=./data-sample npm run dev
```

## 운영 빌드 확인

```bash
npm run build
npm start
```

`npm start`는 빌드된 서버와 클라이언트를 사용한다.

## 검증

```bash
npm run typecheck
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
```

공개 준비 점검만 따로 실행할 수도 있다.

```bash
npm run check:public
```

## 자주 막히는 지점

- 포트가 이미 사용 중이면 `.env`의 `PORT` 값을 바꾼다.
- 데이터를 새로 시작하려면 서버를 끄고 `DATA_DIR`을 다른 폴더로 지정한다.
- 실제 업무 데이터가 들어 있는 `data/`, `.data/`, `data-sample/*.sqlite`는 공유하지 않는다.
