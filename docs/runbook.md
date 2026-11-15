# Wowo External API — Production Operations Runbook

**Service Name:** `external-api`  
**On-Call Rotation:** Tier-1 Infrastructure / Platform Engineering  
**Escalation Contact:** Lead Platform Engineer / Head of Infrastructure  
**Core SLA:** 99.9% Uptime, p95 Latency < 300 ms, Error Rate < 0.1%  

---

## 1. Automated Alerts & Monitoring Configurations

### 1.1 Critical Alert: High 5xx Error Rate (`High5xxErrorRate`)

- **Condition:** 5xx responses exceed 1% of total API traffic over a rolling 5-minute window.
- **Severity:** P1 — CRITICAL (Pages on-call immediately).
- **Prometheus Alert Rule Definition:**

```yaml
groups:
  - name: external_api_alerts
    rules:
      - alert: ExternalApiHigh5xxErrorRate
        expr: |
          (
            sum(rate(http_requests_total{job="external-api", status=~"5.."}[5m]))
            /
            sum(rate(http_requests_total{job="external-api"}[5m]))
          ) * 100 > 1.0
        for: 5m
        labels:
          severity: critical
          service: external-api
        annotations:
          summary: "External API 5xx error rate exceeds 1% (current: {{ $value }}%)"
          description: "External API is returning high rate of 5xx errors affecting partner integrations."
          runbook_url: "docs/runbook.md#incident-1-high-5xx-error-rate-spike"
```

### 1.2 Warning Alert: Database Connection Pool Exhaustion (`DbPoolExhaustionHigh`)

- **Condition:** Active pooled connections exceed 85% of pool capacity for 3 minutes.
- **Severity:** P2 — WARNING.
- **Prometheus Alert Rule Definition:**

```yaml
      - alert: ExternalApiDbPoolExhaustion
        expr: pg_stat_activity_count{datname="external_api"} / 20 > 0.85
        for: 3m
        labels:
          severity: warning
          service: external-api
        annotations:
          summary: "PostgreSQL pool nearing saturation (>85%)"
          runbook_url: "docs/runbook.md#incident-5-database-connection-pool-saturation"
```

---

## 2. Emergency Kill Switches & Mitigation Mechanisms

The service contains three independent, cascading kill switches:

```
[ Incoming Request ]
         │
         ▼
[ Kill Switch 1: Global / Env ] ──(EXTERNAL_API_ENABLED=false)──> 503 SERVICE_UNAVAILABLE
         │
         ▼
[ Kill Switch 2: Platform Level ] ──(Platform.isActive=false)───> 403 PLATFORM_INACTIVE
         │
         ▼
[ Kill Switch 3: Account Level ] ──(Business.isActive=false)────> 403 ACCOUNT_INACTIVE
         │
         ▼
[ Device Level Check ] ───────────(Device.revokedAt != null)────> 401 TOKEN_REVOKED
         │
         ▼
[ Scoped Handler Execution ]
```

### 2.1 Switch 1: Global Process Kill Switch (`EXTERNAL_API_ENABLED`)
- **Use When:** Catastrophic platform-wide security incident, active DB corruption, or scheduled major infrastructure migration.
- **Effect:** Immediately rejects all incoming traffic across all partners with `503 SERVICE_UNAVAILABLE`.
- **Action:**
  ```powershell
  # AWS ECS / Kubernetes / VM Environment:
  # Set environment variable:
  EXTERNAL_API_ENABLED=false
  # Restart service containers
  ```

### 2.2 Switch 2: Partner Platform Kill Switch (`Platform.isActive`)
- **Use When:** Specific partner (e.g. Wowo) experiences an unconstrained runaway script, credential breach, or contractual billing dispute.
- **Effect:** Halts all traffic originating from that platform's devices with `403 PLATFORM_INACTIVE`. Leaves other partners unaffected.
- **Action via CLI / SQL:**
  ```sql
  UPDATE platforms
  SET is_active = false,
      suspended_at = NOW(),
      suspended_reason = 'Incident INC-1029: Suspended due to unthrottled request flood'
  WHERE id = '<platform-id>';
  ```

### 2.3 Switch 3: Merchant Account Kill Switch (`Business.isActive`)
- **Use When:** A single merchant is compromised, suspected of fraud, or de-boarded.
- **Effect:** Rejects requests scoped to `/accounts/:id` with `403 ACCOUNT_INACTIVE`.
- **Action via CLI / SQL:**
  ```sql
  UPDATE businesses
  SET is_active = false
  WHERE id = '<business-id>';
  ```

### 2.4 Device-Level Immediate Revocation (`ExternalDevice.revokedAt`)
- **Use When:** A merchant POS terminal or server is stolen, replaced, or token leaked.
- **Effect:** Rejects any request carrying that device token with `401 TOKEN_REVOKED`.
- **Action via CLI / SQL:**
  ```sql
  UPDATE external_devices
  SET revoked_at = NOW(),
      token_hash = NULL
  WHERE id = '<device-id>';
  ```

---

## 3. Incident Response Playbooks (Named First Actions)

### Incident 1: High 5xx Error Rate Spike (>1%)
- **Named First Action:** Check container logs for unhandled exceptions filtered by `requestId`:
  ```powershell
  # Stream recent errors with formatted JSON
  kubectl logs -l app=external-api --tail=100 | grep '"level":50'
  ```
- **Diagnostic Steps:**
  1. Inspect the stack trace: Is it DB connectivity (`Can't reach database server`), validation failure, or out of memory?
  2. If PostgreSQL is unreachable: Check database CPU, memory, and connection limits in Supabase / RDS console.
  3. If Prisma client throws connection timeout: Increase `DATABASE_URL` pool size or restart pooler.
  4. If a bug was introduced in a new deployment: Roll back to previous container image tag immediately.

### Incident 2: Partner Rate Limit Burst (429 Flood)
- **Named First Action:** Identify the offending IP or device token hash in the access logs:
  ```powershell
  # Find top IPs returning 429
  kubectl logs -l app=external-api --tail=1000 | grep '"status":429' | jq -r '.ip' | sort | uniq -c | sort -nr
  ```
- **Diagnostic Steps:**
  1. Determine if the traffic is legitimate surge or a tight retry loop without exponential backoff.
  2. If legitimate high-volume event (e.g. Black Friday): Temporarily bump `EXTERNAL_DATA_RATE_LIMIT` in environment config (default is 100 req/min).
  3. If abusive or bug loop: Notify Wowo technical contacts with the client IP and device token prefix.

### Incident 3: Lost Activation Code / Merchant Stuck in Activation
- **Named First Action:** Re-issue an activation code using the administrative CLI:
  ```powershell
  cd "external-api"
  npx tsx src/cli/admin.ts issue-code --account <business-id>
  ```
- **Behavior:** Mints a new 10-character code, sets expiration to 1 hour, resets failed attempt count to 0, writes an audit log (`actor = 'cli'`), and outputs the code to the operator console.
- **Action:** Deliver the code securely to the merchant operator.

### Incident 4: Subscription Expired (Partner Receiving 402 on Data Routes)
- **Named First Action:** Verify the platform's current `subscriptionExpiresAt` date:
  ```sql
  SELECT id, name, subscription_expires_at, is_active FROM platforms WHERE id = '<platform-id>';
  ```
- **Resolution Action:** Extend the subscription entitlement window:
  ```sql
  UPDATE platforms
  SET subscription_expires_at = NOW() + INTERVAL '30 days'
  WHERE id = '<platform-id>';
  ```
- **Verification:** Device `/me` response immediately shows `subscriptionActive: true` and data routes unlock instantly.

### Incident 5: Database Connection Pool Saturation
- **Named First Action:** Inspect current active connections in PostgreSQL:
  ```sql
  SELECT pid, client_addr, state, query_start, query
  FROM pg_stat_activity
  WHERE datname = current_database() AND state != 'idle'
  ORDER BY query_start ASC;
  ```
- **Diagnostic Steps:**
  1. Look for long-running unindexed queries (check for `EXPLAIN` and missing indexes).
  2. Kill runaway queries using `SELECT pg_terminate_backend(pid);`.
  3. Ensure application container count multiplied by pool size does not exceed DB max connections.

### Incident 6: Data Sync Keyset Paging Loop
- **Named First Action:** Inspect client sync request query parameters in logs:
  ```powershell
  # Check if client is reusing an old cursor or passing updatedSince with limit=0
  kubectl logs -l app=external-api --tail=500 | grep '/sales?updatedSince'
  ```
- **Diagnostic Steps:**
  1. Ensure client is advancing the cursor returned in `page.nextCursor`.
  2. Verify client is not sending `updatedSince` without reading the next pages until `hasMore: false`.
  3. Advise partner integration team to follow [integration-guide.md](integration-guide.md#3-data-synchronization--pagination-guide).

---

## 4. Operational Maintenance Procedures

### 4.1 Running the Retention Purge Manually (If Scheduler Disabled)
```powershell
cd "external-api"
npx tsx -e "import { runRetentionJob } from './src/jobs/retention.job.js'; runRetentionJob().then(console.log);"
```

### 4.2 Verifying Autovacuum Table Options
```sql
SELECT relname, reloptions
FROM pg_class
WHERE relname IN ('sales_transactions', 'audit_logs', 'external_devices');
```
Expected output:
- `sales_transactions`: `{autovacuum_vacuum_scale_factor=0.05,autovacuum_vacuum_threshold=1000,...}`
- `audit_logs`: `{autovacuum_vacuum_scale_factor=0.05,autovacuum_vacuum_threshold=1000,...}`
- `external_devices`: `{autovacuum_vacuum_scale_factor=0.05,autovacuum_vacuum_threshold=100,...}`
