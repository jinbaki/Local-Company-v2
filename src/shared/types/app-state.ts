export interface DivisionSummary {
  id: string;
  folderName: string;
  name: string;
  description: string;
  leadWorkerId: string | null;
  leadWorkerName: string | null;
  status: string;
  campaignCount: number;
  workerCount: number;
  updatedAt: string;
}

export interface WorkerSummary {
  id: string;
  divisionId: string;
  name: string;
  position: string;
  status: string;
}

export interface CampaignWorkerSummary {
  workerId: string;
  campaignId: string;
  name: string;
  position: string;
  role: string;
  assignmentStatus: string;
  workerStatus: string;
  sessionStatus: string;
  sessionId: string | null;
  lastUsedAt: string | null;
}

export interface CampaignTeamMemberProposal {
  name: string;
  role: string;
  mission: string;
}

export interface CampaignTeamProposalProjection {
  id: string;
  campaignId: string;
  title: string;
  reason: string;
  members: CampaignTeamMemberProposal[];
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  updatedAt: string;
}

export interface CampaignSummary {
  id: string;
  divisionId: string;
  title: string;
  summary: string;
  pmWorkerId: string | null;
  pmName: string | null;
  status: string;
  currentFocus: string;
  health: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  campaignId: string;
  role: "owner" | "pm" | "system";
  authorName: string;
  content: string;
  createdAt: string;
}

export type CampaignReferenceKind = "note" | "url" | "file";

export interface CampaignReferenceSummary {
  id: string;
  campaignId: string;
  title: string;
  kind: CampaignReferenceKind;
  source: string;
  content: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface GraphGoal {
  id: string;
  title: string;
  status: string;
  summary: string;
  updatedAt: string;
}

export interface TaskProjection {
  id: string;
  title: string;
  description: string;
  status: string;
  ownerWorkerId: string | null;
  ownerWorkerName: string | null;
  priority: string;
  acceptanceCriteria: string;
  updatedAt: string;
}

export interface ArtifactProjection {
  id: string;
  displayNumber: number;
  title: string;
  kind: string;
  status: string;
  currentVersion: string | null;
  ownerWorkerId: string | null;
  ownerWorkerName: string | null;
  reviewSummary: string;
  updatedAt: string;
}

export interface ArtifactVersionSummary {
  artifactId: string;
  version: string;
  createdBy: string;
  sourceQueueItemId: string | null;
  contentPath: string;
  reviewPath: string | null;
  createdAt: string;
}

export interface ArtifactRevisionRequestProjection {
  id: string;
  campaignId: string;
  artifactId: string;
  taskId: string;
  queueItemId: string | null;
  instruction: string;
  status: string;
  updatedAt: string;
}

export interface ArtifactRelationProjection {
  id: string;
  title: string;
  type: string;
  relation: string;
  direction: "from" | "to";
  status: string;
}

export interface ArtifactDetailResponse {
  artifact: ArtifactProjection;
  versions: ArtifactVersionSummary[];
  currentVersion: ArtifactVersionSummary | null;
  content: string;
  review: string;
  viewUrl: string;
  revisionRequests: ArtifactRevisionRequestProjection[];
  relations: ArtifactRelationProjection[];
}

export interface DecisionProjection {
  id: string;
  title: string;
  reason: string;
  options: string[];
  recommendedOption: string;
  status: string;
  blocks: string[];
  answer: string | null;
  updatedAt: string;
}

export interface DecisionInboxItem extends DecisionProjection {
  campaignId: string;
  campaignTitle: string;
  blockedQueueCount: number;
  blockTitles: string[];
}

export interface GraphEdgeProjection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relation: string;
}

export interface QueueItemProjection {
  id: string;
  type: string;
  status: string;
  campaignId: string;
  workerId: string | null;
  workerName: string | null;
  taskId: string | null;
  taskTitle: string | null;
  artifactIds: string[];
  attempt: number;
  maxAttempts: number;
  blockedByDecisionId: string | null;
  updatedAt: string;
}

export interface CampaignProjection {
  goals: GraphGoal[];
  tasks: TaskProjection[];
  artifacts: ArtifactProjection[];
  decisions: DecisionProjection[];
  edges: GraphEdgeProjection[];
  assignedWorkers: CampaignWorkerSummary[];
  teamProposals: CampaignTeamProposalProjection[];
  queueItems: QueueItemProjection[];
}

export interface HandoffItem {
  id: string;
  title: string;
  reason: string;
  sourceType: "decision" | "queue" | "task" | "artifact";
  sourceId: string;
  status: string;
}

export interface CampaignReportFile {
  kind: "human_todos" | "campaign_status" | "owner_brief";
  label: string;
  path: string;
  relativePath: string;
}

export interface CampaignHandoffReportSummary {
  campaignId: string;
  campaignTitle: string;
  generatedAt: string;
  status: string;
  artifactCount: number;
  decisionCount: number;
  humanTodoCount: number;
  nextAiTaskCount: number;
  humanTodos: HandoffItem[];
  nextAiTasks: HandoffItem[];
  files: CampaignReportFile[];
}

export interface AppStateResponse {
  divisions: DivisionSummary[];
  workers: WorkerSummary[];
  campaigns: CampaignSummary[];
  decisions: DecisionInboxItem[];
}

export interface CampaignWorkspaceResponse {
  campaign: CampaignSummary;
  pm: WorkerSummary | null;
  messages: ConversationMessage[];
  references: CampaignReferenceSummary[];
  projection: CampaignProjection;
}

export interface CreateCampaignRequest {
  divisionId: string;
  title: string;
  summary?: string;
}

export interface CreateCampaignReferenceRequest {
  title: string;
  kind: CampaignReferenceKind;
  source?: string;
  content?: string;
  fileName?: string;
  fileMimeType?: string;
  fileBase64?: string;
}

export interface CreateCampaignReferenceResponse {
  reference: CampaignReferenceSummary;
  message: string;
}

export interface CreateDivisionRequest {
  name: string;
  folderName?: string;
  description?: string;
  leadWorkerName?: string;
}

export interface UpdateDivisionRequest {
  name: string;
  description?: string;
  leadWorkerName?: string;
}

export interface UpdateDivisionResponse {
  division: DivisionSummary;
  message: string;
}

export interface DeleteDivisionResponse {
  divisionId: string;
  deletedCampaignCount: number;
  deletedWorkerCount: number;
  deletedFolderPath: string;
  message: string;
}

export interface CreateWorkerRequest {
  divisionId: string;
  name: string;
  position: string;
  skills?: string[];
  workStyle?: string;
}

export interface AssignWorkerRequest {
  workerId: string;
  role?: string;
}

export interface QueueRunResponse {
  queueItem: QueueItemProjection | null;
  message: string;
}

export interface GenerateHandoffReportResponse {
  report: CampaignHandoffReportSummary;
  message: string;
}

export interface UpdateCampaignStatusRequest {
  status: string;
}

export interface UpdateCampaignStatusResponse {
  campaign: CampaignSummary;
  message: string;
}

export interface DeleteCampaignResponse {
  campaignId: string;
  deletedFolderPath: string;
  message: string;
}

export interface RequestArtifactRevisionRequest {
  instruction: string;
  relatedArtifactIds?: string[];
}

export interface RequestArtifactRevisionResponse {
  revisionRequest: ArtifactRevisionRequestProjection;
  created: boolean;
  message: string;
}

export interface SendMessageRequest {
  content: string;
}

export interface SendMessageResponse {
  messages: ConversationMessage[];
}

export interface AnswerDecisionRequest {
  selectedOption?: string;
  answer: string;
}

export interface AnswerDecisionResponse {
  decision: DecisionInboxItem;
  resumedQueueCount: number;
  message: string;
}

export interface ApproveCampaignTeamProposalResponse {
  proposal: CampaignTeamProposalProjection;
  assignedWorkers: CampaignWorkerSummary[];
  message: string;
}
