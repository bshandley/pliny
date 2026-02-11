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

## 📝 Migration Reminder
If you add database changes:
- Create new `.sql` file in `server/src/migrations/`
- Name it sequentially (008-xxx.sql, 009-xxx.sql, etc.)
- It auto-runs on next deploy

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
