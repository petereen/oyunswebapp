#!/bin/bash
# Deploy script for VPS
# Run this on your VPS to update and rebuild the API container

echo "Pulling latest changes..."
git pull origin main

echo "Rebuilding API container..."
docker compose up -d --build api

echo "Waiting for container to start..."
sleep 5

echo "Showing recent logs..."
docker compose logs api --tail 50

echo ""
echo "Deployment complete! Check the logs above for any errors."
