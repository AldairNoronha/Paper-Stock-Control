from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.core.database import dispose_engine
from app.modules.catalog.presentation.routes import router as catalog_router
from app.modules.inventory.application.errors import (
    InvalidMovementError,
    InventoryConflictError,
    InventoryNotFoundError,
)
from app.modules.inventory.presentation.routes import router as inventory_router
from app.modules.labels.application.errors import (
    LabelScanConflictError,
    LabelScanValidationError,
    LabelStorageError,
)
from app.modules.labels.presentation.photo_routes import router as photo_router
from app.modules.labels.presentation.routes import router as labels_router
from app.presentation.health import router as health_router

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    await dispose_engine()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health_router, prefix=settings.api_v1_prefix)
app.include_router(catalog_router, prefix=settings.api_v1_prefix)
app.include_router(inventory_router, prefix=settings.api_v1_prefix)
app.include_router(labels_router, prefix=settings.api_v1_prefix)
app.include_router(photo_router, prefix=settings.api_v1_prefix)


@app.exception_handler(InventoryNotFoundError)
async def inventory_not_found(
    _: Request, exception: InventoryNotFoundError
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND,
        content={"detail": str(exception)},
    )


@app.exception_handler(InventoryConflictError)
async def inventory_conflict(
    _: Request, exception: InventoryConflictError
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": str(exception)},
    )


@app.exception_handler(InvalidMovementError)
async def invalid_inventory_command(
    _: Request, exception: InvalidMovementError
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"detail": str(exception)},
    )


@app.exception_handler(IntegrityError)
async def inventory_integrity_conflict(_: Request, __: IntegrityError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": "inventory command conflicts with current data"},
    )


@app.exception_handler(LabelScanValidationError)
async def invalid_label_scan(
    _: Request, exception: LabelScanValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"detail": str(exception)},
    )


@app.exception_handler(LabelScanConflictError)
async def duplicate_label_scan(
    _: Request, exception: LabelScanConflictError
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": str(exception)},
    )


@app.exception_handler(LabelStorageError)
async def unavailable_label_storage(_: Request, exception: LabelStorageError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"detail": str(exception)},
    )


@app.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    return {"service": settings.app_name, "docs": "/docs"}
