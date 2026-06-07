import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { AppConfig } from "../config.js";
import type { ArtifactDetailResponse, CampaignSummary } from "../../shared/types/app-state.js";

export type PmReviewResult = "approved" | "needs_revision" | "owner_decision";

export interface CodexRunInput {
  purpose: "pm_reply" | "scribe_actions" | "worker_run" | "artifact_revision" | "pm_review";
  model?: string;
  prompt: string;
}

export interface CodexWorkerTask {
  title: string;
  description: string;
  instructions: string;
  acceptanceCriteria: string;
}

export interface CodexPmReview {
  result: PmReviewResult;
  review: string;
  summary: string;
}

export function isCodexCliRunner(config: AppConfig): boolean {
  return (config.codexRunner ?? "mock").toLowerCase() === "codex-cli";
}

function compactText(value: string, maxLength = 72): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length <= maxLength ? compacted : `${compacted.slice(0, maxLength)}...`;
}

function createTempOutputPath(purpose: string): string {
  return path.join(os.tmpdir(), `local-company-${purpose}-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
}

function buildCodexCommand(bin: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== "win32") {
    return { command: bin, args };
  }

  return {
    command: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/c", bin, ...args]
  };
}

function readOutput(outputPath: string, stdout: string): string {
  if (fs.existsSync(outputPath)) {
    const text = fs.readFileSync(outputPath, "utf8").trim();
    fs.rmSync(outputPath, { force: true });
    if (text) {
      return text;
    }
  }

  return stdout.trim();
}

export function runCodexCli(config: AppConfig, input: CodexRunInput): string {
  const outputPath = createTempOutputPath(input.purpose);
  const model = input.model ?? config.codexPmModel ?? "gpt-5.5";
  const args = [
    "exec",
    "-m",
    model,
    "--output-last-message",
    outputPath,
    ...(config.codexExecArgs ?? []),
    "-"
  ];
  const command = buildCodexCommand(config.codexCliBin ?? "codex", args);

  const result = spawnSync(command.command, command.args, {
    cwd: config.rootDir,
    encoding: "utf8",
    input: input.prompt,
    timeout: config.codexTimeoutMs ?? 600000,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8
  });

  if (result.error) {
    fs.rmSync(outputPath, { force: true });
    throw new Error(`Codex CLI 실행에 실패했습니다: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fs.rmSync(outputPath, { force: true });
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`Codex CLI가 실패했습니다. ${detail || `exit code ${result.status}`}`);
  }

  const output = readOutput(outputPath, result.stdout ?? "");
  if (!output) {
    throw new Error("Codex CLI가 빈 응답을 반환했습니다.");
  }

  return output;
}

export function createMockPmReply(campaign: CampaignSummary, ownerMessage: string, referenceContext = "없음"): string {
  const focus = compactText(ownerMessage, 48);
  const referenceLine =
    referenceContext === "없음" ? "등록된 참고자료는 아직 없습니다." : "등록된 참고자료를 함께 확인해 캠페인 방향에 반영하겠습니다.";

  return [
    `대표님, "${campaign.title}" 캠페인 기준으로 이해했습니다.`,
    "",
    `지금 초점은 "${focus}"를 실행 가능한 업무로 정리하는 것입니다.`,
    referenceLine,
    "다음 단계에서 목표, 태스크, 필요한 산출물을 나누어 운영판에 반영하겠습니다.",
    "외부 사실 확인, 비용, 연락, 확정 판단이 필요한 항목은 결정함에 따로 올리겠습니다."
  ].join("\n");
}

export function createPmReply(config: AppConfig, campaign: CampaignSummary, ownerMessage: string, referenceContext = "없음"): string {
  if (!isCodexCliRunner(config)) {
    return createMockPmReply(campaign, ownerMessage, referenceContext);
  }

  return runCodexCli(config, {
    purpose: "pm_reply",
    model: config.codexPmModel,
    prompt: [
      "당신은 Local Company V2의 캠페인 PM입니다.",
      "대표의 요청을 받아 실행 방향을 정리하되, 확정되지 않은 외부 사실은 단정하지 마세요.",
      "답변은 한국어 Markdown으로 작성하세요.",
      "반드시 다음을 포함하세요: 이해한 목표, 다음 작업 방향, 필요한 산출물, 필요한 AI 직원 구성, 사람이 확인해야 할 항목.",
      "",
      `캠페인 제목: ${campaign.title}`,
      `캠페인 요약: ${campaign.summary || "아직 없음"}`,
      "",
      "캠페인 참고자료:",
      referenceContext,
      "",
      `대표 요청: ${ownerMessage}`
    ].join("\n")
  });
}

export function createWorkerArtifactContent(config: AppConfig, task: CodexWorkerTask, workerName: string): string {
  if (!isCodexCliRunner(config)) {
    return [
      `# ${task.title}`,
      "",
      "## 작업 결과",
      "",
      `${workerName}이 PM의 작업지시를 바탕으로 산출물을 확장했습니다.`,
      "",
      "## 작업 목적",
      "",
      task.description || "PM 대화에서 생성된 작업을 실행 가능한 문서로 정리합니다.",
      "",
      "## PM 작업지시",
      "",
      task.instructions || "작업지시가 아직 상세화되지 않았습니다.",
      "",
      "## 완료 기준",
      "",
      task.acceptanceCriteria || "PM이 검토할 수 있는 초안 산출물이 있어야 합니다.",
      "",
      "## 남은 리스크",
      "",
      "- 외부 사실 확인이 필요한 항목은 대표 또는 사람 직원 확인이 필요합니다.",
      "- 실제 Codex 직원 실행 전까지 이 문서는 mock worker 결과입니다.",
      ""
    ].join("\n");
  }

  return runCodexCli(config, {
    purpose: "worker_run",
    model: config.codexWorkerModel,
    prompt: [
      "당신은 Local Company V2의 AI 직원입니다.",
      "PM 작업지시를 바탕으로 대표가 바로 검토할 수 있는 산출물 초안을 Markdown으로 작성하세요.",
      "확정되지 않은 외부 사실은 '확인 필요'로 표시하세요.",
      "",
      `직원 이름: ${workerName}`,
      `작업 제목: ${task.title}`,
      `작업 설명: ${task.description || "없음"}`,
      `PM 작업지시:\n${task.instructions || "없음"}`,
      `완료 기준: ${task.acceptanceCriteria || "없음"}`
    ].join("\n")
  });
}

function cleanRevisionMarkers(value: string): string {
  return value.replace(/\[NEEDS_REVISION\]|재작업 필요/g, "").trim();
}

export function createRevisionArtifactContent(
  config: AppConfig,
  detail: ArtifactDetailResponse,
  workerName: string,
  revisionInstruction?: string
): string {
  if (!isCodexCliRunner(config)) {
    const cleanTitle = cleanRevisionMarkers(detail.artifact.title) || detail.artifact.title;

    return [
      `# ${cleanTitle}`,
      "",
      "## 재작업 결과",
      "",
      `${workerName}이 PM 리뷰를 반영해 산출물을 보강했습니다.`,
      "",
      "## 보강 내용",
      "",
      revisionInstruction ? `- 대표 수정 요청을 반영했습니다: ${revisionInstruction}` : "- PM 리뷰에서 나온 재작업 요청을 반영했습니다.",
      "- 목적, 근거, 다음 행동을 더 분명히 정리했습니다.",
      "- 대표 판단이 필요한 항목은 확정 표현으로 쓰지 않았습니다.",
      "",
      "## 본문",
      "",
      cleanRevisionMarkers(detail.content),
      "",
      "## 남은 리스크",
      "",
      "- 외부 사실은 사람 확인 후 확정해야 합니다.",
      ""
    ].join("\n");
  }

  return runCodexCli(config, {
    purpose: "artifact_revision",
    model: config.codexWorkerModel,
    prompt: [
      "당신은 Local Company V2의 AI 직원입니다.",
      "기존 산출물을 보존하면서 수정 요청을 반영한 새 Markdown 버전을 작성하세요.",
      "확정되지 않은 외부 사실은 단정하지 말고 확인 필요로 남기세요.",
      "",
      `직원 이름: ${workerName}`,
      `산출물 제목: ${detail.artifact.title}`,
      `현재 버전: ${detail.currentVersion?.version ?? "없음"}`,
      `수정 요청: ${revisionInstruction || "PM 리뷰에서 나온 재작업 요청"}`,
      "",
      "기존 본문:",
      detail.content
    ].join("\n")
  });
}

function evaluateMockPmReview(detail: ArtifactDetailResponse): PmReviewResult {
  const content = detail.content;

  if (/\[OWNER_DECISION\]|대표 결정 필요|대표 판단 필요|외부 연락 필요|비용 확정 필요/.test(content)) {
    return "owner_decision";
  }

  if (/\[NEEDS_REVISION\]|재작업 필요|보강 필요|근거 부족/.test(content)) {
    return "needs_revision";
  }

  return "approved";
}

function renderMockPmReview(
  detail: ArtifactDetailResponse,
  result: PmReviewResult,
  ownerAnswer?: string | null
): CodexPmReview {
  if (result === "approved") {
    return {
      result,
      summary: ownerAnswer ? "대표 결정을 반영해 PM 리뷰를 통과했습니다." : "PM 리뷰를 통과했습니다.",
      review: [
        "# PM 리뷰",
        "",
        "판정: 승인",
        "",
        "- 산출물 목적이 캠페인 목표와 연결되어 있습니다.",
        "- 다음 행동으로 이어질 수 있는 구조입니다.",
        ownerAnswer ? `- 대표 결정 답변을 반영했습니다: ${ownerAnswer.replace(/\n+/g, " ")}` : "- 외부 사실은 확정하지 않고 확인 필요 항목으로 남겼습니다.",
        ""
      ].join("\n")
    };
  }

  if (result === "needs_revision") {
    return {
      result,
      summary: "PM 리뷰 결과 재작업이 필요합니다.",
      review: [
        "# PM 리뷰",
        "",
        "판정: 재작업 필요",
        "",
        "- 일부 근거와 실행 기준이 충분히 선명하지 않습니다.",
        "- 직원에게 산출물 보강을 요청합니다.",
        ""
      ].join("\n")
    };
  }

  return {
    result,
    summary: "대표 결정이 필요해 자동 실행을 멈췄습니다.",
    review: [
      "# PM 리뷰",
      "",
      "판정: 대표 결정 필요",
      "",
      "- 전략, 비용, 외부 연락, 확정 판단 중 대표 확인이 필요한 항목이 있습니다.",
      "- 결정이 기록될 때까지 관련 자동 실행을 멈춥니다.",
      ""
    ].join("\n")
  };
}

function extractJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("JSON 객체를 찾지 못했습니다.");
  }

  return JSON.parse(candidate.slice(start, end + 1));
}

export function reviewArtifactWithPm(config: AppConfig, detail: ArtifactDetailResponse, ownerAnswer?: string | null): CodexPmReview {
  const mockResult = evaluateMockPmReview(detail);
  if (!isCodexCliRunner(config)) {
    return renderMockPmReview(detail, ownerAnswer ? "approved" : mockResult, ownerAnswer);
  }

  const output = runCodexCli(config, {
    purpose: "pm_review",
    model: config.codexPmModel,
    prompt: [
      "당신은 Local Company V2의 PM 리뷰어입니다.",
      "산출물을 검토하고 반드시 JSON 객체 하나만 반환하세요.",
      "스키마:",
      '{"result":"approved|needs_revision|owner_decision","summary":"짧은 요약","review":"Markdown 리뷰 본문"}',
      "판정 기준:",
      "- 승인 가능하면 approved",
      "- 보강/근거/구조 수정이 필요하면 needs_revision",
      "- 대표가 비용, 외부 연락, 확정 판단을 해야 하면 owner_decision",
      ownerAnswer ? `대표 답변이 이미 있습니다. 답변을 반영하세요: ${ownerAnswer}` : "",
      "",
      `산출물 제목: ${detail.artifact.title}`,
      `현재 버전: ${detail.currentVersion?.version ?? "없음"}`,
      "본문:",
      detail.content
    ].join("\n")
  });
  const parsed = extractJsonObject(output) as Partial<CodexPmReview>;
  const result = parsed.result === "needs_revision" || parsed.result === "owner_decision" ? parsed.result : "approved";

  return {
    result: ownerAnswer ? "approved" : result,
    summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : "Codex PM 리뷰가 완료되었습니다.",
    review:
      typeof parsed.review === "string" && parsed.review.trim()
        ? parsed.review.trim()
        : ["# PM 리뷰", "", `판정: ${result}`, "", output.trim()].join("\n")
  };
}
