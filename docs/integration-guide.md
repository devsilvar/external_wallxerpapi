# Wowo External API — Partner Integration Guide

**Document Version:** 1.0.0  
**Target Audience:** Partner Integration Engineers & Technical Leads  
**Service Endpoint:** `/api/external/v1`  
**Interactive Docs:** `/docs` (Scalar UI)  
**Machine-Readable Spec:** `/openapi.json` (OpenAPI 3.1.0)  

---

## 1. Architectural Principles & Integration Contract

The Wowo External API is purpose-built for high-throughput, multi-tenant financial data ingestion (sales, expenses, invoices, and customer entities). When integrating with this service, keep the following core invariants in mind:

1. **Per-Account Tenancy**:
   - All operational endpoints are strictly scoped under an account: `/api/external/v1/accounts/:accountId/...`.
   - Your device credential is bound to exactly one `accountId`. Attempting to query an account or a resource belonging to another account returns `404 NOT_FOUND` (never `403 FORBIDDEN`), deliberately preventing tenant enumeration.

2. **At-Least-Once Delivery & Keyset Paging (D40)**:
   - Polling endpoints (`GET /accounts/:id/sales?updatedSince=...`) return rows ordered by `(updatedAt ASC, id ASC)` using an opaque base64url `cursor`.
   - Because rows may be updated while a client is in the middle of a cursor traversal, an edited row moves forward in time and will be delivered again.
   - **Client Contract:** Clients **must** upsert records locally by `id`.

3. **Idempotency by Reference**:
   - **Sales**: deduplicated by `(businessId, source, referenceId)`.
   - **Expenses & Invoices**: deduplicated by `(businessId, externalRef)`.
   - Submitting a duplicate request with the identical payload returns `200 OK` with the existing entity.
   - Submitting a duplicate reference with a differing payload returns `409 IDEMPOTENCY_CONFLICT` (or `409 DUPLICATE_EXTERNAL_REF`).

4. **Internal Namespace Reservation (`^WX-`)**:
   - The prefix `WX-` is strictly reserved for WallX internal numbering (e.g. invoice numbers `WX-202611-0000001` and automated sales reconciliations).
   - External clients sending `referenceId` or `externalRef` beginning with `WX-` will receive `400 INVALID_REFERENCE`.

5. **Safe Tax Defaults (Non-Fiscal Invoices)**:
   - This service is a commercial document pipeline, not a tax-invoicing service under VAT legislation.
   - Commercial invoices carry `vatRate = 0.00` and `vatAmount = 0.00`.
   - Generated PDFs display the required legal disclaimer:
     > *"This document is a commercial invoice, not a tax invoice under VAT legislation."*
   - Expense entities default to `isDeductible = false`.

---

## 2. Authentication & Credential Lifecycle

Authentication is based on opaque 64-character hex device bearer tokens. Tokens are transmitted in the HTTP `Authorization` header:

```http
Authorization: Bearer <device-token>
```

```
[ Merchant Setup ]
       │
       ▼
1. Operator issues 10-char Activation Code (CLI / Portal)
       │ (1-hour TTL, max 3 attempts)
       ▼
2. Device calls POST /api/external/v1/auth/activate { code }
       │
       ▼
3. Device receives 64-char Bearer Token (Stored in hardware / secure storage)
       │
       ├─────────────────────────────────────────┐
       ▼                                         ▼
[ Normal Traffic ]                        [ Scheduled / Urgent Rotation ]
Calls /accounts/:id/* with Bearer Token   Calls POST /accounts/:id/rotate
                                                 │
                                                 ▼
                                          New Token issued immediately
                                          Old Token remains valid for 24h grace window
```

### 2.1 Device Activation (`POST /auth/activate`)

When a merchant is provisioned, the operator issues a 10-character alphanumeric activation code (e.g., `AB12CD34EF`). The merchant device exchanges this code for a persistent bearer token:

```http
POST /api/external/v1/auth/activate HTTP/1.1
Content-Type: application/json

{
  "code": "AB12CD34EF"
}
```

**Response (200 OK):**
```json
{
  "data": {
    "token": "7a3b4f5c9e1d2a3b4f5c9e1d2a3b4f5c9e1d2a3b4f5c9e1d2a3b4f5c9e1d2a3b",
    "accountId": "c1234567-0000-0000-0000-000000000001",
    "businessName": "Acme Supermarket",
    "merchantId": "WOWO0000123"
  }
}
```

> [!WARNING]
> Activation codes expire after **1 hour** (`EXTERNAL_CODE_TTL_HOURS`) and are locked after **3 failed attempts** (`EXTERNAL_MAX_CODE_ATTEMPTS`). Codes are single-use; upon successful activation, the code is wiped. If a merchant loses the response, an operator must run `admin.ts issue-code --account <id>` to issue a fresh code.

### 2.2 Device Token Rotation (`POST /accounts/:id/rotate`)

Tokens should be rotated periodically or immediately upon suspected compromise:

```http
POST /api/external/v1/accounts/c1234567-0000-0000-0000-000000000001/rotate HTTP/1.1
Authorization: Bearer <current-token>
```

**Response (200 OK):**
```json
{
  "data": {
    "token": "9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e",
    "graceWindowHours": 24
  }
}
```

- **Grace Window**: The previous token remains accepted for **24 hours** (`EXTERNAL_ROTATE_GRACE_HOURS`) to prevent network partitions from dropping requests during client token swaps.
- After 24 hours, queries using the pre-rotate token return `401 TOKEN_EXPIRED`.

### 2.3 Explicit Revocation (`POST /accounts/:id/revoke`)

To immediately terminate a token with no grace window:

```http
POST /api/external/v1/accounts/c1234567-0000-0000-0000-000000000001/revoke HTTP/1.1
Authorization: Bearer <current-token>
```

**Response (200 OK):**
```json
{
  "data": {
    "revoked": true
  }
}
```

---

## 3. Data Synchronization & Pagination Guide

The service offers two paging strategies on all collection endpoints (`/sales`, `/expenses`, `/invoices`, `/customers`):

### 3.1 Browse Mode (Omitted `updatedSince`)
- **Ordering**: Descending by transaction or creation date: `(transactionDate DESC, id DESC)`.
- **Use Case**: UI presentation, recent transaction history, merchant POS query screens.

### 3.2 Sync Mode (Supplied `updatedSince`)
- **Ordering**: Strict ascending keyset order: `(updatedAt ASC, id ASC)`.
- **Query Parameter**: `updatedSince=2026-11-15T00:00:00.000Z` (ISO-8601 UTC timestamp).
- **Page Size**: Configurable via `limit=N` (default: 50, max: 250).

**First Sync Request:**
```http
GET /api/external/v1/accounts/c1234567-0000-0000-0000-000000000001/sales?updatedSince=2026-11-15T00:00:00.000Z&limit=50 HTTP/1.1
Authorization: Bearer <device-token>
```

**Response (200 OK):**
```json
{
  "data": [
    {
      "id": "e9b1d3f0-4a2c-4e89-9a1b-123456789abc",
      "referenceId": "POS-TX-99012",
      "amount": "4500.00",
      "source": "pos",
      "status": "confirmed",
      "isTaxable": true,
      "transactionDate": "2026-11-15T10:30:00.000Z",
      "createdAt": "2026-11-15T10:30:05.123Z",
      "updatedAt": "2026-11-15T10:30:05.123Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "nextCursor": "ZXlKaGJHY2lPaUpJVXpVeE1pSXNJblI1Y0NJNklrcFhWQ0o5...",
    "hasMore": true
  }
}
```

**Subsequent Page Requests:**
Pass the `nextCursor` value in the `cursor` query parameter:
```http
GET /api/external/v1/accounts/c1234567-0000-0000-0000-000000000001/sales?cursor=ZXlKaGJHY2lPaUpJVXpVeE1pSXNJblI1Y0NJNklrcFhWQ0o5... HTTP/1.1
Authorization: Bearer <device-token>
```
When `hasMore` is `false` or `nextCursor` is `null`, the sync stream is fully caught up.

### 3.3 Deletions & Tombstones Synchronization (`/deletions`)
When an entity is deleted, an immutable tombstone is recorded in `external_tombstones`. Clients synchronize deleted records via:

```http
GET /api/external/v1/accounts/c1234567-0000-0000-0000-000000000001/deletions?since=2026-11-15T00:00:00.000Z&limit=50 HTTP/1.1
Authorization: Bearer <device-token>
```

**Response (200 OK):**
```json
{
  "data": [
    {
      "id": "tomb-001",
      "entityType": "sale",
      "entityId": "e9b1d3f0-4a2c-4e89-9a1b-123456789abc",
      "createdAt": "2026-11-15T11:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false
  }
}
```
*Note: Tombstones are retained for 180 days (`EXTERNAL_TOMBSTONE_RETENTION_DAYS`) before scheduled automated purging.*

---

## 4. Invoicing Lifecycle & Commercial PDF Delivery

Invoices follow an explicit state machine:

```
[ Draft ] ────(PUT)────> [ Modified Draft ]
    │
 (POST /send)
    │
    ▼
 [ Sent ] ─────(POST /cancel)────> [ Cancelled ]
    │
(POST /mark-paid)
    │
    ▼
  [ Paid ]  (Atomically creates linked sale; irreversible)
```

1. **Create Draft (`POST /invoices`)**:
   - `lines` require `description`, `quantity`, `unitPrice`.
   - `discount` (if provided) cannot exceed `subtotal` (never automatically clamped).
   - Generates sequential invoice number: `WX-YYYYMM-XXXXXXX`.
2. **Issue Invoice (`POST /invoices/:id/send`)**:
   - Locks draft from further edits (`PUT` returns `409 INVOICE_NOT_EDITABLE`).
   - Sets `sentAt` timestamp. Idempotent: replaying returns 200.
3. **Mark Paid (`POST /invoices/:id/mark-paid`)**:
   - Validates that `paymentDate` is not in the future and not before `issueDate`.
   - In a single atomic database transaction, creates a linked `sales_transactions` row (`source = 'api'`, `isTaxable = false`, `referenceId = invoice.invoiceNumber`).
   - Replaying is idempotent and returns the existing linked sale.
4. **Commercial PDF Rendering (`GET /invoices/:id/pdf`)**:
   - Returns binary `application/pdf` with strict headers:
     - `Content-Disposition: attachment; filename="WX-YYYYMM-XXXXXXX.pdf"`
     - `Cache-Control: private, no-store, max-age=0`
     - `X-Robots-Tag: noindex, nofollow, noarchive`
5. **Public Capability Link (`POST /invoices/:id/pdf-link`)**:
   - Mints a 256-bit unguessable capability URL: `/api/external/v1/public/invoices/:shareToken/pdf`.
   - Allows merchant customers to view/download their PDF without login or bearer tokens.
   - Capability links expire after 30 days (`EXTERNAL_SHARE_LINK_TTL_DAYS`).
   - Regenerating a PDF link invalidates prior tokens immediately.

---

## 5. Comprehensive Error Catalogue

All error responses adhere to the unified RFC-7807-compatible error envelope:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Invalid request parameters",
    "requestId": "req_88a9c1e2-4f3b-4119-8827-82b8e7a9dffe",
    "details": {
      "fields": {
        "amount": "Must be a positive decimal string"
      }
    }
  }
}
```

| HTTP Status | Error Code | Description | Client Action |
|:---:|:---|:---|:---|
| **400** | `VALIDATION_FAILED` | Request schema violation (invalid type, format, or bounds). | Inspect `error.details.fields`, fix types/values, and resend. |
| **400** | `UNKNOWN_FIELD` | Body contains fields not in the schema (strict rejection). | Strip unrecognized fields from JSON payload. |
| **400** | `INVALID_DATE` | Date is malformed, in the future where disallowed, or due before issue. | Ensure ISO-8601 formatting (`YYYY-MM-DD`). |
| **400** | `INVALID_REFERENCE` | Reference matches reserved internal pattern `^WX-`. | Prefix partner references with a custom identifier (e.g. `WOWO-`). |
| **400** | `INVALID_DISCOUNT` | Invoice discount exceeds item subtotal. | Correct discount calculation before submission. |
| **401** | `INVALID_TOKEN` | Bearer token header missing, malformed, or hash unrecognized. | Re-authenticate using `/auth/activate` or check header. |
| **401** | `TOKEN_EXPIRED` | Pre-rotate token used past 24-hour grace window. | Update local credentials to latest rotated token. |
| **401** | `TOKEN_REVOKED` | Token was explicitly revoked or device suspended. | Operator must re-activate device via new activation code. |
| **402** | `SUBSCRIPTION_EXPIRED` | Partner subscription period has ended (`entitlement.expiresAt < now`). | Data routes locked. Access `/me` for status; contact account manager. |
| **403** | `PLATFORM_INACTIVE` | Partner integration is administratively suspended. | Global kill-switch active. Contact WallX operations. |
| **403** | `ACCOUNT_INACTIVE` | Specific merchant account has been deactivated. | Merchant kill-switch active. Contact support. |
| **404** | `NOT_FOUND` | Resource does not exist OR belongs to another account. | Verify ID and verify querying device owns the account scope. |
| **409** | `IDEMPOTENCY_CONFLICT` | Same `referenceId` sent with different amount or payload. | Generate new referenceId for distinct transactions. |
| **409** | `INVOICE_NOT_EDITABLE` | Attempted `PUT` on an invoice already in `sent` or `paid` status. | Invoices cannot be edited after issuance; cancel or issue credit note. |
| **409** | `INVOICE_NOT_DELETABLE` | Attempted `DELETE` on a non-draft invoice. | Only `draft` invoices may be deleted. |
| **409** | `INVOICE_PAID` | Attempted `cancel` on an invoice already marked `paid`. | Paid invoices are immutable. |
| **409** | `INVOICE_NOT_SENT` | Attempted `mark-paid` on an invoice still in `draft`. | Issue invoice via `/send` before marking paid. |
| **409** | `SALE_LINKED_TO_INVOICE` | Attempted `DELETE` on a sale linked to a paid invoice. | Linked reconciliation sales cannot be deleted independently. |
| **410** | `INVOICE_CANCELLED` | Attempted access to public PDF link for a cancelled invoice. | Display invoice cancelled banner to customer. |
| **429** | `RATE_LIMIT_EXCEEDED` | Account or IP rate limit window exhausted (100 req/min default). | Back off exponentially using `Retry-After` header. |
| **500** | `INTERNAL_ERROR` | Server-side unhandled exception. | Contact support with `error.requestId`. |
| **503** | `SERVICE_UNAVAILABLE` | Planned maintenance or global kill-switch active. | Retry after maintenance window. |

---

## 6. Summary Integration Checklist for Wowo Engineers

- [ ] Store device tokens securely in encrypted storage (hardware keystore / secure environment variable).
- [ ] Never hardcode or construct internal references matching `^WX-`.
- [ ] Implement exponential backoff for HTTP `429` with jitter.
- [ ] Implement local upsert logic (`id` primary key) for polling endpoints.
- [ ] Rotate device tokens periodically via `POST /accounts/:id/rotate` within the 24-hour grace window.
- [ ] Log and quote `error.requestId` in any technical support ticket.
