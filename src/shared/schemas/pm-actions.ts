export type PmActionType =
  | "update_campaign_summary"
  | "create_goal"
  | "update_goal"
  | "create_task"
  | "update_task"
  | "create_artifact_request"
  | "revise_artifact"
  | "propose_campaign_team"
  | "assign_worker"
  | "start_worker_session"
  | "enqueue_work"
  | "request_owner_decision"
  | "mark_done"
  | "archive_item";

export interface BasePmAction {
  type: PmActionType;
  clientId?: string;
  reason?: string;
}

export interface UpdateCampaignSummaryAction extends BasePmAction {
  type: "update_campaign_summary";
  summary?: string;
  currentFocus?: string;
}

export interface CreateGoalAction extends BasePmAction {
  type: "create_goal";
  clientId: string;
  title: string;
  summary?: string;
  status?: "draft" | "ready" | "running" | "blocked" | "done";
}

export interface UpdateGoalAction extends BasePmAction {
  type: "update_goal";
  goalId: string;
  title?: string;
  summary?: string;
  status?: string;
}

export interface CreateTaskAction extends BasePmAction {
  type: "create_task";
  clientId: string;
  title: string;
  description?: string;
  instructions?: string;
  acceptanceCriteria?: string;
  priority?: "low" | "normal" | "high";
  goalRef?: string;
}

export interface UpdateTaskAction extends BasePmAction {
  type: "update_task";
  taskId: string;
  title?: string;
  description?: string;
  status?: string;
}

export interface CreateArtifactRequestAction extends BasePmAction {
  type: "create_artifact_request";
  clientId: string;
  title: string;
  kind?: "markdown" | "html" | "json" | "csv" | "image" | "folder";
  status?: "draft" | "in_review" | "needs_revision" | "approved" | "archived";
  taskRef?: string;
}

export interface ReviseArtifactAction extends BasePmAction {
  type: "revise_artifact";
  artifactId: string;
  revisionInstruction: string;
  relatedArtifactIds?: string[];
}

export interface ProposeCampaignTeamAction extends BasePmAction {
  type: "propose_campaign_team";
  clientId: string;
  title: string;
  proposalReason: string;
  members: {
    name: string;
    role: string;
    mission: string;
  }[];
}

export interface AssignWorkerAction extends BasePmAction {
  type: "assign_worker";
  taskId: string;
  workerId: string;
}

export interface StartWorkerSessionAction extends BasePmAction {
  type: "start_worker_session";
  workerId: string;
}

export interface EnqueueWorkAction extends BasePmAction {
  type: "enqueue_work";
  taskId: string;
  workerId?: string;
}

export interface RequestOwnerDecisionAction extends BasePmAction {
  type: "request_owner_decision";
  clientId: string;
  title: string;
  decisionReason: string;
  options: string[];
  recommendedOption: string;
  blocks?: string[];
}

export interface MarkDoneAction extends BasePmAction {
  type: "mark_done";
  targetId: string;
}

export interface ArchiveItemAction extends BasePmAction {
  type: "archive_item";
  targetId: string;
}

export type PmAction =
  | UpdateCampaignSummaryAction
  | CreateGoalAction
  | UpdateGoalAction
  | CreateTaskAction
  | UpdateTaskAction
  | CreateArtifactRequestAction
  | ReviseArtifactAction
  | ProposeCampaignTeamAction
  | AssignWorkerAction
  | StartWorkerSessionAction
  | EnqueueWorkAction
  | RequestOwnerDecisionAction
  | MarkDoneAction
  | ArchiveItemAction;

export interface PmActionValidationIssue {
  action: PmAction;
  reason: string;
  approvalRequired: boolean;
}

export interface PmActionValidationResult {
  accepted: PmAction[];
  rejected: PmActionValidationIssue[];
}

export const pmActionTypes: PmActionType[] = [
  "update_campaign_summary",
  "create_goal",
  "update_goal",
  "create_task",
  "update_task",
  "create_artifact_request",
  "revise_artifact",
  "propose_campaign_team",
  "assign_worker",
  "start_worker_session",
  "enqueue_work",
  "request_owner_decision",
  "mark_done",
  "archive_item"
];

export const approvalRequiredActionTypes: PmActionType[] = [
  "assign_worker",
  "start_worker_session",
  "enqueue_work",
  "mark_done",
  "archive_item"
];

export function isPmAction(value: unknown): value is PmAction {
  if (!value || typeof value !== "object") {
    return false;
  }

  const action = value as { type?: unknown };
  return typeof action.type === "string" && pmActionTypes.includes(action.type as PmActionType);
}
