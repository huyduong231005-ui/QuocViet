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
from llm import OptionalLLM
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


def create_app(workflow: AgentWorkflow | None = None) -> FastAPI:
    demo_mode = os.getenv("DEMO_MODE", "true").lower() in {"1", "true", "yes"}
    api_key = os.getenv("AGENT_API_KEY", "local-demo-agent-key")
    if not demo_mode and api_key == "local-demo-agent-key":
        raise RuntimeError("Set a private AGENT_API_KEY when DEMO_MODE=false")

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        model = None
        service = workflow
        if service is None:
            model = OptionalLLM.from_environment()
            backend = BackendClient(os.getenv("BACKEND_URL", "http://127.0.0.1:3000/api"), api_key)
            service = AgentWorkflow(backend, sqlite_path=os.getenv("AGENT_SQLITE_PATH"), database_url=os.getenv("DATABASE_URL"), demo_mode=demo_mode, llm=model)
        application.state.workflow = service
        application.state.model = service.llm
        try:
            yield
        finally:
            service.close()
            if model:
                model.close()

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
        return {"status": "ok", "service": "procureiq-agent", "demoMode": demo_mode, "ocrAvailable": bool(shutil.which("tesseract")), "llmConfigured": bool(os.getenv("LLM_API_KEY"))}

    @application.post("/extract", dependencies=[Depends(require_agent_key)])
    def extract(payload: ExtractionPayload, request: Request):
        if not payload.text and not payload.fileBase64:
            raise HTTPException(400, "Provide text or fileBase64")
        try:
            return extract_quotation(text=payload.text, file_base64=payload.fileBase64, mime_type=payload.mimeType, llm=request.app.state.model)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error

    @application.post("/runs/start", dependencies=[Depends(require_agent_key)])
    def start(payload: StartRun, request: Request):
        return request.app.state.workflow.start(payload.runId, payload.productId, payload.quantity)

    @application.post("/runs/resume", dependencies=[Depends(require_agent_key)])
    def resume(payload: ResumeRun, request: Request):
        return request.app.state.workflow.resume(payload.runId)

    return application


app = create_app()
