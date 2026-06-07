import type { DatabaseSync } from "node:sqlite";
import type {
  ApproveCampaignTeamProposalResponse,
  CampaignTeamMemberProposal,
  CampaignTeamProposalProjection
} from "../../shared/types/app-state.js";
import { createId } from "./ids.js";
import { assignWorkerToCampaign, createWorker, listCampaignWorkers } from "./worker-service.js";

interface TeamProposalRow {
  id: string;
  campaignId: string;
  title: string;
  reason: string;
  members: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  updatedAt: string;
}

interface CreateTeamProposalInput {
  title: string;
  reason: string;
  members: CampaignTeamMemberProposal[];
}

interface CampaignForTeamProposal {
  id: string;
  divisionId: string;
}

function compactText(value: string, maxLength: number): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length <= maxLength ? compacted : `${compacted.slice(0, maxLength).trim()}...`;
}

function normalizeMembers(members: CampaignTeamMemberProposal[]): CampaignTeamMemberProposal[] {
  if (!Array.isArray(members) || members.length === 0) {
    throw new Error("PM 팀 제안에는 최소 1명의 직원 후보가 필요합니다.");
  }

  if (members.length > 5) {
    throw new Error("PM 팀 제안은 한 번에 최대 5명까지만 받을 수 있습니다.");
  }

  return members.map((member) => {
    const name = compactText(member.name ?? "", 40);
    const role = compactText(member.role ?? "", 60);
    const mission = compactText(member.mission ?? "", 200);

    if (!name || !role || !mission) {
      throw new Error("PM 팀 제안의 각 직원에는 이름, 역할, 임무가 모두 필요합니다.");
    }

    return { name, role, mission };
  });
}

function parseMembers(value: string): CampaignTeamMemberProposal[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item): item is CampaignTeamMemberProposal => {
        if (!item || typeof item !== "object") {
          return false;
        }

        const member = item as Partial<CampaignTeamMemberProposal>;
        return typeof member.name === "string" && typeof member.role === "string" && typeof member.mission === "string";
      })
      .map((member) => ({
        name: member.name,
        role: member.role,
        mission: member.mission
      }));
  } catch {
    return [];
  }
}

function normalizeProposal(row: TeamProposalRow): CampaignTeamProposalProjection {
  return {
    ...row,
    members: parseMembers(row.members)
  };
}

function getCampaignForTeamProposal(db: DatabaseSync, campaignId: string): CampaignForTeamProposal | null {
  const row = db
    .prepare(
      `SELECT
        id,
        division_id AS divisionId
      FROM campaigns
      WHERE id = ?`
    )
    .get(campaignId) as unknown as CampaignForTeamProposal | undefined;

  return row ?? null;
}

export function listTeamProposals(db: DatabaseSync, campaignId: string): CampaignTeamProposalProjection[] {
  const rows = db
    .prepare(
      `SELECT
        id,
        campaign_id AS campaignId,
        title,
        reason,
        members,
        status,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM campaign_team_proposals
      WHERE campaign_id = ?
      ORDER BY
        CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
        created_at DESC,
        rowid DESC`
    )
    .all(campaignId) as unknown as TeamProposalRow[];

  return rows.map(normalizeProposal);
}

export function createTeamProposal(
  db: DatabaseSync,
  campaignId: string,
  input: CreateTeamProposalInput
): CampaignTeamProposalProjection {
  const title = compactText(input.title, 100);
  const reason = compactText(input.reason, 400);
  const members = normalizeMembers(input.members);

  if (!title) {
    throw new Error("PM 팀 제안 제목이 필요합니다.");
  }

  const proposalId = createId("team-proposal");

  db.prepare(
    `INSERT INTO campaign_team_proposals (id, campaign_id, title, reason, members, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`
  ).run(proposalId, campaignId, title, reason, JSON.stringify(members));

  const created = listTeamProposals(db, campaignId).find((proposal) => proposal.id === proposalId);
  if (!created) {
    throw new Error("PM 팀 제안을 저장했지만 다시 조회하지 못했습니다.");
  }

  return created;
}

export function approveTeamProposal(db: DatabaseSync, proposalId: string): ApproveCampaignTeamProposalResponse {
  const row = db
    .prepare(
      `SELECT
        id,
        campaign_id AS campaignId,
        title,
        reason,
        members,
        status,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM campaign_team_proposals
      WHERE id = ?`
    )
    .get(proposalId) as unknown as TeamProposalRow | undefined;

  if (!row) {
    throw new Error("PM 팀 제안을 찾을 수 없습니다.");
  }

  const proposal = normalizeProposal(row);
  if (proposal.status !== "pending") {
    throw new Error("이미 처리된 PM 팀 제안입니다.");
  }

  const campaign = getCampaignForTeamProposal(db, proposal.campaignId);
  if (!campaign) {
    throw new Error("캠페인을 찾을 수 없습니다.");
  }

  for (const member of proposal.members) {
    const worker = createWorker(db, {
      divisionId: campaign.divisionId,
      name: member.name,
      position: member.role,
      skills: [member.mission],
      workStyle: member.mission
    });

    assignWorkerToCampaign(db, campaign.id, {
      workerId: worker.id,
      role: member.role
    });
  }

  db.prepare(
    `UPDATE campaign_team_proposals
     SET status = 'approved', updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(proposal.id);

  db.prepare(
    `INSERT INTO events (id, type, campaign_id, payload)
     VALUES (?, 'campaign_team_proposal_approved', ?, ?)`
  ).run(
    createId("event"),
    campaign.id,
    JSON.stringify({
      proposalId: proposal.id,
      memberCount: proposal.members.length
    })
  );

  const updated = listTeamProposals(db, campaign.id).find((item) => item.id === proposal.id);
  if (!updated) {
    throw new Error("PM 팀 제안을 승인했지만 다시 조회하지 못했습니다.");
  }

  return {
    proposal: updated,
    assignedWorkers: listCampaignWorkers(db, campaign.id),
    message: "PM 팀 제안을 승인하고 캠페인 직원으로 배정했습니다."
  };
}
