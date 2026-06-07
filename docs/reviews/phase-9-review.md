# Phase 9 리뷰

Last updated: 2026-05-29

## 범위

- V2-9-01 `.env.example` 작성
- V2-9-02 설치 매뉴얼
- V2-9-03 사용 매뉴얼
- V2-9-04 샘플 데이터
- V2-9-05 GitHub 공개 준비

## 결과

통과.

## 확인한 증거

| 항목 | 증거 |
| --- | --- |
| `.env.example` | 포트, 데이터 경로, 모델명, timeout 예시가 있고 절대 경로와 비밀값이 없다. |
| 설치 매뉴얼 | `docs/install.md`에 설치, 실행, 빌드, 데모 데이터 실행이 정리되어 있다. |
| Codex 연결 안내 | `docs/codex-connection.md`에 Codex CLI 설치, 인증, `CODEX_RUNNER=codex-cli` 설정, 실제 실행 흐름이 정리되어 있다. |
| 사용 매뉴얼 | `docs/user-guide.md`에 첫 캠페인, PM 대화, 산출물, 결정함, 인계 보고서 흐름이 있다. |
| 샘플 데이터 | `npm run seed:demo`가 개인정보 없는 데모 캠페인을 `data-sample/`에 생성한다. |
| 공개 준비 | `.gitignore`, `LICENSE`, `README.md`, `check:public` 점검이 있다. |

## 실행한 검증

```text
npm run typecheck
npm test
npm run review:phase9
npm run check:public
npm run seed:demo
```

## 리뷰 스크립트 결과

```text
[PASS] V2-9-01 .env.example 작성
[PASS] V2-9-02 설치 매뉴얼
[PASS] V2-9-03 사용 매뉴얼
[PASS] V2-9-04 샘플 데이터
[PASS] V2-9-05 GitHub 공개 준비
Phase 9 review passed.
```

## 실제 로컬 확인

`seed-demo` 실행 뒤 데모 데이터에는 캠페인 1개, 산출물 1개 이상, 열린 결정 1개 이상, 인계 보고서 3개가 생성된다.

```text
Reports=reports/human-todos.md, reports/campaign-status.md, reports/owner-brief.md
```

## 남은 판단

- 라이선스는 현재 All rights reserved이다. 외부 공개 전에 오픈소스 또는 내부 공유 전용 여부를 결정해야 한다.
- Node.js 20 지원이 필요하면 `node:sqlite` 사용 방식을 다시 검토해야 한다.
