# Pliny — Dev Context
_Last updated: 2026-02-28_

## What it is
Self-hosted Kanban app. Bradley's personal side project. NOT Wiz work.
Stack: React + TypeScript (client), Express + TypeScript (server), PostgreSQL.

## Repos & Deployment
- **Source:** `~/pliny` on OpenClaw VM | Gitea: `gitea.handley.io/bradley/pliny`
- **Live app:** Wharf (`10.0.0.102`) — stack at `~/stacks/pliny` (or `/opt/stacks/plank`)
- **Deploy flow:** push to Gitea → Wharf auto-pulls → docker compose up --build → migrations auto-run

## Current State (as of last session)
- Drag and drop: Trello-style grab-anywhere on desktop, handle-only (⠿) on touch
- Touch detection: `useIsTablet()` hook — `navigator.maxTouchPoints > 0 || 'ontouchstart' in window`
- CSS touch detection: `@media (pointer: coarse)` for handle sizing

## Key Architecture Decisions
- **Per-board roles:** Viewer / Editor / Admin (independent of global Guest / Member / Admin)
- **Card drag:** `dragHandleProps` on card wrapper for desktop, on `.card-drag-handle` div for touch
- **Migrations:** auto-run on server startup, idempotent — safe to re-run
- **All migrations** must include ALL valid roles in role_check constraints or they break on redeploy

## Proactive concerns
Approach as a full-stack developer who's shipped production React + Node apps.
- Flag bundle size and render performance implications on new UI features
- Catch migration safety issues before they hit production — always check ALL valid roles in constraints
- Surface mobile/touch edge cases — Bradley uses an iPad regularly
- Question API design consistency: naming conventions, error shapes, auth surface area
- Flag when a feature needs a database index or will hurt at scale

## Active TODOs
- [ ] Drop real screenshots into app (for marketing site)
- [ ] Todoist skill bug: `update_task(title=...)` uses deprecated arg — needs fix

## Known Gotchas
- `useIsTablet` returns true for ANY touch-capable device — phones, tablets, touch laptops. Not just tablets.
- Migration constraint naming: include ALL roles (`READ`, `COLLABORATOR`, `ADMIN`, `GUEST`, `MEMBER`, `VIEWER`, `EDITOR`) when updating role checks or existing data breaks

## Recent Commits
- `6b80b02` feat: Trello-style drag on desktop, handle-only drag on touch
- `e90230b` feat: dedicated drag handle on cards for touch-compatible scroll+drag
