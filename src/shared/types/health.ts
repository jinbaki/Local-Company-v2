export interface HealthResponse {
  status: "ok";
  app: string;
  phase: string;
  generatedAt: string;
  port: number;
  dataDir: string;
  database: {
    path: string;
    ready: boolean;
    tableCount: number;
    migrations: string[];
  };
  runner: {
    mode: string;
    cliBin: string;
    pmModel: string;
    workerModel: string;
    scribeModel: string;
    execArgs: string[];
    timeoutMs: number;
  };
  folders: {
    path: string;
    exists: boolean;
  }[];
}

export interface UpdateRunnerSettingsRequest {
  mode: string;
  cliBin: string;
  pmModel: string;
  workerModel: string;
  scribeModel: string;
}

export interface UpdateRunnerSettingsResponse {
  runner: HealthResponse["runner"];
  message: string;
}

export interface OpenCodexLoginTerminalResponse {
  command: string;
  message: string;
}

export type CodexConnectionState = "connected" | "mock" | "not_installed" | "not_logged_in" | "error";

export interface CodexConnectionStatusResponse {
  state: CodexConnectionState;
  mode: string;
  cliBin: string;
  version: string | null;
  authStatus: string | null;
  checkedAt: string;
  message: string;
  details: string[];
}
