# Local Company V2

Local Company V2는 대표가 AI PM과 대화하고, PM이 업무 그래프, 작업 큐, 산출물, 결정사항을 운영하는 로컬 AI 회사 워크스페이스입니다.

## 현재 구현 상태

- Phase 0 프로젝트 기반 완료
- Phase 1 캠페인과 PM 대화 완료
- Phase 2 PM 액션과 업무 그래프 완료
- Phase 3 산출물 저장소 완료
- Phase 4 직원과 작업 큐 완료
- Phase 5 PM 리뷰와 자동 재작업 완료
- Phase 6 대표 결정함 완료
- Phase 7 산출물 수정 플로우 완료
- Phase 8 인계 보고서와 사람 TODO 완료
- Phase 9 배포와 공유 준비 완료
- Codex CLI 실제 실행 모드 준비 완료 (`CODEX_RUNNER=codex-cli`)

## 실행

Windows에서는 `start-local-company.cmd`를 더블클릭하면 서버를 켜고 브라우저를 연다.

```bash
npm install
npm run dev
```

기본 주소:

```text
http://127.0.0.1:8788
```

## 데모 데이터

개인정보 없는 데모 캠페인을 만들려면 다음을 실행합니다.

```bash
npm run seed:demo
```

PowerShell에서 데모 데이터로 앱을 실행하려면:

```powershell
$env:DATA_DIR = ".\data-sample"
npm run dev
```

## Codex 연결

기본값은 공개 데모용 `mock` 실행이다. 로컬에 Codex CLI를 설치하고 로그인한 뒤 `.env`에서 `CODEX_RUNNER=codex-cli`로 바꾸면 PM 답변, PM 액션 서기, 직원 실행, 산출물 수정, PM 리뷰가 `codex exec`로 실행된다. 기본 모델 후보는 PM, worker, scribe 모두 `gpt-5.5`다. `gpt-5.3-codex` 같은 Codex 전용 모델은 계정과 Codex CLI 표면에서 지원될 때만 직접 설정한다.

자세한 내용은 `docs/codex-connection.md`를 확인한다.

## MCP 연결 빠른 방법

휴대폰이나 다른 Codex 대화에서 Local Company PM에게 메시지를 전달하려면 MCP 도구를 등록한다.

1. 이 프로젝트 폴더에서 `npm install`을 실행한다.
2. `start-local-company.cmd`를 실행해서 Local Company V2를 켠다.
3. Codex CLI를 설치하고 본인의 Codex/ChatGPT 계정으로 로그인한다.

```bash
npm install -g @openai/codex
codex
```

4. 프로젝트 폴더의 `install-local-company-mcp.cmd`를 실행한다.
5. Codex 앱을 재시작하거나 새 Codex 대화를 연다.
6. Codex에게 다음처럼 요청한다.

```text
Local Company 캠페인 목록 확인해줘.
```

또는:

```text
Local Company PM에게 "지금 캠페인 방향을 검토해줘"라고 전달하고 답변 받아줘.
```

첨부 파일이나 긴 가이드를 PM이 참고해야 하면 먼저 참고자료로 저장하라고 요청한다.

```text
첨부한 가이드를 Local Company의 "습관 형성 앱 콘텐츠 개발" 캠페인 참고자료로 추가하고, 그 자료를 기준으로 PM에게 작업 계획을 세우라고 지시해줘.
```

잘 모르겠다면 이 프로젝트 폴더를 통째로 Codex에 열어준 뒤 이렇게 물어본다.

```text
이 폴더의 README와 docs를 보고 Local Company V2의 MCP 연결을 도와줘.
```

단, 다른 사람에게 폴더를 전달할 때는 실제 `.env`, `data/`, SQLite 파일, 실행 로그가 포함되지 않도록 한다. 자세한 내용은 `docs/codex-mobile-pm-bridge.md`를 확인한다.

## 개인정보와 계정 정보

이 저장소에는 실제 `.env`, SQLite 데이터, 로컬 실행 로그, Codex 인증 파일, API 키를 커밋하지 않는다. `install-local-company-mcp.cmd`는 실행한 사용자의 PC에서만 Codex MCP 도구를 등록하며, 저장소에 특정 사용자의 Codex ID나 토큰을 넣지 않는다.

다른 사용자가 이 저장소를 클론하면 그 사용자는 자신의 PC에서 `npm install`, `start-local-company.cmd`, `install-local-company-mcp.cmd`를 실행하고, 본인의 Codex/ChatGPT 계정으로 로그인해 사용한다. 이 과정에서 원저장소 소유자의 Codex 계정이나 로컬 데이터가 공유되지 않는다.

## 검증

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

## 주요 문서

- `docs/install.md`
- `docs/user-guide.md`
- `docs/codex-connection.md`
- `docs/codex-mobile-pm-bridge.md`
- `docs/00-index.md`
- `docs/12-phase-ticket-implementation-plan.md`
- `docs/13-human-decisions.md`

## 데이터

개발 데이터는 기본적으로 `data/`에 생성됩니다. 데모 데이터는 `data-sample/`에 생성됩니다. 실제 SQLite 파일과 런타임 데이터는 커밋하지 않습니다.

## 라이선스

현재 라이선스는 `LICENSE`의 "All rights reserved" 상태입니다. 공개/배포 범위를 바꾸려면 `docs/13-human-decisions.md`의 라이선스 항목을 먼저 결정해야 합니다.
