"""Authenticated loopback API for the local review client."""

from __future__ import annotations

import argparse
import re
import secrets
import uuid
from pathlib import Path
from typing import Annotated, Any

import uvicorn
from fastapi import BackgroundTasks, Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from core import profile
from core import sync as git_sync
from core.vault_identity import VaultMonitor, list_registered, register_vault
from core.repository import list_markdown
from core.access import extract_summary
from core.onboarding import onboarding_state, propose_answer
from core.human3 import confirm_session, current_session, save_conclusion, save_dimension, session_view, start_session
from core import monthly_reflection
from core import product_state
from core import security
from core.visualization import human3_trend, monthly_trend, privacy_audit, profile_overview, timeline
from core import growth
from core import vault_management
from core.vault_management import assert_vault_isolated, recover_vault_swap, require_current_schema, vault_operation_lock


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status = status
        self.code = code
        self.message = message


class CandidateInput(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    memory_type: str = Field(default="note", max_length=64)
    subject: str = Field(default="", max_length=200)


class EditInput(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class ActionInput(BaseModel):
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")
    reason: str = Field(default="user-request", max_length=200)
    content: str = Field(default="", max_length=4000)


class OnboardingInput(BaseModel):
    topic: str = Field(min_length=1, max_length=40)
    content: str = Field(min_length=1, max_length=1000)
    consent: bool


class Human3DimensionInput(BaseModel):
    reflection: str = Field(min_length=1, max_length=2000)
    evidence: str = Field(default="", max_length=1200)
    evidence_state: str = Field(pattern=r"^(sufficient|limited|insufficient)$")
    score: float = Field(ge=0, le=10)
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class Human3ConclusionInput(BaseModel):
    summary: str = Field(min_length=1, max_length=1600)
    plan: str = Field(min_length=1, max_length=1600)
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class RevisionInput(BaseModel):
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class MonthlyCreateInput(BaseModel):
    month: str = Field(pattern=r"^\d{4}-(?:0[1-9]|1[0-2])$")


class MonthlyDimensionInput(BaseModel):
    content: str = Field(default="", max_length=5000)
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class MonthlyEventInput(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    dimension: str = Field(pattern=r"^(mind|body|spirit|vocation)$")
    description: str = Field(default="", max_length=1200)
    feeling: str = Field(default="", max_length=500)
    project: str = Field(default="", max_length=120)
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class MonthlyGoalsInput(BaseModel):
    goals: list[dict[str, Any]] = Field(max_length=30)
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class MonthlySummaryInput(BaseModel):
    summary: str = Field(min_length=1, max_length=2400)
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class GrowthCreateInput(BaseModel):
    month: str = Field(pattern=r"^\d{4}-(?:0[1-9]|1[0-2])$")


class GrowthDimensionInput(BaseModel):
    current: str = Field(default="", max_length=5000)
    evidence: str = Field(default="", max_length=5000)
    challenges: str = Field(default="", max_length=5000)
    direction: str = Field(default="", max_length=5000)
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class GrowthLevelInput(BaseModel):
    level: str = Field(default="", max_length=8)
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class GrowthAssociationInput(BaseModel):
    from_dimension: str = Field(pattern=r"^(mind|body|spirit|vocation)$")
    from_event_id: str = Field(default="", max_length=80)
    to_dimension: str = Field(pattern=r"^(mind|body|spirit|vocation)$")
    to_event_id: str = Field(default="", max_length=80)
    relation_type: str = Field(pattern=r"^(correlation|causation)$")
    note: str = Field(default="", max_length=1200)


class GrowthGoalCreateInput(BaseModel):
    horizon: str = Field(pattern=r"^(long-term|quarterly|monthly)$")
    title: str = Field(min_length=1, max_length=160)
    action: str = Field(default="", max_length=500)
    priority: str = Field(pattern=r"^(low|medium|high)$")
    due: str = Field(default="", max_length=10)
    previous_goal_id: str = Field(default="", max_length=80)


class GrowthGoalUpdateInput(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    action: str = Field(default="", max_length=500)
    priority: str = Field(pattern=r"^(low|medium|high)$")
    due: str = Field(default="", max_length=10)
    completed: bool = False
    previous_goal_id: str = Field(default="", max_length=80)
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class SecurityClientInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    scopes: list[str] = Field(min_length=1, max_length=20)


class SecurityScopesInput(BaseModel):
    scopes: list[str] = Field(min_length=1, max_length=20)


class BackupRestoreInput(BaseModel):
    confirmation: str = Field(min_length=1, max_length=220)
    expected_vault_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class VaultPathInput(BaseModel):
    path: str = Field(min_length=1, max_length=1000)


class GitCommitInput(BaseModel):
    message: str = Field(min_length=1, max_length=160)
    confirmation: str = Field(pattern=r"^COMMIT$")


class GitConfirmationInput(BaseModel):
    confirmation: str = Field(pattern=r"^(PULL|PUSH)$")


def safe_git_error(message: str, root: Path) -> str:
    """Keep Git diagnostics useful without returning credentials or Vault paths."""
    value = re.sub(r"(https?://)[^/@\s]+@", r"\1[redacted]@", message)
    return value.replace(str(root), "[Vault]")


def envelope(data: Any, revision: str | None = None) -> dict[str, Any]:
    meta: dict[str, Any] = {"requestId": uuid.uuid4().hex}
    if revision:
        meta["revision"] = revision
    return {"data": data, "meta": meta}


def domain_error(exc: SystemExit) -> ApiError:
    message = str(exc)
    if "未找到" in message or "不存在" in message:
        return ApiError(404, "NOT_FOUND", message)
    if "其他进程修改" in message or "目标文件已存在" in message:
        return ApiError(409, "REVISION_CONFLICT", message)
    if "冲突" in message or "相同" in message or "已存在" in message:
        return ApiError(409, "MEMORY_CONFLICT", message)
    return ApiError(400, "INVALID_REQUEST", message)


def memory_view(root: Path, path: Path) -> dict[str, Any]:
    path = profile.safe_vault_file(root, path)
    metadata, body = profile.read_record(path)
    return {
        "id": metadata["id"],
        "status": metadata["status"],
        "type": metadata.get("type", "note"),
        "subject": metadata.get("subject", ""),
        "sourceAgent": metadata.get("source_agent", "unknown"),
        "created": metadata.get("created", ""),
        "updated": metadata.get("updated", ""),
        "visibility": metadata.get("visibility", "private"),
        "aiAccess": metadata.get("ai_access", "denied"),
        "tags": [item.strip() for item in metadata.get("tags", "").split(",") if item.strip()][:20],
        "content": extract_summary(body),
        "revision": profile.revision(path),
    }


def memory_stats(root: Path) -> dict[str, int]:
    counts = {"candidateMemories": 0, "pendingReview": 0, "confirmedMemories": 0}
    for folder, target in (("Inbox", "pendingReview"), ("Confirmed", "confirmedMemories")):
        for path in list_markdown(root, f"30 Memory/{folder}"):
            metadata, _ = profile.read_record(profile.safe_vault_file(root, path))
            counts[target] += 1
            if folder == "Inbox" and metadata.get("status") == "candidate":
                counts["candidateMemories"] += 1
    return counts


def find(root: Path, folder: str, record_id: str) -> Path:
    with profile.vault_lock(root):
        try:
            return profile.record_by_id(root, folder, record_id)
        except SystemExit as exc:
            raise domain_error(exc) from None


def create_app(vault: Path, token: str | None = None, web_dist: Path | None = None) -> FastAPI:
    root = vault.expanduser().resolve()
    with vault_operation_lock(root):
        recover_vault_swap(root)
    missing = [name for name in profile.REQUIRED if not (root / name).is_file()]
    if missing:
        raise RuntimeError(f"私人档案结构不完整：{', '.join(missing)}")
    assert_vault_isolated(root)
    require_current_schema(root)

    app = FastAPI(title="Personal AI Profile Local API", version="0.1.0")
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])
    app.state.vault = root
    app.state.token = token or secrets.token_urlsafe(32)
    app.state.request_shutdown = None
    app.state.request_restart = None
    register_vault(root)
    app.state.vault_monitor = VaultMonitor(root)

    @app.middleware("http")
    async def track_local_mutations(request: Request, call_next):
        response = await call_next(request)
        if request.method in {"POST", "PUT", "PATCH", "DELETE"} and response.status_code < 400 and not request.url.path.startswith("/api/v1/vault/switch"):
            app.state.vault_monitor.accept()
        return response

    def authorize(authorization: Annotated[str | None, Header()] = None) -> None:
        scheme, _, credential = (authorization or "").partition(" ")
        if scheme.lower() != "bearer" or not secrets.compare_digest(credential, app.state.token):
            raise ApiError(401, "UNAUTHORIZED", "需要有效的本地启动会话。")

    auth = Depends(authorize)

    @app.exception_handler(ApiError)
    async def api_error(request: Request, exc: ApiError) -> JSONResponse:
        request_id = uuid.uuid4().hex
        return JSONResponse(
            status_code=exc.status,
            content={"error": {"code": exc.code, "message": exc.message, "details": {}}, "requestId": request_id},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        request_id = uuid.uuid4().hex
        return JSONResponse(
            status_code=422,
            content={
                "error": {"code": "VALIDATION_ERROR", "message": "请求数据格式无效。", "details": exc.errors()},
                "requestId": request_id,
            },
        )

    @app.get("/api/v1/health")
    def health() -> dict[str, Any]:
        return envelope({"status": "ok", "schemaVersion": 1, "vaultReady": True})

    @app.get("/api/v1/vault", dependencies=[auth])
    def vault_status() -> dict[str, Any]:
        return envelope(app.state.vault_monitor.view())

    @app.get("/api/v1/vaults", dependencies=[auth])
    def vaults() -> dict[str, Any]:
        return envelope(list_registered())

    @app.post("/api/v1/vaults/validate", dependencies=[auth])
    def validate_vault(data: VaultPathInput) -> dict[str, Any]:
        candidate = Path(data.path).expanduser().resolve()
        try:
            assert_vault_isolated(candidate)
            require_current_schema(candidate)
            missing = [name for name in profile.REQUIRED if not (candidate / name).is_file()]
            if missing:
                raise RuntimeError(f"Vault 结构不完整：{', '.join(missing)}")
            entry = register_vault(candidate)
            return envelope({"vaultId": entry["vault_id"], "displayName": entry["display_name"], "valid": True})
        except RuntimeError as exc:
            raise ApiError(400, "INVALID_VAULT", str(exc)) from None

    @app.post("/api/v1/vaults/create", status_code=201, dependencies=[auth])
    def create_vault(data: VaultPathInput) -> dict[str, Any]:
        candidate = Path(data.path).expanduser().resolve()
        try:
            profile.init(str(candidate))
            entry = register_vault(candidate)
            return envelope({"vaultId": entry["vault_id"], "displayName": entry["display_name"], "created": True})
        except (RuntimeError, SystemExit) as exc:
            raise ApiError(400, "VAULT_CREATE_FAILED", str(exc)) from None

    @app.post("/api/v1/vault/switch", dependencies=[auth])
    def switch_vault(data: VaultPathInput, background: BackgroundTasks) -> dict[str, Any]:
        candidate = Path(data.path).expanduser().resolve()
        validate_vault(data)
        if not callable(app.state.request_restart):
            raise ApiError(409, "RESTART_UNAVAILABLE", "当前启动方式不支持安全切换；请关闭服务后使用 --vault 重新启动。")
        background.add_task(app.state.request_restart, candidate)
        return envelope({"status": "restarting"})

    @app.get("/api/v1/git/status", dependencies=[auth])
    def git_status() -> dict[str, Any]:
        try:
            return envelope(git_sync.sync_status(str(root)))
        except RuntimeError as exc:
            return envelope({"configured": False, "message": safe_git_error(str(exc), root), "dirty": [], "unmerged": []})

    @app.post("/api/v1/git/commit", dependencies=[auth])
    def git_commit(data: GitCommitInput) -> dict[str, Any]:
        if data.confirmation != "COMMIT":
            raise ApiError(400, "CONFIRMATION_REQUIRED", "请输入 COMMIT 确认。")
        try:
            return envelope({"head": git_sync.sync_commit(str(root), data.message)})
        except RuntimeError as exc:
            raise ApiError(409, "GIT_COMMIT_FAILED", safe_git_error(str(exc), root)) from None

    @app.post("/api/v1/git/pull", dependencies=[auth])
    def git_pull(data: GitConfirmationInput) -> dict[str, Any]:
        if data.confirmation != "PULL":
            raise ApiError(400, "CONFIRMATION_REQUIRED", "请输入 PULL 确认。")
        try:
            return envelope(git_sync.sync_pull(str(root)))
        except RuntimeError as exc:
            raise ApiError(409, "GIT_PULL_FAILED", safe_git_error(str(exc), root)) from None

    @app.post("/api/v1/git/push", dependencies=[auth])
    def git_push(data: GitConfirmationInput) -> dict[str, Any]:
        if data.confirmation != "PUSH":
            raise ApiError(400, "CONFIRMATION_REQUIRED", "请输入 PUSH 确认。")
        try:
            return envelope(git_sync.sync_push(str(root)))
        except RuntimeError as exc:
            raise ApiError(409, "GIT_PUSH_FAILED", safe_git_error(str(exc), root)) from None

    @app.get("/api/v1/capabilities", dependencies=[auth])
    def capabilities() -> dict[str, Any]:
        return envelope({"memoryLifecycle": True, "vaultLifecycle": True, "externalChangeDetection": True, "gitBackup": True, "visualization": True, "onboarding": True, "human3Reflection": True, "monthlyReflection": True, "growthIntelligence": True, "securityCenter": True, "backupRecovery": True, "revisionControl": True, "fileLock": True, "shutdown": callable(app.state.request_shutdown)})

    @app.get("/api/v1/overview", dependencies=[auth])
    def overview_snapshot() -> dict[str, Any]:
        with profile.vault_lock(root):
            memory = memory_stats(root)
            clients = security.list_clients(root)
            active = [client for client in clients if client["authorization"] == "authorized"]
            recent = security.query_events(root, page_size=6)["items"]
            months = growth.growth_timeline(root)["months"]
            latest_month = months[-1] if months else None
            return envelope({
                "profile": profile_overview(root),
                "memory": memory,
                "clients": {"total": len(active), "active": active[:8]},
                "recentAccess": recent,
                "growth": {"latestMonth": latest_month},
                "pending": memory["pendingReview"],
                "vault": "ready",
                "initialized": product_state.is_initialized(root),
            })

    @app.post("/api/v1/initialized", dependencies=[auth])
    def mark_initialized() -> dict[str, Any]:
        with profile.vault_lock(root):
            product_state.mark_initialized(root)
        return envelope({"initialized": True})

    @app.get("/api/v1/backups", dependencies=[auth])
    def backups() -> dict[str, Any]:
        try:
            return envelope(vault_management.backup_overview(root))
        except RuntimeError as exc:
            raise ApiError(400, "BACKUP_ERROR", str(exc)) from None

    @app.post("/api/v1/backups", status_code=201, dependencies=[auth])
    def create_backup() -> dict[str, Any]:
        try:
            item = vault_management.create_managed_backup(root)
            overview = vault_management.backup_overview(root)
            return envelope({"backup": item, "currentRevision": overview["currentRevision"]})
        except RuntimeError as exc:
            raise ApiError(400, "BACKUP_ERROR", str(exc)) from None

    @app.get("/api/v1/backups/{backup_id}/verify", dependencies=[auth])
    def verify_backup(backup_id: str) -> dict[str, Any]:
        try:
            return envelope(vault_management.verify_managed_backup(root, backup_id))
        except RuntimeError as exc:
            raise ApiError(400, "BACKUP_INVALID", str(exc)) from None

    @app.post("/api/v1/backups/{backup_id}/restore", dependencies=[auth])
    def restore_backup(backup_id: str, data: BackupRestoreInput) -> dict[str, Any]:
        if data.confirmation != f"RESTORE {backup_id}":
            raise ApiError(400, "CONFIRMATION_REQUIRED", "恢复确认文字不匹配。")
        try:
            return envelope(vault_management.restore_managed_backup(root, backup_id, data.expected_vault_revision))
        except RuntimeError as exc:
            message = str(exc)
            if "其他入口修改" in message:
                raise ApiError(409, "REVISION_CONFLICT", message) from None
            raise ApiError(400, "RESTORE_ERROR", message) from None

    @app.get("/api/v1/visualization/profile", dependencies=[auth])
    def visualization_profile() -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope(profile_overview(root))

    @app.get("/api/v1/visualization/timeline", dependencies=[auth])
    def visualization_timeline(limit: int = 100) -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope(timeline(root, max(1, min(limit, 100))))

    @app.get("/api/v1/visualization/privacy", dependencies=[auth])
    def visualization_privacy() -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope(privacy_audit(root))

    @app.get("/api/v1/visualization/human3", dependencies=[auth])
    def visualization_human3() -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope(human3_trend(root))

    @app.get("/api/v1/visualization/monthly", dependencies=[auth])
    def visualization_monthly() -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope(monthly_trend(root))

    @app.get("/api/v1/growth/dimensions", dependencies=[auth])
    def growth_dimensions() -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope(growth.dimension_overview(root))

    @app.get("/api/v1/growth/timeline", dependencies=[auth])
    def growth_timeline(month: str | None = None) -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope(growth.growth_timeline(root, month))

    @app.get("/api/v1/onboarding", dependencies=[auth])
    def get_onboarding() -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope(onboarding_state(root))

    @app.post("/api/v1/onboarding/responses", status_code=201, dependencies=[auth])
    def onboarding_response(data: OnboardingInput) -> dict[str, Any]:
        if data.consent is not True:
            raise ApiError(400, "CONSENT_REQUIRED", "只有明确同意后才能创建候选记忆。")
        try:
            path = propose_answer(root, data.topic, data.content)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope({"candidateId": profile.read_record(path)[0]["id"], "state": onboarding_state(root)})

    @app.get("/api/v1/human3/session", dependencies=[auth])
    def get_human3_session() -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope({"session": current_session(root)})

    @app.post("/api/v1/human3/session", status_code=201, dependencies=[auth])
    def create_human3_session() -> dict[str, Any]:
        try:
            path = start_session(str(root))
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope({"session": session_view(root, path)})

    @app.put("/api/v1/human3/session/{session_id}/dimensions/{dimension}", dependencies=[auth])
    def update_human3_dimension(session_id: str, dimension: str, data: Human3DimensionInput) -> dict[str, Any]:
        try:
            path = save_dimension(str(root), session_id, dimension, data.reflection, data.evidence, data.evidence_state, data.score, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope({"session": session_view(root, path)})

    @app.put("/api/v1/human3/session/{session_id}/conclusion", dependencies=[auth])
    def update_human3_conclusion(session_id: str, data: Human3ConclusionInput) -> dict[str, Any]:
        try:
            path = save_conclusion(str(root), session_id, data.summary, data.plan, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope({"session": session_view(root, path)})

    @app.post("/api/v1/human3/session/{session_id}/confirm", dependencies=[auth])
    def confirm_human3_session(session_id: str, data: RevisionInput) -> dict[str, Any]:
        try:
            destination = confirm_session(str(root), session_id, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        return envelope({"id": session_id, "status": "confirmed", "file": destination.name})

    @app.get("/api/v1/monthly-reflections", dependencies=[auth])
    def monthly_overview() -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope(monthly_reflection.overview(root))

    @app.get("/api/v1/monthly-reflections/{reflection_id}", dependencies=[auth])
    def monthly_get(reflection_id: str) -> dict[str, Any]:
        with profile.vault_lock(root):
            try:
                return envelope(monthly_reflection.reflection_view(root, monthly_reflection._find(root, reflection_id)))
            except SystemExit as exc:
                raise domain_error(exc) from None

    @app.post("/api/v1/monthly-reflections", status_code=201, dependencies=[auth])
    def monthly_create(data: MonthlyCreateInput) -> dict[str, Any]:
        try:
            path = monthly_reflection.create(str(root), data.month)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope(monthly_reflection.reflection_view(root, path))

    @app.put("/api/v1/monthly-reflections/{reflection_id}/dimensions/{dimension}", dependencies=[auth])
    def monthly_dimension(reflection_id: str, dimension: str, data: MonthlyDimensionInput) -> dict[str, Any]:
        try:
            path = monthly_reflection.save_dimension(str(root), reflection_id, dimension, data.content, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope(monthly_reflection.reflection_view(root, path))

    @app.post("/api/v1/monthly-reflections/{reflection_id}/events", dependencies=[auth])
    def monthly_add_event(reflection_id: str, data: MonthlyEventInput) -> dict[str, Any]:
        try:
            path = monthly_reflection.add_event(str(root), reflection_id, data.model_dump(exclude={"expected_revision"}), data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope(monthly_reflection.reflection_view(root, path))

    @app.delete("/api/v1/monthly-reflections/{reflection_id}/events/{event_id}", dependencies=[auth])
    def monthly_delete_event(reflection_id: str, event_id: str, expected_revision: str) -> dict[str, Any]:
        try:
            path = monthly_reflection.delete_event(str(root), reflection_id, event_id, expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope(monthly_reflection.reflection_view(root, path))

    @app.put("/api/v1/monthly-reflections/{reflection_id}/goals", dependencies=[auth])
    def monthly_goals(reflection_id: str, data: MonthlyGoalsInput) -> dict[str, Any]:
        try:
            path = monthly_reflection.save_goals(str(root), reflection_id, data.goals, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope(monthly_reflection.reflection_view(root, path))

    @app.post("/api/v1/monthly-reflections/{reflection_id}/summary-draft", dependencies=[auth])
    def monthly_summary_draft(reflection_id: str, data: RevisionInput) -> dict[str, Any]:
        try:
            path = monthly_reflection.generate_summary(str(root), reflection_id, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope(monthly_reflection.reflection_view(root, path))

    @app.put("/api/v1/monthly-reflections/{reflection_id}/summary", dependencies=[auth])
    def monthly_summary(reflection_id: str, data: MonthlySummaryInput) -> dict[str, Any]:
        try:
            path = monthly_reflection.save_summary(str(root), reflection_id, data.summary, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope(monthly_reflection.reflection_view(root, path))

    @app.post("/api/v1/monthly-reflections/{reflection_id}/confirm", dependencies=[auth])
    def monthly_confirm(reflection_id: str, data: RevisionInput) -> dict[str, Any]:
        try:
            path = monthly_reflection.confirm(str(root), reflection_id, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope(monthly_reflection.reflection_view(root, path))

    @app.get("/api/v1/growth/assessments", dependencies=[auth])
    def growth_overview() -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope(growth.overview(root))

    @app.post("/api/v1/growth/assessments", status_code=201, dependencies=[auth])
    def growth_create(data: GrowthCreateInput) -> dict[str, Any]:
        try:
            path = growth.create(str(root), data.month)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope(growth.assessment_view(root, path))

    @app.put("/api/v1/growth/assessments/{assessment_id}/dimensions/{dimension}", dependencies=[auth])
    def growth_dimension(assessment_id: str, dimension: str, data: GrowthDimensionInput) -> dict[str, Any]:
        try:
            path = growth.save_dimension(str(root), assessment_id, dimension, data.current, data.evidence, data.challenges, data.direction, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope(growth.assessment_view(root, path))

    @app.put("/api/v1/growth/assessments/{assessment_id}/level", dependencies=[auth])
    def growth_level(assessment_id: str, data: GrowthLevelInput) -> dict[str, Any]:
        try:
            path = growth.save_level(str(root), assessment_id, data.level, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope(growth.assessment_view(root, path))

    @app.post("/api/v1/growth/assessments/{assessment_id}/confirm", dependencies=[auth])
    def growth_confirm(assessment_id: str, data: RevisionInput) -> dict[str, Any]:
        try:
            path = growth.confirm(str(root), assessment_id, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope(growth.assessment_view(root, path))

    @app.delete("/api/v1/growth/assessments/{assessment_id}", dependencies=[auth])
    def growth_delete(assessment_id: str, expected_revision: str) -> dict[str, Any]:
        try:
            growth.delete(str(root), assessment_id, expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        return envelope({"id": assessment_id, "action": "archived"})

    @app.get("/api/v1/growth/associations", dependencies=[auth])
    def growth_associations() -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope(growth.list_associations(root))

    @app.post("/api/v1/growth/associations", status_code=201, dependencies=[auth])
    def growth_add_association(data: GrowthAssociationInput) -> dict[str, Any]:
        try:
            record = growth.add_association(str(root), data.from_dimension, data.from_event_id, data.to_dimension, data.to_event_id, data.relation_type, data.note)
        except SystemExit as exc:
            raise domain_error(exc) from None
        return envelope(record)

    @app.delete("/api/v1/growth/associations/{association_id}", dependencies=[auth])
    def growth_delete_association(association_id: str, expected_revision: str) -> dict[str, Any]:
        try:
            growth.delete_association(str(root), association_id, expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        return envelope({"id": association_id, "action": "deleted"})

    @app.get("/api/v1/growth/goals", dependencies=[auth])
    def growth_goals(horizon: str | None = None) -> dict[str, Any]:
        with profile.vault_lock(root):
            try:
                result = growth.list_goals(root, horizon)
            except SystemExit as exc:
                raise domain_error(exc) from None
            return envelope(result)

    @app.post("/api/v1/growth/goals", status_code=201, dependencies=[auth])
    def growth_add_goal(data: GrowthGoalCreateInput) -> dict[str, Any]:
        try:
            record = growth.add_goal(str(root), data.horizon, data.title, data.action, data.priority, data.due, data.previous_goal_id)
        except SystemExit as exc:
            raise domain_error(exc) from None
        return envelope(record)

    @app.put("/api/v1/growth/goals/{goal_id}", dependencies=[auth])
    def growth_update_goal(goal_id: str, data: GrowthGoalUpdateInput) -> dict[str, Any]:
        try:
            record = growth.update_goal(str(root), goal_id, title=data.title, action=data.action, priority=data.priority, due=data.due, completed=data.completed, previous_goal_id=data.previous_goal_id, expected_revision=data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        return envelope(record)

    @app.delete("/api/v1/growth/goals/{goal_id}", dependencies=[auth])
    def growth_delete_goal(goal_id: str, expected_revision: str) -> dict[str, Any]:
        try:
            growth.delete_goal(str(root), goal_id, expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        return envelope({"id": goal_id, "action": "deleted"})

    @app.get("/api/v1/security/overview", dependencies=[auth])
    def security_overview() -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope({"diagnostics": security.diagnostics(root), "scopes": sorted(security.KNOWN_SCOPES)})

    @app.get("/api/v1/security/clients", dependencies=[auth])
    def security_clients() -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope(security.list_clients(root))

    @app.post("/api/v1/security/clients", status_code=201, dependencies=[auth])
    def security_authorize_client(data: SecurityClientInput) -> dict[str, Any]:
        try:
            with profile.vault_lock(root):
                client, credential = security.create_client(root, data.name, data.scopes)
                return envelope({"client": client, "credential": credential})
        except SystemExit as exc:
            raise domain_error(exc) from None

    @app.post("/api/v1/security/clients/register", status_code=201, dependencies=[auth])
    def security_register_client(data: SecurityClientInput) -> dict[str, Any]:
        try:
            with profile.vault_lock(root):
                return envelope(security.register_client(root, data.name, data.scopes))
        except SystemExit as exc:
            raise domain_error(exc) from None

    @app.put("/api/v1/security/clients/{client_id}/scopes", dependencies=[auth])
    def security_update_client(client_id: str, data: SecurityScopesInput) -> dict[str, Any]:
        try:
            with profile.vault_lock(root):
                return envelope(security.update_scopes(root, client_id, data.scopes))
        except SystemExit as exc:
            raise domain_error(exc) from None

    @app.post("/api/v1/security/clients/{client_id}/revoke", dependencies=[auth])
    def security_revoke_client(client_id: str) -> dict[str, Any]:
        try:
            with profile.vault_lock(root):
                return envelope(security.revoke_client(root, client_id))
        except SystemExit as exc:
            raise domain_error(exc) from None

    @app.post("/api/v1/security/clients/{client_id}/authorize", dependencies=[auth])
    def security_client_authorize(client_id: str) -> dict[str, Any]:
        try:
            with profile.vault_lock(root):
                client, credential = security.authorize_client(root, client_id)
                return envelope({"client": client, "credential": credential})
        except SystemExit as exc:
            raise domain_error(exc) from None

    @app.post("/api/v1/security/clients/{client_id}/reissue", dependencies=[auth])
    def security_client_reissue(client_id: str) -> dict[str, Any]:
        try:
            with profile.vault_lock(root):
                client, credential = security.reissue_token(root, client_id)
                return envelope({"client": client, "credential": credential})
        except SystemExit as exc:
            raise domain_error(exc) from None

    @app.delete("/api/v1/security/clients/{client_id}", dependencies=[auth])
    def security_delete_client(client_id: str) -> dict[str, Any]:
        try:
            with profile.vault_lock(root):
                return envelope(security.delete_client(root, client_id))
        except SystemExit as exc:
            raise domain_error(exc) from None

    @app.get("/api/v1/security/audit-events", dependencies=[auth])
    def security_audit_events(client_id: str = "", event_type: str = "", resource_type: str = "", result: str = "", since: str = "", until: str = "", page: int = 1, page_size: int = 25) -> dict[str, Any]:
        if result not in {"", "allowed", "denied"}:
            raise ApiError(400, "INVALID_FILTER", "审计结果筛选无效。")
        with profile.vault_lock(root):
            return envelope(security.query_events(root, client_id=client_id, event_type=event_type, resource_type=resource_type, result=result, since=since, until=until, page=page, page_size=page_size))

    @app.post("/api/v1/shutdown", dependencies=[auth])
    def shutdown(background_tasks: BackgroundTasks) -> dict[str, Any]:
        callback = app.state.request_shutdown
        if not callable(callback):
            raise ApiError(503, "SHUTDOWN_UNAVAILABLE", "当前启动方式不支持远程关闭。")
        background_tasks.add_task(callback)
        return envelope({"status": "shutting-down"})

    @app.get("/api/v1/memories", dependencies=[auth])
    def list_memories(status: str = "candidate", limit: int = 50) -> dict[str, Any]:
        folders = {"candidate": "Inbox", "confirmed": "Confirmed", "rejected": "Rejected", "archived": "Archived"}
        if status not in folders:
            raise ApiError(400, "INVALID_STATUS", "不支持的记忆状态筛选。")
        with profile.vault_lock(root):
            files = list_markdown(root, f"30 Memory/{folders[status]}", limit=max(1, min(limit, 100)))
            return envelope([memory_view(root, path) for path in files])

    @app.get("/api/v1/memory-stats", dependencies=[auth])
    def get_memory_stats() -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope(memory_stats(root))

    @app.get("/api/v1/memories/{record_id}", dependencies=[auth])
    def get_memory(record_id: str) -> dict[str, Any]:
        with profile.vault_lock(root):
            for folder in ("Inbox", "Confirmed", "Rejected", "Archived"):
                try:
                    return envelope(memory_view(root, profile.record_by_id(root, folder, record_id)))
                except SystemExit:
                    pass
        raise ApiError(404, "NOT_FOUND", f"未找到记忆：{record_id}")

    @app.post("/api/v1/memories/candidates", status_code=201, dependencies=[auth])
    def create_candidate(data: CandidateInput) -> dict[str, Any]:
        try:
            path = profile.remember(str(root), data.content, "local-api", data.memory_type, data.subject)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            view = memory_view(root, path)
            return envelope(view, view["revision"])

    @app.patch("/api/v1/memories/{record_id}", dependencies=[auth])
    def edit_candidate(record_id: str, data: EditInput) -> dict[str, Any]:
        path = find(root, "Inbox", record_id)
        try:
            profile.edit_candidate(str(root), path.name, data.content, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        path = find(root, "Inbox", record_id)
        return envelope(memory_view(root, path), profile.revision(path))

    def lifecycle(record_id: str, data: ActionInput, action: str) -> dict[str, Any]:
        folder = "Confirmed" if action in {"forget", "supersede"} else "Inbox"
        path = find(root, folder, record_id)
        try:
            if action == "confirm":
                profile.confirm(str(root), path.name, data.expected_revision)
            elif action == "reject":
                profile.reject(str(root), path.name, data.reason, data.expected_revision)
            elif action == "forget":
                profile.forget(str(root), path.name, data.reason, data.expected_revision)
            elif action == "supersede":
                if not data.content.strip():
                    raise ApiError(400, "INVALID_REQUEST", "替代记忆不能为空。")
                profile.supersede(str(root), path.name, data.content, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        return envelope({"id": record_id, "action": action, "status": "completed"})

    @app.post("/api/v1/memories/{record_id}/confirm", dependencies=[auth])
    def confirm(record_id: str, data: ActionInput) -> dict[str, Any]:
        return lifecycle(record_id, data, "confirm")

    @app.post("/api/v1/memories/{record_id}/reject", dependencies=[auth])
    def reject(record_id: str, data: ActionInput) -> dict[str, Any]:
        return lifecycle(record_id, data, "reject")

    @app.post("/api/v1/memories/{record_id}/forget", dependencies=[auth])
    def forget(record_id: str, data: ActionInput) -> dict[str, Any]:
        return lifecycle(record_id, data, "forget")

    @app.post("/api/v1/memories/{record_id}/supersede", dependencies=[auth])
    def supersede(record_id: str, data: ActionInput) -> dict[str, Any]:
        return lifecycle(record_id, data, "supersede")

    web_dist = web_dist or Path(__file__).parents[1] / "web" / "dist"
    index = web_dist / "index.html"
    if index.is_file():
        @app.get("/{path:path}", include_in_schema=False)
        def web(path: str) -> FileResponse:
            candidate = (web_dist / path).resolve()
            try:
                candidate.relative_to(web_dist.resolve())
            except ValueError:
                candidate = index
            return FileResponse(candidate if candidate.is_file() else index, headers={"Cache-Control": "no-store"})

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="启动本地 Personal AI Profile API")
    parser.add_argument("--vault", required=True, type=Path)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    app = create_app(args.vault)
    print(f"Local API: http://127.0.0.1:{args.port}  Bearer token: {app.state.token}")
    uvicorn.run(app, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
