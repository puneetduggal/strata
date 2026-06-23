# Meridian Platform — High-Level Design (HLD)

**System:** Meridian — the company's e-commerce/marketplace platform.

## Services and Owners

| Service | Language | Owner | Datastore |
| --- | --- | --- | --- |
| api-gateway | Go | Lena Ortiz | — |
| identity-service | Go | Priya Nair | users-db |
| order-service | Java | Marcus Webb | orders-db |
| payment-service | Go | (unassigned) | payments-ledger-db |
| platform-config | Go | Lena Ortiz | — |

- **api-gateway** (Go): edge service that routes and rate-limits inbound API traffic.
- **identity-service** (Go): authenticates users and mints JWT sessions.
- **order-service** (Java): owns the order lifecycle and orchestrates checkout.
- **payment-service** (Go): charges and refunds payments idempotently.
- **platform-config** (Go): service discovery and runtime configuration.

A separate third-party edge proxy, payments-gateway-service, fronts the external
card networks and is distinct from payment-service. payments-gateway-service is
not a Meridian-owned service; it is a third-party payment-network edge proxy.

## Datastores

- users-db (PostgreSQL): system of record for user accounts and credentials.
- orders-db (PostgreSQL): system of record for orders.
- payments-ledger-db (PostgreSQL): append-only ledger of payment transactions.

## Data Ownership (USES)

- identity-service uses users-db as its system of record (USES).
- order-service uses orders-db as its system of record (USES).
- payment-service uses payments-ledger-db as its append-only ledger (USES).

## Service Dependencies

- api-gateway calls identity-service for auth on every request (CALLS).
- api-gateway routes order traffic to order-service (CALLS).
- api-gateway reads runtime configuration from platform-config (CONFIG).

## Ownership (OWNS)

Priya Nair owns identity-service. Marcus Webb owns order-service. Lena Ortiz owns
api-gateway. Lena Ortiz also owns platform-config.

Priya Nair, Marcus Webb, and Lena Ortiz are the engineers accountable for these
services on the Meridian platform.
