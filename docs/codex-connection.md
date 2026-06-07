# Codex 연결 안내

Last updated: 2026-05-30

Local Company V2는 두 가지 AI 실행 모드를 지원한다.

- `CODEX_RUNNER=mock`: 공개 데모와 오프라인 테스트용 기본 모드
- `CODEX_RUNNER=codex-cli`: 로컬에 설치되고 인증된 Codex CLI를 실제로 호출하는 모드

`codex-cli` 모드를 켜면 PM 답변, PM 액션 서기, 직원 산출물 작성, 산출물 수정, PM 리뷰가 `codex exec`를 통해 실행된다. 앱이 API 키를 직접 저장하지 않고, Codex CLI가 이미 로그인된 로컬 환경을 사용한다.

## 1. Codex CLI 설치

OpenAI 공식 안내 기준으로 Codex CLI는 로컬 터미널에서 설치하고 실행한다.

```bash
npm install -g @openai/codex
```

설치 후 버전을 확인한다.

```bash
codex --version
```

Windows에서는 PowerShell에서 네이티브로 실행하거나, 필요하면 WSL2 환경을 사용할 수 있다.

## 2. 인증

처음 한 번은 터미널에서 Codex를 직접 실행해 로그인한다.

```bash
codex
```

Codex CLI가 ChatGPT 계정 로그인 또는 API 키 인증 흐름을 안내한다. 인증 정보와 API 키는 공개 레포에 넣지 않는다.

주의:

- `.env`는 git에서 제외되어야 한다.
- `.env.example`에는 실제 키를 쓰지 않는다.
- Codex 인증 파일은 사용자 홈 폴더 쪽에 두고 프로젝트 폴더에 복사하지 않는다.
- 공개 전에는 `npm run check:public`을 실행한다.

## 3. 앱에서 실제 Codex 켜기

앱의 설정 화면에서 `Codex 연결` 실행 방식을 `Codex CLI`로 바꾸고 저장한다. 이 설정은 로컬 DB에 저장되므로 공개 레포에는 올라가지 않는다.

처음 로그인해야 한다면 같은 설정 화면에서 `설치/로그인 터미널 열기`를 누른다. 앱이 새 로컬 터미널을 열고 Codex 로그인 전용 흐름을 실행한다. 터미널에는 로그인 순서와 예외 상황에서 눌러야 할 키가 표시된다.

터미널에서 할 일:

- 이미 로그인되어 있다고 나오면 터미널을 닫고 앱으로 돌아간다.
- 로그인 주소나 기기 코드가 나오면 브라우저 안내를 따라 로그인한다.
- `Continue anyway? [y/N]`가 보이면 `y`를 입력하고 Enter를 누른다.
- Local Company 설정 화면으로 돌아와 `연결 확인`을 누른다.
- `연결됨`이 보이면 캠페인으로 돌아가 PM에게 메시지를 보낸다.

공식 npm CLI가 없거나 Windows 앱 별칭이 막혀 있으면 터미널에서 `@openai/codex`를 설치/업데이트한 뒤 `codex login --device-auth`를 실행한다. 로그인 과정은 Codex CLI가 처리하며 앱은 비밀번호나 API 키를 저장하지 않는다.

또는 `.env.example`을 `.env`로 복사한 뒤 다음 값만 바꿀 수 있다.

```text
CODEX_RUNNER=codex-cli
CODEX_CLI_BIN=codex
CODEX_PM_MODEL=gpt-5.5
CODEX_WORKER_MODEL=gpt-5.5
CODEX_SCRIBE_MODEL=gpt-5.5
CODEX_TIMEOUT_MS=600000
CODEX_EXEC_ARGS=
```

선택적으로 `CODEX_EXEC_ARGS`에 `codex exec` 추가 옵션을 넣을 수 있다.

예시:

```text
CODEX_EXEC_ARGS=--sandbox read-only
```

현재 앱은 Codex에게 파일을 직접 수정하라고 시키지 않고 최종 메시지를 받아 산출물 저장소에 기록한다. 그래서 기본 설정에서는 추가 실행 권한을 열 필요가 없다.

## 4. 동작 방식

앱은 다음 흐름에서 Codex CLI를 호출한다.

| 흐름 | 실행 내용 | 기본 모델 변수 |
| --- | --- | --- |
| PM 답변 | 대표 메시지를 읽고 PM 응답을 작성 | `CODEX_PM_MODEL` |
| PM 액션 서기 | PM 응답을 목표, 작업, 산출물, 팀 제안, 결정 요청 JSON으로 구조화 | `CODEX_SCRIBE_MODEL` |
| 직원 실행 | 작업지시를 산출물 초안 Markdown으로 작성 | `CODEX_WORKER_MODEL` |
| 산출물 수정 | 수정 요청을 반영한 새 산출물 버전 작성 | `CODEX_WORKER_MODEL` |
| PM 리뷰 | 산출물을 승인, 재작업, 대표 결정 필요 중 하나로 판정 | `CODEX_PM_MODEL` |

기본 모델 후보는 PM, worker, scribe 모두 `gpt-5.5`로 둔다. 공개 배포판은 계정별 모델 권한 차이로 처음부터 실패하지 않는 구성을 우선한다. `gpt-5.3-codex` 같은 Codex 전용 모델은 공식 모델 목록에 있더라도 로그인한 ChatGPT/API 계정과 Codex CLI 표면에서 지원될 때만 설정 화면에서 직접 바꾼다.

Codex CLI 실행 결과가 실패하거나 시간이 초과되면 해당 큐 항목은 `failed` 상태로 바뀌고, 오류 메시지가 앱에 남는다. 실패한 작업은 설정과 인증 상태를 확인한 뒤 다시 실행한다.

## 5. 연결 확인

1. `.env`에서 `CODEX_RUNNER=codex-cli`로 바꾼다.
2. 앱을 실행한다.

```bash
npm run dev
```

3. 설정 화면의 `Codex 연결`이 `Codex CLI 사용`으로 보이는지 확인한다.
4. 로그인이 필요하면 설정 화면에서 `설치/로그인 터미널 열기`를 누르고 터미널 안내에 따라 로그인한다.
5. `연결 확인`을 눌러 `연결됨` 상태인지 확인한다.
6. 캠페인에서 PM에게 메시지를 보내고, PM 팀 제안이 뜨면 승인한 뒤 운영판의 작업 실행을 눌러 산출물이 생성되는지 확인한다.

## 6. 보안 체크

```bash
npm run check:public
```

이 체크는 다음을 확인한다.

- `.env.example`에 실제 키가 없는지
- `.env`, `data/`, SQLite 파일, 빌드 산출물이 git에서 제외되는지
- 공개 문서에 로컬 절대경로나 개인 표시명이 남아 있지 않은지
- 설치, 사용, Codex 연결 문서가 준비되어 있는지

## 7. Codex 모바일에서 PM에게 전달하기

ChatGPT 모바일 앱의 Codex에서 Local Company PM에게 의견을 전달하려면 `install-local-company-mcp.cmd`로 MCP 도구를 등록한다. 이 연결은 Local Company 앱을 외부에 공개하지 않고, 연결된 PC의 Codex가 로컬 주소 `http://127.0.0.1:8788` 을 호출하는 방식이다.

자세한 설정과 사용 예시는 [Codex 모바일 PM 브리지](codex-mobile-pm-bridge.md)를 확인한다.

## 공식 참고

- [OpenAI Developers: Codex CLI](https://developers.openai.com/codex/cli)
- [OpenAI Help Center: API, Codex CLI, and Sign in with ChatGPT](https://help.openai.com/en/articles/11381614-api-codex-cli-and-sign-in-with-chatgpt)
- [OpenAI Developers: Codex models](https://developers.openai.com/codex/models)
