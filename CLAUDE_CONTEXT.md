# Cork Development Context (for Claude Code)

## 🎯 Your Job
Write code. Push to Gitea. Done.

## 🚫 NOT Your Job
- Deployment to Wharf
- Docker operations
- Server management

## ⚡ The Pipeline (Fully Automated)
1. **You code** → `~/cork` on openclaw VM
2. **You push** → `git push` to local Gitea (http://10.0.0.102:3004)
3. **Auto-deploy** → Wharf detects within 5 min, pulls, migrates, rebuilds
4. **Live** → http://10.0.0.102:5175

## 📝 Migration Rules
If you add database changes:
- Create new `.sql` file in `server/src/migrations/`
- Name it sequentially (011-xxx.sql, 012-xxx.sql, etc.)
- It auto-runs on next deploy

### ⚠️ CRITICAL: Migration Idempotency
All migrations re-run on every deploy (the runner executes them all sequentially).
They MUST be idempotent — safe to run against an already-migrated database.

**Known issue:** Migration 002 sets a CHECK constraint on `users.role`.
- It MUST include ALL valid roles: `('READ', 'COLLABORATOR', 'ADMIN')`
- If you add a new role, update 002's constraint AND add a new migration
- **NEVER** write a constraint that excludes roles added by later migrations

**Pattern for constraints:**
```sql
-- WRONG: will fail on re-run if data has values from later migrations
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('READ', 'ADMIN'));

-- RIGHT: include all current valid values
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('READ', 'COLLABORATOR', 'ADMIN'));
```

## 🔗 Key URLs
- **Gitea Repo**: http://10.0.0.102:3004/bradley/cork
- **Dev Frontend**: http://10.0.0.102:5175 (production deploy)
- **API**: http://10.0.0.102:3006

## 💡 Local Dev
- Client runs on port 5173 locally (vite dev server)
- Server runs on port 3001 locally
- For production deploys, just push - no manual action needed

---
*Deployment is handled. You just write code.* 🍞
