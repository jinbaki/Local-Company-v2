@echo off
setlocal

set "MCP_NAME=local-company"

echo Removing Local Company MCP from Codex...
echo.

where.exe codex > nul 2> nul
if errorlevel 1 (
  echo Codex CLI was not found.
  pause
  exit /b 1
)

codex mcp remove "%MCP_NAME%"
if errorlevel 1 (
  echo.
  echo Nothing was removed, or Codex returned an error.
  pause
  exit /b 1
)

echo.
echo Local Company MCP was removed from Codex.
echo.
pause
