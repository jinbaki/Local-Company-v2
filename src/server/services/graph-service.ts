import type { DatabaseSync } from "node:sqlite";
import type {
  ArtifactProjection,
  CampaignProjection,
  DecisionProjection,
  GraphEdgeProjection,
  GraphGoal,
  TaskProjection
} from "../../shared/types/app-state.js";
import { listQueueItems } from "./queue-service.js";
import { listTeamProposals } from "./team-proposal-service.js";
import { listCampaignWorkers } from "./worker-service.js";

function parseJsonArray(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function normalizeDecision(row: Omit<DecisionProjection, "options" | "blocks"> & { options: string; blocks: string }): DecisionProjection {
  return {
    ...row,
    options: parseJsonArray(row.options),
    blocks: parseJsonArray(row.blocks)
  };
}

export function nodeExists(db: DatabaseSync, nodeId: string): boolean {
  const row = db.prepare("SELECT id FROM graph_nodes WHERE id = ?").get(nodeId);
  return Boolean(row);
}

export function taskExists(db: DatabaseSync, taskId: string): boolean {
  const row = db.prepare("SELECT id FROM tasks WHERE id = ?").get(taskId);
  return Boolean(row);
}

export function artifactExists(db: DatabaseSync, artifactId: string): boolean {
  const row = db.prepare("SELECT id FROM artifacts WHERE id = ?").get(artifactId);
  return Boolean(row);
}

export function getNextArtifactNumber(db: DatabaseSync, campaignId: string): number {
  const row = db
    .prepare("SELECT COALESCE(MAX(display_number), 0) + 1 AS nextNumber FROM artifacts WHERE campaign_id = ?")
    .get(campaignId) as unknown as { nextNumber: number };
  return row.nextNumber;
}

export function getCampaignProjection(db: DatabaseSync, campaignId: string): CampaignProjection {
  const goals = db
    .prepare(
      `SELECT
        id,
        title,
        status,
        summary,
        updated_at AS updatedAt
      FROM graph_nodes
      WHERE campaign_id = ? AND type = 'goal'
      ORDER BY created_at ASC, rowid ASC`
    )
    .all(campaignId) as unknown as GraphGoal[];

  const tasks = db
    .prepare(
      `SELECT
        t.id,
        t.title,
        t.description,
        t.status,
        t.owner_worker_id AS ownerWorkerId,
        w.name AS ownerWorkerName,
        t.priority,
        t.acceptance_criteria AS acceptanceCriteria,
        t.updated_at AS updatedAt
      FROM tasks t
      LEFT JOIN workers w ON w.id = t.owner_worker_id
      WHERE t.campaign_id = ?
      ORDER BY t.created_at ASC, t.rowid ASC`
    )
    .all(campaignId) as unknown as TaskProjection[];

  const artifacts = db
    .prepare(
      `SELECT
        a.id,
        a.display_number AS displayNumber,
        a.title,
        a.kind,
        a.status,
        a.current_version AS currentVersion,
        a.owner_worker_id AS ownerWorkerId,
        w.name AS ownerWorkerName,
        a.review_summary AS reviewSummary,
        a.updated_at AS updatedAt
      FROM artifacts a
      LEFT JOIN workers w ON w.id = a.owner_worker_id
      WHERE a.campaign_id = ?
      ORDER BY a.display_number ASC`
    )
    .all(campaignId) as unknown as ArtifactProjection[];

  const decisionRows = db
    .prepare(
      `SELECT
        id,
        title,
        reason,
        options,
        recommended_option AS recommendedOption,
        status,
        blocks,
        answer,
        updated_at AS updatedAt
      FROM decisions
      WHERE campaign_id = ?
      ORDER BY created_at ASC, rowid ASC`
    )
    .all(campaignId) as unknown as (Omit<DecisionProjection, "options" | "blocks"> & {
    options: string;
    blocks: string;
  })[];

  const edges = db
    .prepare(
      `SELECT
        id,
        from_node_id AS fromNodeId,
        to_node_id AS toNodeId,
        relation
      FROM graph_edges
      WHERE campaign_id = ?
      ORDER BY created_at ASC, rowid ASC`
    )
    .all(campaignId) as unknown as GraphEdgeProjection[];

  return {
    goals,
    tasks,
    artifacts,
    decisions: decisionRows.map(normalizeDecision),
    edges,
    assignedWorkers: listCampaignWorkers(db, campaignId),
    teamProposals: listTeamProposals(db, campaignId),
    queueItems: listQueueItems(db, campaignId)
  };
}
