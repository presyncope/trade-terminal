FROM python:3.13-slim

WORKDIR /app

COPY services/shared/ services/shared/
COPY services/data-worker/ services/data_worker/

RUN pip install --no-cache-dir \
    asyncpg aiohttp redis[hiredis]

CMD ["python", "-m", "services.data_worker.main"]
