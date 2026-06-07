import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../config.js";
import type { CodexConnectionStatusResponse, HealthResponse, UpdateRunnerSettingsRequest } from "../../shared/types/health.js";
import { ensureDir } from "../storage/file-store.js";

const keys = {
  mode: "runner.mode",
  cliBin: "runner.cliBin",
  pmModel: "runner.pmModel",
  workerModel: "runner.workerModel",
  scribeModel: "runner.scribeModel"
} as const;

function getMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_meta (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).run(key, value);
}

function normalizeMode(value: string | undefined): string {
  return value === "codex-cli" ? "codex-cli" : "mock";
}

function requiredText(value: string | undefined, label: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    throw new Error(`${label} 값을 입력하세요.`);
  }

  return trimmed;
}

function safeCliBin(value: string | undefined): string {
  return requiredText(value, "Codex CLI").replace(/[\r\n"]/g, "");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

interface CliStatusRun {
  status: number | null;
  stdout: string;
  stderr: string;
  error: string | null;
}

function buildCliCommand(bin: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== "win32") {
    return { command: bin, args };
  }

  return {
    command: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/c", bin, ...args]
  };
}

function runCli(config: AppConfig, args: string[], timeoutMs: number): CliStatusRun {
  const command = buildCliCommand(config.codexCliBin ?? "codex", args);
  const result = spawnSync(command.command, command.args, {
    cwd: config.rootDir,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 4
  });

  return {
    status: result.status,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
    error: result.error?.message ?? null
  };
}

function firstFailureText(result: CliStatusRun): string {
  return [result.error, result.stderr, result.stdout].filter(Boolean).join("\n").trim();
}

function parseDoctorJson(output: string): {
  authOk: boolean | null;
  websocketOk: boolean | null;
  authSummary: string | null;
  websocketSummary: string | null;
} {
  try {
    const parsed = JSON.parse(output) as {
      checks?: Record<string, { status?: string; summary?: string }>;
    };
    const auth = parsed.checks?.["auth.credentials"];
    const websocket = parsed.checks?.["network.websocket_reachability"];

    return {
      authOk: auth?.status ? auth.status === "ok" : null,
      websocketOk: websocket?.status ? websocket.status === "ok" : null,
      authSummary: auth?.summary ?? null,
      websocketSummary: websocket?.summary ?? null
    };
  } catch {
    return {
      authOk: null,
      websocketOk: null,
      authSummary: null,
      websocketSummary: null
    };
  }
}

export function getRunnerSettings(config: AppConfig): HealthResponse["runner"] {
  return {
    mode: config.codexRunner ?? "mock",
    cliBin: config.codexCliBin ?? "codex",
    pmModel: config.codexPmModel ?? "gpt-5.5",
    workerModel: config.codexWorkerModel ?? "gpt-5.5",
    scribeModel: config.codexScribeModel ?? "gpt-5.5",
    execArgs: config.codexExecArgs ?? [],
    timeoutMs: config.codexTimeoutMs ?? 600000
  };
}

export function applyPersistedRunnerSettings(db: DatabaseSync, config: AppConfig): void {
  config.codexRunner = normalizeMode(getMeta(db, keys.mode) ?? config.codexRunner);
  config.codexCliBin = getMeta(db, keys.cliBin) ?? config.codexCliBin ?? "codex";
  config.codexPmModel = getMeta(db, keys.pmModel) ?? config.codexPmModel ?? "gpt-5.5";
  config.codexWorkerModel = getMeta(db, keys.workerModel) ?? config.codexWorkerModel ?? "gpt-5.5";
  config.codexScribeModel = getMeta(db, keys.scribeModel) ?? config.codexScribeModel ?? "gpt-5.5";
}

export function updateRunnerSettings(
  db: DatabaseSync,
  config: AppConfig,
  input: UpdateRunnerSettingsRequest
): HealthResponse["runner"] {
  const mode = normalizeMode(input.mode);
  const cliBin = requiredText(input.cliBin, "Codex CLI");
  const pmModel = requiredText(input.pmModel, "PM 모델");
  const workerModel = requiredText(input.workerModel, "worker 모델");
  const scribeModel = requiredText(input.scribeModel, "scribe 모델");

  setMeta(db, keys.mode, mode);
  setMeta(db, keys.cliBin, cliBin);
  setMeta(db, keys.pmModel, pmModel);
  setMeta(db, keys.workerModel, workerModel);
  setMeta(db, keys.scribeModel, scribeModel);

  config.codexRunner = mode;
  config.codexCliBin = cliBin;
  config.codexPmModel = pmModel;
  config.codexWorkerModel = workerModel;
  config.codexScribeModel = scribeModel;

  return getRunnerSettings(config);
}

export function checkCodexConnection(config: AppConfig): CodexConnectionStatusResponse {
  const mode = config.codexRunner ?? "mock";
  const cliBin = config.codexCliBin ?? "codex";
  const checkedAt = new Date().toISOString();

  if (mode !== "codex-cli") {
    return {
      state: "mock",
      mode,
      cliBin,
      version: null,
      authStatus: null,
      checkedAt,
      message: "현재 Mock 응답 모드입니다.",
      details: ["실제 Codex를 쓰려면 실행 방식을 Codex CLI로 바꾸고 저장하세요."]
    };
  }

  const version = runCli(config, ["--version"], 5000);
  if (version.status !== 0) {
    return {
      state: "not_installed",
      mode,
      cliBin,
      version: null,
      authStatus: null,
      checkedAt,
      message: "Codex CLI를 실행하지 못했습니다.",
      details: [firstFailureText(version) || "Codex CLI 명령을 찾지 못했습니다."]
    };
  }

  const login = runCli(config, ["login", "status"], 10000);
  const doctor = runCli(config, ["doctor", "--json"], 20000);
  const doctorStatus = parseDoctorJson(doctor.stdout);
  const authStatus = login.stdout || doctorStatus.authSummary;
  const loginOk = login.status === 0 && /logged in/i.test(login.stdout);
  const authOk = doctorStatus.authOk ?? loginOk;
  const websocketOk = doctorStatus.websocketOk;
  const details = [
    `CLI: ${version.stdout}`,
    authStatus ? `인증: ${authStatus}` : "",
    doctorStatus.websocketSummary ? `네트워크: ${doctorStatus.websocketSummary}` : "",
    doctor.status !== 0 && !doctorStatus.authSummary ? firstFailureText(doctor) : ""
  ].filter(Boolean);

  if (!loginOk && authOk !== true) {
    return {
      state: "not_logged_in",
      mode,
      cliBin,
      version: version.stdout,
      authStatus,
      checkedAt,
      message: "Codex 로그인이 필요합니다.",
      details
    };
  }

  if (websocketOk === false) {
    return {
      state: "error",
      mode,
      cliBin,
      version: version.stdout,
      authStatus,
      checkedAt,
      message: "로그인은 되어 있지만 Codex 네트워크 연결 확인에 실패했습니다.",
      details
    };
  }

  return {
    state: "connected",
    mode,
    cliBin,
    version: version.stdout,
    authStatus,
    checkedAt,
    message: "Codex CLI가 로그인되어 있고 연결 확인이 완료되었습니다.",
    details
  };
}

function openWindowsCodexTerminal(config: AppConfig, cliBin: string): void {
  const scriptDir = path.join(config.dataDir, "system");
  ensureDir(scriptDir);
  const scriptPath = path.join(scriptDir, "codex-login.cmd");
  fs.writeFileSync(
    scriptPath,
    [
      "@echo off",
      "chcp 65001 > nul",
      "title Local Company Codex Login",
      `cd /d "${config.rootDir}"`,
      `set "CODEX_CLI_BIN=${cliBin}"`,
      "set \"TERM=xterm-256color\"",
      "echo Local Company V2 - Codex CLI 로그인",
      "echo.",
      "echo 이 창은 Codex 로그인 전용입니다.",
      "echo.",
      "echo 1. 이미 로그인되어 있다고 나오면 이 창을 닫고 앱으로 돌아가세요.",
      "echo 2. 로그인 주소나 기기 코드가 나오면 브라우저 안내를 따라 로그인하세요.",
      "echo 3. 혹시 Continue anyway? [y/N]가 보이면 y를 입력하고 Enter를 누르세요.",
      "echo 4. 끝나면 Local Company V2 설정 화면에서 연결 확인을 누르세요.",
      "echo 5. 연결됨으로 표시되면 캠페인에서 PM에게 메시지를 보내면 됩니다.",
      "echo.",
      "echo Local Company는 비밀번호나 API 키를 저장하지 않습니다.",
      "echo.",
      "for /f \"delims=\" %%P in ('npm config get prefix 2^>nul') do set \"NPM_PREFIX=%%P\"",
      "if defined NPM_PREFIX if exist \"%NPM_PREFIX%\\codex.cmd\" (",
      "  set \"CODEX_RESOLVED=%NPM_PREFIX%\\codex.cmd\"",
      "  goto run_codex",
      ")",
      "if exist \"%CODEX_CLI_BIN%\" (",
      "  set \"CODEX_RESOLVED=%CODEX_CLI_BIN%\"",
      "  goto run_codex",
      ")",
      "for /f \"delims=\" %%C in ('where \"%CODEX_CLI_BIN%\" 2^>nul') do (",
      "  echo %%C | findstr /i \"\\\\WindowsApps\\\\OpenAI.Codex_\" >nul",
      "  if errorlevel 1 (",
      "    set \"CODEX_RESOLVED=%%C\"",
      "    goto run_codex",
      "  )",
      ")",
      "echo.",
      "echo 공식 npm Codex CLI를 찾지 못했거나 Windows 앱 별칭 실행이 막혔습니다.",
      "echo 지금 공식 Codex CLI를 설치 또는 업데이트합니다.",
      "echo 로그인 화면이 시작되기 전 npm 다운로드 진행 상황이 보일 수 있습니다.",
      "echo.",
      "echo npm install -g @openai/codex",
      "echo.",
      "call npm install -g @openai/codex",
      "if errorlevel 1 goto install_failed",
      "for /f \"delims=\" %%P in ('npm config get prefix 2^>nul') do set \"NPM_PREFIX=%%P\"",
      "if defined NPM_PREFIX if exist \"%NPM_PREFIX%\\codex.cmd\" (",
      "  set \"CODEX_RESOLVED=%NPM_PREFIX%\\codex.cmd\"",
      "  goto run_codex",
      ")",
      "echo npm 설치 후에도 Codex CLI를 찾지 못했습니다.",
      "goto install_failed",
      ":run_codex",
      "echo 찾은 Codex CLI: %CODEX_RESOLVED%",
      "echo.",
      "echo 먼저 로그인 상태를 확인합니다...",
      "call \"%CODEX_RESOLVED%\" login status >nul 2>nul",
      "if not errorlevel 1 goto already_logged_in",
      "echo.",
      "echo 로그인이 필요합니다. 이제 Codex 로그인 화면을 엽니다.",
      "echo 브라우저가 열리거나 기기 코드가 나오면 화면 안내를 따라주세요.",
      "echo.",
      "call \"%CODEX_RESOLVED%\" login --device-auth",
      "if errorlevel 1 goto login_failed",
      "goto login_done",
      ":already_logged_in",
      "echo.",
      "echo 이미 Codex에 로그인되어 있습니다.",
      "goto login_done",
      ":login_done",
      "echo.",
      "echo Codex 로그인 확인이 끝났습니다.",
      "echo.",
      "echo 다음 단계:",
      "echo Local Company V2 설정 화면으로 돌아가 연결 확인을 누르세요.",
      "echo 연결됨으로 표시되면 캠페인으로 돌아가 PM에게 메시지를 보내세요.",
      "echo 아직 로그인이 필요하다고 나오면 설치/로그인 터미널 열기를 다시 눌러주세요.",
      "pause",
      "exit /b 0",
      ":login_failed",
      "echo.",
      "echo Codex 로그인이 실패했거나 중간에 취소되었습니다.",
      "echo 다시 시도하려면 Local Company V2에서 설치/로그인 터미널 열기를 한 번 더 누르세요.",
      "echo 직접 시도하려면 이 터미널에서 아래 명령을 입력하세요:",
      "echo codex login --device-auth",
      "echo.",
      "pause",
      "exit /b 1",
      ":install_failed",
      "echo.",
      "echo Codex CLI 설치 또는 실행에 실패했습니다.",
      "echo 이 터미널에서 아래 명령을 직접 시도할 수 있습니다:",
      "echo npm install -g @openai/codex",
      "echo codex login --device-auth",
      "echo.",
      "pause"
    ].join("\r\n"),
    "utf8"
  );

  const child = spawn("cmd.exe", ["/d", "/c", "start", "Local Company Codex Login", "cmd.exe", "/k", scriptPath], {
    cwd: config.rootDir,
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();
}

function openMacCodexTerminal(config: AppConfig, cliBin: string): void {
  const command = `cd ${shellQuote(config.rootDir)} && ${shellQuote(cliBin)}`;
  const child = spawn("osascript", ["-e", `tell application "Terminal" to do script ${JSON.stringify(command)}`], {
    cwd: config.rootDir,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

function openLinuxCodexTerminal(config: AppConfig, cliBin: string): void {
  const command = `cd ${shellQuote(config.rootDir)} && ${shellQuote(cliBin)}; echo; echo 'After login, return to Local Company.'; read -r -p 'Press Enter to close...'`;
  const child = spawn("x-terminal-emulator", ["-e", "sh", "-lc", command], {
    cwd: config.rootDir,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

export function openCodexLoginTerminal(config: AppConfig): { command: string; message: string } {
  const cliBin = safeCliBin(config.codexCliBin ?? "codex");

  if (process.platform === "win32") {
    openWindowsCodexTerminal(config, cliBin);
  } else if (process.platform === "darwin") {
    openMacCodexTerminal(config, cliBin);
  } else {
    openLinuxCodexTerminal(config, cliBin);
  }

  return {
    command: cliBin,
    message: "Codex 로그인 터미널을 열었습니다."
  };
}
