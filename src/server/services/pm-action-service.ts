import type { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../config.js";
import type { CampaignSummary } from "../../shared/types/app-state.js";
import {
  approvalRequiredActionTypes,
  isPmAction,
  pmActionTypes,
  type CreateArtifactRequestAction,
  type CreateGoalAction,
  type CreateTaskAction,
  type PmAction,
  type PmActionValidationIssue,
  type PmActionValidationResult,
  type ProposeCampaignTeamAction,
  type RequestOwnerDecisionAction,
  type ReviseArtifactAction
} from "../../shared/schemas/pm-actions.js";
import { isCodexCliRunner, runCodexCli } from "./agent-runner.js";
import { ensureArtifactManifest, ensureInitialArtifactVersion } from "./artifact-service.js";
import { artifactExists, getNextArtifactNumber, nodeExists, taskExists } from "./graph-service.js";
import { createId } from "./ids.js";
import { requestArtifactRevision } from "./revision-service.js";
import { renderReferenceContext } from "./reference-service.js";
import { createTeamProposal, listTeamProposals } from "./team-proposal-service.js";

export interface ExtractedPmActions {
  rawOutput: string;
  actions: PmAction[];
}

export interface AppliedPmActions {
  accepted: PmAction[];
  rejected: PmActionValidationIssue[];
  createdIds: Record<string, string>;
}

interface ArtifactCandidate {
  id: string;
  displayNumber: number;
  title: string;
  updatedAt: string;
}

function compactText(value: string, maxLength = 72): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxLength) {
    return compacted;
  }

  return `${compacted.slice(0, maxLength)}...`;
}

function shouldRequestOwnerDecision(ownerMessage: string): boolean {
  return /결정|승인|외부|비용|연락|확정|선택/.test(ownerMessage);
}

function isRevisionMessage(ownerMessage: string): boolean {
  return /수정|고쳐|바꿔|변경|보강|다듬|업데이트|추가/.test(ownerMessage);
}

export function extractPmActions(input: {
  campaign: CampaignSummary;
  ownerMessage: string;
  pmReply: string;
}): ExtractedPmActions {
  const focus = compactText(input.ownerMessage);
  const goalClientId = "goal-primary";
  const taskClientId = "task-initial-plan";
  const artifactClientId = "artifact-initial-plan";

  const actions: PmAction[] = [
    {
      type: "update_campaign_summary",
      currentFocus: focus,
      summary: input.campaign.summary || `${input.campaign.title} 캠페인의 목표와 실행 범위를 PM 대화로 구체화한다.`,
      reason: "대표 메시지와 PM 답변에서 현재 초점을 갱신"
    },
    {
      type: "create_goal",
      clientId: goalClientId,
      title: `${focus} 목표화`,
      summary: `대표 요청을 실행 가능한 목표로 정리한다. 요청: ${focus}`,
      status: "ready",
      reason: "PM 답변에서 캠페인 목표 후보를 구조화"
    },
    {
      type: "create_task",
      clientId: taskClientId,
      title: `${focus} 실행 항목 정리`,
      description: "대표 요청을 태스크와 산출물로 나누기 위한 초기 정리 작업",
      instructions: input.pmReply,
      acceptanceCriteria: "목표, 필요한 작업, 첫 산출물이 구분되어야 한다.",
      priority: "normal",
      goalRef: goalClientId,
      reason: "PM 답변을 실제 작업 단위로 반영"
    },
    {
      type: "create_artifact_request",
      clientId: artifactClientId,
      title: `${focus} 실행 계획 메모`,
      kind: "markdown",
      status: "draft",
      taskRef: taskClientId,
      reason: "대표가 읽을 첫 산출물 요청 생성"
    },
    {
      type: "propose_campaign_team",
      clientId: "team-initial-proposal",
      title: `${focus} 캠페인 팀 제안`,
      proposalReason: "PM이 이 요청을 혼자 처리하지 않고 역할별 담당자를 세워 진행하기 위한 팀 구성 제안입니다.",
      members: [
        {
          name: "자료 담당",
          role: "리서치 담당",
          mission: "요청과 관련된 기준, 자료, 확인 필요 항목을 먼저 정리합니다."
        },
        {
          name: "초안 담당",
          role: "작성 담당",
          mission: "PM 작업지시를 바탕으로 대표가 읽을 수 있는 첫 산출물 초안을 작성합니다."
        },
        {
          name: "검토 담당",
          role: "검토 담당",
          mission: "초안의 누락, 위험 표현, 대표 결정 필요 항목을 점검합니다."
        }
      ],
      reason: "PM이 캠페인 실행에 필요한 최소 팀을 제안"
    }
  ];

  if (shouldRequestOwnerDecision(input.ownerMessage)) {
    actions.push({
      type: "request_owner_decision",
      clientId: "decision-owner-direction",
      title: `${focus} 관련 대표 판단`,
      decisionReason: "대표가 직접 확정해야 할 가능성이 있는 요청이 포함되어 있다.",
      options: ["PM이 안전한 범위에서 초안을 만든다", "대표가 기준을 먼저 제공한다"],
      recommendedOption: "PM이 안전한 범위에서 초안을 만든다",
      blocks: [taskClientId],
      reason: "결정 또는 외부 행동 가능성이 있는 표현 감지"
    });
  }

  return {
    rawOutput: JSON.stringify(actions, null, 2),
    actions
  };
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasValidTeamMembers(value: unknown): value is ProposeCampaignTeamAction["members"] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 5 &&
    value.every((member) => {
      if (!member || typeof member !== "object") {
        return false;
      }

      const candidate = member as Partial<ProposeCampaignTeamAction["members"][number]>;
      return hasText(candidate.name) && hasText(candidate.role) && hasText(candidate.mission);
    })
  );
}

function extractJsonArray(text: string): unknown[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start < 0 || end < start) {
    throw new Error("Codex 서기 응답에서 JSON 배열을 찾지 못했습니다.");
  }

  const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Codex 서기 응답이 JSON 배열이 아닙니다.");
  }

  return parsed;
}

function isSupportedScribeAction(value: unknown): value is PmAction {
  if (!isPmAction(value)) {
    return false;
  }

  if (value.type === "update_campaign_summary") {
    return true;
  }

  if (value.type === "create_goal") {
    return hasText(value.clientId) && hasText(value.title);
  }

  if (value.type === "create_task") {
    return hasText(value.clientId) && hasText(value.title);
  }

  if (value.type === "create_artifact_request") {
    return hasText(value.clientId) && hasText(value.title);
  }

  if (value.type === "propose_campaign_team") {
    return hasText(value.clientId) && hasText(value.title) && hasText(value.proposalReason) && hasValidTeamMembers(value.members);
  }

  if (value.type === "request_owner_decision") {
    return (
      hasText(value.clientId) &&
      hasText(value.title) &&
      hasText(value.decisionReason) &&
      Array.isArray(value.options) &&
      value.options.length >= 2 &&
      hasText(value.recommendedOption)
    );
  }

  if (value.type === "revise_artifact") {
    return hasText(value.artifactId) && hasText(value.revisionInstruction);
  }

  return false;
}

function renderArtifactCandidatesForPrompt(db: DatabaseSync, campaignId: string): string {
  const artifacts = listArtifactCandidates(db, campaignId).slice(0, 20);
  if (artifacts.length === 0) {
    return "없음";
  }

  return artifacts.map((artifact) => `- ${artifact.displayNumber}: ${artifact.title} (${artifact.id})`).join("\n");
}

function extractPmActionsWithRunner(
  db: DatabaseSync,
  config: AppConfig,
  campaign: CampaignSummary,
  ownerMessage: string,
  pmReply: string
): ExtractedPmActions {
  const output = runCodexCli(config, {
    purpose: "scribe_actions",
    model: config.codexScribeModel,
    prompt: [
      "You are the Local Company V2 PM scribe.",
      "Read the owner message and PM reply, then return only a JSON array of actions that this app can safely apply.",
      "Do not include prose outside JSON.",
      "",
      `Allowed action types: ${pmActionTypes.join(", ")}`,
      "Supported in this app right now: update_campaign_summary, create_goal, create_task, create_artifact_request, propose_campaign_team, request_owner_decision, revise_artifact.",
      "",
      "Action shape examples:",
      '[{"type":"update_campaign_summary","summary":"...","currentFocus":"...","reason":"..."},',
      '{"type":"create_goal","clientId":"goal-1","title":"...","summary":"...","status":"ready","reason":"..."},',
      '{"type":"create_task","clientId":"task-1","title":"...","description":"...","instructions":"...","acceptanceCriteria":"...","priority":"normal","goalRef":"goal-1","reason":"..."},',
      '{"type":"create_artifact_request","clientId":"artifact-1","title":"...","kind":"markdown","status":"draft","taskRef":"task-1","reason":"..."},',
      '{"type":"propose_campaign_team","clientId":"team-1","title":"...","proposalReason":"...","members":[{"name":"...","role":"...","mission":"..."}],"reason":"..."},',
      '{"type":"request_owner_decision","clientId":"decision-1","title":"...","decisionReason":"...","options":["...","..."],"recommendedOption":"...","blocks":["task-1"],"reason":"..."},',
      '{"type":"revise_artifact","artifactId":"artifact-id","revisionInstruction":"...","relatedArtifactIds":[],"reason":"..."}]',
      "",
      "Rules:",
      "- Use clientId references when actions in the same batch depend on each other.",
      "- When campaign work needs people beyond the PM, add propose_campaign_team with 1-5 lean members. The app will store the proposal and wait for owner approval before creating workers.",
      "- Ask for owner decisions only when the owner must choose budget, policy, public promise, or business risk.",
      "- Use revise_artifact only when the owner clearly asks to change an existing artifact. Use the artifact id listed below.",
      "- Write Korean titles, summaries, instructions, reasons, team roles, missions, and decision options.",
      "",
      `Campaign id: ${campaign.id}`,
      `Campaign title: ${campaign.title}`,
      `Campaign summary: ${campaign.summary || "없음"}`,
      "",
      "Campaign references:",
      renderReferenceContext(db, campaign.id),
      "",
      "Known artifacts:",
      renderArtifactCandidatesForPrompt(db, campaign.id),
      "",
      "Owner message:",
      ownerMessage,
      "",
      "PM reply:",
      pmReply
    ].join("\n")
  });

  const actions = extractJsonArray(output).filter(isSupportedScribeAction);
  if (actions.length === 0) {
    throw new Error("Codex 서기 응답에서 적용 가능한 PM 액션을 찾지 못했습니다.");
  }

  return {
    rawOutput: output,
    actions
  };
}

function validateReference(
  db: DatabaseSync,
  ref: string | undefined,
  batchIds: Set<string>,
  target: "node" | "task" | "artifact"
): boolean {
  if (!ref) {
    return true;
  }

  if (batchIds.has(ref)) {
    return true;
  }

  if (target === "node") {
    return nodeExists(db, ref);
  }

  if (target === "task") {
    return taskExists(db, ref);
  }

  return artifactExists(db, ref);
}

export function validatePmActions(db: DatabaseSync, _campaignId: string, actions: PmAction[]): PmActionValidationResult {
  const accepted: PmAction[] = [];
  const rejected: PmActionValidationIssue[] = [];
  const batchIds = new Set(actions.map((action) => action.clientId).filter((clientId): clientId is string => Boolean(clientId)));

  for (const action of actions) {
    const approvalRequired = approvalRequiredActionTypes.includes(action.type);

    if (approvalRequired) {
      rejected.push({
        action,
        reason: "대표 승인 없이 자동 반영할 수 없는 액션입니다.",
        approvalRequired
      });
      continue;
    }

    if (action.type === "create_goal" && !hasText(action.title)) {
      rejected.push({ action, reason: "목표 제목이 없습니다.", approvalRequired: false });
      continue;
    }

    if (action.type === "create_task") {
      if (!hasText(action.title)) {
        rejected.push({ action, reason: "태스크 제목이 없습니다.", approvalRequired: false });
        continue;
      }

      if (!validateReference(db, action.goalRef, batchIds, "node")) {
        rejected.push({ action, reason: "연결할 목표를 찾을 수 없습니다.", approvalRequired: false });
        continue;
      }
    }

    if (action.type === "create_artifact_request") {
      if (!hasText(action.title)) {
        rejected.push({ action, reason: "산출물 제목이 없습니다.", approvalRequired: false });
        continue;
      }

      if (!validateReference(db, action.taskRef, batchIds, "task")) {
        rejected.push({ action, reason: "연결할 태스크를 찾을 수 없습니다.", approvalRequired: false });
        continue;
      }
    }

    if (action.type === "propose_campaign_team") {
      if (!hasText(action.title) || !hasText(action.proposalReason) || !hasValidTeamMembers(action.members)) {
        rejected.push({
          action,
          reason: "PM 팀 제안에는 제목, 이유, 1~5명의 이름/역할/임무가 필요합니다.",
          approvalRequired: false
        });
        continue;
      }
    }

    if (action.type === "request_owner_decision") {
      if (!hasText(action.title) || !hasText(action.decisionReason) || action.options.length < 2) {
        rejected.push({ action, reason: "결정 요청에는 제목, 이유, 2개 이상의 선택지가 필요합니다.", approvalRequired: false });
        continue;
      }
    }

    if (action.type === "revise_artifact") {
      if (!hasText(action.artifactId) || !artifactExists(db, action.artifactId)) {
        rejected.push({ action, reason: "수정할 산출물을 찾을 수 없습니다.", approvalRequired: false });
        continue;
      }

      if (!hasText(action.revisionInstruction)) {
        rejected.push({ action, reason: "수정 요청 내용이 없습니다.", approvalRequired: false });
        continue;
      }

      const invalidRelatedArtifact = (action.relatedArtifactIds ?? []).find((artifactId) => !artifactExists(db, artifactId));
      if (invalidRelatedArtifact) {
        rejected.push({ action, reason: "관련 산출물 중 찾을 수 없는 항목이 있습니다.", approvalRequired: false });
        continue;
      }
    }

    accepted.push(action);
  }

  return { accepted, rejected };
}

function resolveRef(ref: string | undefined, idMap: Record<string, string>): string | undefined {
  if (!ref) {
    return undefined;
  }

  return idMap[ref] ?? ref;
}

function insertGraphNode(
  db: DatabaseSync,
  campaignId: string,
  nodeId: string,
  type: string,
  title: string,
  status: string,
  summary: string
): void {
  db.prepare(
    `INSERT INTO graph_nodes (id, campaign_id, type, title, status, summary)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(nodeId, campaignId, type, title, status, summary);
}

function insertGraphEdge(
  db: DatabaseSync,
  campaignId: string,
  fromNodeId: string,
  toNodeId: string,
  relation: string
): void {
  db.prepare(
    `INSERT INTO graph_edges (id, campaign_id, from_node_id, to_node_id, relation)
     VALUES (?, ?, ?, ?, ?)`
  ).run(createId("edge"), campaignId, fromNodeId, toNodeId, relation);
}

function applyCreateGoal(db: DatabaseSync, campaignId: string, action: CreateGoalAction, idMap: Record<string, string>): void {
  const goalId = createId("goal");
  idMap[action.clientId] = goalId;
  insertGraphNode(db, campaignId, goalId, "goal", action.title, action.status ?? "ready", action.summary ?? "");
}

function applyCreateTask(db: DatabaseSync, campaignId: string, action: CreateTaskAction, idMap: Record<string, string>): void {
  const taskId = createId("task");
  idMap[action.clientId] = taskId;

  db.prepare(
    `INSERT INTO tasks (
      id,
      campaign_id,
      title,
      description,
      status,
      instructions,
      acceptance_criteria,
      priority
    )
    VALUES (?, ?, ?, ?, 'ready', ?, ?, ?)`
  ).run(
    taskId,
    campaignId,
    action.title,
    action.description ?? "",
    action.instructions ?? "",
    action.acceptanceCriteria ?? "",
    action.priority ?? "normal"
  );

  insertGraphNode(db, campaignId, taskId, "task", action.title, "ready", action.description ?? "");

  const goalId = resolveRef(action.goalRef, idMap);
  if (goalId) {
    insertGraphEdge(db, campaignId, goalId, taskId, "contains");
  }
}

function applyCreateArtifact(
  db: DatabaseSync,
  config: AppConfig,
  campaignId: string,
  action: CreateArtifactRequestAction,
  idMap: Record<string, string>
): void {
  const artifactId = createId("artifact");
  const taskId = resolveRef(action.taskRef, idMap);
  idMap[action.clientId] = artifactId;

  db.prepare(
    `INSERT INTO artifacts (
      id,
      campaign_id,
      display_number,
      title,
      kind,
      status,
      linked_task_ids
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    artifactId,
    campaignId,
    getNextArtifactNumber(db, campaignId),
    action.title,
    action.kind ?? "markdown",
    action.status ?? "draft",
    JSON.stringify(taskId ? [taskId] : [])
  );

  insertGraphNode(db, campaignId, artifactId, "artifact", action.title, action.status ?? "draft", "");

  if (taskId) {
    insertGraphEdge(db, campaignId, taskId, artifactId, "produces");
  }

  ensureArtifactManifest(db, config, artifactId);
  ensureInitialArtifactVersion(db, config, artifactId, action.reason ?? "PM 대화에서 생성된 산출물 요청입니다.");
}

function applyRequestDecision(
  db: DatabaseSync,
  campaignId: string,
  action: RequestOwnerDecisionAction,
  idMap: Record<string, string>
): void {
  const decisionId = createId("decision");
  const blocks = (action.blocks ?? []).map((block) => resolveRef(block, idMap) ?? block);
  idMap[action.clientId] = decisionId;

  db.prepare(
    `INSERT INTO decisions (
      id,
      campaign_id,
      title,
      reason,
      options,
      recommended_option,
      status,
      blocks
    )
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`
  ).run(
    decisionId,
    campaignId,
    action.title,
    action.decisionReason,
    JSON.stringify(action.options),
    action.recommendedOption,
    JSON.stringify(blocks)
  );

  insertGraphNode(db, campaignId, decisionId, "decision", action.title, "open", action.decisionReason);

  for (const blockedId of blocks) {
    insertGraphEdge(db, campaignId, decisionId, blockedId, "blocks");
  }
}

function applyReviseArtifact(db: DatabaseSync, action: ReviseArtifactAction, idMap: Record<string, string>): void {
  const response = requestArtifactRevision(db, action.artifactId, {
    instruction: action.revisionInstruction,
    relatedArtifactIds: action.relatedArtifactIds
  });

  if (action.clientId) {
    idMap[action.clientId] = response.revisionRequest.id;
  }
}

function applyProposeCampaignTeam(
  db: DatabaseSync,
  campaignId: string,
  action: ProposeCampaignTeamAction,
  idMap: Record<string, string>
): void {
  const existingProposal = listTeamProposals(db, campaignId).find((proposal) => proposal.status === "pending" || proposal.status === "approved");
  if (existingProposal) {
    idMap[action.clientId] = existingProposal.id;
    return;
  }

  const proposal = createTeamProposal(db, campaignId, {
    title: action.title,
    reason: action.proposalReason,
    members: action.members
  });

  idMap[action.clientId] = proposal.id;
}

export function applyPmActions(
  db: DatabaseSync,
  config: AppConfig,
  campaignId: string,
  actions: PmAction[],
  rawOutput: string
): AppliedPmActions {
  const validation = validatePmActions(db, campaignId, actions);
  const idMap: Record<string, string> = {};

  db.prepare(
    `INSERT INTO events (id, type, campaign_id, payload)
     VALUES (?, 'pm_actions_extracted', ?, ?)`
  ).run(createId("event"), campaignId, JSON.stringify({ rawOutput, actions }));

  for (const action of validation.accepted) {
    if (action.type === "update_campaign_summary") {
      db.prepare(
        `UPDATE campaigns
         SET
           summary = COALESCE(NULLIF(?, ''), summary),
           current_focus = COALESCE(NULLIF(?, ''), current_focus),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(action.summary ?? "", action.currentFocus ?? "", campaignId);
    }

    if (action.type === "create_goal") {
      applyCreateGoal(db, campaignId, action, idMap);
    }

    if (action.type === "create_task") {
      applyCreateTask(db, campaignId, action, idMap);
    }

    if (action.type === "create_artifact_request") {
      applyCreateArtifact(db, config, campaignId, action, idMap);
    }

    if (action.type === "request_owner_decision") {
      applyRequestDecision(db, campaignId, action, idMap);
    }

    if (action.type === "revise_artifact") {
      applyReviseArtifact(db, action, idMap);
    }

    if (action.type === "propose_campaign_team") {
      applyProposeCampaignTeam(db, campaignId, action, idMap);
    }
  }

  db.prepare(
    `INSERT INTO events (id, type, campaign_id, payload)
     VALUES (?, 'pm_actions_applied', ?, ?)`
  ).run(
    createId("event"),
    campaignId,
    JSON.stringify({
      accepted: validation.accepted,
      rejected: validation.rejected,
      createdIds: idMap
    })
  );

  return {
    accepted: validation.accepted,
    rejected: validation.rejected,
    createdIds: idMap
  };
}

function listArtifactCandidates(db: DatabaseSync, campaignId: string): ArtifactCandidate[] {
  return db
    .prepare(
      `SELECT
        id,
        display_number AS displayNumber,
        title,
        updated_at AS updatedAt
      FROM artifacts
      WHERE campaign_id = ?
      ORDER BY updated_at DESC, display_number DESC`
    )
    .all(campaignId) as unknown as ArtifactCandidate[];
}

function findRevisionTargetArtifact(db: DatabaseSync, campaignId: string, ownerMessage: string): ArtifactCandidate | null {
  const artifacts = listArtifactCandidates(db, campaignId);
  if (artifacts.length === 0) {
    return null;
  }

  for (const artifact of artifacts) {
    const displayNumber = String(artifact.displayNumber);
    const paddedNumber = displayNumber.padStart(3, "0");
    if (ownerMessage.includes(paddedNumber) || new RegExp(`(^|\\D)${displayNumber}(\\D|$)`).test(ownerMessage)) {
      return artifact;
    }
  }

  const titleMatched = artifacts.find((artifact) => ownerMessage.includes(artifact.title));
  if (titleMatched) {
    return titleMatched;
  }

  return artifacts[0];
}

function buildRevisionActionFromOwnerMessage(
  db: DatabaseSync,
  campaignId: string,
  ownerMessage: string
): ReviseArtifactAction | null {
  if (!isRevisionMessage(ownerMessage)) {
    return null;
  }

  const targetArtifact = findRevisionTargetArtifact(db, campaignId, ownerMessage);
  if (!targetArtifact) {
    return null;
  }

  return {
    type: "revise_artifact",
    clientId: "revision-owner-request",
    artifactId: targetArtifact.id,
    revisionInstruction: ownerMessage.trim(),
    reason: "대표의 자연어 수정 요청을 산출물 수정 액션으로 구조화"
  };
}

export function extractValidateAndApplyPmActions(
  db: DatabaseSync,
  config: AppConfig,
  campaign: CampaignSummary,
  ownerMessage: string,
  pmReply: string
): AppliedPmActions {
  const extracted = isCodexCliRunner(config)
    ? extractPmActionsWithRunner(db, config, campaign, ownerMessage, pmReply)
    : extractPmActions({ campaign, ownerMessage, pmReply });
  const revisionAction = buildRevisionActionFromOwnerMessage(db, campaign.id, ownerMessage);

  if (revisionAction) {
    const campaignSummaryAction = extracted.actions.find((action) => action.type === "update_campaign_summary");
    const actions = campaignSummaryAction ? [campaignSummaryAction, revisionAction] : [revisionAction];
    return applyPmActions(db, config, campaign.id, actions, JSON.stringify(actions, null, 2));
  }

  return applyPmActions(db, config, campaign.id, extracted.actions, extracted.rawOutput);
}
