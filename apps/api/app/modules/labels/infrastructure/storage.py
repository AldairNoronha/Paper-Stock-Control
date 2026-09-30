from typing import Protocol
from urllib.parse import quote

import httpx

from app.core.config import Settings
from app.modules.labels.application.errors import LabelStorageError


class LabelImageStorage(Protocol):
    async def upload(self, path: str, content: bytes, content_type: str) -> None: ...

    async def delete(self, path: str) -> None: ...


class SupabaseLabelImageStorage:
    def __init__(self, settings: Settings) -> None:
        self._base_url = settings.supabase_url.rstrip("/")
        self._bucket = settings.supabase_storage_bucket
        self._secret_key = settings.supabase_secret_key

    @property
    def _headers(self) -> dict[str, str]:
        if not self._secret_key:
            raise LabelStorageError("SUPABASE_SECRET_KEY is not configured on the API")
        headers = {"apikey": self._secret_key}
        if not self._secret_key.startswith("sb_secret_"):
            headers["authorization"] = f"Bearer {self._secret_key}"
        return headers

    async def upload(self, path: str, content: bytes, content_type: str) -> None:
        encoded_path = quote(f"{self._bucket}/{path}", safe="/")
        headers = {
            **self._headers,
            "content-type": content_type,
            "cache-control": "31536000",
            "x-upsert": "false",
        }
        response: httpx.Response | None = None
        last_error: httpx.HTTPError | None = None
        timeout = httpx.Timeout(60, connect=20)
        for _attempt in range(2):
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.post(
                        f"{self._base_url}/storage/v1/object/{encoded_path}",
                        content=content,
                        headers=headers,
                    )
                break
            except httpx.HTTPError as exc:
                last_error = exc
        if response is None:
            raise LabelStorageError("Supabase Storage is unavailable") from last_error
        if response.status_code not in {200, 201}:
            raise LabelStorageError(
                f"Supabase Storage rejected the upload ({response.status_code})"
            )

    async def delete(self, path: str) -> None:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                await client.request(
                    "DELETE",
                    f"{self._base_url}/storage/v1/object/{quote(self._bucket, safe='')}",
                    json={"prefixes": [path]},
                    headers=self._headers,
                )
        except (httpx.HTTPError, LabelStorageError):
            # Best-effort compensation. The original database error remains authoritative.
            return
