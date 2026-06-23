# ADR-M004 — Consolidate on a shared orders datastore

**Status:** Accepted
**Decision:** ADR-M004

## Context

notification-service originally maintained its own copy of order state, which
drifted from the authoritative record in order-service. Reconciliation was
fragile and a frequent source of incidents.

## Decision

Consolidate on a shared orders datastore. Both order-service and
notification-service read order state from the single shared orders-db rather
than keeping separate copies. This decision (ADR-M004) is recorded with status
Accepted.

## Rationale

Consolidate on a shared orders datastore to eliminate state drift: a single
source of truth removes the reconciliation logic entirely.

## Consequences

- This decision affects order-service: order-service remains the writer of
  orders-db. ADR-M004 affects order-service.
- This decision affects notification-service: notification-service now uses
  orders-db directly as a reader (USES). ADR-M004 affects notification-service.
- order-service and notification-service share the orders-db datastore
  (SHARES_DATA): order-service shares its order data with notification-service
  through the shared orders-db.

**Status:** Accepted.
