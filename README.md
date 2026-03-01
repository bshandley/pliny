# Pliny

[![License: ELv2](https://img.shields.io/badge/License-Elastic_v2-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io%2Fbshandley%2Fpliny-blue?logo=docker)](https://github.com/bshandley/pliny/pkgs/container/pliny-server)

Self-hosted kanban for teams who own their data. Built with React, TypeScript, Express, and PostgreSQL.

**[getpliny.com](https://getpliny.com)** · [Self-hosting guide](https://getpliny.com/self-host)

---

## Features

- **Full kanban board** with drag-and-drop (desktop & mobile touch)
- **Multiple views** — board, calendar, list, and analytics dashboard
- **Labels, assignees, due dates, checklists, and card descriptions**
- **Board starring** and sort preferences
- **Public board sharing** — shareable read-only links
- **CSV import** — create boards from a spreadsheet in 3 steps
- **User management** — ADMIN and READ roles with board-level permissions
- **SSO / OIDC** — plug in any OIDC-compatible identity provider
- **REST API** with personal access tokens
- **Real-time updates** via WebSocket
- **Mobile-responsive** with touch-friendly drag handles
- **Docker-ready** — pulls from GHCR, no build step required

---

## Quick Start

### Prerequisites

- Docker 20+
- Docker Compose v2+

### Deploy

```bash
git clone https://github.com/bshandley/pliny
cd pliny
cp .env.example .env
# Edit .env — set DB_PASSWORD, JWT_SECRET, and PLINY_URL at minimum
docker compose up -d
docker compose exec server npm run migrate
```

Open `http://localhost` (or your `PLINY_URL`). Create your admin account on first launch.

Images are pulled automatically from GitHub Container Registry — no build step needed.

### Updating

```bash
docker compose pull
docker compose up -d
docker compose exec server npm run migrate
```

Migrations are idempotent — safe to re-run on every update.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DB_PASSWORD` | ✅ | — | PostgreSQL password |
| `JWT_SECRET` | ✅ | — | Secret for JWT signing — use a long random string |
| `PLINY_URL` | ✅ | — | Public URL of your instance (e.g. `https://pliny.example.com`) |
| `DB_HOST` | | `db` | PostgreSQL host |
| `DB_PORT` | | `5432` | PostgreSQL port |
| `DB_NAME` | | `pliny` | Database name |
| `DB_USER` | | `pliny` | Database user |
| `PORT` | | `3001` | Backend API port |
| `SMTP_HOST` | | — | SMTP host for email notifications |
| `SMTP_PORT` | | `587` | SMTP port |
| `SMTP_USER` | | — | SMTP username |
| `SMTP_PASS` | | — | SMTP password |
| `SMTP_FROM` | | — | From address for outbound email |
| `S3_ENDPOINT` | | — | S3-compatible storage endpoint (uses local disk by default) |
| `S3_BUCKET` | | — | S3 bucket name |
| `S3_ACCESS_KEY` | | — | S3 access key |
| `S3_SECRET_KEY` | | — | S3 secret key |
| `OIDC_ISSUER` | | — | OIDC provider URL for SSO |
| `OIDC_CLIENT_ID` | | — | OIDC client ID |
| `OIDC_CLIENT_SECRET` | | — | OIDC client secret |
| `TOTP_ENCRYPTION_KEY` | | — | Encryption key for TOTP secrets |

---

## Reverse Proxy

Point your reverse proxy to port `80` (the client container). WebSocket support is required — forward the `Upgrade` header.

**nginx example:**
```nginx
location / {
    proxy_pass http://localhost:80;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

Works with nginx, Caddy, Traefik, or any WebSocket-capable proxy.

---

## Architecture

```
pliny/
├── server/             # Express + TypeScript backend
│   ├── src/
│   │   ├── routes/     # API routes
│   │   ├── middleware/ # Auth & RBAC
│   │   ├── migrations/ # Database schema (idempotent)
│   │   └── index.ts   # Server entry + WebSocket
│   └── Dockerfile
├── client/             # React + TypeScript frontend
│   ├── src/
│   │   ├── components/ # UI components
│   │   ├── api.ts      # API client
│   │   └── App.tsx     # App root
│   ├── Dockerfile
│   └── nginx.conf
└── docker-compose.yml
```

---

## API

All endpoints require a `Bearer` token (JWT from login, or a personal access token).

### Authentication
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Login — returns JWT |
| `POST` | `/api/auth/register` | Register new user (ADMIN only) |

### Boards
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/boards` | List boards |
| `POST` | `/api/boards` | Create board (ADMIN) |
| `GET` | `/api/boards/:id` | Get board with columns & cards |
| `PUT` | `/api/boards/:id` | Update board (ADMIN) |
| `DELETE` | `/api/boards/:id` | Delete board (ADMIN) |
| `PUT` | `/api/boards/:id/star` | Star/unstar board |
| `GET` | `/api/boards/:id/analytics` | Board analytics (activity, assignees) |

### Board Members (ADMIN only)
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/boards/:id/members` | List members |
| `POST` | `/api/boards/:id/members` | Add member |
| `DELETE` | `/api/boards/:id/members/:userId` | Remove member |

### Columns
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/columns` | Create column (ADMIN) |
| `PUT` | `/api/columns/:id` | Update column (ADMIN) |
| `DELETE` | `/api/columns/:id` | Delete column (ADMIN) |

### Cards
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/cards` | Create card (ADMIN) |
| `GET` | `/api/cards/:id` | Get card detail |
| `PUT` | `/api/cards/:id` | Update card (ADMIN) |
| `DELETE` | `/api/cards/:id` | Delete card (ADMIN) |

### Import
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/csv/board-import/preview` | Preview CSV import |
| `POST` | `/api/csv/board-import/confirm` | Confirm and create board from CSV |

### Admin
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/users` | List users (ADMIN) |
| `PUT` | `/api/users/:id` | Update user (ADMIN) |
| `DELETE` | `/api/users/:id` | Delete user (ADMIN) |
| `GET` | `/api/boards/admin/shared` | List all publicly shared boards (ADMIN) |

---

## Permissions

- **ADMIN** — Full access. Manages users, boards, members, columns, and cards.
- **READ** — View-only. Sees only boards they've been added to. Cannot modify anything.

---

## Local Development

**Backend:**
```bash
cd server
npm install
npm run dev        # starts with ts-node-dev
npm run migrate    # run migrations against local DB
```

**Frontend:**
```bash
cd client
npm install
npm run dev        # Vite dev server on :5173
```

**Database:**
```bash
docker run -d -p 5432:5432 \
  -e POSTGRES_DB=pliny \
  -e POSTGRES_USER=pliny \
  -e POSTGRES_PASSWORD=changeme \
  postgres:16
```

---

## License

[Elastic License 2.0](LICENSE) — free to self-host and modify; commercial redistribution and managed service offerings require a separate agreement.
