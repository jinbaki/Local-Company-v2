import type { DatabaseSync } from "node:sqlite";
import type { AnswerDecisionRequest, AnswerDecisionResponse, DecisionInboxItem } from "../../shared/types/app-state.js";
import { createId } from "./ids.js";

type DecisionRow = Omit<DecisionInboxItem, "options" | "blocks" | "blockTitles"> & {
  options: string;
  blocks: string;
};

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

function getBlockTitles(db: DatabaseSync, blockIds: string[]): string[] {
  return blockIds
    .map((blockId) => {
      const row = db
        .prepare(
          `SELECT title
           FROM graph_nodes
           WHERE id = ?`
        )
        .get(blockId) as unknown as { title: string } | undefined;

      return row?.title ?? blockId;
    })
    .filter((title) => title.trim().length > 0);
}

function normalizeDecision(db: DatabaseSync, row: DecisionRow): DecisionInboxItem {
  const blocks = parseJsonArray(row.blocks);

  return {
    ...row,
    options: parseJsonArray(row.options),
    blocks,
    blockTitles: getBlockTitles(db, blocks)
  };
}

function buildDecisionQuery(where: string): string {
  return `SELECT
    d.id,
    d.campaign_id AS campaignId,
    c.title AS campaignTitle,
    d.title,
    d.reason,
    d.options,
    d.recommended_option AS recommendedOption,
    d.status,
    d.blocks,
    d.answer,
    d.updated_at AS updatedAt,
    (
      SELECT COUNT(*)
      FROM queue_items q
      WHERE q.blocked_by_decision_id = d.id AND q.status = 'blocked'
    ) AS blockedQueueCount
  FROM decisions d
  JOIN campaigns c ON c.id = d.campaign_id
  ${where}
  ORDER BY
    CASE d.status
      WHEN 'open' THEN 0
      WHEN 'answered' THEN 1
      ELSE 2
    END,
    d.updated_at DESC,
    d.rowid DESC`;
}

export function listDecisions(db: DatabaseSync, status?: string): DecisionInboxItem[] {
  const where = status ? "WHERE d.status = ?" : "";
  const statement = db.prepare(buildDecisionQuery(where));
  const rows = (status ? statement.all(status) : statement.all()) as unknown as DecisionRow[];

  return rows.map((row) => normalizeDecision(db, row));
}

export function getDecision(db: DatabaseSync, decisionId: string): DecisionInboxItem | null {
  const row = db.prepare(buildDecisionQuery("WHERE d.id = ?")).get(decisionId) as unknown as DecisionRow | undefined;
  return row ? normalizeDecision(db, row) : null;
}

function formatAnswer(input: AnswerDecisionRequest): string {
  const selectedOption = input.selectedOption?.trim();
  const answer = input.answer.trim();

  if (!selectedOption && !answer) {
    throw new Error("결정 내용을 입력하세요.");
  }

  if (selectedOption && answer && selectedOption !== answer) {
    return `선택: ${selectedOption}\n\n메모: ${answer}`;
  }

  return answer || selectedOption || "";
}

function updateCampaignHealth(db: DatabaseSync, campaignId: string): void {
  const openDecision = db
    .prepare("SELECT id FROM decisions WHERE campaign_id = ? AND status = 'open' LIMIT 1")
    .get(campaignId);
  const blockedQueue = db
    .prepare("SELECT id FROM queue_items WHERE campaign_id = ? AND status = 'blocked' LIMIT 1")
    .get(campaignId);

  db.prepare(
    `UPDATE campaigns
     SET health = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(openDecision || blockedQueue ? "needs_owner_decision" : "normal", campaignId);
}

function reopenBlockedArtifacts(db: DatabaseSync, blockIds: string[]): void {
  for (const blockId of blockIds) {
    db.prepare(
      `UPDATE artifacts
       SET status = 'in_review', review_summary = '대표 결정이 기록되어 PM 리뷰를 다시 진행할 수 있습니다.', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'blocked'`
    ).run(blockId);

    db.prepare(
      `UPDATE graph_nodes
       SET status = 'in_review', summary = '대표 결정이 기록되어 PM 리뷰를 다시 진행할 수 있습니다.', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND type = 'artifact' AND status = 'blocked'`
    ).run(blockId);
  }
}

export function answerDecision(db: DatabaseSync, decisionId: string, input: AnswerDecisionRequest): AnswerDecisionResponse {
  const decision = getDecision(db, decisionId);
  if (!decision) {
    throw new Error("결정 항목을 찾을 수 없습니다.");
  }

  if (decision.status !== "open") {
    throw new Error("이미 답변된 결정입니다.");
  }

  const answer = formatAnswer(input);
  const blockedQueueRows = db
    .prepare(
      `SELECT id
       FROM queue_items
       WHERE blocked_by_decision_id = ? AND status = 'blocked'`
    )
    .all(decisionId) as unknown as { id: string }[];

  db.prepare(
    `UPDATE decisions
     SET status = 'answered', answer = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(answer, decisionId);

  db.prepare(
    `UPDATE graph_nodes
     SET status = 'answered', summary = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND type = 'decision'`
  ).run(answer, decisionId);

  db.prepare(
    `UPDATE queue_items
     SET status = 'queued', updated_at = CURRENT_TIMESTAMP
     WHERE blocked_by_decision_id = ? AND status = 'blocked'`
  ).run(decisionId);

  reopenBlockedArtifacts(db, decision.blocks);
  updateCampaignHealth(db, decision.campaignId);

  db.prepare(
    `INSERT INTO events (id, type, campaign_id, payload)
     VALUES (?, 'decision_answered', ?, ?)`
  ).run(
    createId("event"),
    decision.campaignId,
    JSON.stringify({
      decisionId,
      selectedOption: input.selectedOption ?? null,
      answer,
      resumedQueueIds: blockedQueueRows.map((row) => row.id)
    })
  );

  const updatedDecision = getDecision(db, decisionId);
  if (!updatedDecision) {
    throw new Error("결정 답변을 저장했지만 다시 조회하지 못했습니다.");
  }

  return {
    decision: updatedDecision,
    resumedQueueCount: blockedQueueRows.length,
    message:
      blockedQueueRows.length > 0
        ? `결정을 저장했습니다. 멈춰 있던 작업 ${blockedQueueRows.length}건을 다시 대기 상태로 돌렸습니다.`
        : "결정을 저장했습니다."
  };
}
