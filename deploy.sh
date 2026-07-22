#!/bin/bash
# Deploy script for VPS.
# The frontend HTML and Vite's hashed assets must be rebuilt together.

echo "Pulling latest changes..."
git pull origin main

echo "Rebuilding API and frontend containers..."
docker compose up -d --build api frontend nginx

echo "Waiting for container to start..."
sleep 5

echo "Showing recent logs..."
docker compose logs api frontend nginx --tail 50

echo ""
echo "Deployment complete! Check the logs above for any errors."
