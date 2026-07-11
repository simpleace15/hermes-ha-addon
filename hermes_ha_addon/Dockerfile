ARG BUILD_FROM=ghcr.io/home-assistant/base:latest
FROM ${BUILD_FROM}

# Install Python pip and build deps
RUN \
    apk add --no-cache \
        python3 \
        py3-pip \
        jq

# Install Python dependencies
COPY requirements.txt /app/
RUN pip3 install --no-cache-dir --break-system-packages -r /app/requirements.txt

# Copy app files
COPY app.py hermes_proxy.py profile_registry.py /app/
COPY static /app/static
COPY run.sh /

RUN chmod a+x /run.sh

WORKDIR /app

LABEL \
    io.hass.version="1.0.0" \
    io.hass.type="app" \
    io.hass.arch="amd64,aarch64,armv7"