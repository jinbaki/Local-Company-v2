import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import type {
  AppStateResponse,
  CampaignReferenceKind,
  CampaignReferenceSummary,
  CampaignSummary,
  CampaignWorkspaceResponse,
  CreateCampaignRequest,
  CreateCampaignReferenceRequest,
  CreateCampaignReferenceResponse,
  CreateDivisionRequest,
  DivisionSummary,
  SendMessageResponse
} from "../shared/types/app-state.js";
import type { HealthResponse } from "../shared/types/health.js";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface ToolCallParams {
  name?: string;
  arguments?: unknown;
}

interface CampaignResolverInput {
  campaignId?: string;
  campaignTitle?: string;
}

interface DivisionResolverInput {
  divisionId?: string;
  divisionName?: string;
}

interface AddReferenceInput extends CampaignResolverInput {
  title?: string;
  kind?: CampaignReferenceKind;
  source?: string;
  content?: string;
  fileName?: string;
  fileMimeType?: string;
  fileBase64?: string;
}

interface LocalCompanyStatusOutput {
  app: string;
  status: string;
  url: string;
  runnerMode: string;
  campaignCount: number;
  openDecisionCount: number;
}

interface ListCampaignsOutput {
  divisions: Array<{
    id: string;
    name: string;
    leadWorkerName: string | null;
    campaignCount: number;
  }>;
  campaigns: Array<{
    id: string;
    divisionId: string;
    title: string;
    pmName: string | null;
    status: string;
    currentFocus: string;
    updatedAt: string;
  }>;
}

interface WorkspaceOutput {
  campaign: CampaignWorkspaceResponse["campaign"];
  pm: CampaignWorkspaceResponse["pm"];
  recentMessages: CampaignWorkspaceResponse["messages"];
  references: CampaignWorkspaceResponse["references"];
  summary: {
    goals: number;
    tasks: number;
    artifacts: number;
    openDecisions: number;
    assignedWorkers: number;
    teamProposals: number;
    queuedItems: number;
  };
}

const defaultLocalCompanyUrl = "http://127.0.0.1:8788";

const tools: ToolDefinition[] = [
  {
    name: "local_company_status",
    description:
      "Check whether the Local Company V2 app is running on this computer and summarize the active PM workspace state.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "local_company_list_campaigns",
    description:
      "List Local Company business divisions and campaigns. Use this before sending a PM message when the target campaign is unclear.",
    inputSchema: {
      type: "object",
      properties: {
        divisionName: {
          type: "string",
          description: "Optional business division name or partial name to filter campaigns."
        },
        includeDone: {
          type: "boolean",
          description: "Whether to include completed and archived campaigns. Defaults to true."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "local_company_get_pm_workspace",
    description:
      "Read a Local Company campaign workspace, including recent PM conversation, reference materials, tasks, artifacts, decisions, workers, and queue counts.",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: {
          type: "string",
          description: "Exact campaign id. Use this when available."
        },
        campaignTitle: {
          type: "string",
          description: "Campaign title or partial title. Used when campaignId is not provided."
        },
        messageLimit: {
          type: "number",
          description: "Maximum recent PM messages to return. Defaults to 8."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "local_company_send_pm_message",
    description:
      "Send an owner message to a Local Company campaign PM and return the PM reply. This may trigger the configured PM runner, including Codex CLI if enabled.",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: {
          type: "string",
          description: "Exact campaign id. Use this when available."
        },
        campaignTitle: {
          type: "string",
          description: "Campaign title or partial title. Used when campaignId is not provided."
        },
        message: {
          type: "string",
          description: "The owner instruction or opinion to pass to the campaign PM."
        },
        messageLimit: {
          type: "number",
          description: "Maximum recent PM messages to return after sending. Defaults to 8."
        }
      },
      required: ["message"],
      additionalProperties: false
    }
  },
  {
    name: "local_company_add_reference",
    description:
      "Add PM reference material to a Local Company campaign. Use this before sending a PM message when the user provides an attached file, guide, URL, or background note.",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: {
          type: "string",
          description: "Exact campaign id. Use this when available."
        },
        campaignTitle: {
          type: "string",
          description: "Campaign title or partial title. Used when campaignId is not provided."
        },
        title: {
          type: "string",
          description: "Reference title shown to the PM."
        },
        kind: {
          type: "string",
          enum: ["note", "url", "file"],
          description: "Reference type. Defaults to note."
        },
        source: {
          type: "string",
          description: "Original URL, filename, or short source label."
        },
        content: {
          type: "string",
          description:
            "Reference content. For attached files, pass the relevant extracted text here so Local Company can store it for the PM."
        },
        fileName: {
          type: "string",
          description: "Optional uploaded filename when passing fileBase64."
        },
        fileMimeType: {
          type: "string",
          description: "Optional uploaded file MIME type when passing fileBase64."
        },
        fileBase64: {
          type: "string",
          description: "Optional file payload encoded as base64. Prefer content for normal text attachments."
        }
      },
      required: ["title"],
      additionalProperties: false
    }
  },
  {
    name: "local_company_create_campaign",
    description:
      "Create a new Local Company campaign in a business division. Use this only when the user explicitly asks to start a new campaign.",
    inputSchema: {
      type: "object",
      properties: {
        divisionId: {
          type: "string",
          description: "Exact business division id. Use this when available."
        },
        divisionName: {
          type: "string",
          description: "Business division name or partial name. Used when divisionId is not provided."
        },
        title: {
          type: "string",
          description: "New campaign title."
        },
        summary: {
          type: "string",
          description: "Short campaign goal or background."
        }
      },
      required: ["title"],
      additionalProperties: false
    }
  },
  {
    name: "local_company_create_division",
    description:
      "Create a new Local Company business division and its lead PM worker. Use this only when the user explicitly asks to create a business division or team.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Business division name."
        },
        folderName: {
          type: "string",
          description: "Optional folder name. Use Korean, English, numbers, hyphen, or underscore without spaces."
        },
        description: {
          type: "string",
          description: "Optional division description."
        },
        leadWorkerName: {
          type: "string",
          description: "Optional PM name for the division lead worker."
        }
      },
      required: ["name"],
      additionalProperties: false
    }
  }
];

function getBaseUrl(): string {
  const raw = process.env.LOCAL_COMPANY_URL?.trim() || defaultLocalCompanyUrl;
  return raw.replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalBoolean(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

function optionalNumber(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function optionalReferenceKind(record: Record<string, unknown>, key: string): CampaignReferenceKind {
  const value = optionalString(record, key);
  return value === "url" || value === "file" ? value : "note";
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = optionalString(record, key);
  if (!value) {
    throw new Error(`${key} 값을 입력하세요.`);
  }

  return value;
}

class LocalCompanyApiClient {
  constructor(private readonly baseUrl: string) {}

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/api/health");
  }

  async appState(): Promise<AppStateResponse> {
    return this.request<AppStateResponse>("/api/app-state");
  }

  async workspace(campaignId: string): Promise<CampaignWorkspaceResponse> {
    return this.request<CampaignWorkspaceResponse>(`/api/campaigns/${encodeURIComponent(campaignId)}`);
  }

  async sendPmMessage(campaignId: string, message: string): Promise<SendMessageResponse> {
    return this.request<SendMessageResponse>(`/api/campaigns/${encodeURIComponent(campaignId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: message })
    });
  }

  async addReference(campaignId: string, input: CreateCampaignReferenceRequest): Promise<CreateCampaignReferenceResponse> {
    return this.request<CreateCampaignReferenceResponse>(`/api/campaigns/${encodeURIComponent(campaignId)}/references`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  async createCampaign(input: CreateCampaignRequest): Promise<CampaignSummary> {
    return this.request<CampaignSummary>("/api/campaigns", {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  async createDivision(input: CreateDivisionRequest): Promise<DivisionSummary> {
    return this.request<DivisionSummary>("/api/divisions", {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;

    try {
      response = await fetch(url, {
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers ?? {})
        },
        ...init
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "연결 실패";
      throw new Error(`Local Company 앱에 연결하지 못했습니다. 먼저 start-local-company.cmd로 앱을 실행하세요. (${detail})`);
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? `Local Company 요청이 실패했습니다. HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }
}

function matchText(target: string, query: string): boolean {
  return target.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

async function resolveCampaign(client: LocalCompanyApiClient, input: CampaignResolverInput): Promise<CampaignSummary> {
  const state = await client.appState();

  if (input.campaignId) {
    const campaign = state.campaigns.find((item) => item.id === input.campaignId);
    if (!campaign) {
      throw new Error(`캠페인 ID를 찾지 못했습니다: ${input.campaignId}`);
    }
    return campaign;
  }

  if (input.campaignTitle) {
    const exact = state.campaigns.filter((item) => item.title === input.campaignTitle);
    const partial = exact.length > 0 ? exact : state.campaigns.filter((item) => matchText(item.title, input.campaignTitle ?? ""));
    if (partial.length === 1) {
      return partial[0];
    }
    if (partial.length > 1) {
      throw new Error(`캠페인이 여러 개 일치합니다. campaignId를 지정하세요: ${partial.map((item) => `${item.title} (${item.id})`).join(", ")}`);
    }
    throw new Error(`캠페인 제목을 찾지 못했습니다: ${input.campaignTitle}`);
  }

  const activeCampaigns = state.campaigns.filter((item) => item.status !== "done" && item.status !== "archived");
  const candidates = activeCampaigns.length > 0 ? activeCampaigns : state.campaigns;
  if (candidates.length === 1) {
    return candidates[0];
  }

  throw new Error(`대상 캠페인을 지정하세요. 후보: ${state.campaigns.map((item) => `${item.title} (${item.id})`).join(", ") || "없음"}`);
}

async function resolveDivision(client: LocalCompanyApiClient, input: DivisionResolverInput): Promise<string> {
  const state = await client.appState();

  if (input.divisionId) {
    const division = state.divisions.find((item) => item.id === input.divisionId);
    if (!division) {
      throw new Error(`사업부 ID를 찾지 못했습니다: ${input.divisionId}`);
    }
    return division.id;
  }

  if (input.divisionName) {
    const exact = state.divisions.filter((item) => item.name === input.divisionName);
    const partial = exact.length > 0 ? exact : state.divisions.filter((item) => matchText(item.name, input.divisionName ?? ""));
    if (partial.length === 1) {
      return partial[0].id;
    }
    if (partial.length > 1) {
      throw new Error(`사업부가 여러 개 일치합니다. divisionId를 지정하세요: ${partial.map((item) => `${item.name} (${item.id})`).join(", ")}`);
    }
    throw new Error(`사업부 이름을 찾지 못했습니다: ${input.divisionName}`);
  }

  if (state.divisions.length === 1) {
    return state.divisions[0].id;
  }

  const defaultDivision = state.divisions.find((item) => item.id === "division-default");
  if (defaultDivision) {
    return defaultDivision.id;
  }

  throw new Error(`사업부를 지정하세요. 후보: ${state.divisions.map((item) => `${item.name} (${item.id})`).join(", ") || "없음"}`);
}

function summarizeWorkspace(workspace: CampaignWorkspaceResponse, messageLimit: number): WorkspaceOutput {
  const safeLimit = Math.max(1, Math.min(messageLimit, 30));
  const openDecisions = workspace.projection.decisions.filter((item) => item.status === "open").length;
  const queuedItems = workspace.projection.queueItems.filter((item) => item.status === "queued").length;

  return {
    campaign: workspace.campaign,
    pm: workspace.pm,
    recentMessages: workspace.messages.slice(-safeLimit),
    references: workspace.references,
    summary: {
      goals: workspace.projection.goals.length,
      tasks: workspace.projection.tasks.length,
      artifacts: workspace.projection.artifacts.length,
      openDecisions,
      assignedWorkers: workspace.projection.assignedWorkers.length,
      teamProposals: workspace.projection.teamProposals.length,
      queuedItems
    }
  };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const client = new LocalCompanyApiClient(getBaseUrl());

  if (name === "local_company_status") {
    const [health, state] = await Promise.all([client.health(), client.appState()]);
    const output: LocalCompanyStatusOutput = {
      app: health.app,
      status: health.status,
      url: `http://127.0.0.1:${health.port}`,
      runnerMode: health.runner.mode,
      campaignCount: state.campaigns.length,
      openDecisionCount: state.decisions.length
    };
    return output;
  }

  if (name === "local_company_list_campaigns") {
    const state = await client.appState();
    const divisionName = optionalString(args, "divisionName");
    const includeDone = optionalBoolean(args, "includeDone", true);
    const divisionIds = divisionName
      ? new Set(state.divisions.filter((item) => matchText(item.name, divisionName)).map((item) => item.id))
      : null;
    const campaigns = state.campaigns.filter((item) => {
      if (divisionIds && !divisionIds.has(item.divisionId)) {
        return false;
      }
      return includeDone || (item.status !== "done" && item.status !== "archived");
    });

    const output: ListCampaignsOutput = {
      divisions: state.divisions.map((item) => ({
        id: item.id,
        name: item.name,
        leadWorkerName: item.leadWorkerName,
        campaignCount: item.campaignCount
      })),
      campaigns: campaigns.map((item) => ({
        id: item.id,
        divisionId: item.divisionId,
        title: item.title,
        pmName: item.pmName,
        status: item.status,
        currentFocus: item.currentFocus,
        updatedAt: item.updatedAt
      }))
    };
    return output;
  }

  if (name === "local_company_get_pm_workspace") {
    const campaign = await resolveCampaign(client, {
      campaignId: optionalString(args, "campaignId"),
      campaignTitle: optionalString(args, "campaignTitle")
    });
    const workspace = await client.workspace(campaign.id);
    return summarizeWorkspace(workspace, optionalNumber(args, "messageLimit", 8));
  }

  if (name === "local_company_send_pm_message") {
    const message = requireString(args, "message");
    const campaign = await resolveCampaign(client, {
      campaignId: optionalString(args, "campaignId"),
      campaignTitle: optionalString(args, "campaignTitle")
    });

    const before = Date.now();
    const messages = await client.sendPmMessage(campaign.id, message);
    const workspace = await client.workspace(campaign.id);
    const lastPmMessage = [...messages.messages].reverse().find((item) => item.role === "pm") ?? null;

    return {
      campaign: workspace.campaign,
      pm: workspace.pm,
      sentMessage: message,
      pmReply: lastPmMessage,
      elapsedMs: Date.now() - before,
      workspace: summarizeWorkspace(workspace, optionalNumber(args, "messageLimit", 8))
    };
  }

  if (name === "local_company_add_reference") {
    const campaign = await resolveCampaign(client, {
      campaignId: optionalString(args, "campaignId"),
      campaignTitle: optionalString(args, "campaignTitle")
    });
    const title = requireString(args, "title");
    const input: AddReferenceInput = {
      title,
      kind: optionalReferenceKind(args, "kind"),
      source: optionalString(args, "source"),
      content: optionalString(args, "content"),
      fileName: optionalString(args, "fileName"),
      fileMimeType: optionalString(args, "fileMimeType"),
      fileBase64: optionalString(args, "fileBase64")
    };
    const response = await client.addReference(campaign.id, {
      title,
      kind: input.kind ?? "note",
      source: input.source,
      content: input.content,
      fileName: input.fileName,
      fileMimeType: input.fileMimeType,
      fileBase64: input.fileBase64
    });
    const workspace = await client.workspace(campaign.id);
    const output: { reference: CampaignReferenceSummary; message: string; workspace: WorkspaceOutput } = {
      reference: response.reference,
      message: response.message,
      workspace: summarizeWorkspace(workspace, 8)
    };
    return output;
  }

  if (name === "local_company_create_campaign") {
    const divisionId = await resolveDivision(client, {
      divisionId: optionalString(args, "divisionId"),
      divisionName: optionalString(args, "divisionName")
    });
    const campaign = await client.createCampaign({
      divisionId,
      title: requireString(args, "title"),
      summary: optionalString(args, "summary")
    });
    const workspace = await client.workspace(campaign.id);
    return summarizeWorkspace(workspace, 8);
  }

  if (name === "local_company_create_division") {
    const division = await client.createDivision({
      name: requireString(args, "name"),
      folderName: optionalString(args, "folderName"),
      description: optionalString(args, "description"),
      leadWorkerName: optionalString(args, "leadWorkerName")
    });
    return {
      division,
      message: "사업부와 사업부 PM을 생성했습니다."
    };
  }

  throw new Error(`지원하지 않는 도구입니다: ${name}`);
}

function toolResult(value: unknown): Record<string, unknown> {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ],
    structuredContent: value
  };
}

export async function handleMcpRequest(request: JsonRpcRequest): Promise<Record<string, unknown> | null> {
  if (request.id === undefined) {
    return null;
  }

  if (request.method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: "local-company",
        version: "0.1.0"
      }
    };
  }

  if (request.method === "ping") {
    return {};
  }

  if (request.method === "tools/list") {
    return { tools };
  }

  if (request.method === "resources/list") {
    return { resources: [] };
  }

  if (request.method === "prompts/list") {
    return { prompts: [] };
  }

  if (request.method === "tools/call") {
    const params = asRecord(request.params);
    const callParams = params as ToolCallParams;
    if (!callParams.name) {
      throw new Error("도구 이름이 없습니다.");
    }

    const args = asRecord(callParams.arguments);
    return toolResult(await callTool(callParams.name, args));
  }

  throw new Error(`지원하지 않는 MCP 메서드입니다: ${request.method}`);
}

function writeMessage(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeResult(id: JsonRpcId | undefined, result: Record<string, unknown>): void {
  writeMessage({
    jsonrpc: "2.0",
    id,
    result
  });
}

function writeError(id: JsonRpcId | undefined, error: unknown): void {
  const message = error instanceof Error ? error.message : "MCP 요청을 처리하지 못했습니다.";
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message
    }
  });
}

export function startMcpServer(): void {
  const pendingRequests = new Set<Promise<void>>();
  const input = createInterface({
    input: process.stdin,
    crlfDelay: Number.POSITIVE_INFINITY
  });

  input.on("line", (line) => {
    if (!line.trim()) {
      return;
    }

    const pendingRequest = (async () => {
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(line) as JsonRpcRequest;
      } catch (error: unknown) {
        writeError(null, error);
        return;
      }

      try {
        const result = await handleMcpRequest(request);
        if (result !== null) {
          writeResult(request.id, result);
        }
      } catch (error: unknown) {
        writeError(request.id, error);
      }
    })();
    pendingRequests.add(pendingRequest);
    pendingRequest.finally(() => {
      pendingRequests.delete(pendingRequest);
    });
  });

  input.on("close", () => {
    void Promise.allSettled([...pendingRequests]);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMcpServer();
}
