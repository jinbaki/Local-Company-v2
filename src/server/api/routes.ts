import { Router } from "express";
import type { DatabaseContext } from "../storage/db.js";
import type {
  AppStateResponse,
  ApproveCampaignTeamProposalResponse,
  AnswerDecisionRequest,
  AnswerDecisionResponse,
  AssignWorkerRequest,
  CampaignWorkspaceResponse,
  CreateCampaignRequest,
  CreateCampaignReferenceRequest,
  CreateCampaignReferenceResponse,
  CreateDivisionRequest,
  CreateWorkerRequest,
  DeleteCampaignResponse,
  DeleteDivisionResponse,
  GenerateHandoffReportResponse,
  QueueRunResponse,
  RequestArtifactRevisionRequest,
  RequestArtifactRevisionResponse,
  SendMessageRequest,
  SendMessageResponse,
  UpdateCampaignStatusRequest,
  UpdateCampaignStatusResponse,
  UpdateDivisionRequest,
  UpdateDivisionResponse
} from "../../shared/types/app-state.js";
import type {
  CodexConnectionStatusResponse,
  OpenCodexLoginTerminalResponse,
  UpdateRunnerSettingsRequest,
  UpdateRunnerSettingsResponse
} from "../../shared/types/health.js";
import { createCampaign, getCampaign, getCampaignPm, listCampaigns, updateCampaignStatus } from "../services/campaign-service.js";
import { createDivision, ensureDefaultDivision, listDivisions, listWorkers, updateDivision } from "../services/division-service.js";
import { ensureConversation, listMessages, sendOwnerMessage } from "../services/conversation-service.js";
import { getCampaignProjection } from "../services/graph-service.js";
import { getArtifactDetail, listArtifacts } from "../services/artifact-service.js";
import { assignWorkerToCampaign, createWorker, startWorkerSession } from "../services/worker-service.js";
import { runNextQueueItem, syncQueueForCampaign } from "../services/queue-service.js";
import { answerDecision, getDecision, listDecisions } from "../services/decision-service.js";
import { requestArtifactRevision } from "../services/revision-service.js";
import { generateCampaignHandoffReport } from "../services/report-service.js";
import { approveTeamProposal } from "../services/team-proposal-service.js";
import { createCampaignReference, listCampaignReferences } from "../services/reference-service.js";
import { checkCodexConnection, openCodexLoginTerminal, updateRunnerSettings } from "../services/runner-settings-service.js";
import { deleteCampaign, deleteDivision } from "../services/delete-service.js";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}

export function createApiRouter(context: DatabaseContext): Router {
  const router = Router();

  router.get("/app-state", (_request, response) => {
    ensureDefaultDivision(context.db);
    const payload: AppStateResponse = {
      divisions: listDivisions(context.db),
      workers: listWorkers(context.db),
      campaigns: listCampaigns(context.db),
      decisions: listDecisions(context.db, "open")
    };

    response.json(payload);
  });

  router.patch("/settings/runner", (request, response) => {
    try {
      const body = request.body as UpdateRunnerSettingsRequest;
      const payload: UpdateRunnerSettingsResponse = {
        runner: updateRunnerSettings(context.db, context.config, body),
        message: "Codex 실행 설정을 저장했습니다."
      };
      response.status(200).json(payload);
    } catch (error: unknown) {
      response.status(400).json({ message: getErrorMessage(error) });
    }
  });

  router.post("/settings/codex-login-terminal", (_request, response) => {
    try {
      const payload: OpenCodexLoginTerminalResponse = openCodexLoginTerminal(context.config);
      response.status(200).json(payload);
    } catch (error: unknown) {
      response.status(400).json({ message: getErrorMessage(error) });
    }
  });

  router.get("/settings/codex-status", (_request, response) => {
    try {
      const payload: CodexConnectionStatusResponse = checkCodexConnection(context.config);
      response.status(200).json(payload);
    } catch (error: unknown) {
      response.status(400).json({ message: getErrorMessage(error) });
    }
  });

  router.post("/campaigns", (request, response) => {
    try {
      const body = request.body as CreateCampaignRequest;
      const campaign = createCampaign(context.db, context.config, body);
      response.status(201).json(campaign);
    } catch (error: unknown) {
      response.status(400).json({ message: getErrorMessage(error) });
    }
  });

  router.delete("/campaigns/:campaignId", (request, response) => {
    try {
      const payload: DeleteCampaignResponse = deleteCampaign(context.db, context.config, request.params.campaignId);
      response.status(200).json(payload);
    } catch (error: unknown) {
      response.status(400).json({ message: getErrorMessage(error) });
    }
  });

  router.post("/divisions", (request, response) => {
    try {
      const body = request.body as CreateDivisionRequest;
      const division = createDivision(context.db, context.config, body);
      response.status(201).json(division);
    } catch (error: unknown) {
      response.status(400).json({ message: getErrorMessage(error) });
    }
  });

  router.patch("/divisions/:divisionId", (request, response) => {
    try {
      const body = request.body as UpdateDivisionRequest;
      const division = updateDivision(context.db, request.params.divisionId, body);
      const payload: UpdateDivisionResponse = {
        division,
        message: "사업부 정보를 수정했습니다."
      };
      response.status(200).json(payload);
    } catch (error: unknown) {
      response.status(400).json({ message: getErrorMessage(error) });
    }
  });

  router.delete("/divisions/:divisionId", (request, response) => {
    try {
      const payload: DeleteDivisionResponse = deleteDivision(context.db, context.config, request.params.divisionId);
      response.status(200).json(payload);
    } catch (error: unknown) {
      response.status(400).json({ message: getErrorMessage(error) });
    }
  });

  router.post("/workers", (request, response) => {
    try {
      const body = request.body as CreateWorkerRequest;
      const worker = createWorker(context.db, body);
      response.status(201).json(worker);
    } catch (error: unknown) {
      response.status(400).json({ message: getErrorMessage(error) });
    }
  });

  router.get("/campaigns/:campaignId", (request, response) => {
    const campaign = getCampaign(context.db, request.params.campaignId);
    if (!campaign) {
      response.status(404).json({ message: "캠페인을 찾을 수 없습니다." });
      return;
    }

    ensureConversation(context.db, context.config, campaign.id);

    const payload: CampaignWorkspaceResponse = {
      campaign,
      pm: getCampaignPm(context.db, campaign.id),
      messages: listMessages(context.db, campaign.id),
      references: listCampaignReferences(context.db, campaign.id),
      projection: getCampaignProjection(context.db, campaign.id)
    };

    response.json(payload);
  });

  router.post("/campaigns/:campaignId/references", (request, response) => {
    try {
      const body = request.body as CreateCampaignReferenceRequest;
      const payload: CreateCampaignReferenceResponse = createCampaignReference(context.db, context.config, request.params.campaignId, body);
      response.status(201).json(payload);
    } catch (error: unknown) {
      response.status(400).json({ message: getErrorMessage(error) });
    }
  });

  router.post("/campaigns/:campaignId/messages", (request, response) => {
    try {
      const body = request.body as SendMessageRequest;
      const payload: SendMessageResponse = {
        messages: sendOwnerMessage(context.db, context.config, request.params.campaignId, body.content)
      };

      response.status(201).json(payload);
    } catch (error: unknown) {
      response.status(400).json({ message: getErrorMessage(error) });
    }
  });

  router.post("/campaigns/:campaignId/reports/handoff", (request, response) => {
    try {
      const report = generateCampaignHandoffReport(context.db, context.config, request.params.campaignId);
      const payload: GenerateHandoffReportResponse = {
        report,
        message: `인계 보고서 ${report.files.length}개를 생성했습니다.`
      };
      response.status(201).json(payload);
    } catch (error: unknown) {
      response.status(400).json({ message: getErrorMessage(error) });
    }
  });

  router.post("/campaigns/:campaignId/status", (request, response) => {
    try {
      const body = request.body as UpdateCampaignStatusRequest;
      const campaign = updateCampaignStatus(context.db, request.params.campaignId, body);
      const payload: UpdateCampaignStatusResponse = {
        campaign,
        message: `캠페인 상태가 ${campaign.status}(으)로 바뀌었습니다.`
      };
      response.status(201).json(payload);
    } catch (error: unknown) {
      response.status(400).json({ message: getErrorMessage(error) });
    }
  });

  router.post("/campaigns/:campaignId/workers", (request, response) => {
    try {
      const body = request.body as AssignWorkerRequest;
      const assigned = assignWorkerToCampaign(context.db, request.params.campaignId, body);
      response.status(201).json(assigned);
    } catch (error: unknown) {
      response.status(400).json({ message: getErrorMessage(error) });
    }
  });

  router.post("/campaigns/:campaignId/workers/:workerId/session", (request, response) => {
    try {
      const worker = startWorkerSession(context.db, request.params.campaignId, request.params.workerId);
      response.status(201).json(worker);
    } catch (error: unknown) {
      response.status(400).json({ message: getErrorMessage(error) });
    }
  });

  router.post("/team-proposals/:proposalId/approve", (request, response) => {
    try {
      const payload: ApproveCampaignTeamProposalResponse = approveTeamProposal(context.db, request.params.proposalId);
      syncQueueForCampaign(context.db, payload.proposal.campaignId);
      response.status(201).json(payload);
    } catch (error: unknown) {
      response.status(400).json({ message: getErrorMessage(error) });
    }
  });

  router.post("/campaigns/:campaignId/queue/sync", (request, response) => {
    try {
      response.json({ queueItems: syncQueueForCampaign(context.db, request.params.campaignId) });
    } catch (error: unknown) {
      response.status(400).json({ message: getErrorMessage(error) });
    }
  });

  router.post("/campaigns/:campaignId/queue/run-next", (request, response) => {
    try {
      const payload: QueueRunResponse = runNextQueueItem(context.db, context.config, request.params.campaignId);
      response.status(201).json(payload);
    } catch (error: unknown) {
      response.status(400).json({ message: getErrorMessage(error) });
    }
  });

  router.get("/artifacts", (request, response) => {
    const campaignId = typeof request.query.campaignId === "string" ? request.query.campaignId : undefined;
    response.json({
      artifacts: listArtifacts(context.db, campaignId)
    });
  });

  router.get("/artifacts/:artifactId", (request, response) => {
    try {
      response.json(getArtifactDetail(context.db, context.config, request.params.artifactId));
    } catch (error: unknown) {
      response.status(404).json({ message: getErrorMessage(error) });
    }
  });

  router.post("/artifacts/:artifactId/revision-requests", (request, response) => {
    try {
      const body = request.body as RequestArtifactRevisionRequest;
      const payload: RequestArtifactRevisionResponse = requestArtifactRevision(context.db, request.params.artifactId, body);
      response.status(payload.created ? 201 : 200).json(payload);
    } catch (error: unknown) {
      response.status(400).json({ message: getErrorMessage(error) });
    }
  });

  router.get("/decisions", (request, response) => {
    const status = typeof request.query.status === "string" ? request.query.status : undefined;
    response.json({
      decisions: listDecisions(context.db, status)
    });
  });

  router.get("/decisions/:decisionId", (request, response) => {
    const decision = getDecision(context.db, request.params.decisionId);
    if (!decision) {
      response.status(404).json({ message: "결정 항목을 찾을 수 없습니다." });
      return;
    }

    response.json(decision);
  });

  router.post("/decisions/:decisionId/answer", (request, response) => {
    try {
      const body = request.body as AnswerDecisionRequest;
      const payload: AnswerDecisionResponse = answerDecision(context.db, request.params.decisionId, body);
      response.status(201).json(payload);
    } catch (error: unknown) {
      response.status(400).json({ message: getErrorMessage(error) });
    }
  });

  return router;
}
