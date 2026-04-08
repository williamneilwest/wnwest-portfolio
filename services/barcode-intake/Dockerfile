FROM python:3.11-slim

WORKDIR /app

# install build deps required for evdev
RUN apt-get update && apt-get install -y \
    gcc \
    libc6-dev \
    linux-libc-dev \
    && rm -rf /var/lib/apt/lists/*

COPY barcode_listener.py .

RUN pip install --no-cache-dir requests evdev

CMD ["python","-u","barcode_listener.py"]
