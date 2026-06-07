@echo off
setlocal

set "APP_DIR=%~dp0"
set "APP_URL=http://127.0.0.1:8788"
set "MCP_NAME=local-company"
set "MCP_COMMAND=%APP_DIR%node_modules\.bin\tsx.cmd"
set "MCP_SERVER=%APP_DIR%src\mcp\local-company-mcp.ts"

cd /d "%APP_DIR%"

echo Installing Local Company MCP for Codex...
echo.

if not exist "package.json" (
  echo App files were not found.
  echo Current folder: %APP_DIR%
  pause
  exit /b 1
)

where.exe codex > nul 2> nul
if errorlevel 1 (
  echo Codex CLI was not found.
  echo Install or update Codex first, then run this file again.
  echo.
  echo npm install -g @openai/codex
  pause
  exit /b 1
)

if not exist "%MCP_COMMAND%" (
  echo Installing required Node packages first...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
  )
)

if not exist "%MCP_SERVER%" (
  echo MCP server file was not found:
  echo %MCP_SERVER%
  pause
  exit /b 1
)

codex mcp remove "%MCP_NAME%" > nul 2> nul
codex mcp add "%MCP_NAME%" --env LOCAL_COMPANY_URL=%APP_URL% -- "%MCP_COMMAND%" "%MCP_SERVER%"
if errorlevel 1 (
  echo.
  echo Codex MCP registration failed.
  pause
  exit /b 1
)

echo.
echo Local Company MCP is registered for Codex.
echo Restart Codex or start a new Codex thread if the tool does not appear right away.
echo.
codex mcp list
echo.
pause
