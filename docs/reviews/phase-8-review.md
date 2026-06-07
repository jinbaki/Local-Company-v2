# Phase 8 리뷰

Last updated: 2026-05-29

## 범위

- V2-8-01 사람 TODO 추출
- V2-8-02 다음 AI 작업 추출
- V2-8-03 종합 보고서
- V2-8-04 캠페인 완료 처리

## 결과

통과.

## 확인한 증거

| 항목 | 증거 |
| --- | --- |
| 사람 TODO 추출 | 열린 결정, 막힌 큐, 외부 확인/승인 키워드가 있는 산출물을 `human-todos.md`에 정리 |
| 다음 AI 작업 추출 | queued/running/blocked 큐와 미완료 작업 후보를 캠페인 상태 보고서에 정리 |
| 종합 보고서 | `reports/human-todos.md`, `reports/campaign-status.md`, `reports/owner-brief.md` 생성 |
| 완료 처리 | `POST /api/campaigns/:campaignId/status`로 `done` 전환 |

## 실행한 검증

```text
npm run typecheck
npm test
npm run review:phase8
POST /api/campaigns/:campaignId/reports/handoff
POST /api/campaigns/:campaignId/status
```

## 리뷰 스크립트 결과

```text
[PASS] V2-8-01 사람 TODO 추출
[PASS] V2-8-02 다음 AI 작업 추출
[PASS] V2-8-03 종합 보고서
[PASS] V2-8-04 캠페인 완료 처리
Phase 8 review passed.
```

## 실제 로컬 확인

개발 서버에서 캠페인을 만들고 인계 보고서 생성 API를 호출해 보고서 3개가 생성되는 것을 확인한다. 이후 완료 처리 API로 `done`이 캠페인 조회 결과에 반영되는지 확인한다.

```text
files=reports/human-todos.md, reports/campaign-status.md, reports/owner-brief.md
status=done
```

## 남은 판단

- 사람 TODO 추출은 현재 키워드와 상태 기반 규칙이다. 실제 운영에서는 외부 연락, 대표 승인, 내부 확인을 더 세밀하게 나눌 기준이 필요하다.
