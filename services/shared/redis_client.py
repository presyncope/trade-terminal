"""Redis connection helper (pub/sub & cache)."""

from __future__ import annotations

import redis.asyncio as aioredis
from .config import RedisConfig


def create_redis(cfg: RedisConfig | None = None) -> aioredis.Redis:
    cfg = cfg or RedisConfig()
    return aioredis.from_url(cfg.url, decode_responses=True)
