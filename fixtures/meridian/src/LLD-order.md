# order-service — Low-Level Design (LLD)

**Service:** order-service (Java)
**Owner:** Marcus Webb
**Datastore:** orders-db

## 1. Responsibilities

order-service owns the order lifecycle and orchestrates checkout. It is written
in Java and is owned by Marcus Webb. It coordinates the other services required
to turn a cart into a paid, confirmed order.

## 2. Dependencies

order-service depends on three other services to complete checkout:

| Dependency | Kind | Reason |
| --- | --- | --- |
| identity-service | CALLS | Verify the authenticated session before placing an order. |
| payment-service | CALLS | Charge the customer for the order. |
| platform-config | USES_LIBRARY | Resolve runtime configuration and feature flags. |

- order-service calls identity-service to verify the authenticated session
  before placing an order (CALLS).
- order-service calls payment-service to charge the customer (CALLS).
- order-service uses platform-config as an embedded configuration library to
  resolve runtime configuration (USES_LIBRARY).

## 3. Data Model

order-service persists every order in orders-db, the PostgreSQL system of record
for orders.

## 4. Checkout Orchestration

1. Validate the session via identity-service.
2. Reserve inventory and write a pending order to orders-db.
3. Charge via payment-service.
4. Commit the order atomically.

Marcus Webb owns the order-service runbook and is accountable for checkout
reliability.
