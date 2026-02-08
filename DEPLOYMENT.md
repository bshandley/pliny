# Deployment Guide

## Architecture

```
Developer
    ↓ git push
GitHub (bshandley/plank)
    ↓ pull (manual or automated)
Wharf (10.0.0.102)
    ↓ docker compose up --build
Production App (http://10.0.0.102:5174)
```

## Quick Deploy

### Option 1: Manual Deploy from Wharf

SSH to Wharf and run:

```bash
ssh bradley@10.0.0.102
cd /opt/stacks/plank
./deploy-from-github.sh
```

This script:
1. Pulls latest changes from GitHub
2. Rebuilds Docker containers
3. Restarts the application

### Option 2: Deploy from Development Machine

From your local machine:

```bash
ssh bradley@10.0.0.102 'cd /opt/stacks/plank && ./deploy-from-github.sh'
```

### Option 3: Deploy via OpenClaw/Rye

Ask Rye to deploy:
```
"Deploy the latest Plank changes to Wharf"
```

## Development Workflow

1. **Make changes** to the code
2. **Commit** and **push** to GitHub:
   ```bash
   git add .
   git commit -m "Your change description"
   git push
   ```
3. **Deploy** using one of the options above

## Vibe Coding Workflow

1. Tell Rye what changes you want
2. Rye makes the changes and pushes to GitHub
3. Rye deploys to Wharf automatically
4. Check http://10.0.0.102:5174 to see changes

## Repository

- **GitHub:** https://github.com/bshandley/plank
- **Visibility:** Private
- **Branch:** master

## Secrets Configuration

GitHub repository secrets (already configured):
- `WHARF_HOST` - 10.0.0.102
- `WHARF_USER` - bradley
- `WHARF_SSH_KEY` - SSH private key for Wharf access

## Automated Deployment (Future)

To enable automatic deployment on every push, you can:

1. **Set up a cron job on Wharf** to poll for changes every 5 minutes:
   ```bash
   */5 * * * * cd /opt/stacks/plank && ./deploy-from-github.sh >> /var/log/plank-deploy.log 2>&1
   ```

2. **Use GitHub webhooks** (requires exposing Wharf to the internet or using a relay)

3. **Use a self-hosted GitHub Actions runner** on Wharf

For now, manual deployment is fast and simple.

## Rollback

To rollback to a previous version:

```bash
ssh bradley@10.0.0.102
cd /opt/stacks/plank
git log --oneline  # Find the commit hash
git reset --hard <commit-hash>
docker compose up -d --build
```

## Monitoring

View logs:
```bash
ssh bradley@10.0.0.102
cd /opt/stacks/plank
docker compose logs -f          # All containers
docker compose logs -f server   # Backend only
docker compose logs -f client   # Frontend only
docker compose logs -f db       # Database only
```

Check status:
```bash
docker compose ps
```

## Troubleshooting

**Deployment fails:**
```bash
ssh bradley@10.0.0.102
cd /opt/stacks/plank
docker compose down
docker compose up -d --build
```

**Database issues:**
```bash
docker compose exec db psql -U plank -d plank
```

**Clear everything and redeploy:**
```bash
docker compose down -v  # WARNING: Deletes database!
git pull
docker compose up -d --build
docker compose exec -T db psql -U plank -d plank -f server/src/migrations/schema.sql
```
