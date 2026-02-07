# Deployment Checklist

## Before Deploying to Production

- [ ] Change `JWT_SECRET` in `.env` to a strong random string
- [ ] Update database credentials (`DB_PASSWORD`) in `.env`
- [ ] Set `CLIENT_URL` to your production frontend URL
- [ ] Review CORS settings in `server/src/index.ts`
- [ ] Change default admin password after first login
- [ ] Setup HTTPS reverse proxy (recommended: nginx/Traefik)
- [ ] Configure Docker restart policies for production
- [ ] Setup database backups
- [ ] Add rate limiting middleware (optional but recommended)
- [ ] Review and update Dockerfile security (run as non-root user)

## Testing Before Production

- [ ] Test login with default credentials
- [ ] Create a test board
- [ ] Add columns (To Do, In Progress, Done)
- [ ] Create cards and test drag-and-drop
- [ ] Test on mobile device (drag-drop should work with touch)
- [ ] Test READ role user (create via register endpoint)
- [ ] Verify WebSocket real-time updates (open in two browsers)
- [ ] Test all CRUD operations
- [ ] Verify authentication (logout/login)

## Monitoring

- [ ] Setup container health checks
- [ ] Monitor PostgreSQL disk usage
- [ ] Monitor backend logs: `docker-compose logs -f server`
- [ ] Monitor client nginx logs: `docker-compose logs -f client`
- [ ] Check WebSocket connections: look for connection/disconnection logs

## Performance Optimization (Optional)

- [ ] Enable nginx gzip compression
- [ ] Setup CDN for static assets
- [ ] Add Redis for session storage (instead of JWT only)
- [ ] Database indexing review
- [ ] Enable PostgreSQL connection pooling limits
- [ ] Add API response caching where appropriate

## Security Hardening (Production)

- [ ] Enable Docker user namespaces
- [ ] Limit container capabilities
- [ ] Use secrets management (Docker secrets / Vault)
- [ ] Enable audit logging
- [ ] Setup fail2ban or similar for brute force protection
- [ ] Regular security updates (base images, dependencies)
