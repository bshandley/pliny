# Wiz Kanban

A production-ready Kanban project management application built with React, TypeScript, Express, and PostgreSQL.

## Features

- 🎯 **Full Kanban board** with drag-and-drop (desktop & mobile)
- 📱 **Mobile-responsive** design with touch-friendly UI
- 🔐 **Simple RBAC** - READ (view-only) and WRITE (full access) roles
- 🔄 **Real-time updates** via WebSocket
- 🐳 **Docker-ready** deployment
- 💪 **TypeScript** throughout (type-safe)

## Quick Start

### Prerequisites

- Docker & Docker Compose
- (Optional) Node.js 18+ for local development

### Deploy with Docker

1. **Clone and configure:**

```bash
cd /tmp/wiz-kanban
cp .env.example .env
# Edit .env with your settings
```

2. **Start the stack:**

```bash
docker-compose up -d
```

3. **Run database migrations:**

```bash
docker-compose exec server npm run migrate
```

4. **Access the app:**

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

### Default Credentials

- **Username:** admin
- **Password:** admin123
- **Role:** WRITE

⚠️ **Change this immediately in production!**

## Architecture

```
wiz-kanban/
├── server/           # Express + TypeScript backend
│   ├── src/
│   │   ├── routes/   # API routes (auth, boards, columns, cards)
│   │   ├── middleware/ # Auth & RBAC
│   │   ├── migrations/ # Database schema
│   │   └── index.ts  # Main server + WebSocket
│   └── Dockerfile
├── client/           # React + TypeScript frontend
│   ├── src/
│   │   ├── components/ # UI components
│   │   ├── api.ts    # API client
│   │   └── App.tsx   # Main app
│   ├── Dockerfile
│   └── nginx.conf
└── docker-compose.yml
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login (returns JWT)
- `POST /api/auth/register` - Register new user (WRITE role required)

### Boards
- `GET /api/boards` - List all boards
- `GET /api/boards/:id` - Get board with columns & cards
- `POST /api/boards` - Create board (WRITE)
- `PUT /api/boards/:id` - Update board (WRITE)
- `DELETE /api/boards/:id` - Delete board (WRITE)

### Columns
- `POST /api/columns` - Create column (WRITE)
- `PUT /api/columns/:id` - Update column (WRITE)
- `DELETE /api/columns/:id` - Delete column (WRITE)

### Cards
- `POST /api/cards` - Create card (WRITE)
- `PUT /api/cards/:id` - Update card (WRITE)
- `DELETE /api/cards/:id` - Delete card (WRITE)

## RBAC

- **READ role:** Can view boards, columns, and cards. Cannot create/edit/delete.
- **WRITE role:** Full access to all operations.

Authentication required for all endpoints (except login).

## Real-time Updates

WebSocket events:
- `join-board` - Join a board room
- `leave-board` - Leave a board room
- `board-updated` - Broadcast when board data changes

## Environment Variables

See `.env.example` for all configuration options.

Key variables:
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` - PostgreSQL connection
- `JWT_SECRET` - Secret for JWT signing (change in production!)
- `PORT` - Server port (default: 3001)

## Development

### Local development (without Docker):

**Backend:**
```bash
cd server
npm install
npm run dev
# Run migrations: npm run migrate
```

**Frontend:**
```bash
cd client
npm install
npm run dev
```

**Database:**
```bash
# Use local PostgreSQL or Docker:
docker run -d -p 5432:5432 \
  -e POSTGRES_DB=kanban \
  -e POSTGRES_USER=kanban \
  -e POSTGRES_PASSWORD=kanban123 \
  postgres:16
```

## Deployment to Wharf

1. **Copy project to Wharf:**

```bash
scp -r /tmp/wiz-kanban bradley@10.0.0.102:/opt/stacks/
```

2. **SSH to Wharf and deploy:**

```bash
ssh bradley@10.0.0.102
cd /opt/stacks/wiz-kanban
docker-compose up -d
docker-compose exec server npm run migrate
```

3. **Access via Wharf:**

Update `docker-compose.yml` ports if needed, or setup reverse proxy.

## Mobile Support

- Touch-friendly drag-and-drop using `react-beautiful-dnd`
- Responsive breakpoints: 768px (tablet), 480px (phone)
- Horizontal scroll for columns on mobile
- Large touch targets for cards and buttons

## Security Notes

- Change default admin password immediately
- Set strong `JWT_SECRET` in production
- Use HTTPS in production (setup reverse proxy)
- Consider rate limiting for API endpoints
- Review CORS settings in production

## License

MIT
