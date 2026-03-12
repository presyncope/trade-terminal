FROM python:3.12-slim

WORKDIR /app

# Install build dependencies for nautilus_trader and hyperopt
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libssl-dev curl && \
    rm -rf /var/lib/apt/lists/*

COPY services/shared/     services/shared/
COPY services/experiment/ services/experiment/

RUN pip install --no-cache-dir \
    asyncpg \
    "redis[hiredis]" \
    nautilus_trader \
    hyperopt \
    mlflow

CMD ["python", "-m", "services.experiment.main"]
