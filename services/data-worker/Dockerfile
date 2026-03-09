FROM python:3.12-slim

WORKDIR /app

COPY services/shared/ services/shared/
COPY services/data-worker/ services/data_worker/

RUN pip install --no-cache-dir \
    asyncpg \
    redis[hiredis] \
    nautilus_trader

CMD ["python", "-m", "services.data_worker.main"]
