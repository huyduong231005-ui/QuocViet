"""FastAPI entrypoint. Run: uvicorn app:app --host 127.0.0.1 --port 8001."""
from __future__ import annotations

import hmac
import os
import shutil
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from extraction import extract_quotation
from llm import GeminiLLM, model_from_environment
from configuration import save_gemini_config, validate_gemini_keys
from workflow import AgentWorkflow, BackendClient, BackendToolError, WorkflowConflict


class StrictPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class StartRun(StrictPayload):
    runId: str = Field(min_length=1, max_length=200)
    productId: str = Field(min_length=1, max_length=200)
    quantity: float | None = Field(default=None, gt=0, le=1_000_000_000)


class ResumeRun(StrictPayload):
    runId: str = Field(min_length=1, max_length=200)


class ExtractionPayload(StrictPayload):
    text: str | None = Field(default=None, max_length=100_000)
    fileBase64: str | None = Field(default=None, max_length=29_360_128)
    mimeType: str | None = Field(default=None, max_length=100)


class GeminiConfiguration(StrictPayload):
    keys: list[str] = Field(min_length=1, max_length=20)
    model: str = Field(default="gemini-3.5-flash-lite", min_length=1, max_length=100)


def create_app(workflow: AgentWorkflow | None = None) -> FastAPI:
    demo_mode = os.getenv("DEMO_MODE", "true").lower() in {"1", "true", "yes"}
    api_key = os.getenv("AGENT_API_KEY", "local-demo-agent-key")
    workflow_enabled = workflow is not None or os.getenv("AGENT_ENABLED", "false").lower() == "true"
    if not demo_mode and api_key == "local-demo-agent-key":
        raise RuntimeError("Set a private AGENT_API_KEY when DEMO_MODE=false")

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        model = None
        service = workflow
        if service is None:
            model = model_from_environment()
        if service is None and workflow_enabled:
            backend = BackendClient(os.getenv("BACKEND_URL", "http://127.0.0.1:3000/api"), api_key)
            service = AgentWorkflow(backend, sqlite_path=os.getenv("AGENT_SQLITE_PATH"), database_url=os.getenv("AGENT_DATABASE_URL"), demo_mode=demo_mode, llm=model)
        application.state.workflow = service
        application.state.model = service.llm if service else model
        application.state.models_to_close = [model] if model else []
        try:
            yield
        finally:
            if service:
                service.close()
            for instance in application.state.models_to_close:
                instance.close()

    application = FastAPI(title="ProcureIQ Agent", version="1.0.0", lifespan=lifespan)

    def require_agent_key(x_agent_key: Annotated[str | None, Header()] = None):
        if x_agent_key is None or not hmac.compare_digest(x_agent_key, api_key):
            raise HTTPException(401, "Invalid X-Agent-Key")

    @application.exception_handler(HTTPException)
    async def http_error(request: Request, error: HTTPException):
        return JSONResponse(status_code=error.status_code, content={"statusCode": error.status_code, "message": error.detail})

    @application.exception_handler(RequestValidationError)
    async def validation_error(request: Request, error: RequestValidationError):
        message = "; ".join(".".join(str(part) for part in entry["loc"]) + ": " + entry["msg"] for entry in error.errors())
        return JSONResponse(status_code=422, content={"statusCode": 422, "message": message})

    @application.exception_handler(WorkflowConflict)
    async def workflow_conflict(request: Request, error: WorkflowConflict):
        return JSONResponse(status_code=409, content={"statusCode": 409, "message": str(error)})

    @application.exception_handler(BackendToolError)
    async def backend_error(request: Request, error: BackendToolError):
        status = error.status_code if error.status_code < 500 else 502
        return JSONResponse(status_code=status, content={"statusCode": status, "message": str(error)})

    @application.get("/health")
    def health():
        model = getattr(application.state, "model", None)
        return {"status": "ok", "service": "procureiq-agent", "demoMode": demo_mode,
                "ocrAvailable": bool(shutil.which("tesseract")), "llmConfigured": model is not None,
                "model": getattr(model, "model", None), "provider": getattr(model, "provider", os.getenv("LLM_PROVIDER", "openai")),
                "keyCount": len(model.keys) if getattr(model, "provider", None) == "gemini" else (1 if model else 0),
                "workflowEnabled": workflow_enabled}

    def active_workflow(request: Request):
        if request.app.state.workflow is None:
            raise HTTPException(403, "Workflow is disabled; quotation extraction is available separately")
        return request.app.state.workflow

    @application.post("/extract", dependencies=[Depends(require_agent_key)])
    def extract(payload: ExtractionPayload, request: Request):
        if not payload.text and not payload.fileBase64:
            raise HTTPException(400, "Provide text or fileBase64")
        try:
            return extract_quotation(text=payload.text, file_base64=payload.fileBase64, mime_type=payload.mimeType, llm=request.app.state.model)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error

    @application.post("/config/gemini", dependencies=[Depends(require_agent_key)])
    def configure_gemini(payload: GeminiConfiguration, request: Request):
        if request.app.state.workflow is not None:
            raise HTTPException(403, "Configure Gemini while the extraction-only stage is active")
        try:
            keys = validate_gemini_keys(payload.keys)
            candidate = GeminiLLM(keys, payload.model)
            try:
                save_gemini_config(keys, payload.model)
            except Exception:
                candidate.close()
                raise
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        except OSError as error:
            raise HTTPException(503, "Could not save Agent configuration") from error
        except RuntimeError as error:
            raise HTTPException(503, str(error)) from error
        os.environ["LLM_PROVIDER"] = "gemini"
        os.environ["GEMINI_MODEL"] = payload.model
        os.environ["GEMINI_API_KEYS"] = ",".join(keys)
        request.app.state.model = candidate
        request.app.state.models_to_close.append(candidate)
        return {"configured": True, "provider": "gemini", "model": payload.model, "keyCount": len(keys)}

    @application.post("/runs/start", dependencies=[Depends(require_agent_key)])
    def start(payload: StartRun, request: Request):
        return active_workflow(request).start(payload.runId, payload.productId, payload.quantity)

    @application.post("/runs/resume", dependencies=[Depends(require_agent_key)])
    def resume(payload: ResumeRun, request: Request):
        return active_workflow(request).resume(payload.runId)

    return application


app = create_app()
