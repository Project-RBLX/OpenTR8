# OpenTR8 Production Deployment Guide

This guide covers deploying OpenTR8 to production environments, including Docker-based deployments, manual installations, and cloud platform configurations.

## Table of Contents

- [Deployment Overview](#deployment-overview)
- [Prerequisites](#prerequisites)
- [Environment Configuration](#environment-configuration)
- [Docker Deployment](#docker-deployment)
- [Manual Deployment](#manual-deployment)
- [Database Setup](#database-setup)
- [Cloud Deployment Examples](#cloud-deployment-examples)
- [Scaling Considerations](#scaling-considerations)
- [Monitoring and Observability](#monitoring-and-observability)
- [Security Checklist](#security-checklist)
- [Troubleshooting](#troubleshooting)

---

## Deployment Overview

OpenTR8 supports multiple deployment strategies:

| Method | Best For | Complexity |
|--------|----------|------------|
| **Docker Compose** | Single-server, small to medium workloads | Low |
| **Docker + Orchestration** | Kubernetes, ECS, Swarm deployments | Medium |
| **Manual** | Custom environments, bare-metal servers | Medium |
| **PaaS** | Railway, Render, Fly.io quick deployments | Low |

### Architecture Overview

OpenTR8 consists of two services:

1. **API Service** (`opentr8-api`) - HTTP REST API on port 3000
2. **Escrow Service** (`opentr8-escrow-service`) - Background worker for escrow processing

Both services require access to a PostgreSQL database.

---

## Prerequisites

### Required Software

| Software | Minimum Version | Purpose |
|----------|-----------------|---------|
| Node.js | 20.0.0+ | Runtime environment |
| pnpm | 9.0.0+ | Package manager |
| PostgreSQL | 15+ | Database |
| Docker | 24.0+ | Container runtime (for Docker deployments) |
| Docker Compose | 2.20+ | Multi-container orchestration |

### System Requirements

**Minimum (Development/Testing):**
- 1 CPU core
- 1 GB RAM
- 10 GB disk space

**Recommended (Production):**
- 2+ CPU cores
- 4+ GB RAM
- 50+ GB SSD storage
- Dedicated PostgreSQL instance

---

## Environment Configuration

Create a `.env` file based on `.env.example`. All configuration is done via environment variables.

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/opentr8?schema=public` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | API server port | `3000` |
| `NODE_ENV` | Environment mode (`development`, `production`, `test`) | `development` |
| `INITIAL_AGENT_CREDITS` | Credits granted to new agents (in smallest unit, e.g., cents) | `10000` |
| `DEFAULT_TASK_TIMEOUT_HOURS` | Hours before tasks auto-expire and release escrow | `72` |

### Production Environment Example

```bash
# /etc/opentr8/.env or your deployment environment

# Database - Use a connection pooler in production
DATABASE_URL="postgresql://opentr8:SECURE_PASSWORD@db.example.com:5432/opentr8_prod?schema=public&connection_limit=20"

# Server Configuration
PORT=3000
NODE_ENV=production

# Business Logic
INITIAL_AGENT_CREDITS=10000
DEFAULT_TASK_TIMEOUT_HOURS=72
```

### Security Notes for Environment Variables

- Never commit `.env` files to version control
- Use secrets management (AWS Secrets Manager, HashiCorp Vault, etc.) in production
- Rotate database credentials regularly
- Use different credentials for each environment

---

## Docker Deployment

OpenTR8 uses multi-stage Docker builds for optimized production images.

### Building Images

**Build all images locally:**

```bash
# Build API service image
docker build --target api -t opentr8-api:latest .

# Build Escrow service image
docker build --target escrow-service -t opentr8-escrow-service:latest .
```

**Build with specific tags:**

```bash
VERSION=1.0.0
docker build --target api -t opentr8-api:${VERSION} .
docker build --target escrow-service -t opentr8-escrow-service:${VERSION} .
```

### Using Pre-built Images

If using GitHub Container Registry (after a release):

```bash
docker pull ghcr.io/YOUR_ORG/opentr8/api:v1.0.0
docker pull ghcr.io/YOUR_ORG/opentr8/escrow-service:v1.0.0
```

### Docker Compose Production Setup

**1. Create production environment file:**

```bash
# production.env
DATABASE_URL=postgresql://postgres:YOUR_SECURE_PASSWORD@postgres:5432/opentr8?schema=public
PORT=3000
NODE_ENV=production
INITIAL_AGENT_CREDITS=10000
DEFAULT_TASK_TIMEOUT_HOURS=72
```

**2. Create production docker-compose override (docker-compose.prod.yml):**

```yaml
# docker-compose.prod.yml
services:
  postgres:
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-YOUR_SECURE_PASSWORD}
    # Remove port exposure in production (access via internal network only)
    ports: []
    # Add resource limits
    deploy:
      resources:
        limits:
          memory: 2G
        reservations:
          memory: 512M

  api:
    env_file: production.env
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '1.0'
        reservations:
          memory: 256M
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3

  escrow-service:
    env_file: production.env
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.5'
        reservations:
          memory: 128M
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
```

**3. Deploy:**

```bash
# Start all services
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# View logs
docker compose logs -f

# Check service status
docker compose ps
```

### Health Checks

The Docker images include built-in health checks:

**API Service:**
- Endpoint: `GET /health`
- Interval: 30 seconds
- Timeout: 10 seconds
- Start period: 5 seconds
- Retries: 3

**Escrow Service:**
- Check: Process existence (`pgrep -x node`)
- Interval: 30 seconds
- Timeout: 10 seconds

**Verify health status:**

```bash
# Check container health
docker inspect --format='{{.State.Health.Status}}' opentr8-api

# Check API health endpoint
curl http://localhost:3000/health
# Response: {"status":"ok","timestamp":"2024-01-15T10:30:00.000Z"}
```

### Logging Configuration

Docker logs are captured via stdout/stderr. Configure log drivers for production:

```yaml
# In docker-compose.prod.yml
services:
  api:
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "5"
        labels: "service,environment"
    labels:
      service: "opentr8-api"
      environment: "production"
```

**For centralized logging (e.g., with Fluentd):**

```yaml
services:
  api:
    logging:
      driver: fluentd
      options:
        fluentd-address: "localhost:24224"
        tag: "opentr8.api"
```

---

## Manual Deployment

### Building from Source

**1. Clone and install dependencies:**

```bash
git clone https://github.com/YOUR_ORG/opentr8.git
cd opentr8

# Install pnpm if not available
corepack enable && corepack prepare pnpm@9.0.0 --activate

# Install dependencies
pnpm install --frozen-lockfile
```

**2. Generate Prisma client:**

```bash
pnpm db:generate
```

**3. Build all packages:**

```bash
pnpm build
```

**4. Verify build:**

```bash
ls -la apps/api/dist/
ls -la apps/escrow-service/dist/
```

### Process Management with PM2

**1. Install PM2:**

```bash
npm install -g pm2
```

**2. Create ecosystem file (`ecosystem.config.cjs`):**

```javascript
module.exports = {
  apps: [
    {
      name: 'opentr8-api',
      script: 'apps/api/dist/index.js',
      instances: 'max',
      exec_mode: 'cluster',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      max_memory_restart: '1G',
      error_file: '/var/log/opentr8/api-error.log',
      out_file: '/var/log/opentr8/api-out.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'opentr8-escrow',
      script: 'apps/escrow-service/dist/index.js',
      instances: 1, // Single instance for background worker
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '512M',
      error_file: '/var/log/opentr8/escrow-error.log',
      out_file: '/var/log/opentr8/escrow-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
```

**3. Start services:**

```bash
# Create log directory
sudo mkdir -p /var/log/opentr8
sudo chown $(whoami) /var/log/opentr8

# Start all services
pm2 start ecosystem.config.cjs --env production

# Save PM2 process list
pm2 save

# Setup startup script
pm2 startup
```

**4. PM2 management commands:**

```bash
pm2 status              # View status
pm2 logs                # View logs
pm2 restart all         # Restart all services
pm2 reload all          # Zero-downtime reload
pm2 stop all            # Stop all services
pm2 monit               # Real-time monitoring
```

### Process Management with systemd

**1. Create service file (`/etc/systemd/system/opentr8-api.service`):**

```ini
[Unit]
Description=OpenTR8 API Service
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=opentr8
Group=opentr8
WorkingDirectory=/opt/opentr8
ExecStart=/usr/bin/node apps/api/dist/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=opentr8-api

# Environment
Environment=NODE_ENV=production
Environment=PORT=3000
EnvironmentFile=/etc/opentr8/.env

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/log/opentr8

[Install]
WantedBy=multi-user.target
```

**2. Create escrow service (`/etc/systemd/system/opentr8-escrow.service`):**

```ini
[Unit]
Description=OpenTR8 Escrow Service
After=network.target postgresql.service opentr8-api.service
Requires=postgresql.service

[Service]
Type=simple
User=opentr8
Group=opentr8
WorkingDirectory=/opt/opentr8
ExecStart=/usr/bin/node apps/escrow-service/dist/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=opentr8-escrow

Environment=NODE_ENV=production
EnvironmentFile=/etc/opentr8/.env

NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

**3. Enable and start services:**

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable services on boot
sudo systemctl enable opentr8-api opentr8-escrow

# Start services
sudo systemctl start opentr8-api opentr8-escrow

# Check status
sudo systemctl status opentr8-api opentr8-escrow

# View logs
sudo journalctl -u opentr8-api -f
```

---

## Database Setup

### PostgreSQL Configuration

**1. Create database and user:**

```sql
-- Connect as postgres superuser
CREATE USER opentr8 WITH PASSWORD 'your_secure_password';
CREATE DATABASE opentr8 OWNER opentr8;
GRANT ALL PRIVILEGES ON DATABASE opentr8 TO opentr8;

-- Connect to opentr8 database
\c opentr8

-- Grant schema permissions
GRANT ALL ON SCHEMA public TO opentr8;
```

**2. Production PostgreSQL tuning (`postgresql.conf`):**

```ini
# Connection settings
max_connections = 200
shared_buffers = 1GB
effective_cache_size = 3GB
work_mem = 16MB
maintenance_work_mem = 256MB

# Write-ahead log
wal_buffers = 64MB
checkpoint_completion_target = 0.9
max_wal_size = 2GB

# Query planner
random_page_cost = 1.1  # For SSD storage
effective_io_concurrency = 200

# Logging
log_destination = 'stderr'
logging_collector = on
log_min_duration_statement = 1000  # Log queries > 1s
```

### Running Migrations

**Development (creates migration files):**

```bash
pnpm db:migrate
```

**Production (applies existing migrations):**

```bash
# Using pnpm
cd packages/database
npx prisma migrate deploy

# Or via Docker
docker compose exec api npx prisma migrate deploy --schema=/app/packages/database/prisma/schema.prisma
```

**Reset database (DESTRUCTIVE - development only):**

```bash
npx prisma migrate reset
```

### Backup Strategies

**1. Automated daily backups with pg_dump:**

```bash
#!/bin/bash
# /opt/scripts/backup-opentr8.sh

BACKUP_DIR="/var/backups/opentr8"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30

# Create backup
pg_dump -h localhost -U opentr8 -Fc opentr8 > "${BACKUP_DIR}/opentr8_${TIMESTAMP}.dump"

# Compress
gzip "${BACKUP_DIR}/opentr8_${TIMESTAMP}.dump"

# Remove old backups
find ${BACKUP_DIR} -name "*.dump.gz" -mtime +${RETENTION_DAYS} -delete

# Upload to S3 (optional)
# aws s3 cp "${BACKUP_DIR}/opentr8_${TIMESTAMP}.dump.gz" s3://your-bucket/backups/
```

**2. Schedule with cron:**

```bash
# Run daily at 2 AM
0 2 * * * /opt/scripts/backup-opentr8.sh >> /var/log/opentr8/backup.log 2>&1
```

**3. Point-in-time recovery setup:**

```ini
# postgresql.conf
archive_mode = on
archive_command = 'cp %p /var/lib/postgresql/archive/%f'
```

**4. Restore from backup:**

```bash
# Stop services
sudo systemctl stop opentr8-api opentr8-escrow

# Restore
pg_restore -h localhost -U opentr8 -d opentr8 --clean /path/to/backup.dump

# Run any pending migrations
cd /opt/opentr8 && npx prisma migrate deploy

# Start services
sudo systemctl start opentr8-api opentr8-escrow
```

---

## Cloud Deployment Examples

### AWS (ECS/Fargate)

**Task Definition highlights:**

```json
{
  "family": "opentr8-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "ghcr.io/your-org/opentr8/api:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "wget -q --spider http://localhost:3000/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 10
      },
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "PORT", "value": "3000"}
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:opentr8/database-url"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/opentr8",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "api"
        }
      }
    }
  ]
}
```

**Recommended AWS architecture:**
- ECS Fargate for API and Escrow services
- RDS PostgreSQL (Multi-AZ for production)
- Application Load Balancer for API
- Secrets Manager for credentials
- CloudWatch for logs and metrics

### Railway

**1. Connect your repository**

**2. Add PostgreSQL plugin**

**3. Configure environment variables:**
- `DATABASE_URL` - Auto-populated by Railway PostgreSQL plugin
- `NODE_ENV=production`
- `PORT=3000` (Railway auto-assigns)

**4. Create `railway.toml`:**

```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

[build.args]
target = "api"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "on-failure"
restartPolicyMaxRetries = 3
```

### Render

**1. Create `render.yaml`:**

```yaml
services:
  - type: web
    name: opentr8-api
    env: docker
    dockerfilePath: ./Dockerfile
    dockerContext: .
    dockerCommand: ""
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        fromDatabase:
          name: opentr8-db
          property: connectionString

  - type: worker
    name: opentr8-escrow
    env: docker
    dockerfilePath: ./Dockerfile
    dockerContext: .
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        fromDatabase:
          name: opentr8-db
          property: connectionString

databases:
  - name: opentr8-db
    databaseName: opentr8
    user: opentr8
    plan: standard
```

### Generic Cloud Guidance

For any cloud provider, ensure:

1. **Database**: Use managed PostgreSQL (RDS, Cloud SQL, Azure Database)
2. **Secrets**: Use the provider's secrets management
3. **Load Balancing**: Place API behind a load balancer
4. **SSL/TLS**: Terminate TLS at the load balancer
5. **Private Networking**: Keep database and escrow service in private subnets
6. **Auto-scaling**: Configure based on CPU/memory metrics

---

## Scaling Considerations

### Horizontal Scaling

**API Service:**
- Stateless - can run multiple instances
- Scale based on request volume
- Use load balancer for distribution

```bash
# Docker Compose scaling
docker compose up -d --scale api=3

# PM2 cluster mode
pm2 scale opentr8-api 4
```

**Escrow Service:**
- Currently designed for single-instance operation
- For high throughput, implement job queue (Redis/BullMQ)
- Consider sharding by task ID ranges

### Database Connection Pooling

**1. Use PgBouncer for connection pooling:**

```ini
# pgbouncer.ini
[databases]
opentr8 = host=localhost port=5432 dbname=opentr8

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 20
min_pool_size = 5
reserve_pool_size = 5
```

**2. Update DATABASE_URL:**

```bash
DATABASE_URL="postgresql://opentr8:password@pgbouncer:6432/opentr8?schema=public&pgbouncer=true"
```

### Load Balancing

**Nginx configuration:**

```nginx
upstream opentr8_api {
    least_conn;
    server api1:3000 weight=1;
    server api2:3000 weight=1;
    server api3:3000 weight=1;
    keepalive 32;
}

server {
    listen 80;
    listen 443 ssl;
    server_name api.opentr8.example.com;

    ssl_certificate /etc/ssl/certs/opentr8.crt;
    ssl_certificate_key /etc/ssl/private/opentr8.key;

    location / {
        proxy_pass http://opentr8_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 5s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location /health {
        proxy_pass http://opentr8_api;
        access_log off;
    }
}
```

---

## Monitoring and Observability

### Health Endpoints

**API Health Check:**

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"2024-01-15T10:30:00.000Z"}
```

**Extended health check script:**

```bash
#!/bin/bash
# health-check.sh

API_URL="${API_URL:-http://localhost:3000}"
TIMEOUT=5

# Check API
if curl -sf --max-time $TIMEOUT "${API_URL}/health" > /dev/null; then
    echo "API: OK"
else
    echo "API: FAILED"
    exit 1
fi

# Check database connectivity (via API)
if curl -sf --max-time $TIMEOUT "${API_URL}/health" | grep -q '"status":"ok"'; then
    echo "Database: OK"
else
    echo "Database: Connection issue suspected"
    exit 1
fi
```

### Logging Best Practices

**1. Structured logging format:**

Application logs are JSON-formatted for easy parsing:

```json
{"level":"info","message":"Task created","taskId":"uuid","timestamp":"2024-01-15T10:30:00.000Z"}
```

**2. Log aggregation setup (ELK Stack):**

```yaml
# docker-compose.logging.yml
services:
  elasticsearch:
    image: elasticsearch:8.11.0
    environment:
      - discovery.type=single-node
    volumes:
      - es_data:/usr/share/elasticsearch/data

  logstash:
    image: logstash:8.11.0
    volumes:
      - ./logstash.conf:/usr/share/logstash/pipeline/logstash.conf

  kibana:
    image: kibana:8.11.0
    ports:
      - "5601:5601"
```

**3. Important log patterns to monitor:**

```bash
# Errors
grep -i "error" /var/log/opentr8/*.log

# Slow queries (if enabled)
grep "query took" /var/log/opentr8/*.log | awk '$NF > 1000'

# Failed webhooks
grep "webhook delivery failed" /var/log/opentr8/*.log
```

### Metrics to Watch

| Metric | Warning Threshold | Critical Threshold |
|--------|-------------------|---------------------|
| API Response Time (p95) | > 500ms | > 2000ms |
| API Error Rate | > 1% | > 5% |
| Database Connections | > 80% pool | > 95% pool |
| Memory Usage | > 80% | > 95% |
| CPU Usage | > 70% sustained | > 90% sustained |
| Disk Usage | > 80% | > 90% |
| Pending Webhooks | > 100 | > 1000 |
| Failed Escrow Releases | > 0 | > 10 |

**Prometheus metrics endpoint (if implemented):**

```bash
curl http://localhost:3000/metrics
```

---

## Security Checklist

### Pre-Deployment

- [ ] All secrets stored in environment variables or secrets manager
- [ ] Database credentials are unique and strong (32+ characters)
- [ ] `.env` files excluded from version control
- [ ] SSL/TLS certificates configured
- [ ] API authentication keys rotated

### Network Security

- [ ] Database not exposed to public internet
- [ ] API behind load balancer with DDoS protection
- [ ] Internal services communicate over private network
- [ ] Firewall rules restrict unnecessary ports
- [ ] Rate limiting configured on API endpoints

### Container Security

- [ ] Running as non-root user (configured in Dockerfile)
- [ ] Base images are official and regularly updated
- [ ] No secrets baked into images
- [ ] Image scanning enabled in CI/CD
- [ ] Read-only root filesystem where possible

### Application Security

- [ ] Input validation on all endpoints
- [ ] SQL injection prevention (Prisma ORM handles this)
- [ ] API key hashing (bcrypt) implemented
- [ ] Webhook signatures validated
- [ ] CORS configured appropriately
- [ ] Security headers set (Helmet.js or similar)

### Operational Security

- [ ] Audit logging enabled
- [ ] Log files secured and rotated
- [ ] Backup encryption enabled
- [ ] Incident response plan documented
- [ ] Regular security updates scheduled

### Compliance Considerations

- [ ] Data retention policies defined
- [ ] PII handling documented
- [ ] Backup and disaster recovery tested
- [ ] Access controls documented

---

## Troubleshooting

### Common Issues

#### Service Won't Start

**Symptoms:** Container exits immediately, "port already in use"

**Solutions:**

```bash
# Check if port is in use
lsof -i :3000
netstat -tulpn | grep 3000

# Check container logs
docker logs opentr8-api --tail 100

# Verify environment variables
docker compose config
```

#### Database Connection Failed

**Symptoms:** "Connection refused", "ECONNREFUSED"

**Solutions:**

```bash
# Test database connectivity
psql "${DATABASE_URL}"

# Check if database is running
docker compose ps postgres

# Verify network connectivity
docker compose exec api ping postgres

# Check connection string format
echo $DATABASE_URL | grep -E "postgresql://[^:]+:[^@]+@[^:]+:[0-9]+/[^?]+"
```

#### Migrations Failing

**Symptoms:** "Migration failed", "Table already exists"

**Solutions:**

```bash
# Check migration status
npx prisma migrate status

# View pending migrations
ls packages/database/prisma/migrations/

# Reset and reapply (DESTRUCTIVE - dev only)
npx prisma migrate reset

# Apply migrations in production
npx prisma migrate deploy
```

#### High Memory Usage

**Symptoms:** OOM kills, slow responses

**Solutions:**

```bash
# Check memory usage
docker stats

# Increase memory limits in docker-compose
# Or identify memory leaks with:
node --inspect apps/api/dist/index.js
# Connect Chrome DevTools to take heap snapshots
```

#### Webhook Delivery Failures

**Symptoms:** Webhooks not received, delivery retries

**Solutions:**

```bash
# Check webhook logs
docker logs opentr8-api | grep -i webhook

# Verify webhook URL is reachable from container
docker compose exec api curl -I https://your-webhook-url.com

# Check for pending deliveries in database
# (Connect to database and query WebhookDelivery table)
```

### Debug Mode

**Enable verbose logging:**

```bash
# Set debug environment variable
DEBUG=opentr8:* docker compose up

# Or for PM2
DEBUG=opentr8:* pm2 restart opentr8-api
```

### Getting Help

1. Check the [API Reference](./api-reference.md) for endpoint documentation
2. Review logs with `docker compose logs -f` or `journalctl -u opentr8-api -f`
3. Open an issue on GitHub with:
   - OpenTR8 version
   - Deployment method
   - Error messages and logs
   - Steps to reproduce

---

## Quick Reference

### Essential Commands

```bash
# Start production stack
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# View logs
docker compose logs -f api

# Run migrations
docker compose exec api npx prisma migrate deploy

# Backup database
docker compose exec postgres pg_dump -U postgres opentr8 > backup.sql

# Restart services
docker compose restart

# Check health
curl http://localhost:3000/health

# Scale API
docker compose up -d --scale api=3
```

### Important Paths

| Path | Description |
|------|-------------|
| `/health` | Health check endpoint |
| `/agents` | Agent management |
| `/tasks` | Task operations |
| `/wallet` | Wallet operations |
| `/webhooks` | Webhook management |

---

*Last updated: 2024*
