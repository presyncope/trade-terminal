FROM python:3.13-slim

WORKDIR /app

COPY services/shared/ services/shared/
COPY services/web-api/ services/web_api/

RUN pip install --no-cache-dir \
    fastapi uvicorn[standard] asyncpg redis[hiredis] aiohttp

EXPOSE 8000

CMD ["uvicorn", "services.web_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
