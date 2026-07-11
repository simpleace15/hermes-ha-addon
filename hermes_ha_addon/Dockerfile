FROM python:3.12-slim

WORKDIR /app

# jq for parsing HA options.json in run.sh
RUN apt-get update && apt-get install -y --no-install-recommends jq \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8788

CMD ["bash", "run.sh"]