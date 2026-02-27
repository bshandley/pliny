# Pliny Development Context (for Claude Code)

## 🎯 Your Job
Write code. Push to Gitea. Done.

**Do NOT ask clarifying questions. Do NOT create plans and wait for approval. Do NOT ask which execution approach to use. Just implement and push.**

## 🚫 NOT Your Job
- Deployment to Wharf
- Docker operations
- Server management

## ⚡ The Pipeline (Fully Automated)
1. **You code** → `~/pliny` on openclaw VM
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
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('GUEST', 'MEMBER', 'ADMIN'));
```

**⚠️ CRITICAL: Drop constraint BEFORE updating data**
When renaming values in a constrained column, you MUST drop the constraint first,
then update the data, then add the new constraint. If you update data first, the
old constraint (from a previous migration that already ran) will reject the new values.

```sql
-- WRONG: UPDATE fails because old constraint rejects 'MEMBER'
UPDATE users SET role = 'MEMBER' WHERE role = 'COLLABORATOR';  -- ERROR!
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('GUEST', 'MEMBER', 'ADMIN'));

-- RIGHT: Drop first, then update, then constrain
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role = 'MEMBER' WHERE role = 'COLLABORATOR';
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('GUEST', 'MEMBER', 'ADMIN'));
```

### ⚠️ CRITICAL: All Primary Keys are UUID — NOT INTEGER

The live database uses UUID for ALL primary keys: `users.id`, `cards.id`, `boards.id`, `columns.id`, etc.

**When writing migrations, ALL foreign key references must use UUID:**
```sql
-- WRONG: will fail with "incompatible types: integer and uuid"
user_id INTEGER NOT NULL REFERENCES users(id),
card_id INTEGER NOT NULL REFERENCES cards(id),
board_id INTEGER REFERENCES boards(id),

-- RIGHT:
user_id UUID NOT NULL REFERENCES users(id),
card_id UUID NOT NULL REFERENCES cards(id),
board_id UUID REFERENCES boards(id),
```

**When writing route code, NEVER use parseInt() on user/entity IDs:**
```ts
// WRONG: parseInt(uuid) returns NaN
if (row.created_by !== parseInt(req.user!.id))

// RIGHT: compare strings directly
if (row.created_by !== req.user!.id)
```

## 🔗 Key URLs
- **Gitea Repo**: http://10.0.0.102:3004/bradley/pliny
- **Dev Frontend**: http://10.0.0.102:5175 (production deploy)
- **API**: http://10.0.0.102:3006

## 💡 Local Dev
- Client runs on port 5173 locally (vite dev server)
- Server runs on port 3001 locally
- For production deploys, just push - no manual action needed

---
*Deployment is handled. You just write code.* 🍞
