# 폴더 구조

Last updated: 2026-05-29

## 1. 프로젝트 루트

권장 프로젝트 루트:

```text
local-company-v2/
```

권장 구조:

```text
local-company-v2/
  docs/
  src/
  scripts/
  tests/
  data/
  data-sample/
  .env.example
  package.json
  README.md
```

## 2. 문서 폴더

```text
docs/
  00-index.md
  01-product-brief.md
  02-system-architecture.md
  03-data-model.md
  04-folder-structure.md
  05-pm-agent-operating-model.md
  06-ui-ux-spec.md
  07-implementation-roadmap.md
  08-dev-setup.md
  09-decisions-and-open-questions.md
  10-wireframes.md
  11-layout-and-design-system.md
  12-phase-ticket-implementation-plan.md
  13-human-decisions.md
  install.md
  codex-connection.md
  user-guide.md
  reviews/
    phase-0-review.md
    phase-1-review.md
    phase-2-review.md
    phase-3-review.md
    phase-4-review.md
    phase-5-review.md
    phase-6-review.md
    phase-7-review.md
    phase-8-review.md
    phase-9-review.md
  99-version-log.md
```

## 3. 앱 코드 폴더 초안

```text
src/
  server/
    index.ts
    config.ts
    api/
    services/
      campaign-service.ts
      conversation-service.ts
      pm-action-service.ts
      graph-service.ts
      queue-service.ts
      artifact-service.ts
      decision-service.ts
      revision-service.ts
      report-service.ts
      knowledge-service.ts
      agent-runner.ts
    storage/
      db.ts
      migrations/
      file-store.ts
    prompts/
      pm.ts
      worker.ts
      scribe.ts
  client/
    main.tsx
    routes/
    components/
    styles/
  shared/
    types/
    schemas/
    utils/
```

## 4. 스크립트 폴더

```text
scripts/
  seed-demo.ts
  check-public-ready.ts
  review-phase0.ts
  ...
  review-phase9.ts
```

## 5. 데이터 루트

개발 중 데이터 루트:

```text
data/
```

운영 데이터 루트:

```text
.data/
```

초기에는 프로젝트 내부 `data/`를 쓰고, 실제 운영에서는 `.data/`로 옮겨도 된다.

## 6. V2 데이터 폴더

```text
data/
  local-company.sqlite
  divisions/
    <divisionId>/
      documents/
      campaigns/
        <campaignId>/
          knowledge/
          conversations/
          artifacts/
          queue-runs/
          reports/
```

SQLite는 상태 인덱스와 관계를 관리한다. 폴더는 사람이 읽는 문서와 산출물 파일을 관리한다.

## 7. 사업부 폴더

```text
divisions/<divisionId>/
  division.md
  documents/
    00-사업부-개요.md
    10-대표-의견.md
    20-운영-기준.md
    30-공통-지식.md
  campaigns/
```

사업부 폴더는 장기 지식과 직원 운영 기준을 담는다.

## 8. 캠페인 폴더

```text
campaigns/<campaignId>/
  campaign.md
  knowledge/
    pm-brief.md
    strategy.md
    decisions.md
    assumptions.md
    risks.md
    references/
    owner-notes/
    source-materials/
  conversations/
    pm/
      conversation.md
      messages.jsonl
    workers/
      <workerId>/
        conversation.md
        messages.jsonl
  artifacts/
  queue-runs/
  reports/
```

## 9. 산출물 폴더

```text
artifacts/
  <artifactId>/
    manifest.json
    README.md
    versions/
      v001/
        content.md
        review.md
        prompt.md
        final.md
        raw-output.txt
      v002/
        content.md
        review.md
        prompt.md
        final.md
        raw-output.txt
```

산출물이 HTML이면:

```text
versions/v001/
  content.html
  review.md
  prompt.md
  final.md
  raw-output.txt
```

산출물이 여러 파일이면:

```text
versions/v001/
  content/
    index.html
    data.json
    styles.css
  review.md
  manifest.json
```

## 10. 작업 큐 실행 로그

```text
queue-runs/
  <runId>/
    queue-item.json
    prompt.md
    final.md
    raw-output.txt
    error.txt
```

작업 큐 실행 로그는 디버깅과 재현을 위해 남긴다. 대표 UI에는 기본적으로 노출하지 않는다.

## 11. 보고서 폴더

```text
reports/
  human-todos.md
  campaign-status.md
  owner-brief.md
```

보고서는 대표가 읽는 문서다. 공식 상태는 SQLite에 있고, 보고서는 사람이 보기 쉬운 mirror다. Phase 8에서는 인계 시점에 세 파일을 한 번에 다시 생성한다.

## 12. 샘플 데이터 폴더

```text
data-sample/
  README.md
```

`npm run seed:demo`를 실행하면 이 폴더 아래에 데모 SQLite DB와 캠페인 파일이 생성된다. 생성된 런타임 데이터는 git에서 제외하고, `README.md`만 사용법 안내로 남긴다.
