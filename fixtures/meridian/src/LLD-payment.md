# payment-service — Low-Level Design (LLD)

**Service:** payment-service (Go)
**Owner:** (unassigned)
**Datastore:** payments-ledger-db

## 1. Responsibilities

payment-service charges and refunds payments idempotently. It is written in Go.
It is the only first-party service authorized to move money, and it records every
transaction in an append-only ledger.

## 2. Dependencies

| Dependency | Kind | Reason |
| --- | --- | --- |
| identity-service | CALLS | Verify the paying account before charging. |

- payment-service calls identity-service to verify the paying account before a
  charge is authorized (CALLS).

## 3. Data Model

payment-service writes to payments-ledger-db, a PostgreSQL append-only ledger of
payment transactions. Entries are never updated in place; refunds are recorded as
new compensating ledger entries.

## 4. Idempotency

Every charge carries an idempotency key so that retries are safe. A duplicate key
returns the original ledger result rather than charging twice.
