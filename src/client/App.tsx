import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent, KeyboardEvent, ReactElement, ReactNode } from "react";
import {
  Building2,
  CheckCircle2,
  ClipboardList,
  FileText,
  Home,
  Inbox,
  Loader2,
  MessagesSquare,
  Pencil,
  Play,
  Plus,
  Search,
  Send,
  Settings,
  Trash2,
  UserCircle,
  Users
} from "lucide-react";
import type {
  AppStateResponse,
  ApproveCampaignTeamProposalResponse,
  ArtifactDetailResponse,
  ArtifactProjection,
  CampaignReferenceKind,
  CampaignSummary,
  CampaignWorkspaceResponse,
  CampaignHandoffReportSummary,
  ConversationMessage,
  AnswerDecisionResponse,
  DecisionInboxItem,
  DivisionSummary,
  GenerateHandoffReportResponse,
  QueueRunResponse,
  CreateCampaignReferenceResponse,
  DeleteCampaignResponse,
  DeleteDivisionResponse,
  RequestArtifactRevisionResponse,
  UpdateCampaignStatusResponse,
  UpdateDivisionResponse
} from "../shared/types/app-state.js";
import type {
  CodexConnectionState,
  CodexConnectionStatusResponse,
  HealthResponse,
  OpenCodexLoginTerminalResponse,
  UpdateRunnerSettingsResponse
} from "../shared/types/health.js";

type View = "home" | "division" | "campaign" | "artifacts" | "decisions" | "organization" | "settings";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; appState: AppStateResponse; health: HealthResponse }
  | { status: "error"; message: string };

const navItems: { label: string; view: View; icon: typeof Home }[] = [
  { label: "홈", view: "home", icon: Home },
  { label: "사업", view: "division", icon: Building2 },
  { label: "캠페인", view: "campaign", icon: MessagesSquare },
  { label: "산출물", view: "artifacts", icon: FileText },
  { label: "결정", view: "decisions", icon: Inbox },
  { label: "조직", view: "organization", icon: Users },
  { label: "설정", view: "settings", icon: Settings }
];

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "요청을 처리하지 못했습니다.");
  }

  return response.json() as Promise<T>;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function App(): ReactElement {
  const [view, setView] = useState<View>("home");
  const [selectedDivisionId, setSelectedDivisionId] = useState<string | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | null>(null);
  const [isCreatingDivision, setIsCreatingDivision] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  async function loadApp(): Promise<void> {
    try {
      const [appState, health] = await Promise.all([
        requestJson<AppStateResponse>("/api/app-state"),
        requestJson<HealthResponse>("/api/health")
      ]);
      setLoadState({ status: "ready", appState, health });

      setSelectedDivisionId((currentDivisionId) =>
        currentDivisionId && appState.divisions.some((division) => division.id === currentDivisionId)
          ? currentDivisionId
          : appState.divisions[0]?.id ?? null
      );

      setSelectedCampaignId((currentCampaignId) =>
        currentCampaignId && appState.campaigns.some((campaign) => campaign.id === currentCampaignId)
          ? currentCampaignId
          : appState.campaigns[0]?.id ?? null
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "앱 상태를 확인하지 못했습니다.";
      setLoadState({ status: "error", message });
    }
  }

  useEffect(() => {
    void loadApp();
  }, []);

  const selectedDivision =
    loadState.status === "ready"
      ? loadState.appState.divisions.find((division) => division.id === selectedDivisionId) ??
        loadState.appState.divisions[0] ??
        null
      : null;
  const selectedDivisionCampaigns =
    loadState.status === "ready" && selectedDivision
      ? loadState.appState.campaigns.filter((campaign) => campaign.divisionId === selectedDivision.id)
      : [];
  const selectedCampaign =
    loadState.status === "ready"
      ? selectedDivisionCampaigns.find((campaign) => campaign.id === selectedCampaignId) ??
        selectedDivisionCampaigns[0] ??
        loadState.appState.campaigns.find((campaign) => campaign.id === selectedCampaignId) ??
        null
      : null;

  return (
    <div className="app-shell">
      {loadState.status === "ready" ? (
        <TopBar
          divisions={loadState.appState.divisions}
          campaigns={loadState.appState.campaigns}
          selectedDivisionId={selectedDivision?.id ?? null}
          onSelectDivision={(divisionId) => {
            setSelectedDivisionId(divisionId);
            const nextCampaign = loadState.appState.campaigns.find((campaign) => campaign.divisionId === divisionId);
            setSelectedCampaignId(nextCampaign?.id ?? null);
            setView("division");
          }}
          onCreateDivision={() => {
            setIsCreatingDivision(true);
          }}
          onOpenCampaign={(campaign) => {
            setSelectedDivisionId(campaign.divisionId);
            setSelectedCampaignId(campaign.id);
            setView("campaign");
          }}
          onOpenSettings={() => {
            setView("settings");
          }}
        />
      ) : (
        <TopBar
          divisions={[]}
          campaigns={[]}
          selectedDivisionId={null}
          onSelectDivision={() => undefined}
          onCreateDivision={() => undefined}
          onOpenCampaign={() => undefined}
          onOpenSettings={() => undefined}
        />
      )}
      <Rail currentView={view} onSelect={setView} />

      <main className="workspace">
        {loadState.status === "loading" ? <LoadingState /> : null}
        {loadState.status === "error" ? <ErrorState message={loadState.message} onRetry={loadApp} /> : null}
        {loadState.status === "ready" ? (
          <>
            {view === "home" ? (
              <HomeView
                campaigns={loadState.appState.campaigns}
                decisions={loadState.appState.decisions}
                onOpenCampaign={(campaignId) => {
                  setSelectedCampaignId(campaignId);
                  setView("campaign");
                }}
                onOpenDecision={(decisionId) => {
                  setSelectedDecisionId(decisionId);
                  setView("decisions");
                }}
              />
            ) : null}
            {view === "division" && selectedDivision ? (
              <DivisionView
                division={selectedDivision}
                divisions={loadState.appState.divisions}
                campaigns={selectedDivisionCampaigns}
                onSelectDivision={(divisionId) => {
                  setSelectedDivisionId(divisionId);
                  const nextCampaign = loadState.appState.campaigns.find((campaign) => campaign.divisionId === divisionId);
                  setSelectedCampaignId(nextCampaign?.id ?? null);
                }}
                onCreateDivision={() => {
                  setIsCreatingDivision(true);
                }}
                onCreated={async (campaignId) => {
                  setSelectedCampaignId(campaignId);
                  await loadApp();
                  setView("campaign");
                }}
                onUpdated={loadApp}
                onDeleted={async () => {
                  setSelectedDivisionId(null);
                  setSelectedCampaignId(null);
                  await loadApp();
                  setView("division");
                }}
                onOpenCampaign={(campaignId) => {
                  setSelectedCampaignId(campaignId);
                  setView("campaign");
                }}
              />
            ) : null}
            {view === "campaign" ? (
              selectedCampaign ? (
                <CampaignView
                  campaignId={selectedCampaign.id}
                  onRefresh={loadApp}
                  onDeleted={async () => {
                    setSelectedCampaignId(null);
                    await loadApp();
                    setView("division");
                  }}
                  onOpenDecision={(decisionId) => {
                    setSelectedDecisionId(decisionId);
                    setView("decisions");
                  }}
                />
              ) : (
                <EmptyCampaignView
                  onMoveToDivision={() => {
                    setView("division");
                  }}
                />
              )
            ) : null}
            {view === "artifacts" ? <ArtifactStoreView /> : null}
            {view === "decisions" ? (
              <DecisionInboxView
                initialDecisionId={selectedDecisionId}
                onRefresh={loadApp}
                onOpenCampaign={(campaignId) => {
                  setSelectedCampaignId(campaignId);
                  setView("campaign");
                }}
              />
            ) : null}
            {view === "organization" ? <OrganizationView appState={loadState.appState} onRefresh={loadApp} /> : null}
            {view === "settings" ? <SettingsView health={loadState.health} onRefresh={loadApp} /> : null}
            {isCreatingDivision ? (
              <NewDivisionModal
                onCancel={() => {
                  setIsCreatingDivision(false);
                }}
                onCreated={async (divisionId) => {
                  setIsCreatingDivision(false);
                  setSelectedDivisionId(divisionId);
                  setSelectedCampaignId(null);
                  await loadApp();
                  setView("division");
                }}
              />
            ) : null}
          </>
        ) : null}
      </main>
    </div>
  );
}

function TopBar({
  divisions,
  campaigns,
  selectedDivisionId,
  onSelectDivision,
  onCreateDivision,
  onOpenCampaign,
  onOpenSettings
}: {
  divisions: DivisionSummary[];
  campaigns: CampaignSummary[];
  selectedDivisionId: string | null;
  onSelectDivision: (divisionId: string) => void;
  onCreateDivision: () => void;
  onOpenCampaign: (campaign: CampaignSummary) => void;
  onOpenSettings: () => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  const selectedDivision = divisions.find((division) => division.id === selectedDivisionId) ?? divisions[0] ?? null;
  const searchResults = query.trim()
    ? campaigns
        .filter((campaign) => {
          const keyword = query.trim().toLowerCase();
          return `${campaign.title} ${campaign.summary} ${campaign.currentFocus}`.toLowerCase().includes(keyword);
        })
        .slice(0, 6)
    : [];

  return (
    <header className="top-bar">
      <div className="brand">
        <span className="brand-mark">LC</span>
        <span>Local Company</span>
      </div>
      <div className="division-control" aria-label="사업부 선택">
        <Building2 aria-hidden="true" size={16} />
        <select
          value={selectedDivision?.id ?? ""}
          disabled={divisions.length === 0}
          onChange={(event) => {
            onSelectDivision(event.target.value);
          }}
        >
          {divisions.length === 0 ? <option value="">사업부 없음</option> : null}
          {divisions.map((division) => (
            <option key={division.id} value={division.id}>
              {division.name}
            </option>
          ))}
        </select>
        <button className="top-icon-button" type="button" title="사업부 만들기" onClick={onCreateDivision}>
          <Plus aria-hidden="true" size={16} />
        </button>
      </div>
      <div className="search-area">
        <label className="search-box">
          <Search aria-hidden="true" size={16} />
          <span className="sr-only">캠페인 검색</span>
          <input
            value={query}
            placeholder="캠페인 검색"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </label>
        {query.trim() ? (
          <div className="search-results">
            {searchResults.length === 0 ? (
              <p className="muted-text">검색 결과가 없습니다.</p>
            ) : (
              searchResults.map((campaign) => (
                <button
                  key={campaign.id}
                  type="button"
                  onClick={() => {
                    setQuery("");
                    onOpenCampaign(campaign);
                  }}
                >
                  <span>{campaign.title}</span>
                  <small>{divisions.find((division) => division.id === campaign.divisionId)?.name ?? "사업부 미지정"}</small>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
      <div className="top-user">
        <span className="owner-mode">
          <UserCircle aria-hidden="true" size={16} />
          대표 모드
        </span>
        <button className="top-icon-button" type="button" title="설정" onClick={onOpenSettings}>
          <Settings aria-hidden="true" size={16} />
        </button>
      </div>
    </header>
  );
}

function Rail({ currentView, onSelect }: { currentView: View; onSelect: (view: View) => void }): ReactElement {
  return (
    <aside className="rail" aria-label="주요 화면">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <button
            className={item.view === currentView ? "rail-item active" : "rail-item"}
            key={item.label}
            type="button"
            title={item.label}
            aria-label={item.label}
            onClick={() => {
              onSelect(item.view);
            }}
          >
            <Icon aria-hidden="true" size={18} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </aside>
  );
}

function PageHeader({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactElement;
}): ReactElement {
  return (
    <section className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </section>
  );
}

function HomeView({
  campaigns,
  decisions,
  onOpenCampaign,
  onOpenDecision
}: {
  campaigns: CampaignSummary[];
  decisions: DecisionInboxItem[];
  onOpenCampaign: (campaignId: string) => void;
  onOpenDecision: (decisionId: string) => void;
}): ReactElement {
  return (
    <>
      <PageHeader eyebrow="홈" title="오늘 확인할 일" description="결정이 필요한 항목과 진행 중 캠페인을 먼저 봅니다." />
      <section className="page-stack">
        <div className="section-block full-width">
          <div className="section-heading">
            <h2>대표 결정 필요</h2>
            <span className="status-badge neutral">열림 {decisions.length}</span>
          </div>
          {decisions.length === 0 ? (
            <p className="muted-text">아직 대표가 판단해야 할 결정 항목은 없습니다.</p>
          ) : (
            <ul className="plain-list">
              {decisions.slice(0, 5).map((decision) => (
                <li key={decision.id}>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      onOpenDecision(decision.id);
                    }}
                  >
                    {decision.title}
                  </button>
                  <span className="muted-inline"> · {decision.campaignTitle} · PM 추천: {decision.recommendedOption}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="section-block full-width">
          <div className="section-heading">
            <h2>진행 중 캠페인</h2>
          </div>
          <CampaignTable campaigns={campaigns} onOpenCampaign={onOpenCampaign} />
        </div>

        <div className="section-block full-width">
          <div className="section-heading">
            <h2>최근 PM 보고</h2>
          </div>
          <p className="muted-text">캠페인을 만들고 PM에게 첫 메시지를 보내면 최근 보고가 이곳에 쌓입니다.</p>
        </div>
      </section>
    </>
  );
}

function DivisionView({
  division,
  divisions,
  campaigns,
  onSelectDivision,
  onCreateDivision,
  onCreated,
  onUpdated,
  onDeleted,
  onOpenCampaign
}: {
  division: DivisionSummary;
  divisions: DivisionSummary[];
  campaigns: CampaignSummary[];
  onSelectDivision: (divisionId: string) => void;
  onCreateDivision: () => void;
  onCreated: (campaignId: string) => Promise<void>;
  onUpdated: () => Promise<void>;
  onDeleted: () => Promise<void>;
  onOpenCampaign: (campaignId: string) => void;
}): ReactElement {
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  async function deleteCurrentDivision(): Promise<void> {
    const confirmed = window.confirm(
      `"${division.name}" 사업부를 삭제할까요?\n\n캠페인 ${division.campaignCount}개, 직원 ${division.workerCount}명, 로컬 폴더가 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`
    );

    if (!confirmed) {
      return;
    }

    setDeleteError("");
    setIsDeleting(true);

    try {
      await requestJson<DeleteDivisionResponse>(`/api/divisions/${division.id}`, {
        method: "DELETE"
      });
      await onDeleted();
    } catch (requestError: unknown) {
      setDeleteError(requestError instanceof Error ? requestError.message : "사업부를 삭제하지 못했습니다.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="사업부 홈"
        title={division.name}
        description={division.description}
        action={
          <div className="header-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setIsEditing(true);
              }}
            >
              <Pencil aria-hidden="true" size={16} />
              사업부 수정
            </button>
            {division.id !== "division-default" ? (
              <button className="danger-button" disabled={isDeleting} type="button" onClick={() => void deleteCurrentDivision()}>
                {isDeleting ? <Loader2 aria-hidden="true" size={16} /> : <Trash2 aria-hidden="true" size={16} />}
                사업부 삭제
              </button>
            ) : null}
            <button className="secondary-button" type="button" onClick={onCreateDivision}>
              <Plus aria-hidden="true" size={16} />
              사업부 만들기
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                setIsCreating(true);
              }}
            >
              <Plus aria-hidden="true" size={16} />
              새 캠페인
            </button>
          </div>
        }
      />
      <section className="page-stack">
        {deleteError ? <p className="error-text">{deleteError}</p> : null}
        <div className="division-overview full-width">
          <section className="division-switcher-panel" aria-labelledby="division-switcher-title">
            <div className="section-heading">
              <h2 id="division-switcher-title">사업부</h2>
              <span className="status-badge neutral">{divisions.length}개</span>
            </div>
            <div className="division-switcher-list">
              {divisions.map((item) => (
                <button
                  className={item.id === division.id ? "division-switcher-item active" : "division-switcher-item"}
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectDivision(item.id);
                  }}
                >
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.leadWorkerName ?? "리드 미지정"}</small>
                  </span>
                  <em>{item.campaignCount}</em>
                </button>
              ))}
            </div>
          </section>

          <section className="division-summary-panel" aria-labelledby="division-summary-title">
            <div className="section-heading">
              <h2 id="division-summary-title">사업부 요약</h2>
              <span className="status-badge success">{statusLabel(division.status)}</span>
            </div>
            <p className="division-description">{division.description}</p>
            <dl className="division-summary-list">
              <div>
                <dt>폴더</dt>
                <dd>{division.folderName}</dd>
              </div>
              <div>
                <dt>리드</dt>
                <dd>{division.leadWorkerName ?? "미지정"}</dd>
              </div>
              <div>
                <dt>직원</dt>
                <dd>{division.workerCount}명</dd>
              </div>
              <div>
                <dt>캠페인</dt>
                <dd>{division.campaignCount}개</dd>
              </div>
            </dl>
          </section>
        </div>

        <div className="section-block full-width">
          <div className="section-heading">
            <h2>캠페인</h2>
            <span className="status-badge neutral">{campaigns.length}개</span>
          </div>
          <CampaignTable campaigns={campaigns} onOpenCampaign={onOpenCampaign} />
        </div>
      </section>

      {isCreating ? (
        <NewCampaignModal
          divisionId={division.id}
          onCancel={() => {
            setIsCreating(false);
          }}
          onCreated={async (campaignId) => {
            setIsCreating(false);
            await onCreated(campaignId);
          }}
        />
      ) : null}
      {isEditing ? (
        <EditDivisionModal
          division={division}
          onCancel={() => {
            setIsEditing(false);
          }}
          onUpdated={async () => {
            setIsEditing(false);
            await onUpdated();
          }}
        />
      ) : null}
    </>
  );
}

function CampaignTable({
  campaigns,
  onOpenCampaign
}: {
  campaigns: CampaignSummary[];
  onOpenCampaign: (campaignId: string) => void;
}): ReactElement {
  if (campaigns.length === 0) {
    return <p className="muted-text">아직 캠페인이 없습니다. 사업부 홈에서 새 캠페인을 만드세요.</p>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>캠페인명</th>
            <th>PM</th>
            <th>상태</th>
            <th>현재 초점</th>
            <th>갱신</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => (
            <tr key={campaign.id}>
              <td>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => {
                    onOpenCampaign(campaign.id);
                  }}
                >
                  {campaign.title}
                </button>
              </td>
              <td>{campaign.pmName ?? "미지정"}</td>
              <td>
                <span className="status-badge neutral">{statusLabel(campaign.status)}</span>
              </td>
              <td>{campaign.currentFocus || "초기 정리 중"}</td>
              <td>{formatDate(campaign.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NewCampaignModal({
  divisionId,
  onCancel,
  onCreated
}: {
  divisionId: string;
  onCancel: () => void;
  onCreated: (campaignId: string) => Promise<void>;
}): ReactElement {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const campaign = await requestJson<CampaignSummary>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({ divisionId, title, summary })
      });
      await onCreated(campaign.id);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "캠페인을 만들지 못했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal" onSubmit={submit}>
        <div className="section-heading">
          <h2>새 캠페인 만들기</h2>
        </div>
        <label className="field">
          <span>캠페인명</span>
          <input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            placeholder="콘텐츠 제작 캠페인"
            autoFocus
          />
        </label>
        <label className="field">
          <span>짧은 설명</span>
          <textarea
            value={summary}
            onChange={(event) => {
              setSummary(event.target.value);
            }}
            placeholder="예: 제품 소개 콘텐츠를 기획하고 첫 초안을 만듭니다."
            rows={4}
          />
        </label>
        <div className="radio-summary">
          <span className="status-badge neutral">PM</span>
          <span>사업부 리드가 겸임합니다.</span>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            취소
          </button>
          <button className="primary-button" disabled={isSubmitting} type="submit">
            만들기
          </button>
        </div>
      </form>
    </div>
  );
}

function NewDivisionModal({
  onCancel,
  onCreated
}: {
  onCancel: () => void;
  onCreated: (divisionId: string) => Promise<void>;
}): ReactElement {
  const [name, setName] = useState("");
  const [folderName, setFolderName] = useState("");
  const [description, setDescription] = useState("");
  const [leadWorkerName, setLeadWorkerName] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const division = await requestJson<DivisionSummary>("/api/divisions", {
        method: "POST",
        body: JSON.stringify({ name, folderName, description, leadWorkerName })
      });
      await onCreated(division.id);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "사업부를 만들지 못했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal" onSubmit={submit}>
        <div className="section-heading">
          <h2>사업부 만들기</h2>
        </div>
        <label className="field">
          <span>사업부 이름</span>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder="콘텐츠 사업부"
            autoFocus
          />
        </label>
        <label className="field">
          <span>사업부 폴더 이름</span>
          <input
            value={folderName}
            onChange={(event) => {
              setFolderName(event.target.value);
            }}
            placeholder="content-team"
          />
          <small>data/divisions 아래에 만들어집니다. 공백 없이 한글, 영문, 숫자, 하이픈, 밑줄을 사용할 수 있습니다.</small>
        </label>
        <label className="field">
          <span>설명</span>
          <textarea
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
            placeholder="이 사업부가 맡을 콘텐츠, 운영 범위, 검토 기준을 적어주세요."
            rows={3}
          />
        </label>
        <label className="field">
          <span>사업부 리드 / PM 이름</span>
          <input
            value={leadWorkerName}
            onChange={(event) => {
              setLeadWorkerName(event.target.value);
            }}
            placeholder="콘텐츠 PM"
          />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            취소
          </button>
          <button className="primary-button" disabled={isSubmitting} type="submit">
            만들기
          </button>
        </div>
      </form>
    </div>
  );
}

function EditDivisionModal({
  division,
  onCancel,
  onUpdated
}: {
  division: DivisionSummary;
  onCancel: () => void;
  onUpdated: () => Promise<void>;
}): ReactElement {
  const [name, setName] = useState(division.name);
  const [description, setDescription] = useState(division.description);
  const [leadWorkerName, setLeadWorkerName] = useState(division.leadWorkerName ?? "");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      await requestJson<UpdateDivisionResponse>(`/api/divisions/${division.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, description, leadWorkerName })
      });
      await onUpdated();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "사업부 정보를 수정하지 못했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal" onSubmit={submit}>
        <div className="section-heading">
          <h2>사업부 수정</h2>
        </div>
        <label className="field">
          <span>사업부 이름</span>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            autoFocus
          />
        </label>
        <label className="field">
          <span>설명</span>
          <textarea
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
            rows={3}
          />
        </label>
        <label className="field">
          <span>사업부 리드 / PM 이름</span>
          <input
            value={leadWorkerName}
            onChange={(event) => {
              setLeadWorkerName(event.target.value);
            }}
          />
        </label>
        <div className="radio-summary">
          <span className="status-badge neutral">폴더</span>
          <span>{division.folderName}은 이미 저장된 파일 경로라 여기서는 바꾸지 않습니다.</span>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            취소
          </button>
          <button className="primary-button" disabled={isSubmitting} type="submit">
            저장
          </button>
        </div>
      </form>
    </div>
  );
}

function NewReferenceModal({
  campaignId,
  onCancel,
  onCreated
}: {
  campaignId: string;
  onCancel: () => void;
  onCreated: () => Promise<void>;
}): ReactElement {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<CampaignReferenceKind>("note");
  const [source, setSource] = useState("");
  const [content, setContent] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function readFileBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        resolve(result.split(",")[1] ?? "");
      });
      reader.addEventListener("error", () => {
        reject(new Error("파일을 읽지 못했습니다."));
      });
      reader.readAsDataURL(file);
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      if (selectedFile && selectedFile.size > 5 * 1024 * 1024) {
        throw new Error("참고자료 파일은 5MB 이하만 업로드할 수 있습니다.");
      }

      const filePayload =
        kind === "file" && selectedFile
          ? {
              fileName: selectedFile.name,
              fileMimeType: selectedFile.type,
              fileBase64: await readFileBase64(selectedFile)
            }
          : {};

      await requestJson<CreateCampaignReferenceResponse>(`/api/campaigns/${campaignId}/references`, {
        method: "POST",
        body: JSON.stringify({ title, kind, source, content, ...filePayload })
      });
      await onCreated();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "참고자료를 추가하지 못했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal" onSubmit={submit}>
        <div className="section-heading">
          <h2>참고자료 추가</h2>
        </div>
        <label className="field">
          <span>자료 제목</span>
          <input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            placeholder="제품 소개 핵심 메모"
            autoFocus
          />
        </label>
        <label className="field">
          <span>자료 유형</span>
          <select
            value={kind}
            onChange={(event) => {
              const nextKind = event.target.value as CampaignReferenceKind;
              setKind(nextKind);
              setSource("");
              setSelectedFile(null);
            }}
          >
            <option value="note">메모</option>
            <option value="url">URL</option>
            <option value="file">파일 업로드</option>
          </select>
        </label>
        {kind === "url" ? (
          <label className="field">
            <span>URL</span>
            <input
              value={source}
              onChange={(event) => {
                setSource(event.target.value);
              }}
              placeholder="https://example.com/reference"
            />
          </label>
        ) : null}
        {kind === "file" ? (
          <label className="field">
            <span>파일 선택</span>
            <input
              type="file"
              onChange={(event) => {
                setSelectedFile(event.target.files?.[0] ?? null);
              }}
            />
            <small>선택한 파일은 이 캠페인의 knowledge/source-materials 폴더에 저장됩니다. 5MB 이하 파일만 업로드할 수 있습니다.</small>
          </label>
        ) : null}
        <label className="field">
          <span>{kind === "note" ? "내용" : "핵심 내용 / 참고 지시"}</span>
          <textarea
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
            }}
            placeholder="PM이 참고해야 할 핵심 맥락을 적어주세요."
            rows={6}
          />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            취소
          </button>
          <button className="primary-button" disabled={isSubmitting} type="submit">
            {isSubmitting ? <Loader2 aria-hidden="true" size={16} /> : <Plus aria-hidden="true" size={16} />}
            추가
          </button>
        </div>
      </form>
    </div>
  );
}

function CampaignView({
  campaignId,
  onRefresh,
  onDeleted,
  onOpenDecision
}: {
  campaignId: string;
  onRefresh: () => Promise<void>;
  onDeleted: () => Promise<void>;
  onOpenDecision: (decisionId: string) => void;
}): ReactElement {
  const [workspace, setWorkspace] = useState<CampaignWorkspaceResponse | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runMessage, setRunMessage] = useState("");
  const [reportSummary, setReportSummary] = useState<CampaignHandoffReportSummary | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isCompletingCampaign, setIsCompletingCampaign] = useState(false);
  const [isDeletingCampaign, setIsDeletingCampaign] = useState(false);
  const [approvingProposalId, setApprovingProposalId] = useState<string | null>(null);
  const [isAddingReference, setIsAddingReference] = useState(false);
  const [pmPanelWidth, setPmPanelWidth] = useState(() => {
    const stored = window.localStorage.getItem("local-company.pmPanelWidth");
    const parsed = stored ? Number.parseInt(stored, 10) : 560;
    return Number.isFinite(parsed) ? clampNumber(parsed, 460, 760) : 560;
  });

  useEffect(() => {
    window.localStorage.setItem("local-company.pmPanelWidth", String(pmPanelWidth));
  }, [pmPanelWidth]);

  async function loadWorkspace(): Promise<void> {
    const nextWorkspace = await requestJson<CampaignWorkspaceResponse>(`/api/campaigns/${campaignId}`);
    setWorkspace(nextWorkspace);
  }

  useEffect(() => {
    setWorkspace(null);
    setError("");
    setRunMessage("");
    setReportSummary(null);
    void loadWorkspace();
  }, [campaignId]);

  async function submitMessage(): Promise<void> {
    const content = message.trim();
    if (!content || isSending) {
      return;
    }

    setError("");
    setIsSending(true);

    try {
      const response = await requestJson<{ messages: ConversationMessage[] }>(`/api/campaigns/${campaignId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content })
      });
      setWorkspace((current) => (current ? { ...current, messages: response.messages } : current));
      setMessage("");
      await onRefresh();
      await loadWorkspace();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "PM에게 메시지를 보내지 못했습니다.");
    } finally {
      setIsSending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await submitMessage();
  }

  function handleMessageKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void submitMessage();
  }

  if (!workspace) {
    return <LoadingState />;
  }

  const queuedCount = workspace.projection.queueItems.filter((item) => item.status === "queued").length;
  const openDecisions = workspace.projection.decisions.filter((decision) => decision.status === "open");

  async function runNextQueueItem(): Promise<void> {
    setError("");
    setRunMessage("");
    setIsRunning(true);

    try {
      const response = await requestJson<QueueRunResponse>(`/api/campaigns/${campaignId}/queue/run-next`, {
        method: "POST"
      });
      setRunMessage(response.message);
      await onRefresh();
      await loadWorkspace();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "자동 실행을 시작하지 못했습니다.");
    } finally {
      setIsRunning(false);
    }
  }

  async function generateHandoffReport(): Promise<void> {
    setError("");
    setRunMessage("");
    setIsGeneratingReport(true);

    try {
      const response = await requestJson<GenerateHandoffReportResponse>(`/api/campaigns/${campaignId}/reports/handoff`, {
        method: "POST"
      });
      setReportSummary(response.report);
      setRunMessage(response.message);
      await onRefresh();
      await loadWorkspace();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "인계 보고서를 만들지 못했습니다.");
    } finally {
      setIsGeneratingReport(false);
    }
  }

  async function completeCampaign(): Promise<void> {
    setError("");
    setRunMessage("");
    setIsCompletingCampaign(true);

    try {
      const response = await requestJson<UpdateCampaignStatusResponse>(`/api/campaigns/${campaignId}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "done" })
      });
      setRunMessage(response.message);
      await onRefresh();
      await loadWorkspace();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "캠페인 상태를 바꾸지 못했습니다.");
    } finally {
      setIsCompletingCampaign(false);
    }
  }

  async function deleteCurrentCampaign(): Promise<void> {
    if (!workspace) {
      return;
    }

    const confirmed = window.confirm(
      `"${workspace.campaign.title}" 캠페인을 삭제할까요?\n\nPM 대화, 업무, 산출물, 결정함 항목, 로컬 캠페인 폴더가 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setRunMessage("");
    setIsDeletingCampaign(true);

    try {
      await requestJson<DeleteCampaignResponse>(`/api/campaigns/${campaignId}`, {
        method: "DELETE"
      });
      await onDeleted();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "캠페인을 삭제하지 못했습니다.");
    } finally {
      setIsDeletingCampaign(false);
    }
  }

  async function approveTeamProposal(proposalId: string): Promise<void> {
    setError("");
    setRunMessage("");
    setApprovingProposalId(proposalId);

    try {
      const response = await requestJson<ApproveCampaignTeamProposalResponse>(`/api/team-proposals/${proposalId}/approve`, {
        method: "POST"
      });
      setRunMessage(response.message);
      await onRefresh();
      await loadWorkspace();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "PM 팀 제안을 승인하지 못했습니다.");
    } finally {
      setApprovingProposalId(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="캠페인 운영판"
        title={workspace.campaign.title}
        description={`PM ${workspace.pm?.name ?? "미지정"} · 현재 상태: ${statusLabel(
          workspace.campaign.status
        )} · 현재 초점: ${workspace.campaign.currentFocus || "초기 정리 중"}`}
        action={
          <div className="header-actions">
            <button className="secondary-button" disabled={isGeneratingReport} type="button" onClick={() => void generateHandoffReport()}>
              {isGeneratingReport ? <Loader2 aria-hidden="true" size={16} /> : <ClipboardList aria-hidden="true" size={16} />}
              {isGeneratingReport ? "보고서 생성 중" : "인계 보고서"}
            </button>
            <button className="primary-button" disabled={queuedCount === 0 || isRunning} type="button" onClick={() => void runNextQueueItem()}>
              {isRunning ? <Loader2 aria-hidden="true" size={16} /> : <Play aria-hidden="true" size={16} />}
              {queuedCount > 0 ? "자동 실행 시작" : "대기 작업 없음"}
            </button>
            <button
              className="secondary-button"
              disabled={workspace.campaign.status === "done" || isCompletingCampaign}
              type="button"
              onClick={() => void completeCampaign()}
            >
              {isCompletingCampaign ? <Loader2 aria-hidden="true" size={16} /> : <CheckCircle2 aria-hidden="true" size={16} />}
              캠페인 완료
            </button>
            <button className="danger-button" disabled={isDeletingCampaign} type="button" onClick={() => void deleteCurrentCampaign()}>
              {isDeletingCampaign ? <Loader2 aria-hidden="true" size={16} /> : <Trash2 aria-hidden="true" size={16} />}
              캠페인 삭제
            </button>
          </div>
        }
      />
      <section className="campaign-layout" style={{ "--pm-panel-width": `${pmPanelWidth}px` } as CSSProperties}>
        <div className="pm-panel">
          <div className="section-heading">
            <h2>PM 대화</h2>
            <div className="inline-actions">
              <label className="width-control" title="PM 대화 패널 가로 폭">
                <span>대화 폭</span>
                <input
                  aria-label="PM 대화 패널 가로 폭"
                  max={760}
                  min={460}
                  step={20}
                  type="range"
                  value={pmPanelWidth}
                  onChange={(event) => {
                    setPmPanelWidth(Number.parseInt(event.target.value, 10));
                  }}
                />
              </label>
              <span className="status-badge neutral">{workspace.pm?.name ?? "PM"}</span>
              <button
                className="secondary-button compact-button"
                type="button"
                onClick={() => {
                  setIsAddingReference(true);
                }}
              >
                <Plus aria-hidden="true" size={14} />
                참고자료 추가
              </button>
            </div>
          </div>
          <div className="reference-strip">
            {workspace.references.length > 0
              ? (
              workspace.references.slice(0, 3).map((reference) => (
                <span className="reference-chip" key={reference.id}>
                  <strong>{reference.title}</strong>
                  <small>{referenceKindLabel(reference.kind)}</small>
                </span>
              ))
                )
              : null}
          </div>
          <div className="message-list">
            {workspace.messages.map((item) => (
              <article className={`message ${item.role}`} key={item.id}>
                <div className="message-meta">
                  <span>{item.authorName}</span>
                  <time>{formatDate(item.createdAt)}</time>
                </div>
                <p>{item.content}</p>
              </article>
            ))}
          </div>
          <form className="message-form" onSubmit={submit}>
            <textarea
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
              }}
              onKeyDown={handleMessageKeyDown}
              placeholder="PM에게 메시지 입력"
              rows={2}
            />
            <button className="icon-button" disabled={isSending} type="submit" title="보내기" aria-label="보내기">
              {isSending ? <Loader2 aria-hidden="true" size={18} /> : <Send aria-hidden="true" size={18} />}
            </button>
          </form>
          {error ? <p className="error-text">{error}</p> : null}
        </div>

        <div className="operation-board">
          <BoardSection title="현재 목표">
            {workspace.projection.goals.length === 0 ? (
              <p>{workspace.campaign.summary || "PM 대화를 통해 목표를 구체화합니다."}</p>
            ) : (
              <ul className="plain-list">
                {workspace.projection.goals.map((goal) => (
                  <li key={goal.id}>
                    <strong>{goal.title}</strong>
                    <span className="muted-inline"> {goal.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </BoardSection>
          <BoardSection title="PM 현재 판단">
            <ul className="plain-list">
              <li>PM 답변에서 안전한 액션은 업무 그래프에 자동 반영합니다.</li>
              <li>현재 그래프 관계 {workspace.projection.edges.length}개가 저장되어 있습니다.</li>
              <li>대기 중인 작업 큐는 {queuedCount}개입니다.</li>
            </ul>
            {runMessage ? <p className="success-text top-space">{runMessage}</p> : null}
          </BoardSection>
          <BoardSection title="PM 팀 제안">
            {workspace.projection.teamProposals.length === 0 ? (
              <p className="muted-text">아직 PM이 제안한 팀 구성이 없습니다.</p>
            ) : (
              <div className="team-proposal-list">
                {workspace.projection.teamProposals.map((proposal) => (
                  <article className="team-proposal" key={proposal.id}>
                    <div className="team-proposal-header">
                      <div>
                        <strong>{proposal.title}</strong>
                        <p>{proposal.reason}</p>
                      </div>
                      <span className={proposal.status === "approved" ? "status-badge success" : "status-badge neutral"}>
                        {statusLabel(proposal.status)}
                      </span>
                    </div>
                    <ul className="team-member-list">
                      {proposal.members.map((member) => (
                        <li key={`${proposal.id}-${member.name}-${member.role}`}>
                          <span>
                            <strong>{member.name}</strong>
                            <small>{member.role}</small>
                          </span>
                          <p>{member.mission}</p>
                        </li>
                      ))}
                    </ul>
                    {proposal.status === "pending" ? (
                      <button
                        className="primary-button"
                        disabled={approvingProposalId === proposal.id}
                        type="button"
                        onClick={() => void approveTeamProposal(proposal.id)}
                      >
                        {approvingProposalId === proposal.id ? <Loader2 aria-hidden="true" size={16} /> : <CheckCircle2 aria-hidden="true" size={16} />}
                        팀 생성 승인
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </BoardSection>
          <BoardSection title="인계 보고서">
            {reportSummary ? (
              <div className="handoff-panel">
                <dl className="handoff-stats">
                  <div>
                    <dt>사람 TODO</dt>
                    <dd>{reportSummary.humanTodoCount}</dd>
                  </div>
                  <div>
                    <dt>다음 AI 작업</dt>
                    <dd>{reportSummary.nextAiTaskCount}</dd>
                  </div>
                  <div>
                    <dt>산출물</dt>
                    <dd>{reportSummary.artifactCount}</dd>
                  </div>
                </dl>
                <ul className="plain-list">
                  {reportSummary.files.map((file) => (
                    <li key={file.kind}>
                      <strong>{file.label}</strong>
                      <span className="muted-inline"> {file.relativePath}</span>
                    </li>
                  ))}
                </ul>
                {reportSummary.humanTodos.length > 0 ? (
                  <ul className="plain-list">
                    {reportSummary.humanTodos.slice(0, 3).map((item) => (
                      <li key={item.id}>
                        <strong>{item.title}</strong>
                        <span className="muted-inline"> {item.reason}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <p className="muted-text">아직 생성된 인계 보고서가 없습니다.</p>
            )}
          </BoardSection>
          <BoardSection title="대표 결정 필요">
            {openDecisions.length === 0 ? (
              <p className="muted-text">현재 열린 결정은 없습니다.</p>
            ) : (
              <ul className="plain-list">
                {openDecisions.map((decision) => (
                  <li key={decision.id}>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        onOpenDecision(decision.id);
                      }}
                    >
                      {decision.title}
                    </button>
                    <span className="muted-inline"> PM 추천: {decision.recommendedOption}</span>
                  </li>
                ))}
              </ul>
            )}
          </BoardSection>
          <BoardSection title="진행 중 작업">
            {workspace.projection.tasks.length === 0 ? (
              <p className="muted-text">PM 대화 후 태스크가 이곳에 표시됩니다.</p>
            ) : (
              <div className="table-wrap compact-table">
                <table>
                  <thead>
                    <tr>
                      <th>작업</th>
                      <th>상태</th>
                      <th>담당</th>
                      <th>우선순위</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workspace.projection.tasks.map((task) => (
                      <tr key={task.id}>
                        <td>{task.title}</td>
                        <td>
                          <span className="status-badge neutral">{statusLabel(task.status)}</span>
                        </td>
                        <td>{task.ownerWorkerName ?? "미배정"}</td>
                        <td>{task.priority}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </BoardSection>
          <BoardSection title="산출물">
            {workspace.projection.artifacts.length === 0 ? (
              <p className="muted-text">PM 대화 후 산출물 요청이 이곳에 표시됩니다.</p>
            ) : (
              <div className="table-wrap compact-table">
                <table>
                  <thead>
                    <tr>
                      <th>번호</th>
                      <th>산출물</th>
                      <th>상태</th>
                      <th>버전</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workspace.projection.artifacts.map((artifact) => (
                      <tr key={artifact.id}>
                        <td>{String(artifact.displayNumber).padStart(3, "0")}</td>
                        <td>{artifact.title}</td>
                        <td>
                          <span className="status-badge neutral">{statusLabel(artifact.status)}</span>
                        </td>
                        <td>{artifact.currentVersion ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </BoardSection>
          <BoardSection title="직원 상태">
            {workspace.projection.assignedWorkers.length === 0 ? (
              <p className="muted-text">아직 캠페인에 배정된 직원이 없습니다.</p>
            ) : (
              <div className="table-wrap compact-table">
                <table>
                  <thead>
                    <tr>
                      <th>직원</th>
                      <th>역할</th>
                      <th>세션</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workspace.projection.assignedWorkers.map((worker) => (
                      <tr key={worker.workerId}>
                        <td>{worker.name}</td>
                        <td>{worker.role}</td>
                        <td>
                          <span className="status-badge neutral">{statusLabel(worker.sessionStatus)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </BoardSection>
          <BoardSection title="자동 실행 중 작업">
            {workspace.projection.queueItems.length === 0 ? (
              <p className="muted-text">아직 작업 큐가 없습니다.</p>
            ) : (
              <div className="table-wrap compact-table">
                <table>
                  <thead>
                    <tr>
                      <th>작업</th>
                      <th>직원</th>
                      <th>상태</th>
                      <th>시도</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workspace.projection.queueItems.map((item) => (
                      <tr key={item.id}>
                        <td>{item.taskTitle ?? queueTypeLabel(item.type)}</td>
                        <td>{item.workerName ?? "미배정"}</td>
                        <td>
                          <span className="status-badge neutral">{statusLabel(item.status)}</span>
                        </td>
                        <td>
                          {item.attempt}/{item.maxAttempts}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </BoardSection>
        </div>
      </section>
      {isAddingReference ? (
        <NewReferenceModal
          campaignId={campaignId}
          onCancel={() => {
            setIsAddingReference(false);
          }}
          onCreated={async () => {
            setIsAddingReference(false);
            await loadWorkspace();
          }}
        />
      ) : null}
    </>
  );
}

function BoardSection({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="board-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function EmptyCampaignView({ onMoveToDivision }: { onMoveToDivision: () => void }): ReactElement {
  return (
    <>
      <PageHeader eyebrow="캠페인 운영판" title="캠페인이 없습니다" description="사업부 홈에서 첫 캠페인을 만들면 PM 대화를 시작할 수 있습니다." />
      <section className="page-stack">
        <div className="section-block full-width">
          <button className="primary-button" type="button" onClick={onMoveToDivision}>
            사업부 홈으로 이동
          </button>
        </div>
      </section>
    </>
  );
}

function OrganizationView({ appState, onRefresh }: { appState: AppStateResponse; onRefresh: () => Promise<void> }): ReactElement {
  const [isAdding, setIsAdding] = useState(false);

  return (
    <>
      <PageHeader
        eyebrow="조직"
        title="사업부 직원"
        description="사업부 직원과 캠페인 PM 배정을 확인합니다."
        action={
          <button
            className="primary-button"
            type="button"
            onClick={() => {
              setIsAdding(true);
            }}
          >
            직원 추가
          </button>
        }
      />
      <section className="page-stack">
        <div className="section-block full-width">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>이름</th>
                  <th>포지션</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {appState.workers.map((worker) => (
                  <tr key={worker.id}>
                    <td className="strong">{worker.name}</td>
                    <td>{worker.position}</td>
                    <td>
                      <span className="status-badge neutral">{statusLabel(worker.status)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      {isAdding ? (
        <NewWorkerModal
          divisionId={appState.divisions[0]?.id ?? "division-default"}
          onCancel={() => {
            setIsAdding(false);
          }}
          onCreated={async () => {
            setIsAdding(false);
            await onRefresh();
          }}
        />
      ) : null}
    </>
  );
}

function NewWorkerModal({
  divisionId,
  onCancel,
  onCreated
}: {
  divisionId: string;
  onCancel: () => void;
  onCreated: () => Promise<void>;
}): ReactElement {
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      await requestJson("/api/workers", {
        method: "POST",
        body: JSON.stringify({ divisionId, name, position })
      });
      await onCreated();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "직원을 추가하지 못했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal" onSubmit={submit}>
        <div className="section-heading">
          <h2>직원 추가</h2>
        </div>
        <label className="field">
          <span>이름</span>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder="콘텐츠 담당"
            autoFocus
          />
        </label>
        <label className="field">
          <span>포지션</span>
          <input
            value={position}
            onChange={(event) => {
              setPosition(event.target.value);
            }}
            placeholder="콘텐츠 기획 담당"
          />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            취소
          </button>
          <button className="primary-button" disabled={isSubmitting} type="submit">
            추가
          </button>
        </div>
      </form>
    </div>
  );
}

function ArtifactStoreView(): ReactElement {
  const [artifacts, setArtifacts] = useState<ArtifactProjection[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ArtifactDetailResponse | null>(null);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [revisionInstruction, setRevisionInstruction] = useState("");
  const [revisionMessage, setRevisionMessage] = useState("");
  const [isRequestingRevision, setIsRequestingRevision] = useState(false);

  async function loadArtifacts(): Promise<void> {
    try {
      const payload = await requestJson<{ artifacts: ArtifactProjection[] }>("/api/artifacts");
      setArtifacts(payload.artifacts);
      setSelectedArtifactId((current) => current ?? payload.artifacts[0]?.id ?? null);
      setError("");
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "산출물 목록을 가져오지 못했습니다.");
    }
  }

  useEffect(() => {
    void loadArtifacts();
  }, []);

  useEffect(() => {
    if (!selectedArtifactId) {
      setDetail(null);
      return;
    }

    setRevisionInstruction("");
    setRevisionMessage("");
    let isActive = true;
    requestJson<ArtifactDetailResponse>(`/api/artifacts/${selectedArtifactId}`)
      .then((nextDetail) => {
        if (isActive) {
          setDetail(nextDetail);
        }
      })
      .catch((requestError: unknown) => {
        if (isActive) {
          setError(requestError instanceof Error ? requestError.message : "산출물을 가져오지 못했습니다.");
        }
      });

    return () => {
      isActive = false;
    };
  }, [selectedArtifactId]);

  const filteredArtifacts = artifacts.filter((artifact) => filter === "all" || artifact.status === filter);

  async function requestRevision(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!detail) {
      return;
    }

    setError("");
    setRevisionMessage("");
    setIsRequestingRevision(true);

    try {
      const payload = await requestJson<RequestArtifactRevisionResponse>(`/api/artifacts/${detail.artifact.id}/revision-requests`, {
        method: "POST",
        body: JSON.stringify({ instruction: revisionInstruction })
      });
      const nextDetail = await requestJson<ArtifactDetailResponse>(`/api/artifacts/${detail.artifact.id}`);
      await loadArtifacts();
      setDetail(nextDetail);
      setRevisionMessage(payload.message);
      if (payload.created) {
        setRevisionInstruction("");
      }
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "수정 요청을 접수하지 못했습니다.");
    } finally {
      setIsRequestingRevision(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="산출물 저장소" title="산출물" description="산출물을 목록으로 보고 새 탭 뷰어에서 읽습니다." />
      <section className="content-grid">
        <div className="section-block">
          <div className="section-heading">
            <h2>산출물 목록</h2>
            <select
              className="select-filter"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
              }}
              aria-label="상태 필터"
            >
              <option value="all">전체</option>
              <option value="draft">초안</option>
              <option value="in_review">검토 중</option>
              <option value="needs_revision">수정 필요</option>
              <option value="approved">완료</option>
            </select>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
          {filteredArtifacts.length === 0 ? (
            <p className="muted-text">아직 표시할 산출물이 없습니다. PM 대화에서 산출물 요청이 생기면 이곳에 표시됩니다.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>번호</th>
                    <th>산출물명</th>
                    <th>상태</th>
                    <th>최신 버전</th>
                    <th>갱신</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredArtifacts.map((artifact) => (
                    <tr key={artifact.id}>
                      <td>{String(artifact.displayNumber).padStart(3, "0")}</td>
                      <td>
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => {
                            setSelectedArtifactId(artifact.id);
                          }}
                        >
                          {artifact.title}
                        </button>
                      </td>
                      <td>
                        <span className="status-badge neutral">{statusLabel(artifact.status)}</span>
                      </td>
                      <td>{artifact.currentVersion ?? "-"}</td>
                      <td>{formatDate(artifact.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="section-block">
          <div className="section-heading">
            <h2>선택 산출물 요약</h2>
          </div>
          {!detail ? <p className="muted-text">산출물을 선택하면 요약과 버전을 볼 수 있습니다.</p> : null}
          {detail ? (
            <div className="artifact-summary">
              <p className="artifact-title">
                {String(detail.artifact.displayNumber).padStart(3, "0")} {detail.artifact.title}
              </p>
              <dl className="status-list">
                <div>
                  <dt>상태</dt>
                  <dd>{statusLabel(detail.artifact.status)}</dd>
                </div>
                <div>
                  <dt>형식</dt>
                  <dd>{detail.artifact.kind}</dd>
                </div>
                <div>
                  <dt>최신 버전</dt>
                  <dd>{detail.currentVersion?.version ?? "-"}</dd>
                </div>
              </dl>
              <div className="artifact-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    window.open(detail.viewUrl, "_blank", "noopener,noreferrer");
                  }}
                >
                  새 탭에서 열기
                </button>
              </div>
              <form className="revision-request-form" onSubmit={requestRevision}>
                <label className="field">
                  <span>PM에게 수정 요청</span>
                  <textarea
                    value={revisionInstruction}
                    onChange={(event) => {
                      setRevisionInstruction(event.target.value);
                    }}
                    placeholder="수정할 방향을 자연어로 적어주세요."
                    rows={4}
                  />
                </label>
                <button className="secondary-button" disabled={isRequestingRevision || revisionInstruction.trim().length === 0} type="submit">
                  수정 요청 보내기
                </button>
              </form>
              {revisionMessage ? <p className="success-text">{revisionMessage}</p> : null}
              {detail.revisionRequests.length > 0 ? (
                <div className="relation-list">
                  <h3>수정 요청 이력</h3>
                  <ul className="plain-list">
                    {detail.revisionRequests.map((request) => (
                      <li key={request.id}>
                        <strong>{statusLabel(request.status)}</strong>
                        <span className="muted-inline"> {request.instruction}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {detail.relations.some((relation) => relation.relation === "revises" || relation.relation === "references") ? (
                <div className="relation-list">
                  <h3>관련 항목</h3>
                  <ul className="plain-list">
                    {detail.relations
                      .filter((relation) => relation.relation === "revises" || relation.relation === "references")
                      .map((relation) => (
                        <li key={`${relation.direction}-${relation.relation}-${relation.id}`}>
                          <strong>{relationLabel(relation.relation)}</strong>
                          <span className="muted-inline"> {relation.title}</span>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}

function DecisionInboxView({
  initialDecisionId,
  onRefresh,
  onOpenCampaign
}: {
  initialDecisionId: string | null;
  onRefresh: () => Promise<void>;
  onOpenCampaign: (campaignId: string) => void;
}): ReactElement {
  const [decisions, setDecisions] = useState<DecisionInboxItem[]>([]);
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | null>(initialDecisionId);
  const [filter, setFilter] = useState("open");
  const [selectedOption, setSelectedOption] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadDecisions(): Promise<void> {
    try {
      const url = filter === "all" ? "/api/decisions" : `/api/decisions?status=${encodeURIComponent(filter)}`;
      const payload = await requestJson<{ decisions: DecisionInboxItem[] }>(url);
      setDecisions(payload.decisions);
      setSelectedDecisionId((current) => {
        if (initialDecisionId && payload.decisions.some((decision) => decision.id === initialDecisionId)) {
          return initialDecisionId;
        }

        if (current && payload.decisions.some((decision) => decision.id === current)) {
          return current;
        }

        return payload.decisions[0]?.id ?? null;
      });
      setError("");
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "결정 목록을 가져오지 못했습니다.");
    }
  }

  useEffect(() => {
    void loadDecisions();
  }, [filter, initialDecisionId]);

  const selectedDecision = useMemo(
    () => decisions.find((decision) => decision.id === selectedDecisionId) ?? decisions[0] ?? null,
    [decisions, selectedDecisionId]
  );

  useEffect(() => {
    setSelectedOption(selectedDecision?.recommendedOption ?? "");
    setAnswer("");
    setSuccess("");
  }, [selectedDecision?.id]);

  async function submitAnswer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedDecision) {
      return;
    }

    setError("");
    setSuccess("");
    setIsSubmitting(true);

    try {
      const payload = await requestJson<AnswerDecisionResponse>(`/api/decisions/${selectedDecision.id}/answer`, {
        method: "POST",
        body: JSON.stringify({ selectedOption, answer })
      });

      setSuccess(payload.message);
      await onRefresh();
      await loadDecisions();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "결정을 저장하지 못했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="대표 결정함" title="결정할 일" description="자동 실행이 멈춘 항목과 PM 추천안을 확인하고 답합니다." />
      <section className="content-grid">
        <div className="section-block">
          <div className="section-heading">
            <h2>결정 목록</h2>
            <select
              className="select-filter"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
              }}
              aria-label="결정 상태 필터"
            >
              <option value="open">열림</option>
              <option value="answered">답변 완료</option>
              <option value="all">전체</option>
            </select>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
          {decisions.length === 0 ? (
            <p className="muted-text">현재 표시할 결정 항목이 없습니다.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>결정</th>
                    <th>캠페인</th>
                    <th>상태</th>
                    <th>막힌 작업</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.map((decision) => (
                    <tr key={decision.id}>
                      <td>
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => {
                            setSelectedDecisionId(decision.id);
                          }}
                        >
                          {decision.title}
                        </button>
                      </td>
                      <td>{decision.campaignTitle}</td>
                      <td>
                        <span className="status-badge neutral">{statusLabel(decision.status)}</span>
                      </td>
                      <td>{decision.blockedQueueCount}건</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="section-block">
          <div className="section-heading">
            <h2>결정 상세</h2>
            {selectedDecision ? <span className="status-badge neutral">{statusLabel(selectedDecision.status)}</span> : null}
          </div>
          {!selectedDecision ? <p className="muted-text">왼쪽 목록에서 결정 항목을 선택하세요.</p> : null}
          {selectedDecision ? (
            <div className="decision-detail">
              <p className="artifact-title">{selectedDecision.title}</p>
              <dl className="status-list">
                <div>
                  <dt>캠페인</dt>
                  <dd>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        onOpenCampaign(selectedDecision.campaignId);
                      }}
                    >
                      {selectedDecision.campaignTitle}
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>이유</dt>
                  <dd>{selectedDecision.reason}</dd>
                </div>
                <div>
                  <dt>PM 추천</dt>
                  <dd>{selectedDecision.recommendedOption}</dd>
                </div>
                <div>
                  <dt>영향</dt>
                  <dd>{selectedDecision.blockTitles.length > 0 ? selectedDecision.blockTitles.join(", ") : "연결된 항목 없음"}</dd>
                </div>
              </dl>

              {selectedDecision.status === "open" ? (
                <form className="decision-answer-form" onSubmit={submitAnswer}>
                  <div className="option-list" role="radiogroup" aria-label="결정 선택지">
                    {selectedDecision.options.map((option) => (
                      <label className={selectedOption === option ? "option-row selected" : "option-row"} key={option}>
                        <input
                          checked={selectedOption === option}
                          name="decision-option"
                          type="radio"
                          value={option}
                          onChange={(event) => {
                            setSelectedOption(event.target.value);
                          }}
                        />
                        <span>{option}</span>
                        {option === selectedDecision.recommendedOption ? <span className="status-badge success">추천</span> : null}
                      </label>
                    ))}
                  </div>
                  <label className="field">
                    <span>대표 메모</span>
                    <textarea
                      value={answer}
                      onChange={(event) => {
                        setAnswer(event.target.value);
                      }}
                      placeholder="선택 이유나 추가 지시를 적어주세요."
                      rows={4}
                    />
                  </label>
                  <button className="primary-button" disabled={isSubmitting} type="submit">
                    결정 저장
                  </button>
                </form>
              ) : (
                <div className="answered-note">
                  <h3>저장된 답변</h3>
                  <p>{selectedDecision.answer ?? "답변 내용이 없습니다."}</p>
                </div>
              )}
              {success ? <p className="success-text top-space">{success}</p> : null}
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}

function SettingsView({ health, onRefresh }: { health: HealthResponse; onRefresh: () => Promise<void> }): ReactElement {
  const [mode, setMode] = useState(health.runner.mode);
  const [cliBin, setCliBin] = useState(health.runner.cliBin);
  const [pmModel, setPmModel] = useState(health.runner.pmModel);
  const [workerModel, setWorkerModel] = useState(health.runner.workerModel);
  const [scribeModel, setScribeModel] = useState(health.runner.scribeModel);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isOpeningLogin, setIsOpeningLogin] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<CodexConnectionStatusResponse | null>(null);
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);

  useEffect(() => {
    setMode(health.runner.mode);
    setCliBin(health.runner.cliBin);
    setPmModel(health.runner.pmModel);
    setWorkerModel(health.runner.workerModel);
    setScribeModel(health.runner.scribeModel);
  }, [health.runner.mode, health.runner.cliBin, health.runner.pmModel, health.runner.workerModel, health.runner.scribeModel]);

  useEffect(() => {
    void checkConnection();
  }, [health.runner.mode, health.runner.cliBin]);

  async function checkConnection(): Promise<void> {
    setIsCheckingConnection(true);

    try {
      const payload = await requestJson<CodexConnectionStatusResponse>("/api/settings/codex-status");
      setConnectionStatus(payload);
    } catch (requestError: unknown) {
      setConnectionStatus({
        state: "error",
        mode: health.runner.mode,
        cliBin: health.runner.cliBin,
        version: null,
        authStatus: null,
        checkedAt: new Date().toISOString(),
        message: requestError instanceof Error ? requestError.message : "Codex 연결 상태를 확인하지 못했습니다.",
        details: []
      });
    } finally {
      setIsCheckingConnection(false);
    }
  }

  async function saveRunnerSettings(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setSuccess("");
    setIsSaving(true);

    try {
      const payload = await requestJson<UpdateRunnerSettingsResponse>("/api/settings/runner", {
        method: "PATCH",
        body: JSON.stringify({ mode, cliBin, pmModel, workerModel, scribeModel })
      });
      setSuccess(payload.message);
      await onRefresh();
      await checkConnection();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Codex 실행 설정을 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function openLoginTerminal(): Promise<void> {
    setError("");
    setSuccess("");
    setIsOpeningLogin(true);

    try {
      const payload = await requestJson<OpenCodexLoginTerminalResponse>("/api/settings/codex-login-terminal", {
        method: "POST"
      });
      setSuccess(`${payload.message} 실행 명령: ${payload.command}`);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Codex 로그인 터미널을 열지 못했습니다.");
    } finally {
      setIsOpeningLogin(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="설정" title="개발 환경" description="Codex 연결과 로컬 저장소 상태를 확인합니다." />
      <section className="page-stack">
        <form className="section-block full-width runner-settings-form" onSubmit={saveRunnerSettings}>
          <div className="section-heading">
            <h2>Codex 연결</h2>
            <span className={mode === "codex-cli" ? "status-badge success" : "status-badge neutral"}>
              {mode === "codex-cli" ? "Codex CLI 사용" : "Mock 응답"}
            </span>
          </div>
          <div className="settings-grid">
            <label className="field">
              <span>실행 방식</span>
              <select
                value={mode}
                onChange={(event) => {
                  setMode(event.target.value);
                }}
              >
                <option value="mock">Mock</option>
                <option value="codex-cli">Codex CLI</option>
              </select>
            </label>
            <label className="field">
              <span>CLI 명령</span>
              <input
                value={cliBin}
                onChange={(event) => {
                  setCliBin(event.target.value);
                }}
                placeholder="codex"
              />
            </label>
            <label className="field">
              <span>PM 모델</span>
              <input
                value={pmModel}
                onChange={(event) => {
                  setPmModel(event.target.value);
                }}
              />
            </label>
            <label className="field">
              <span>Worker 모델</span>
              <input
                value={workerModel}
                onChange={(event) => {
                  setWorkerModel(event.target.value);
                }}
              />
            </label>
            <label className="field">
              <span>Scribe 모델</span>
              <input
                value={scribeModel}
                onChange={(event) => {
                  setScribeModel(event.target.value);
                }}
              />
            </label>
          </div>
          <p className="muted-text">
            터미널은 Codex 로그인 전용으로 열립니다. 이미 로그인되어 있으면 창을 닫고, 로그인 주소나 기기 코드가 나오면 안내에 따라 로그인하세요. 만약 Continue anyway? [y/N]가 보이면 y를 입력한 뒤 Enter를 누르세요. 앱은 비밀번호나 API 키를 저장하지 않습니다.
          </p>
          <div className="connection-panel">
            <div>
              <span className={connectionStatusBadgeClass(connectionStatus?.state ?? "error")}>
                {isCheckingConnection ? "확인 중" : connectionStatusLabel(connectionStatus?.state)}
              </span>
              <p>{connectionStatus?.message ?? "Codex 연결 상태를 아직 확인하지 않았습니다."}</p>
            </div>
            <button className="secondary-button compact-button" disabled={isCheckingConnection} type="button" onClick={() => void checkConnection()}>
              {isCheckingConnection ? <Loader2 aria-hidden="true" size={14} /> : <CheckCircle2 aria-hidden="true" size={14} />}
              연결 확인
            </button>
          </div>
          {connectionStatus?.details.length ? (
            <ul className="plain-list connection-details">
              {connectionStatus.details.slice(0, 3).map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
          {error ? <p className="error-text">{error}</p> : null}
          {success ? <p className="success-text">{success}</p> : null}
          <div className="modal-actions">
            <button className="secondary-button" disabled={isOpeningLogin} type="button" onClick={() => void openLoginTerminal()}>
              {isOpeningLogin ? <Loader2 aria-hidden="true" size={16} /> : <Play aria-hidden="true" size={16} />}
              설치/로그인 터미널 열기
            </button>
            <button className="primary-button" disabled={isSaving} type="submit">
              {isSaving ? <Loader2 aria-hidden="true" size={16} /> : <Settings aria-hidden="true" size={16} />}
              설정 저장
            </button>
          </div>
        </form>
        <div className="section-block full-width">
          <dl className="status-list">
            <div>
              <dt>데이터 폴더</dt>
              <dd>{health.dataDir}</dd>
            </div>
            <div>
              <dt>SQLite</dt>
              <dd>{health.database.path}</dd>
            </div>
            <div>
              <dt>Codex runner</dt>
              <dd>
                {health.runner.mode} / {health.runner.cliBin}
              </dd>
            </div>
            <div>
              <dt>AI models</dt>
              <dd>
                PM {health.runner.pmModel} / worker {health.runner.workerModel} / scribe {health.runner.scribeModel}
              </dd>
            </div>
            <div>
              <dt>테이블</dt>
              <dd>{health.database.tableCount}개</dd>
            </div>
          </dl>
        </div>
      </section>
    </>
  );
}

function PlaceholderView({ title, description }: { title: string; description: string }): ReactElement {
  return (
    <>
      <PageHeader eyebrow="준비 중" title={title} description={description} />
      <div className="section-block full-width">
        <p className="muted-text">해당 화면은 구현 계획서 순서에 맞춰 다음 페이즈에서 연결됩니다.</p>
      </div>
    </>
  );
}

function LoadingState(): ReactElement {
  return (
    <div className="section-block full-width">
      <span className="status-badge muted">
        <Loader2 aria-hidden="true" size={12} />
        확인 중
      </span>
      <p className="muted-text top-space">로컬 앱 상태를 확인하고 있습니다.</p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => Promise<void> }): ReactElement {
  return (
    <div className="section-block full-width">
      <p className="error-text">{message}</p>
      <button
        className="secondary-button top-space"
        type="button"
        onClick={() => {
          void onRetry();
        }}
      >
        다시 확인
      </button>
    </div>
  );
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    active: "활성",
    archived: "보관",
    planning: "목표 설계",
    running: "실행 중",
    blocked: "막힘",
    review: "검토 중",
    done: "완료",
    draft: "초안",
    ready: "준비",
    queued: "대기",
    failed: "실패",
    needs_owner_decision: "대표 결정 필요",
    assigned: "배정",
    not_started: "시작 전",
    in_review: "검토 중",
    needs_revision: "수정 필요",
    approved: "완료",
    pending: "승인 대기",
    rejected: "반려"
  };

  return labels[status] ?? status;
}

function queueTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    worker_run: "직원 실행",
    pm_review: "PM 리뷰",
    artifact_revision: "산출물 재작업"
  };

  return labels[type] ?? type;
}

function relationLabel(relation: string): string {
  const labels: Record<string, string> = {
    revises: "수정",
    references: "참조"
  };

  return labels[relation] ?? relation;
}

function referenceKindLabel(kind: CampaignReferenceKind): string {
  const labels: Record<CampaignReferenceKind, string> = {
    note: "메모",
    url: "URL",
    file: "파일"
  };

  return labels[kind] ?? kind;
}

function connectionStatusLabel(state: CodexConnectionState | undefined): string {
  const labels: Record<CodexConnectionState, string> = {
    connected: "연결됨",
    mock: "Mock 모드",
    not_installed: "설치 필요",
    not_logged_in: "로그인 필요",
    error: "확인 필요"
  };

  return state ? labels[state] : "확인 전";
}

function connectionStatusBadgeClass(state: CodexConnectionState): string {
  if (state === "connected") {
    return "status-badge success";
  }

  if (state === "not_installed" || state === "not_logged_in" || state === "error") {
    return "status-badge danger";
  }

  return "status-badge neutral";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
