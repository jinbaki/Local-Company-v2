# Codex 모바일 PM 브리지

Last updated: 2026-06-07

이 문서는 ChatGPT 모바일 앱의 Codex에서 Local Company V2 PM에게 의견을 전달하고 답변을 받는 구조를 설명한다.

## 목표

휴대폰에서 Codex에게 말한다.

```text
Local Company의 현재 캠페인 PM에게 이 의견 전달하고 답변 받아줘.
```

Codex는 로컬 PC에 연결된 MCP 도구를 사용해 Local Company 앱의 PM 대화 API를 호출한다. Local Company PM은 기존 캠페인 대화, 참고자료, 작업 그래프를 기준으로 답변하고, Codex는 그 결과를 휴대폰 대화에 다시 요약한다.

## 구조

```text
ChatGPT 모바일 Codex
  -> 연결된 PC의 Codex App
  -> local-company MCP server
  -> http://127.0.0.1:8788/api
  -> Local Company PM
```

앱을 외부 인터넷에 직접 공개하지 않는다. Local Company 앱은 계속 `127.0.0.1:8788` 로컬 주소에서만 실행한다.

## 구현된 MCP 도구

| 도구 | 역할 |
| --- | --- |
| `local_company_status` | Local Company 앱 실행 여부, 캠페인 수, 열린 결정 수 확인 |
| `local_company_list_campaigns` | 사업부와 캠페인 목록 확인 |
| `local_company_get_pm_workspace` | 특정 캠페인의 PM 대화, 참고자료, 작업/산출물/결정 요약 읽기 |
| `local_company_send_pm_message` | 대표 메시지를 캠페인 PM에게 전달하고 PM 답변 받기 |
| `local_company_create_campaign` | 사용자가 명시적으로 요청한 경우 새 캠페인 생성 |

삭제 도구는 제공하지 않는다. 캠페인과 사업부 삭제는 Local Company 앱 화면에서 직접 확인 후 실행한다.

## 설치

1. Local Company V2를 실행한다.

```text
start-local-company.cmd
```

2. Codex CLI가 로그인되어 있는지 확인한다.

```bash
codex --version
codex login status
```

3. Windows에서 프로젝트 폴더의 MCP 설치 파일을 실행한다.

```text
install-local-company-mcp.cmd
```

이 파일은 Codex MCP 설정에 `local-company` 서버를 추가한다. 연결 주소는 `http://127.0.0.1:8788` 이다.

4. Codex 앱을 재시작하거나 새 스레드를 시작한다.

5. Codex에서 다음처럼 요청한다.

```text
Local Company 캠페인 목록 확인해줘.
```

또는:

```text
Local Company PM에게 "제품 방향을 러너와 자전거 유저 중 어디에 먼저 맞추면 좋을지 검토해줘"라고 전달하고 답변 받아줘.
```

## 휴대폰에서 쓰기

Codex 모바일 연결은 Codex 앱의 원격 연결 기능을 사용한다.

필요 조건:

- PC의 Codex 앱이 켜져 있고 같은 ChatGPT 계정으로 로그인되어 있다.
- PC가 잠자기 상태가 아니고 네트워크에 연결되어 있다.
- Local Company V2 서버가 실행 중이다.
- `install-local-company-mcp.cmd`로 MCP 도구가 등록되어 있다.

휴대폰에서 Codex를 열고 연결된 PC 호스트를 선택한 뒤, Local Company PM에게 전달할 메시지를 요청한다.

## 다른 사용자가 설치할 때

이 MCP 연결은 저장소 소유자의 Codex 계정을 공유하는 방식이 아니다. 각 사용자는 자신의 PC에서 저장소를 클론하고, 자신의 Codex CLI 또는 Codex 앱에 로그인한 뒤 `install-local-company-mcp.cmd`를 실행한다.

설치 파일은 실행된 PC의 프로젝트 폴더를 기준으로 MCP 서버 경로를 등록하고, `LOCAL_COMPANY_URL=http://127.0.0.1:8788` 로컬 주소만 Codex에 알려준다. 따라서 다른 사용자의 MCP 도구는 그 사용자의 로컬 Local Company 앱과 그 사용자의 Codex 계정을 사용한다.

저장소에는 다음 정보를 넣지 않는다.

- Codex 계정 ID 또는 로그인 토큰
- API 키
- 실제 `.env`
- 실제 SQLite 데이터
- 로컬 실행 로그
- 개인 PC의 절대 경로

## 해제

Codex에서 Local Company MCP를 더 이상 쓰지 않으려면 다음 파일을 실행한다.

```text
uninstall-local-company-mcp.cmd
```

## 보안 기준

- Local Company HTTP 서버는 로컬 루프백 주소만 사용한다.
- MCP 도구는 PM 대화 전달과 읽기 중심으로 제한한다.
- 삭제, 로컬 파일 임의 접근, 외부 공개 서버 실행은 MCP 도구에 넣지 않는다.
- `local_company_send_pm_message`는 실제 PM runner를 호출할 수 있으므로, Codex CLI 실행 모드에서는 시간과 비용이 발생할 수 있다.

## 공식 참고

- [Codex remote connections](https://developers.openai.com/codex/remote-connections)
- [Codex MCP](https://developers.openai.com/codex/mcp)
- [Codex App Server](https://developers.openai.com/codex/app-server)
