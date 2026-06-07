# Phase 3 리뷰

Last updated: 2026-05-29

## 범위

- V2-3-01 산출물 manifest 생성
- V2-3-02 산출물 버전 저장
- V2-3-03 Markdown 뷰어
- V2-3-04 HTML 산출물 지원
- V2-3-05 산출물 목록 UI

## 결과

통과.

## 확인한 증거

| 항목 | 증거 |
| --- | --- |
| 산출물 manifest | `artifacts/<artifactId>/manifest.json` 생성 |
| 산출물 버전 | `versions/v001`, `versions/v002` 저장과 `current_version` 갱신 |
| Markdown 뷰어 | Markdown 본문을 문서 HTML로 렌더링 |
| HTML 지원 | HTML 산출물은 sandbox iframe으로 표시 |
| 목록 UI | 산출물 저장소 화면에서 목록, 상태 필터, 선택 요약, 새 탭 열기 제공 |

## 실행한 검증

```text
npm run typecheck
npm run build
npm test
npm run review:phase0
npm run review:phase1
npm run review:phase2
npm run review:phase3
POST http://127.0.0.1:8788/api/campaigns
POST http://127.0.0.1:8788/api/campaigns/:campaignId/messages
GET http://127.0.0.1:8788/api/artifacts?campaignId=:campaignId
GET http://127.0.0.1:8788/api/artifacts/:artifactId
GET http://127.0.0.1:8788/artifacts/:artifactId/view
```

## 실제 로컬 확인

생성된 UTF-8 확인 캠페인:

```text
campaign-d6076cc6-731f-4a9e-aa79-987cbaa017bc
```

확인된 산출물:

```text
artifact-966f9a41-b435-4aa5-aa66-8b1b82dd63de
currentVersion=v001
versionCount=1
viewerStatus=200
```

## 남은 판단

- HTML 산출물은 sandbox iframe으로 표시한다. 외부에서 가져온 HTML을 어느 수준까지 허용할지 운영 정책이 필요하다.
