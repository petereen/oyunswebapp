# VPS Deployment Commands

Use these commands to deploy the latest changes (Dev Mode) and issue SSL certificates on your VPS.

## 1. Prepare Environment
Ensure your `.env` file has the new Dev Mode variables (already added locally, make sure they are on VPS):
```bash
DEV_MODE=true
VITE_DEV_MODE=true
JWT_SECRET=dev-secret-key-change-in-prod
```

## 2. Stop Existing Services
```bash
docker-compose down
```

## 3. Issue SSL Certificate (Let's Encrypt)
Run this script to generate or renew your SSL certificate for `oyunswebapp.ddns.net`.
```bash
chmod +x init-letsencrypt.sh
./init-letsencrypt.sh
```
*Follow the prompts. You can enter `y` to replace existing certificates if needed.*

## 4. Build and Start Application
This will rebuild the frontend (baking in the Dev Mode flag) and start all services.
```bash
docker-compose up --build -d
```

## 5. Verify Status
Check if services are running:
```bash
docker-compose ps
```

View logs to ensure everything started correctly:
```bash
docker-compose logs -f
```
