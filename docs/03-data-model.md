# 데이터 모델

Last updated: 2026-05-29

## 1. 기본 원칙

V2 데이터는 "업무 그래프 + 작업 큐 + 산출물 저장소"로 나눈다.

| 영역 | 역할 |
| --- | --- |
| 업무 그래프 | 목표, 태스크, 산출물, 직원, 이슈, 결정사항의 관계 |
| 작업 큐 | PM이 직원과 서기에게 시키는 실행 단위 |
| 산출물 저장소 | 산출물 파일과 버전 |
| 이벤트 로그 | 모든 중요한 변경의 기록 |
| 지식 저장소 | PM과 직원이 참고하는 문서 |

## 2. 주요 엔티티

### 2.1 Division

사업부는 장기 운영 단위다.

필드:

| 필드 | 설명 |
| --- | --- |
| `id` | 사업부 ID |
| `name` | 사업부명 |
| `description` | 사업부 설명 |
| `leadWorkerId` | 사업부 리드 |
| `status` | active, archived |

### 2.2 Campaign

캠페인은 사업부 안에서 진행되는 목표형 업무 단위다.

필드:

| 필드 | 설명 |
| --- | --- |
| `id` | 캠페인 ID |
| `divisionId` | 소속 사업부 |
| `title` | 캠페인명 |
| `summary` | 캠페인 요약 |
| `pmWorkerId` | 캠페인 PM |
| `status` | planning, running, blocked, review, done, archived |
| `currentFocus` | 현재 PM이 보는 핵심 초점 |
| `health` | normal, needs_owner_decision, blocked, failing |

### 2.3 Graph Node

업무 그래프의 모든 항목은 노드로 표현한다.

노드 종류:

- `goal`
- `task`
- `artifact`
- `worker`
- `decision`
- `issue`
- `risk`
- `reference`
- `run`

공통 필드:

| 필드 | 설명 |
| --- | --- |
| `id` | 노드 ID |
| `type` | 노드 종류 |
| `title` | 표시명 |
| `status` | 상태 |
| `summary` | 짧은 설명 |
| `createdAt` | 생성 시각 |
| `updatedAt` | 수정 시각 |

### 2.4 Graph Edge

엣지는 노드 간 관계다.

관계 종류:

| 관계 | 의미 |
| --- | --- |
| `contains` | 목표가 하위 목표나 태스크를 포함 |
| `requires` | 목표나 태스크가 산출물을 필요로 함 |
| `produces` | 태스크가 산출물을 생성 |
| `assigned_to` | 태스크가 직원에게 배정 |
| `blocks` | 이슈나 결정사항이 태스크를 막음 |
| `references` | 산출물이 참고문서를 참조 |
| `revises` | 작업이 산출물 버전을 수정 |
| `reviews` | PM 리뷰가 산출물을 검토 |

### 2.5 Task

태스크는 실행 가능한 업무 단위다.

필드:

| 필드 | 설명 |
| --- | --- |
| `id` | 태스크 ID |
| `campaignId` | 캠페인 ID |
| `title` | 태스크명 |
| `description` | 작업 설명 |
| `status` | draft, ready, queued, running, blocked, done, archived |
| `ownerWorkerId` | 담당 직원 |
| `instructions` | 작업지시 |
| `acceptanceCriteria` | 완료 기준 |
| `artifactIds` | 관련 산출물 |
| `decisionIds` | 필요한 대표 결정 |
| `priority` | low, normal, high |

### 2.6 Artifact

산출물은 독립 객체다.

필드:

| 필드 | 설명 |
| --- | --- |
| `id` | 산출물 ID |
| `campaignId` | 캠페인 ID |
| `title` | 산출물명 |
| `kind` | markdown, html, json, csv, image, folder |
| `status` | draft, in_review, needs_revision, approved, archived |
| `currentVersion` | 최신 버전 |
| `ownerWorkerId` | 주 담당자 |
| `linkedTaskIds` | 연결 태스크 |
| `reviewSummary` | 최신 PM 리뷰 요약 |

### 2.7 Artifact Version

산출물 버전은 파일 시스템에 저장한다.

필드:

| 필드 | 설명 |
| --- | --- |
| `artifactId` | 산출물 ID |
| `version` | v001, v002 |
| `createdBy` | 만든 직원 또는 PM |
| `sourceQueueItemId` | 생성한 큐 항목 |
| `contentPath` | 본문 파일 경로 |
| `reviewPath` | 리뷰 파일 경로 |
| `createdAt` | 생성 시각 |

### 2.8 Artifact Revision Request

대표가 산출물 수정을 요청한 단위다. 같은 산출물에 같은 지시가 다시 들어와도 중복 큐를 만들지 않기 위해 별도 레코드로 관리한다.

필드:

| 필드 | 설명 |
| --- | --- |
| `id` | 수정 요청 ID |
| `campaignId` | 캠페인 ID |
| `artifactId` | 수정 대상 산출물 |
| `taskId` | 수정 작업 태스크 |
| `queueItemId` | 실행 큐 항목 |
| `instruction` | 대표가 남긴 수정 지시 |
| `status` | queued, running, done, needs_revision, approved, failed |

### 2.9 Worker

직원은 사업부에 속하고 캠페인에 배정된다.

필드:

| 필드 | 설명 |
| --- | --- |
| `id` | 직원 ID |
| `divisionId` | 사업부 ID |
| `name` | 한국식 실제 이름 |
| `position` | 포지션 |
| `skills` | 강점 |
| `workStyle` | 업무 스타일 |
| `status` | active, inactive, archived |

### 2.10 Campaign Team Proposal

PM이 캠페인에 필요한 직원 구성을 제안한 레코드다. 제안 자체는 공식 상태로 저장되지만, 직원 생성과 배정은 대표 승인 뒤에만 실행된다.

필드:

| 필드 | 설명 |
| --- | --- |
| `id` | 팀 제안 ID |
| `campaignId` | 캠페인 ID |
| `title` | 제안 제목 |
| `reason` | PM이 이 팀을 제안한 이유 |
| `members` | 이름, 역할, 임무를 가진 직원 후보 JSON |
| `status` | pending, approved, rejected |

### 2.11 Worker Session

직원 세션은 캠페인별 Codex 세션이다.

필드:

| 필드 | 설명 |
| --- | --- |
| `id` | 세션 레코드 ID |
| `workerId` | 직원 ID |
| `campaignId` | 캠페인 ID |
| `sessionId` | Codex 세션 ID |
| `status` | not_started, ready, running, failed |
| `lastUsedAt` | 마지막 사용 시각 |

### 2.12 Decision

대표 결정함 항목이다.

필드:

| 필드 | 설명 |
| --- | --- |
| `id` | 결정 ID |
| `campaignId` | 캠페인 ID |
| `title` | 결정 제목 |
| `reason` | 왜 결정이 필요한지 |
| `options` | 선택지 |
| `recommendedOption` | PM 추천 |
| `status` | open, answered, dismissed |
| `blocks` | 막고 있는 태스크/산출물 |
| `answer` | 대표 답변 |

### 2.13 Queue Item

작업 큐 항목이다.

필드:

| 필드 | 설명 |
| --- | --- |
| `id` | 큐 ID |
| `type` | worker_run, pm_review, scribe_update, artifact_revision |
| `status` | queued, running, blocked, failed, done |
| `campaignId` | 캠페인 ID |
| `workerId` | 실행 직원 |
| `taskId` | 연결 태스크 |
| `artifactIds` | 생성/수정 산출물 |
| `attempt` | 현재 시도 |
| `maxAttempts` | 최대 시도 |
| `blockedByDecisionId` | 대표 결정 때문에 막힌 경우 |

### 2.14 Handoff Report

인계 보고서는 DB 테이블이 아니라 캠페인 `reports/` 폴더에 생성되는 Markdown mirror다. 공식 원본은 캠페인, 그래프, 결정, 큐, 산출물 레코드이며 보고서는 사람이 이어받기 쉬운 읽기용 결과물이다.

생성 파일:

| 파일 | 설명 |
| --- | --- |
| `human-todos.md` | 사람 확인, 외부 연락, 승인, 열린 결정 항목 |
| `campaign-status.md` | 캠페인 상태, 산출물, 결정, 다음 행동 종합 |
| `owner-brief.md` | 대표가 빠르게 읽는 요약과 다음 처리 항목 |

## 3. SQLite 테이블 초안

초기 테이블:

```text
divisions
campaigns
workers
worker_sessions
graph_nodes
graph_edges
tasks
artifacts
artifact_versions
artifact_revision_requests
campaign_team_proposals
decisions
queue_items
events
conversations
messages
```

파일 시스템과 연결되는 테이블:

- `artifacts`
- `artifact_versions`
- `artifact_revision_requests`
- `campaign_team_proposals`
- `queue_items`
- `events`

## 4. 공식 원본 규칙

| 데이터 | 공식 원본 |
| --- | --- |
| 캠페인 상태 | SQLite `campaigns` |
| 업무 관계 | SQLite `graph_nodes`, `graph_edges` |
| 태스크 | SQLite `tasks` |
| 직원/세션 | SQLite `workers`, `worker_sessions` |
| PM 팀 제안 | SQLite `campaign_team_proposals` |
| 대표 결정 | SQLite `decisions` |
| 작업 큐 | SQLite `queue_items` |
| 산출물 수정 요청 | SQLite `artifact_revision_requests`, `graph_edges` |
| 인계 보고서 | 파일 시스템 `reports/*.md`, 원본은 SQLite와 산출물 파일 |
| 산출물 본문 | 파일 시스템 |
| 산출물 최신 포인터 | SQLite `artifacts`, 파일 `manifest.json` |
| 대화 | SQLite `messages` + JSONL export |
| PM 기억 | Markdown 파일 |

## 5. 상태 전이

### 태스크

```text
draft -> ready -> queued -> running -> done
                         -> blocked
                         -> failed
```

### 산출물

```text
draft -> in_review -> approved
                  -> needs_revision -> in_review
```

### 큐 항목

```text
queued -> running -> done
                 -> failed
                 -> blocked
```

## 6. 이벤트 로그

모든 중요한 상태 변화는 이벤트로 남긴다.

예:

```json
{"type":"campaign_created","campaignId":"campaign-001","at":"2026-05-29T12:00:00+09:00"}
{"type":"pm_message_created","messageId":"msg-001","campaignId":"campaign-001","at":"..."}
{"type":"task_created","taskId":"task-001","campaignId":"campaign-001","at":"..."}
{"type":"queue_item_started","queueItemId":"queue-001","at":"..."}
{"type":"artifact_version_created","artifactId":"artifact-001","version":"v001","at":"..."}
{"type":"decision_requested","decisionId":"decision-001","at":"..."}
{"type":"handoff_report_generated","campaignId":"campaign-001","at":"..."}
{"type":"campaign_status_updated","campaignId":"campaign-001","at":"..."}
```
