FROM python:3.11-slim-bookworm

WORKDIR /app

# requirements live at repo root; build context will be the repo root
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# copy only backend source to keep image small
COPY backend/ ./

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
