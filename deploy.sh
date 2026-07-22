#!/bin/bash
# Deploy script for VPS.
# The frontend HTML and Vite's hashed assets must be rebuilt together.

echo "Pulling latest changes..."
git pull origin main

echo "Rebuilding API and frontend containers..."
docker compose up -d --build api frontend

# nginx resolves the frontend service when it starts. Recreate it after a
# frontend deployment so public traffic cannot remain attached to an old
# frontend container/IP.
echo "Recreating the reverse proxy..."
docker compose up -d --force-recreate nginx

echo "Waiting for container to start..."
sleep 5

echo "Showing recent logs..."
docker compose logs api frontend nginx --tail 50

echo ""
echo "Deployment complete! Check the logs above for any errors."
