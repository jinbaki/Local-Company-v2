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

기본값은 공개 데모용 `mock` 실행이다. 로컬에 Codex CLI를 설치하고 로그인한 뒤 `.env`에서 `CODEX_RUNNER=codex-cli`로 바꾸면 PM 답변, PM 액션 서기, 직원 실행, 산출물 수정, PM 리뷰가 `codex exec`로 실행된다. 기본 모델 후보는 PM `gpt-5.5`, worker `gpt-5.3-codex`, scribe `gpt-5.3-codex`다.

자세한 내용은 `docs/codex-connection.md`를 확인한다.

휴대폰의 Codex에서 Local Company PM에게 메시지를 전달하려면 `install-local-company-mcp.cmd`로 MCP 도구를 등록한다. 자세한 내용은 `docs/codex-mobile-pm-bridge.md`를 확인한다.

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
