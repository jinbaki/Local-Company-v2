# Phase 4 리뷰

Last updated: 2026-05-29

## 범위

- V2-4-01 직원 모델 구현
- V2-4-02 캠페인 직원 배정
- V2-4-03 직원 세션 시작
- V2-4-04 작업 큐 생성
- V2-4-05 큐 실행
- V2-4-06 실행 상태판

## 결과

통과.

## 확인한 증거

| 항목 | 증거 |
| --- | --- |
| 직원 모델 | 기본 PM, 기본 AI 실행 직원, 추가 직원 생성 가능 |
| 캠페인 직원 배정 | `campaign_workers`에 캠페인별 직원 배정 저장 |
| 직원 세션 시작 | `worker_sessions`에 mock session ID와 `ready` 상태 저장 |
| 작업 큐 생성 | PM 대화 후 ready 태스크가 `worker_run` 큐 항목으로 생성 |
| 큐 실행 | `queued -> running -> done` 전이 후 산출물 새 버전 생성 |
| 실행 상태판 | 캠페인 운영판 projection에 assigned workers와 queue items 포함 |

## 실행한 검증

```text
npm run typecheck
npm run build
npm test
npm run review:phase0
npm run review:phase1
npm run review:phase2
npm run review:phase3
npm run review:phase4
POST http://127.0.0.1:8788/api/campaigns
POST http://127.0.0.1:8788/api/campaigns/:campaignId/messages
POST http://127.0.0.1:8788/api/campaigns/:campaignId/queue/run-next
GET http://127.0.0.1:8788/api/campaigns/:campaignId
GET http://127.0.0.1:8788/api/artifacts/:artifactId
```

## 실제 로컬 확인

생성된 UTF-8 확인 캠페인:

```text
campaign-32b9f84f-dc5e-46fa-be4b-92091b21815b
```

확인된 실행 흐름:

```text
assignedWorkers=1
beforeQueue=queued
runStatus=done
taskStatus=done
artifactStatus=in_review
artifactVersion=v002
contentHasResult=true
```

## 남은 판단

- 현재 직원 실행은 mock runner다. 실제 Codex worker runner 연결 전, 자동 실행 시작 버튼의 승인 범위와 비용/시간 제한을 확정해야 한다.
