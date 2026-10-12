# ProcureIQ Python Agent

Current staged implementation: FastAPI, deterministic quotation extraction, optional
structured model calls, and a durable LangGraph workflow. Business records, AHP,
approvals and purchase orders belong to the NestJS backend.

## Run locally

```powershell
cd D:\Quoc_VIet\services\agent
.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8001
```

Install dependencies in a fresh checkout with `python -m venv .venv`, then
`.venv\Scripts\python.exe -m pip install -r requirements.txt`.

## Configuration

| Variable | Default / behavior |
| --- | --- |
| `BACKEND_URL` | `http://127.0.0.1:3000/api` |
| `AGENT_API_KEY` | `local-demo-agent-key`; private key required in real mode |
| `DEMO_MODE` | `true`; demo vendor text is parsed and labeled `source: demo` |
| `AGENT_SQLITE_PATH` | Repository `.data/agent.sqlite` |
| `DATABASE_URL` | If provided, use LangGraph PostgreSQL saver |
| `LLM_API_KEY` | Optional; no model API call when unset |
| `LLM_BASE_URL` | OpenAI-compatible API, default `https://api.openai.com/v1` |
| `LLM_MODEL` | Default `gpt-4.1-mini` |

`GET /health` is public. `POST /extract`, `/runs/start`, and `/runs/resume`
require `X-Agent-Key`. Start accepts `{runId, productId, quantity?}`; resume
accepts `{runId}` only. Extra fields, including `approved`, are rejected.

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

The user requested smaller implementation stages. Real NestJS integration,
PostgreSQL checkpoint verification, a live model provider, installed OCR testing,
and the thirty labeled synthetic documents/evaluation script are deferred.
`test_evaluation.py` preserves the planned corpus acceptance check and is skipped
until that stage is implemented. No real-document accuracy claim has been made.
