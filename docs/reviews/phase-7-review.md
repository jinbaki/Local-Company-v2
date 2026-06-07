# Phase 7 리뷰

Last updated: 2026-05-29

## 범위

- V2-7-01 수정 요청 액션
- V2-7-02 관련 산출물 추적
- V2-7-03 수정 큐 실행
- V2-7-04 수정 후 PM 리뷰
- V2-7-05 처리된 수정 제외

## 결과

통과.

## 확인한 증거

| 항목 | 증거 |
| --- | --- |
| 수정 요청 액션 | PM 대화의 자연어 수정 요청이 `revise_artifact` 액션과 `artifact_revision_requests` 레코드로 구조화 |
| 관련 산출물 추적 | `graph_edges`에 `revises`, `references` 관계 저장, 산출물 상세에서 관련 항목 노출 |
| 수정 큐 실행 | `artifact_revision` 큐 실행 후 기존 산출물을 덮어쓰지 않고 새 버전 생성 |
| 수정 후 PM 리뷰 | 재작업 결과가 `pm_review` 큐를 거쳐 `approved` 상태로 전환 |
| 처리된 수정 제외 | 같은 산출물과 같은 수정 지시는 중복 큐를 만들지 않음 |

## 실행한 검증

```text
npm run typecheck
npm run build
npm test
npm run review:phase7
POST /api/artifacts/:artifactId/revision-requests
POST /api/campaigns/:campaignId/queue/run-next
```

## 리뷰 스크립트 결과

```text
[PASS] V2-7-01 수정 요청 액션
[PASS] V2-7-02 관련 산출물 추적
[PASS] V2-7-03 수정 큐 실행
[PASS] V2-7-04 수정 후 PM 리뷰
[PASS] V2-7-05 처리된 수정 제외
Phase 7 review passed.
```

## 실제 로컬 확인

개발 서버에서 산출물을 만든 뒤 수정 요청 API를 호출하고, 중복 요청 제외와 재작업/PM 리뷰 완료를 확인했다.

```text
firstCreated=true
duplicateCreated=false
revisionRun=done
reviewRun=done
currentVersion=v003
revisionRequestStatus=approved
```

## 남은 판단

- 현재는 같은 산출물과 완전히 같은 수정 지시 문자열을 중복으로 본다. 실제 운영 전, 의미가 비슷하지만 문구가 다른 수정 요청까지 중복으로 묶을지 기준을 정해야 한다.
