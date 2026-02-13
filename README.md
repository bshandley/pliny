# Plank

A production-ready Kanban project management application built with React, TypeScript, Express, and PostgreSQL.

## Features

- **Full Kanban board** with drag-and-drop (desktop & mobile)
- **Mobile-responsive** design with touch-friendly UI
- **User management** - ADMIN (full access) and READ (view-only) roles
- **Board-level permissions** - READ users only see boards they're assigned to
- **Real-time updates** via WebSocket
- **Docker-ready** deployment
- **TypeScript** throughout (type-safe)

## Quick Start

### Prerequisites

- Docker & Docker Compose
- (Optional) Node.js 18+ for local development

### Deploy with Docker

1. **Clone and configure:**

```bash
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
- **Role:** ADMIN

**Change this immediately in production!**

## Architecture

```
plank/
├── server/           # Express + TypeScript backend
│   ├── src/
│   │   ├── routes/   # API routes (auth, boards, columns, cards, users)
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
- `POST /api/auth/register` - Register new user (ADMIN role required)

### Users (ADMIN only)
- `GET /api/users` - List all users
- `PUT /api/users/:id` - Update user (username, password, role)
- `DELETE /api/users/:id` - Delete user

### Boards
- `GET /api/boards` - List boards (ADMIN: all, READ: only assigned)
- `GET /api/boards/:id` - Get board with columns & cards
- `POST /api/boards` - Create board (ADMIN)
- `PUT /api/boards/:id` - Update board (ADMIN)
- `DELETE /api/boards/:id` - Delete board (ADMIN)

### Board Members (ADMIN only)
- `GET /api/boards/:id/members` - List board members
- `POST /api/boards/:id/members` - Add member to board
- `DELETE /api/boards/:id/members/:userId` - Remove member from board

### Columns
- `POST /api/columns` - Create column (ADMIN)
- `PUT /api/columns/:id` - Update column (ADMIN)
- `DELETE /api/columns/:id` - Delete column (ADMIN)

### Cards
- `POST /api/cards` - Create card (ADMIN)
- `PUT /api/cards/:id` - Update card (ADMIN)
- `DELETE /api/cards/:id` - Delete card (ADMIN)

## RBAC & Permissions

- **ADMIN role:** Full access to all operations. Can manage users, boards, columns, and cards. Can add/remove READ users from boards.
- **READ role:** View-only access to assigned boards only. Must be added to boards by an admin. Cannot see boards they are not assigned to.

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
  -e POSTGRES_DB=plank \
  -e POSTGRES_USER=plank \
  -e POSTGRES_PASSWORD=changeme \
  postgres:16
```

## Deployment to Wharf

1. **Copy project to Wharf:**

```bash
scp -r . bradley@10.0.0.102:/opt/stacks/plank
```

2. **SSH to Wharf and deploy:**

```bash
ssh bradley@10.0.0.102
cd /opt/stacks/plank
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
# Webhook test - Fri Feb 13 05:42:22 AM UTC 2026
# Webhook test 2 - Fri Feb 13 05:43:07 AM UTC 2026
