# 문서 색인

Last updated: 2026-05-29

이 폴더는 Local Company V2를 새 프로젝트로 시작하고, 설치하고, 운영하기 위한 기준 문서 모음이다.

V2의 기준은 "대표는 PM과 대화하고, PM이 업무 그래프와 작업 큐를 운영한다"는 구조다.

## 먼저 읽을 순서

1. `01-product-brief.md`
2. `02-system-architecture.md`
3. `03-data-model.md`
4. `04-folder-structure.md`
5. `05-pm-agent-operating-model.md`
6. `06-ui-ux-spec.md`
7. `10-wireframes.md`
8. `11-layout-and-design-system.md`
9. `07-implementation-roadmap.md`
10. `12-phase-ticket-implementation-plan.md`
11. `13-human-decisions.md`
12. `install.md`
13. `codex-connection.md`
14. `codex-mobile-pm-bridge.md`
15. `user-guide.md`
16. `08-dev-setup.md`
17. `09-decisions-and-open-questions.md`

## 문서 목록

| 파일 | 역할 |
| --- | --- |
| `00-index.md` | 문서 읽는 순서와 관리 규칙 |
| `01-product-brief.md` | V2 제품 목표, 사용자, 핵심 시나리오 |
| `02-system-architecture.md` | 전체 시스템 구조, 런타임, 모델 전략 |
| `03-data-model.md` | 업무 그래프, 태스크, 산출물, 직원, 결정함 데이터 모델 |
| `04-folder-structure.md` | 프로젝트 폴더와 데이터 폴더 구조 |
| `05-pm-agent-operating-model.md` | PM, 서기, 직원, 작업 큐 운영 방식 |
| `06-ui-ux-spec.md` | 화면 구성과 UX 원칙 |
| `07-implementation-roadmap.md` | 작은 단위 구현 로드맵과 티켓 |
| `08-dev-setup.md` | 개발 환경과 실행 준비 |
| `09-decisions-and-open-questions.md` | 초기 결정사항과 남은 질문 |
| `10-wireframes.md` | V2 화면별 와이어프레임, 배치, 구성 요소, 금지 요소 |
| `11-layout-and-design-system.md` | 레이아웃 토큰, 타이포, 색상, 버튼, 표, 패널 기준 |
| `12-phase-ticket-implementation-plan.md` | 페이즈와 티켓별 실제 구현 범위, 완료 기준, 검증 방법 |
| `13-human-decisions.md` | 구현 중 사람이 판단해야 할 항목과 임시 기본값 |
| `install.md` | 새 사용자를 위한 설치, 실행, 빌드, 데모 데이터 안내 |
| `codex-connection.md` | Codex CLI 설치, 인증, 보안 주의, `codex-cli` 실행 모드 연결 안내 |
| `codex-mobile-pm-bridge.md` | ChatGPT 모바일 Codex에서 Local Company PM에게 메시지를 전달하는 MCP 연결 안내 |
| `user-guide.md` | 첫 캠페인을 시작하고 산출물, 결정함, 인계 보고서를 확인하는 흐름 |
| `reviews/` | 페이즈별 구현 리뷰와 검증 증거 |
| `99-version-log.md` | 문서와 구현 변경 기록 |

## 문서 관리 규칙

- 새 기능을 구현하기 전에 관련 명세를 먼저 확인한다.
- 확정된 결정은 `09-decisions-and-open-questions.md` 또는 `13-human-decisions.md`에 남긴다.
- 구현 중 발견한 구조 변경은 `99-version-log.md`에 기록한다.
- 실제 코드와 문서가 충돌하면 현재 코드와 검증 결과를 기준으로 문서를 갱신한다.
- 문서 이름은 번호와 영어 소문자 하이픈을 사용한다.
