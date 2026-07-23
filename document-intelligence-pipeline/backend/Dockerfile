FROM python:3.11-slim

# Prevent Python from writing .pyc files and enable unbuffered logging
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install system-level dependencies (updated for Debian Trixie support)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    libgl1 \
    libglx-mesa0 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 1. Install CPU-only PyTorch first (isolated layer for fast caching)
RUN pip install --no-cache-dir \
    --default-timeout=1000 \
    --retries 10 \
    torch torchvision torchaudio \
    --index-url https://download.pytorch.org/whl/cpu

# 2. Copy and install remaining Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir \
    --default-timeout=1000 \
    --retries 10 \
    -r requirements.txt

# 3. Copy application code
COPY . .

# Expose backend port
EXPOSE 8000

# Start FastAPI application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]