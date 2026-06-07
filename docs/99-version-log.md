# 버전 로그

## 2026-06-07

Version: `app-2026.06.07-codex-mobile-pm-bridge`

Changes:

- Added a Local Company MCP server for Codex.
- Exposed safe PM bridge tools: status, campaign list, PM workspace read, PM message send, and explicit campaign creation.
- Added Windows scripts to register and remove the MCP server from Codex.
- Documented the mobile Codex to Local Company PM bridge flow.

Reason:

- The owner wanted to exchange opinions with the Local Company PM through Codex mobile or route Codex commands back to the PM.

---

Version: `app-2026.06.07-windows-launch-shortcut`

Changes:

- Added `start-local-company.cmd` for Windows users.
- Created a local desktop shortcut named `Local Company V2`.
- Documented the shortcut/start script in README and install guide.

Reason:

- The owner wanted a simple way to start the app without remembering terminal commands.

---

## 2026-05-30

Version: `app-2026.05.30-delete-division-campaign`

Changes:

- Changed default division worker names to Korean-style names: `김하늘` and `박도현`.
- Added campaign deletion from the campaign operation board.
- Added non-default division deletion from the division home screen, including related campaigns, workers, and local folders.
- Added API and service coverage for deleting campaign/division data safely.

Reason:

- The owner needed a way to remove the currently created campaign and business division, and wanted default staff labels to look like real Korean names.

---

Version: `app-2026.05.30-codex-login-terminal-clarity`

Changes:

- Changed the login terminal to run the Codex login flow instead of the full interactive Codex CLI.
- Added guidance for the `Continue anyway? [y/N]` prompt and set a terminal type before launching Codex.
- Updated settings helper text and user docs with the clearer login flow.

Reason:

- The owner saw a Codex terminal warning and needed the app to explain exactly what to do.

---

Version: `app-2026.05.30-codex-login-guidance`

Changes:

- Expanded the login terminal instructions so the owner knows how to complete login and return to the app.
- Updated the settings screen helper text.
- Updated Codex connection and user docs with the same flow.

Reason:

- The owner asked that the opened terminal explain what to do next.

---

Version: `app-2026.05.30-codex-connection-status`

Changes:

- Added Codex connection status display in settings.
- Added a `연결 확인` action that checks CLI version, login status, and Codex doctor network/auth diagnostics.
- Added server API and tests for connection status.

Reason:

- The owner wanted the app to show whether Codex was actually connected.

---

Version: `app-2026.05.30-codex-login-terminal`

Changes:

- Added a settings action to open a local Codex login terminal.
- The terminal prefers the official npm Codex CLI, skips blocked WindowsApps aliases, and installs/updates `@openai/codex` when needed.
- The terminal runs the configured Codex CLI command from the project folder and keeps the window open for login/install feedback.
- Updated Codex connection and user docs.

Reason:

- The owner wanted the app to at least open the login terminal instead of requiring them to run the command manually.

---

Version: `app-2026.05.30-browser-codex-runner-settings`

Changes:

- Added browser-side Codex runner settings in the settings screen:
  - switch between `mock` and `codex-cli`,
  - edit CLI command and PM/worker/scribe model IDs,
  - persist the setting locally in SQLite app metadata.
- Server startup now applies persisted runner settings before PM execution.
- Updated user and Codex connection docs.

Reason:

- The owner wanted to use real Codex from the app instead of staying in mock mode.

---

Version: `app-2026.05.30-reference-file-upload`

Changes:

- Changed file references from manual path entry to real file upload.
- Uploaded files are stored under the campaign `knowledge/source-materials` folder.
- Text-like uploaded files are also summarized into PM reference context.
- Increased local JSON request size for reference upload while keeping a 5MB per-file limit.

Reason:

- The owner asked whether uploading the file itself could automatically place it into the campaign folder.

---

Version: `app-2026.05.30-campaign-references`

Changes:

- Added campaign reference materials:
  - PM conversation panel now has a `참고자료 추가` action,
  - owners can save note, URL, and local file path references,
  - references are stored in `knowledge/references`,
  - PM replies and PM action scribing receive the current campaign reference context.
- Added database/API/service support for campaign references.
- Updated the user guide.

Reason:

- The owner wanted reference materials to be added near the PM conversation because they are part of the PM context.

---

Version: `app-2026.05.30-campaign-scroll-model-tune`

Changes:

- Set the default Codex model split to PM `gpt-5.5`, worker `gpt-5.3-codex`, and scribe `gpt-5.3-codex`.
- Made the PM conversation panel slightly taller.
- Changed the campaign operation board so the right-side goals, decisions, tasks, artifacts, workers, and queue area scrolls independently.

Reason:

- The owner asked for worker and scribe to use the Codex coding model and for the right-side campaign board to scroll while keeping the PM conversation in place.

---

Version: `app-2026.05.30-codex-model-defaults`

Changes:

- Reduced the campaign PM panel minimum height so the operation board fits better in the first viewport.
- Updated public Codex model defaults from generic GPT labels to concrete Codex model IDs.
- Updated Codex connection docs and human-decision notes to keep account-specific availability and cost policy explicit.

Reason:

- The owner asked whether the campaign board could avoid a scrollbar and whether the app should show concrete Codex model linkage instead of generic `gpt-5` labels.

---

Version: `app-2026.05.30-neutral-placeholders`

Changes:

- Replaced app placeholders with neutral content-production examples:
  - campaign example now uses content production,
  - division and worker examples use generic content roles,
  - demo campaign and user-guide examples no longer reference earlier review scenarios.
- Sanitized public wireframe examples to remove specific application/recruiting traces.
- Changed default seed worker labels to generic role names and added a migration for existing local data.

Reason:

- The owner asked that placeholders not contain traces of previous personal review examples.

---

## 2026-05-29

Version: `app-2026.05.29-division-edit`

Changes:

- Added business division editing:
  - division name and description can be changed from the division page,
  - lead PM display name can be updated,
  - campaigns created after the edit use the updated PM name,
  - division folder names remain immutable from this screen because they are file paths.
- Added API/service support and tests for division updates.
- Updated the user guide with the edit behavior.

Reason:

- The owner asked whether business division names can be changed from the app.

---

Version: `app-2026.05.29-pm-team-proposals`

Changes:

- Added PM-designed campaign team proposals:
  - PM action schema now supports `propose_campaign_team`,
  - proposals are stored as JSON-constrained records with title, reason, members, roles, and missions,
  - the campaign board shows pending and approved team proposals,
  - owner approval creates the proposed workers and assigns them to the campaign,
  - worker execution waits when a PM team proposal is pending and no execution worker has been approved.
- Added `campaign_team_proposals` SQLite migration and projection data.
- Added tests for proposal storage, approval, campaign worker assignment, and queue opening after approval.
- Updated user and architecture docs to describe PM-designed teams rather than automatic rule-based team creation.

Reason:

- The owner rejected rule-based organization generation and approved a PM-designed team proposal constrained by JSON.

---

Version: `app-2026.05.29-phase9-release-ready`

Changes:

- Implemented Codex CLI runner mode for public install readiness:
  - `CODEX_RUNNER=mock` remains the offline demo default,
  - `CODEX_RUNNER=codex-cli` calls `codex exec` for PM replies, PM action scribing, worker output, artifact revision, and PM review,
  - `CODEX_EXEC_ARGS` passes optional extra `codex exec` flags,
  - settings health output shows the active runner and model configuration,
  - tests cover the CLI execution path with a fake local Codex command.
- Upgraded the header and business-division flow from placeholder to public-version behavior:
  - business divisions can be created from the UI/API,
  - each new division gets its own PM lead worker,
  - campaigns created under a division use that division's PM,
  - the header can select divisions, create divisions, search campaigns, open campaigns, and open settings.
- Implemented Phase 9 release and sharing preparation:
  - portable `.env.example`,
  - install guide and user guide,
  - demo seed script for `data-sample`,
  - public readiness check script,
  - explicit `LICENSE`,
  - sample data README and gitignore safety rules,
  - `review:phase9` script.
- Updated README, document index, development setup, folder structure, and human-decision tracking for release readiness.
- Added Phase 9 review evidence in `docs/reviews/phase-9-review.md`.

Reason:

- The owner asked to complete development phase-ticket by phase-ticket, repeating implementation and review, and to collect human judgment points separately.

---

Version: `app-2026.05.29-phase8-handoff-reports`

Changes:

- Implemented Phase 8 handoff and human TODO flow:
  - campaign handoff report service,
  - `reports/human-todos.md`, `reports/campaign-status.md`, and `reports/owner-brief.md` generation,
  - human TODO extraction from open decisions, blocked queues, and human-confirmation markers,
  - next AI work extraction from active queue items, unfinished tasks, and review/revision artifacts,
  - campaign completion API and UI,
  - campaign board controls for handoff report generation and status transition.
- Added `review:phase8`, expanded tests to 18 cases, and recorded Phase 8 evidence in `docs/reviews/phase-8-review.md`.
- Added handoff report source-of-truth notes and human TODO extraction policy to project docs.

Reason:

- The owner asked to keep implementing the phase-ticket plan through implementation and review, while collecting human judgment points separately.

---

Version: `app-2026.05.29-phase7-artifact-revisions`

Changes:

- Implemented Phase 7 artifact revision flow:
  - `artifact_revision_requests` migration and revision request service,
  - natural-language `revise_artifact` action extraction from PM chat,
  - artifact revision request API,
  - artifact store UI for PM revision requests,
  - `revises` and `references` graph edge tracking,
  - requested revision execution through the existing `artifact_revision` queue,
  - PM review after requested revisions,
  - duplicate revision request prevention.
- Added revision request and relation data to artifact detail responses.
- Added `review:phase7`, expanded tests to 16 cases, and recorded Phase 7 evidence in `docs/reviews/phase-7-review.md`.
- Added revision duplicate policy to `13-human-decisions.md`.

Reason:

- The owner asked to keep implementing the phase-ticket plan through implementation and review, while collecting human judgment points separately.

---

Version: `app-2026.05.29-phase6-decision-inbox`

Changes:

- Implemented Phase 6 owner decision inbox:
  - decision listing, detail, and answer service,
  - decision APIs,
  - open decisions in app state for the home screen,
  - home and campaign-board decision links,
  - decision inbox UI with recommendation, options, and free-form owner memo,
  - blocked queue resume after decision answer,
  - answered decision handling during PM review continuation.
- Added `review:phase6`, expanded tests to 13 cases, and recorded Phase 6 evidence in `docs/reviews/phase-6-review.md`.
- Added decision resume policy to `13-human-decisions.md`.

Reason:

- The owner asked to keep implementing the phase-ticket plan through implementation and review, while collecting human judgment points separately.

---

Version: `app-2026.05.29-phase5-pm-review-rework`

Changes:

- Implemented Phase 5 PM review and automatic rework flow:
  - `pm_review` queue execution,
  - review file updates on the current artifact version,
  - `approved`, `needs_revision`, and `blocked` artifact status transitions,
  - `artifact_revision` queue creation only for failed artifacts,
  - maximum repeated rework limit with blocked queue and owner decision creation,
  - owner-decision detection during PM review.
- Added non-technical queue labels for PM review and artifact rework in the campaign board.
- Added `review:phase5`, expanded tests to 12 cases, and recorded Phase 5 evidence in `docs/reviews/phase-5-review.md`.
- Added PM review/rework policy to `13-human-decisions.md`.

Reason:

- The owner asked to continue the implementation-review loop by phase ticket and collect human judgment points separately.

---

Version: `app-2026.05.29-phase4-workers-queue`

Changes:

- Implemented Phase 4 worker and queue flow:
  - campaign worker assignments,
  - default AI execution worker,
  - worker creation API and organization UI action,
  - mock worker session startup,
  - worker_run queue item sync from PM-created tasks,
  - queue execution with `queued -> running -> done` status transitions,
  - mock worker artifact output saved as a new artifact version.
- Added `002_campaign_workers` migration and queue/session indexes.
- Added campaign workspace projection fields for assigned workers and queue items.
- Added campaign operation board sections for worker status and automatic execution status.
- Added `review:phase4`, expanded tests, and recorded Phase 4 evidence in `docs/reviews/phase-4-review.md`.
- Added real worker execution policy to `13-human-decisions.md`.

Reason:

- The owner asked to continue development phase-ticket by phase-ticket and close each phase with review evidence.

---

Version: `app-2026.05.29-phase3-artifact-store`

Changes:

- Implemented Phase 3 artifact store flow:
  - artifact manifest generation,
  - versioned artifact file storage,
  - initial `v001` artifact request documents,
  - Markdown artifact viewer,
  - sandboxed HTML artifact viewer,
  - artifact list API and UI.
- Added `marked` for Markdown rendering in the local artifact viewer.
- Added artifact detail APIs and `/artifacts/:artifactId/view` document viewer route.
- Added `review:phase3`, expanded tests, and recorded Phase 3 evidence in `docs/reviews/phase-3-review.md`.
- Added HTML artifact security policy and initial artifact version behavior to `13-human-decisions.md`.

Reason:

- The owner asked to continue the phase-ticket implementation and review loop through the artifact store.

---

Version: `app-2026.05.29-phase2-pm-actions-graph`

Changes:

- Implemented Phase 2 PM action and work graph flow:
  - PM action TypeScript schemas,
  - mock scribe action extraction,
  - PM action validation with approval-required separation,
  - graph node and edge persistence,
  - campaign operation board projection.
- Connected PM chat messages so accepted safe actions update campaign summary, goals, tasks, artifact requests, decisions, and graph edges.
- Updated the campaign workspace API and UI to display current goals, PM judgment, decisions, tasks, and artifacts from projection data.
- Added `review:phase2`, expanded tests, and recorded Phase 2 evidence in `docs/reviews/phase-2-review.md`.
- Added PM action approval policy to `13-human-decisions.md`.

Reason:

- The owner asked to continue the implementation-review loop by phase ticket, with human decisions collected separately.

---

Version: `app-2026.05.29-phase1-campaign-pm-chat`

Changes:

- Completed Phase 0 foundation implementation and review.
- Implemented Phase 1 campaign and PM chat flow:
  - default division and PM worker seed,
  - campaign creation API and UI,
  - automatic PM assignment,
  - PM conversation persistence to SQLite, `conversation.md`, and `messages.jsonl`,
  - mock PM response generation.
- Added app state and campaign workspace APIs.
- Reworked the React app shell into Home, Division, Campaign, Organization, Settings, and placeholder future screens.
- Added `review:phase1`, expanded tests, and created phase review records under `docs/reviews/`.
- Updated `13-human-decisions.md` with seed identity and mock PM runner decisions.

Reason:

- The owner asked to proceed phase-ticket by phase-ticket with implementation and review loops.

---

Version: `docs-2026.05.29-v2-phase0-start`

Changes:

- Started Phase 0 implementation from the phase ticket plan.
- Added the React app shell, Node server foundation, SQLite schema initializer, data folder generator, Phase 0 review script, and initial tests.
- Added `13-human-decisions.md` to collect decisions that need owner or human judgment during implementation.
- Updated `00-index.md` and `04-folder-structure.md` to include the human decisions document.

Reason:

- The owner asked to proceed ticket by ticket with implementation and review, while collecting human decisions separately.

---

Version: `docs-2026.05.29-v2-phase-ticket-plan`

Changes:

- Added `12-phase-ticket-implementation-plan.md` as an execution-level implementation plan for every roadmap phase and ticket.
- Defined ticket operating principles, common completion criteria, per-ticket implementation scope, primary modules, acceptance criteria, and verification methods.
- Added an initial public-version implementation cut that closes Phase 0 through Phase 3 and Phase 4 worker mock execution before attaching deeper automation.
- Updated `00-index.md` and `04-folder-structure.md` so the new implementation plan is part of the official document set.

Reason:

- The owner wanted the implementation plan expressed at the phase and ticket level before starting code work.

---

Version: `docs-2026.05.29-v2-wireframes`

Changes:

- Added `10-wireframes.md` to define implementation-ready wireframes for the app shell, home, division home, campaign workspace, PM chat, work graph, artifacts, decisions, organization, and settings.
- Added `11-layout-and-design-system.md` to fix layout, spacing, typography, colors, buttons, tables, panels, status badges, PM chat behavior, artifact viewer behavior, and responsive rules.
- Updated the document index so wireframes and layout standards are read before the implementation roadmap.
- Updated `04-folder-structure.md` so the documented `docs/` folder list includes the new UI specification documents.

Reason:

- The owner identified unclear screen structure, layout, and UI standards as the biggest risk for starting the V2 project.

---

Version: `docs-2026.05.29-v2-startup-docs`

Changes:

- Created the initial documentation folder for Local Company V2.
- Added product brief, architecture, data model, folder structure, PM/agent operating model, UI/UX spec, implementation roadmap, development setup, and decisions/open questions.
- Established V2 as a PM-operated workspace built around PM chat, a work graph, a work queue, an artifact store, and an owner decision inbox.

Reason:

- The owner is starting a new project in a local `local-company-v2/` workspace and needs a clean document set before implementation begins.
