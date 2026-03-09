FROM python:3.13-slim

WORKDIR /app

COPY services/shared/ services/shared/
COPY services/trading/ services/trading/

RUN pip install --no-cache-dir \
    aiohttp redis[hiredis]

CMD ["python", "-m", "services.trading.main"]
