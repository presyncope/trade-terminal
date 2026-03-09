"""Async PostgreSQL (TimescaleDB) connection pool utilities."""

from __future__ import annotations

import asyncpg
from .config import TimescaleConfig


async def create_pool(cfg: TimescaleConfig | None = None, **kwargs) -> asyncpg.Pool:
    cfg = cfg or TimescaleConfig()
    return await asyncpg.create_pool(
        dsn=cfg.dsn,
        min_size=kwargs.pop("min_size", 2),
        max_size=kwargs.pop("max_size", 10),
        **kwargs,
    )
