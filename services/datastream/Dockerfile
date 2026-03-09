FROM python:3.13-slim

WORKDIR /app

COPY services/shared/ services/shared/
COPY services/datastream/ services/datastream/

RUN pip install --no-cache-dir \
    aiohttp redis[hiredis]

CMD ["python", "-m", "services.datastream.main"]
