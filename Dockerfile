# Use the official Python 3 image based on Debian slim
FROM python:3.11-slim-bookworm

# Set the working directory in the container
WORKDIR /app

# Copy the requirements.txt into the container at /app
COPY requirements.txt .

# Install the dependencies from requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy only the runtime files the bot actually imports
COPY oyunsbot.py .
COPY bot_translations.py .
COPY backend/ ./backend/

# Run the Python script when the container starts
CMD ["python", "oyunsbot.py"]
