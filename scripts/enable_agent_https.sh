#!/usr/bin/env sh
set -eu

cert_path="certbot/conf/live/agent.oyuns.mn/fullchain.pem"
if [ ! -f "$cert_path" ]; then
  echo "Missing $cert_path. Issue the agent.oyuns.mn certificate first." >&2
  exit 1
fi

cp nginx/conf.d/agent-https.conf.example nginx/conf.d/agent-https.conf
docker compose up -d --force-recreate nginx
