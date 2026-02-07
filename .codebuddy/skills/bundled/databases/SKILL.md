---
name: databases
version: 1.0.0
description: Database management - PostgreSQL, MongoDB, Redis via CLI and official MCP servers
author: Code Buddy
tags: database, sql, nosql, postgres, mongodb, redis, postgresql, cache
env:
  POSTGRES_URL: ""
  MONGODB_URI: ""
  REDIS_URL: ""
---

# Database Management

Manage PostgreSQL, MongoDB, and Redis databases through CLI tools and official MCP servers. Perform queries, manage schemas, monitor performance, and automate database operations.

## Direct Control (CLI / API / Scripting)

### PostgreSQL (psql)

```bash
# Connection strings
export POSTGRES_URL="postgresql://user:password@localhost:5432/dbname"

# Connect to database
psql "$POSTGRES_URL"
psql -h localhost -p 5432 -U username -d dbname

# Execute query from command line
psql "$POSTGRES_URL" -c "SELECT * FROM users LIMIT 10;"

# Execute SQL file
psql "$POSTGRES_URL" -f schema.sql

# Export query results to CSV
psql "$POSTGRES_URL" -c "COPY (SELECT * FROM users) TO STDOUT WITH CSV HEADER" > users.csv

# Import CSV data
psql "$POSTGRES_URL" -c "\COPY users(id,name,email) FROM 'users.csv' WITH CSV HEADER"

# List databases
psql "$POSTGRES_URL" -c "\l"

# List tables in current database
psql "$POSTGRES_URL" -c "\dt"

# Describe table structure
psql "$POSTGRES_URL" -c "\d+ users"

# Show table sizes
psql "$POSTGRES_URL" -c "
  SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
  FROM pg_tables
  WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
  LIMIT 10;
"

# Show active queries
psql "$POSTGRES_URL" -c "
  SELECT pid, age(clock_timestamp(), query_start), usename, query
  FROM pg_stat_activity
  WHERE query != '<IDLE>' AND query NOT ILIKE '%pg_stat_activity%'
  ORDER BY query_start DESC;
"

# Kill long-running query
psql "$POSTGRES_URL" -c "SELECT pg_terminate_backend(12345);"

# Create database backup
pg_dump "$POSTGRES_URL" > backup_$(date +%Y%m%d_%H%M%S).sql
pg_dump "$POSTGRES_URL" | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz

# Restore from backup
psql "$POSTGRES_URL" < backup_20260207_120000.sql
gunzip -c backup_20260207_120000.sql.gz | psql "$POSTGRES_URL"

# Create user and grant permissions
psql "$POSTGRES_URL" <<EOF
CREATE USER app_user WITH PASSWORD 'secure_password';
GRANT CONNECT ON DATABASE mydb TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
EOF

# Run migrations
psql "$POSTGRES_URL" <<EOF
BEGIN;

CREATE TABLE IF NOT EXISTS migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

INSERT INTO migrations (name) VALUES ('001_create_users_table');

COMMIT;
EOF

# Performance tuning queries
# Find missing indexes
psql "$POSTGRES_URL" -c "
  SELECT
    schemaname, tablename,
    seq_scan, seq_tup_read,
    idx_scan, idx_tup_fetch,
    seq_tup_read / seq_scan AS avg_seq_tup_read
  FROM pg_stat_user_tables
  WHERE seq_scan > 0
  ORDER BY seq_tup_read DESC
  LIMIT 10;
"

# Find unused indexes
psql "$POSTGRES_URL" -c "
  SELECT
    schemaname, tablename, indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
  FROM pg_stat_user_indexes
  WHERE idx_scan = 0
  ORDER BY pg_relation_size(indexrelid) DESC;
"
```

### MongoDB (mongosh)

```bash
# Connection string
export MONGODB_URI="mongodb://user:password@localhost:27017/mydb?authSource=admin"

# Connect to database
mongosh "$MONGODB_URI"
mongosh --host localhost --port 27017 -u user -p password --authenticationDatabase admin

# Execute command from CLI
mongosh "$MONGODB_URI" --eval "db.users.countDocuments()"

# Execute JavaScript file
mongosh "$MONGODB_URI" --file script.js

# List databases
mongosh "$MONGODB_URI" --eval "show dbs"

# List collections
mongosh "$MONGODB_URI" --eval "show collections"

# Query documents
mongosh "$MONGODB_URI" --eval "db.users.find().limit(10).pretty()"

# Find with filter
mongosh "$MONGODB_URI" --eval '
  db.users.find({
    age: { $gte: 18 },
    status: "active"
  }).sort({ created_at: -1 }).limit(20)
'

# Aggregation pipeline
mongosh "$MONGODB_URI" --eval '
  db.orders.aggregate([
    { $match: { status: "completed" } },
    { $group: {
        _id: "$customer_id",
        total: { $sum: "$amount" },
        count: { $sum: 1 }
      }
    },
    { $sort: { total: -1 } },
    { $limit: 10 }
  ])
'

# Insert document
mongosh "$MONGODB_URI" --eval '
  db.users.insertOne({
    email: "user@example.com",
    name: "John Doe",
    created_at: new Date()
  })
'

# Update documents
mongosh "$MONGODB_URI" --eval '
  db.users.updateMany(
    { status: "pending" },
    { $set: { status: "active", updated_at: new Date() } }
  )
'

# Delete documents
mongosh "$MONGODB_URI" --eval '
  db.users.deleteMany({ status: "inactive", last_login: { $lt: new Date("2025-01-01") } })
'

# Create index
mongosh "$MONGODB_URI" --eval '
  db.users.createIndex({ email: 1 }, { unique: true })
  db.orders.createIndex({ customer_id: 1, created_at: -1 })
'

# Show indexes
mongosh "$MONGODB_URI" --eval "db.users.getIndexes()"

# Database statistics
mongosh "$MONGODB_URI" --eval "db.stats()"

# Collection statistics
mongosh "$MONGODB_URI" --eval "db.users.stats()"

# Backup database
mongodump --uri="$MONGODB_URI" --out=backup_$(date +%Y%m%d_%H%M%S)

# Backup specific collection
mongodump --uri="$MONGODB_URI" --collection=users --out=backup_users

# Restore database
mongorestore --uri="$MONGODB_URI" backup_20260207_120000/

# Restore specific collection
mongorestore --uri="$MONGODB_URI" --collection=users backup_users/mydb/users.bson

# Export to JSON
mongoexport --uri="$MONGODB_URI" --collection=users --out=users.json
mongoexport --uri="$MONGODB_URI" --collection=users --query='{"status":"active"}' --out=active_users.json

# Import from JSON
mongoimport --uri="$MONGODB_URI" --collection=users --file=users.json
mongoimport --uri="$MONGODB_URI" --collection=users --file=users.json --mode=upsert

# Performance monitoring
mongosh "$MONGODB_URI" --eval '
  db.currentOp({
    active: true,
    secs_running: { $gte: 5 }
  })
'

# Kill operation
mongosh "$MONGODB_URI" --eval 'db.killOp(12345)'

# Profiling
mongosh "$MONGODB_URI" --eval "db.setProfilingLevel(2)"  # Log all operations
mongosh "$MONGODB_URI" --eval "db.system.profile.find().limit(10).sort({ ts: -1 })"
```

### Redis (redis-cli)

```bash
# Connection
export REDIS_URL="redis://localhost:6379"

# Connect to Redis
redis-cli
redis-cli -h localhost -p 6379
redis-cli -h localhost -p 6379 -a password
redis-cli -u "$REDIS_URL"

# Execute command
redis-cli SET mykey "Hello World"
redis-cli GET mykey

# Execute multiple commands
redis-cli <<EOF
SET key1 "value1"
SET key2 "value2"
MGET key1 key2
EOF

# Ping server
redis-cli PING

# Get server info
redis-cli INFO
redis-cli INFO memory
redis-cli INFO stats

# Key operations
redis-cli KEYS "*"              # List all keys (use in dev only!)
redis-cli SCAN 0 MATCH "user:*" COUNT 100  # Safer iteration
redis-cli TYPE mykey            # Get key type
redis-cli TTL mykey             # Time to live
redis-cli EXPIRE mykey 3600     # Set expiration (1 hour)
redis-cli PERSIST mykey         # Remove expiration
redis-cli DEL mykey             # Delete key
redis-cli EXISTS mykey          # Check if exists

# String operations
redis-cli SET user:1:name "John Doe"
redis-cli GET user:1:name
redis-cli INCR counter
redis-cli INCRBY counter 10
redis-cli SETEX session:abc123 3600 "user_data"  # Set with expiration

# Hash operations
redis-cli HSET user:1 name "John" email "john@example.com" age 30
redis-cli HGET user:1 name
redis-cli HGETALL user:1
redis-cli HINCRBY user:1 age 1
redis-cli HDEL user:1 age

# List operations
redis-cli LPUSH queue:tasks "task1" "task2"
redis-cli RPUSH queue:tasks "task3"
redis-cli LRANGE queue:tasks 0 -1
redis-cli LPOP queue:tasks
redis-cli LLEN queue:tasks

# Set operations
redis-cli SADD tags:post:1 "redis" "database" "nosql"
redis-cli SMEMBERS tags:post:1
redis-cli SISMEMBER tags:post:1 "redis"
redis-cli SCARD tags:post:1

# Sorted set operations
redis-cli ZADD leaderboard 100 "player1" 200 "player2" 150 "player3"
redis-cli ZRANGE leaderboard 0 -1 WITHSCORES
redis-cli ZREVRANGE leaderboard 0 9 WITHSCORES  # Top 10
redis-cli ZINCRBY leaderboard 10 "player1"
redis-cli ZRANK leaderboard "player1"

# Pub/Sub
# Terminal 1 (subscriber)
redis-cli SUBSCRIBE notifications

# Terminal 2 (publisher)
redis-cli PUBLISH notifications "New message"

# Pattern subscription
redis-cli PSUBSCRIBE "user:*:notifications"

# Database management
redis-cli SELECT 1              # Switch to database 1
redis-cli DBSIZE                # Number of keys
redis-cli FLUSHDB               # Clear current database
redis-cli FLUSHALL              # Clear all databases

# Backup and persistence
redis-cli SAVE                  # Synchronous save
redis-cli BGSAVE                # Background save
redis-cli LASTSAVE              # Last save timestamp

# Backup RDB file
cp /var/lib/redis/dump.rdb backup_$(date +%Y%m%d_%H%M%S).rdb

# Monitor commands in real-time
redis-cli MONITOR

# Slow log
redis-cli SLOWLOG GET 10        # Get last 10 slow queries
redis-cli SLOWLOG LEN           # Slow log length
redis-cli SLOWLOG RESET         # Clear slow log

# Memory analysis
redis-cli --memkeys
redis-cli MEMORY STATS
redis-cli MEMORY DOCTOR

# Find large keys
redis-cli --bigkeys

# Batch operations
# Delete keys matching pattern
redis-cli --scan --pattern "session:*" | xargs redis-cli DEL

# Export all keys to JSON
redis-cli --scan | while read key; do
  type=$(redis-cli TYPE "$key" | tr -d '\r')
  ttl=$(redis-cli TTL "$key" | tr -d '\r')
  value=$(redis-cli DUMP "$key" | base64)
  echo "{\"key\":\"$key\",\"type\":\"$type\",\"ttl\":$ttl,\"value\":\"$value\"}"
done > redis_backup.json

# Lua scripting
redis-cli EVAL "return redis.call('SET', KEYS[1], ARGV[1])" 1 mykey myvalue

redis-cli EVAL '
  local count = redis.call("INCR", KEYS[1])
  if count > tonumber(ARGV[1]) then
    return 0
  else
    redis.call("EXPIRE", KEYS[1], ARGV[2])
    return 1
  end
' 1 rate:limit:user123 100 60
```

### Node.js Integration

```typescript
// PostgreSQL with pg
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
});

const result = await pool.query('SELECT * FROM users WHERE id = $1', [123]);
console.log(result.rows);

await pool.end();

// MongoDB with official driver
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();

const db = client.db('mydb');
const users = await db.collection('users').find({ status: 'active' }).toArray();

await client.close();

// Redis with ioredis
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

await redis.set('key', 'value', 'EX', 3600);
const value = await redis.get('key');

await redis.quit();
```

## MCP Server Integration

Add this to `.codebuddy/mcp.json`:

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "POSTGRES_URL": "postgresql://user:password@localhost:5432/mydb"
      }
    },
    "mongodb": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-mongodb"],
      "env": {
        "MONGODB_URI": "mongodb://user:password@localhost:27017/mydb"
      }
    },
    "redis": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-redis"],
      "env": {
        "REDIS_URL": "redis://localhost:6379"
      }
    }
  }
}
```

### PostgreSQL MCP Tools

- **query** - Execute SQL query (SELECT, INSERT, UPDATE, DELETE)
- **list_tables** - List all tables in current database with row counts
- **describe_table** - Get table schema (columns, types, constraints)
- **list_indexes** - Show indexes for a table
- **create_table** - Create new table from schema definition
- **alter_table** - Modify table structure (add/drop columns)
- **analyze_query** - Get EXPLAIN ANALYZE output for query optimization
- **vacuum** - Run VACUUM on table to reclaim space
- **get_stats** - Get database/table statistics

### MongoDB MCP Tools

- **find** - Query documents with filter, projection, sort, limit
- **aggregate** - Run aggregation pipeline
- **insert** - Insert one or many documents
- **update** - Update documents matching filter
- **delete** - Delete documents matching filter
- **list_collections** - List all collections in database
- **create_index** - Create index on collection
- **list_indexes** - Show indexes for collection
- **collection_stats** - Get collection statistics
- **explain** - Get query execution plan

### Redis MCP Tools

- **get** - Get value by key
- **set** - Set key-value with optional TTL
- **del** - Delete key(s)
- **exists** - Check if key exists
- **scan** - Iterate keys matching pattern
- **ttl** - Get time to live for key
- **hgetall** - Get all hash fields
- **lrange** - Get list range
- **smembers** - Get set members
- **zrange** - Get sorted set range
- **info** - Get server info

### MCP Usage Examples

```typescript
// PostgreSQL - Query users
const users = await mcp.callTool('postgres', 'query', {
  sql: 'SELECT * FROM users WHERE age > $1 ORDER BY created_at DESC LIMIT $2',
  params: [18, 10]
});

// PostgreSQL - Create table
await mcp.callTool('postgres', 'create_table', {
  name: 'posts',
  columns: [
    { name: 'id', type: 'SERIAL PRIMARY KEY' },
    { name: 'user_id', type: 'INTEGER REFERENCES users(id)' },
    { name: 'title', type: 'VARCHAR(255) NOT NULL' },
    { name: 'content', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMP DEFAULT NOW()' }
  ]
});

// MongoDB - Find documents
const activeUsers = await mcp.callTool('mongodb', 'find', {
  collection: 'users',
  filter: { status: 'active', age: { $gte: 18 } },
  sort: { created_at: -1 },
  limit: 20
});

// MongoDB - Aggregation
const orderStats = await mcp.callTool('mongodb', 'aggregate', {
  collection: 'orders',
  pipeline: [
    { $match: { status: 'completed' } },
    { $group: {
        _id: '$customer_id',
        total: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    },
    { $sort: { total: -1 } },
    { $limit: 10 }
  ]
});

// Redis - Set with expiration
await mcp.callTool('redis', 'set', {
  key: 'session:abc123',
  value: JSON.stringify({ userId: 123, role: 'admin' }),
  ttl: 3600
});

// Redis - Get value
const session = await mcp.callTool('redis', 'get', {
  key: 'session:abc123'
});
```

## Common Workflows

### 1. Database Migration with Rollback

```bash
#!/bin/bash
# PostgreSQL migration script with automatic rollback on error

set -e  # Exit on error

POSTGRES_URL="postgresql://user:password@localhost:5432/mydb"
MIGRATION_NAME="002_add_profiles_table"

echo "Starting migration: $MIGRATION_NAME"

# Create backup before migration
echo "Creating backup..."
pg_dump "$POSTGRES_URL" | gzip > "backup_before_${MIGRATION_NAME}_$(date +%Y%m%d_%H%M%S).sql.gz"

# Run migration in transaction
psql "$POSTGRES_URL" <<EOF || {
  echo "Migration failed! Restoring from backup..."
  gunzip -c backup_before_${MIGRATION_NAME}_*.sql.gz | psql "$POSTGRES_URL"
  exit 1
}

BEGIN;

-- Migration code
CREATE TABLE user_profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  bio TEXT,
  avatar_url VARCHAR(512),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_profiles_user_id ON user_profiles(user_id);

-- Update migration tracking
INSERT INTO migrations (name, applied_at) VALUES ('$MIGRATION_NAME', NOW());

COMMIT;

EOF

echo "Migration completed successfully!"
```

### 2. Cross-Database Data Sync (PostgreSQL → MongoDB)

```bash
#!/bin/bash
# Sync user data from PostgreSQL to MongoDB

POSTGRES_URL="postgresql://user:password@localhost:5432/mydb"
MONGODB_URI="mongodb://user:password@localhost:27017/mydb"

# Extract from PostgreSQL
psql "$POSTGRES_URL" -c "
  COPY (
    SELECT row_to_json(t)
    FROM (
      SELECT id, email, name, created_at, updated_at
      FROM users
      WHERE updated_at > NOW() - INTERVAL '1 day'
    ) t
  ) TO STDOUT
" > users_sync.json

# Transform and load to MongoDB
mongosh "$MONGODB_URI" <<EOF
const fs = require('fs');
const users = fs.readFileSync('users_sync.json', 'utf8')
  .split('\n')
  .filter(line => line.trim())
  .map(line => JSON.parse(line));

db.users.bulkWrite(
  users.map(user => ({
    updateOne: {
      filter: { id: user.id },
      update: { \$set: user },
      upsert: true
    }
  }))
);

print(\`Synced \${users.length} users to MongoDB\`);
EOF

rm users_sync.json
```

### 3. Redis Cache Warming from Database

```typescript
// cache-warmer.ts
import { Pool } from 'pg';
import Redis from 'ioredis';

const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
const redis = new Redis(process.env.REDIS_URL);

async function warmCache() {
  console.log('Warming Redis cache from PostgreSQL...');

  // Popular users cache
  const popularUsers = await pool.query(`
    SELECT u.id, u.name, u.email, COUNT(p.id) as post_count
    FROM users u
    LEFT JOIN posts p ON u.id = p.user_id
    GROUP BY u.id
    HAVING COUNT(p.id) > 10
    ORDER BY post_count DESC
    LIMIT 100
  `);

  const pipeline = redis.pipeline();

  for (const user of popularUsers.rows) {
    const key = `user:${user.id}`;
    pipeline.hmset(key, {
      name: user.name,
      email: user.email,
      post_count: user.post_count,
    });
    pipeline.expire(key, 3600); // 1 hour TTL
  }

  await pipeline.exec();
  console.log(`Cached ${popularUsers.rows.length} popular users`);

  // Recent posts cache
  const recentPosts = await pool.query(`
    SELECT id, title, content, user_id, created_at
    FROM posts
    ORDER BY created_at DESC
    LIMIT 50
  `);

  await redis.set(
    'posts:recent',
    JSON.stringify(recentPosts.rows),
    'EX',
    300 // 5 minutes
  );

  console.log('Cache warming complete!');

  await pool.end();
  await redis.quit();
}

warmCache();
```

### 4. Database Health Check and Monitoring

```bash
#!/bin/bash
# Multi-database health check script

set -e

POSTGRES_URL="postgresql://user:password@localhost:5432/mydb"
MONGODB_URI="mongodb://user:password@localhost:27017/mydb"
REDIS_URL="redis://localhost:6379"

echo "=== Database Health Check ==="
echo

# PostgreSQL
echo "PostgreSQL:"
psql "$POSTGRES_URL" -t -c "SELECT version();" | head -n1
echo -n "  Status: "
psql "$POSTGRES_URL" -t -c "SELECT 'HEALTHY';" || echo "FAILED"

echo -n "  Connections: "
psql "$POSTGRES_URL" -t -c "SELECT count(*) FROM pg_stat_activity;"

echo -n "  Database size: "
psql "$POSTGRES_URL" -t -c "SELECT pg_size_pretty(pg_database_size(current_database()));"

echo -n "  Slow queries (>1s): "
psql "$POSTGRES_URL" -t -c "
  SELECT count(*)
  FROM pg_stat_activity
  WHERE state = 'active'
  AND NOW() - query_start > interval '1 second';
"

echo

# MongoDB
echo "MongoDB:"
mongosh "$MONGODB_URI" --quiet --eval "db.version()"
echo -n "  Status: "
mongosh "$MONGODB_URI" --quiet --eval "db.adminCommand('ping').ok ? 'HEALTHY' : 'FAILED'"

echo -n "  Connections: "
mongosh "$MONGODB_URI" --quiet --eval "db.serverStatus().connections.current"

echo -n "  Database size: "
mongosh "$MONGODB_URI" --quiet --eval "
  const stats = db.stats();
  (stats.dataSize / 1024 / 1024).toFixed(2) + ' MB'
"

echo -n "  Active operations: "
mongosh "$MONGODB_URI" --quiet --eval "db.currentOp().inprog.length"

echo

# Redis
echo "Redis:"
redis-cli -u "$REDIS_URL" INFO server | grep redis_version
echo -n "  Status: "
redis-cli -u "$REDIS_URL" PING

echo -n "  Connected clients: "
redis-cli -u "$REDIS_URL" INFO clients | grep connected_clients | cut -d: -f2

echo -n "  Memory used: "
redis-cli -u "$REDIS_URL" INFO memory | grep used_memory_human | cut -d: -f2

echo -n "  Keys: "
redis-cli -u "$REDIS_URL" DBSIZE

echo -n "  Hit rate: "
redis-cli -u "$REDIS_URL" INFO stats | grep -E "keyspace_(hits|misses)" | \
  awk -F: '{sum+=$2; arr[NR]=$2} END {printf "%.2f%%\n", (arr[1]/(arr[1]+arr[2]))*100}'

echo
echo "=== Health Check Complete ==="
```

### 5. Automated Backup and Retention

```bash
#!/bin/bash
# Automated backup script with retention policy

BACKUP_DIR="/var/backups/databases"
RETENTION_DAYS=7

mkdir -p "$BACKUP_DIR"
cd "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "Starting database backups at $(date)"

# PostgreSQL backup
echo "Backing up PostgreSQL..."
pg_dump "$POSTGRES_URL" | gzip > "postgres_${TIMESTAMP}.sql.gz"

# MongoDB backup
echo "Backing up MongoDB..."
mongodump --uri="$MONGODB_URI" --out="mongodb_${TIMESTAMP}" --gzip
tar -czf "mongodb_${TIMESTAMP}.tar.gz" "mongodb_${TIMESTAMP}"
rm -rf "mongodb_${TIMESTAMP}"

# Redis backup
echo "Backing up Redis..."
redis-cli -u "$REDIS_URL" BGSAVE
sleep 5  # Wait for background save
cp /var/lib/redis/dump.rdb "redis_${TIMESTAMP}.rdb"
gzip "redis_${TIMESTAMP}.rdb"

# Clean up old backups
echo "Cleaning up backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name "*.gz" -mtime +${RETENTION_DAYS} -delete
find "$BACKUP_DIR" -name "*.rdb" -mtime +${RETENTION_DAYS} -delete

# Upload to S3 (optional)
if [ -n "$S3_BUCKET" ]; then
  echo "Uploading to S3..."
  aws s3 sync "$BACKUP_DIR" "s3://$S3_BUCKET/database-backups/" \
    --exclude "*" \
    --include "*${TIMESTAMP}*"
fi

echo "Backup completed at $(date)"
```
