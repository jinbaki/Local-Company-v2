import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../config.js";
import type { CampaignSummary, ConversationMessage } from "../../shared/types/app-state.js";
import { ensureDir } from "../storage/file-store.js";
import { createId } from "./ids.js";
import { getCampaign } from "./campaign-service.js";
import { createPmReply } from "./agent-runner.js";
import { extractValidateAndApplyPmActions } from "./pm-action-service.js";
import { syncQueueForCampaign } from "./queue-service.js";
import { renderReferenceContext } from "./reference-service.js";

interface ConversationRecord {
  id: string;
  campaignId: string;
  filePath: string;
}

function getCampaignFolder(config: AppConfig, campaign: CampaignSummary): string {
  return path.join(config.dataDir, "divisions", campaign.divisionId, "campaigns", campaign.id);
}

function getConversationFilePath(config: AppConfig, campaign: CampaignSummary): string {
  return path.join(getCampaignFolder(config, campaign), "conversations", "pm", "conversation.md");
}

function getMessagesJsonlPath(config: AppConfig, campaign: CampaignSummary): string {
  return path.join(getCampaignFolder(config, campaign), "conversations", "pm", "messages.jsonl");
}

export function ensureConversation(db: DatabaseSync, config: AppConfig, campaignId: string): ConversationRecord {
  const existing = db
    .prepare(
      `SELECT
        id,
        campaign_id AS campaignId,
        file_path AS filePath
      FROM conversations
      WHERE campaign_id = ? AND kind = 'pm'`
    )
    .get(campaignId) as unknown as ConversationRecord | undefined;

  if (existing) {
    return existing;
  }

  const campaign = getCampaign(db, campaignId);
  if (!campaign) {
    throw new Error("캠페인을 찾을 수 없습니다.");
  }

  const filePath = getConversationFilePath(config, campaign);
  ensureDir(path.dirname(filePath));

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `# ${campaign.title} PM 대화\n\n`, "utf8");
  }

  const jsonlPath = getMessagesJsonlPath(config, campaign);
  if (!fs.existsSync(jsonlPath)) {
    fs.writeFileSync(jsonlPath, "", "utf8");
  }

  const conversationId = createId("conversation");
  db.prepare(
    `INSERT INTO conversations (id, campaign_id, kind, file_path)
     VALUES (?, ?, 'pm', ?)`
  ).run(conversationId, campaignId, filePath);

  return {
    id: conversationId,
    campaignId,
    filePath
  };
}

export function listMessages(db: DatabaseSync, campaignId: string): ConversationMessage[] {
  return db
    .prepare(
      `SELECT
        id,
        conversation_id AS conversationId,
        campaign_id AS campaignId,
        role,
        author_name AS authorName,
        content,
        created_at AS createdAt
      FROM messages
      WHERE campaign_id = ?
      ORDER BY created_at ASC, rowid ASC`
    )
    .all(campaignId) as unknown as ConversationMessage[];
}

export function appendMessage(
  db: DatabaseSync,
  config: AppConfig,
  campaignId: string,
  role: ConversationMessage["role"],
  authorName: string,
  content: string
): ConversationMessage {
  const campaign = getCampaign(db, campaignId);
  if (!campaign) {
    throw new Error("캠페인을 찾을 수 없습니다.");
  }

  const conversation = ensureConversation(db, config, campaignId);
  const messageId = createId("msg");

  db.prepare(
    `INSERT INTO messages (id, conversation_id, campaign_id, role, author_name, content)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(messageId, conversation.id, campaignId, role, authorName, content);

  db.prepare(
    `UPDATE conversations
     SET updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(conversation.id);

  db.prepare(
    `UPDATE campaigns
     SET updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(campaignId);

  const created = db
    .prepare(
      `SELECT
        id,
        conversation_id AS conversationId,
        campaign_id AS campaignId,
        role,
        author_name AS authorName,
        content,
        created_at AS createdAt
      FROM messages
      WHERE id = ?`
    )
    .get(messageId) as unknown as ConversationMessage;

  const markdownEntry = `## ${created.createdAt} ${authorName}\n\n${content}\n\n`;
  fs.appendFileSync(conversation.filePath, markdownEntry, "utf8");

  const jsonlPath = getMessagesJsonlPath(config, campaign);
  fs.appendFileSync(jsonlPath, `${JSON.stringify(created)}\n`, "utf8");

  return created;
}

export function sendOwnerMessage(
  db: DatabaseSync,
  config: AppConfig,
  campaignId: string,
  content: string
): ConversationMessage[] {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("PM에게 보낼 내용을 입력하세요.");
  }

  const campaign = getCampaign(db, campaignId);
  if (!campaign) {
    throw new Error("캠페인을 찾을 수 없습니다.");
  }

  appendMessage(db, config, campaignId, "owner", "대표(나)", trimmed);
  const referenceContext = renderReferenceContext(db, campaignId);
  const reply = createPmReply(config, campaign, trimmed, referenceContext);
  appendMessage(db, config, campaignId, "pm", campaign.pmName ?? "캠페인 PM", reply);
  extractValidateAndApplyPmActions(db, config, campaign, trimmed, reply);
  syncQueueForCampaign(db, campaignId);

  db.prepare(
    `UPDATE campaigns
     SET current_focus = ?, status = 'planning', updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(trimmed.length > 80 ? `${trimmed.slice(0, 80)}...` : trimmed, campaignId);

  return listMessages(db, campaignId);
}
