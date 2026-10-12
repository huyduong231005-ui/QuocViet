# ProcureIQ Python Agent

Current stage: React → NestJS → FastAPI quotation extraction with optional
structured model calls and human confirmation before saving. Business records,
AHP, approvals and purchase orders belong to the NestJS backend. The separate
LangGraph workflow remains disabled in the current application configuration.
See the [setup and demo guide](../../docs/agent-integration.md).

## Run locally

```powershell
# From the repository root; install once, then configure a key locally:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-agent.ps1 -Install
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/configure-ai.ps1 -Restart
```

Install dependencies in a fresh checkout with `python -m venv .venv`, then
`.venv\Scripts\python.exe -m pip install -r requirements.txt`.

## Configuration

| Variable | Default / behavior |
| --- | --- |
| `BACKEND_URL` | `http://127.0.0.1:3000/api` |
| `AGENT_EXTRACTION_ENABLED` | Enables the NestJS extraction endpoint independently of workflow |
| `AGENT_ENABLED` | Enables workflow; leave false for the extraction stage |
| `AGENT_API_KEY` | `local-demo-agent-key`; private key required in real mode |
| `DEMO_MODE` | `true`; demo vendor text is parsed and labeled `source: demo` |
| `AGENT_SQLITE_PATH` | Repository `.data/agent.sqlite` |
| `AGENT_DATABASE_URL` | If provided, use LangGraph PostgreSQL saver when workflow is enabled; separate from app DB |
| `LLM_API_KEY` | Optional; no model API call when unset |
| `LLM_PROVIDER` | `gemini` for the native Gemini API, otherwise `openai` for the existing OpenAI-compatible client |
| `GEMINI_API_KEYS` | Comma-separated keys entered locally by `scripts/configure-gemini.ps1`; selected round-robin, up to 3 attempts per request |
| `GEMINI_MODEL` | Default `gemini-3.5-flash-lite` |
| `LLM_BASE_URL` | OpenAI-compatible API, default `https://api.openai.com/v1` |
| `LLM_MODEL` | Default `gpt-4.1-mini` |

`GET /health` is public. `POST /extract`, `/runs/start`, and `/runs/resume`
require `X-Agent-Key`. Start accepts `{runId, productId, quantity?}`; resume
accepts `{runId}` only. Extra fields, including `approved`, are rejected.

`POST /config/gemini` also requires `X-Agent-Key`. NestJS exposes it only to an
authenticated admin through the AI Agent page. It saves the key list to the
ignored root `.env` file and switches the extraction model in memory. Its
responses and public health endpoint return only model metadata and key count.

The workflow pauses using actual LangGraph interrupts at gate 1 and gate 2.
Resume fetches the bound backend approval before resuming, and the gate node
fetches it again; the interrupt response is never an authorization. Failed
nodes can resume from a checkpoint. Tools retry transport/server failures up
to three attempts and refuse client errors immediately. A thirty-call budget
limits each run; backend tools must additionally enforce their own budget and
idempotence. `report_error` is attempted after an execution failure.

Extraction reads Vietnamese/English text and embedded PDF text, reports every
missing field, and never infers quality scores. Optional model fields must be
supported by independently parsed, verbatim evidence. Images and scanned PDFs
require a Tesseract installation; otherwise their method and warnings report
OCR as unavailable. Real mode requires at least two existing backend quotations
and never generates vendor quotations.

## Verification and deferred work

```powershell
.venv\Scripts\python.exe -m pytest tests -q
```

The implemented tests cover parser text/PDF behavior, missing/invalid values,
document instructions remaining data, protected routes, optional model fallback,
two approval pauses, SQLite restart, rejection at both gates, backend refusal,
bounded retries, retry recovery, and real-mode quotation refusal.

The HTTP integration test in `apps/api/test/agent-extraction.test.ts` starts real
NestJS and Python services with an isolated database and a mock model provider.
It covers text/PDF drafts, permission checks, manual confirmation and outages.
Full workflow integration, PostgreSQL checkpoint verification, a live model provider, installed OCR testing,
and the thirty labeled synthetic documents/evaluation script are deferred.
`test_evaluation.py` preserves the planned corpus acceptance check and is skipped
until that stage is implemented. No real-document accuracy claim has been made.

Google applies Gemini limits per project, so rotating keys from one project does
not increase its total quota. A 429 response from all attempted keys produces a
clear rate-limit status and a deterministic draft. No model response bypasses
the document evidence check or user confirmation.
