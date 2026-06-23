# identity-service — Low-Level Design (LLD)

**Service:** identity-service (Go)
**Owner:** Priya Nair
**Datastore:** users-db

## 1. Responsibilities

identity-service authenticates users and mints JWT sessions. It is written in Go
and is owned by Priya Nair. It is the only service permitted to issue session
tokens for the platform.

## 2. Data Model

identity-service uses users-db as its system of record for user accounts and
credentials (USES). users-db is a PostgreSQL database holding the canonical
record for every user account and credential. No other service writes to
users-db directly.

## 3. Internal Components

| Component | Responsibility |
| --- | --- |
| credential-store | Reads and writes hashed credentials in users-db. |
| token-minter | Issues stateless JWT session tokens. |
| login-handler | Validates email and password, then mints a session. |

## 4. Login Flow

1. The login-handler receives an email and password.
2. credential-store validates them against users-db.
3. token-minter issues a stateless JWT.

Priya Nair owns the operational runbook for identity-service and is the primary
on-call engineer for users-db incidents.
