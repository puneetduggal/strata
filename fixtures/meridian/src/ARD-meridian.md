# Meridian Platform — Architecture Review Document (ARD)

**System:** Meridian — the company's e-commerce/marketplace platform.
**Reviewers:** Architecture Review Board
**Purpose:** Independent review of the proposed Meridian architecture prior to build.

## 1. Scope of Review

This architecture review assesses the proposed service decomposition, data
ownership, and external integration boundaries for the Meridian platform. The
board reviewed the design for soundness, identified risks, and recorded its
findings. This is a review of an existing proposal; it does not itself decide
the architecture.

## 2. Services Reviewed

The board reviewed the following first-party services that make up Meridian:

| Service | Language | Reviewed Concern |
| --- | --- | --- |
| api-gateway | Go | Edge service that routes and rate-limits inbound API traffic. |
| identity-service | Go | Authenticates users and mints JWT sessions. |
| order-service | Java | Owns the order lifecycle and orchestrates checkout. |
| payment-service | Go | Charges and refunds payments idempotently. |

The board confirmed that api-gateway is the single inbound edge, that
identity-service is the only issuer of sessions, that order-service is the
orchestrator of checkout, and that payment-service owns money movement.

### 2.1 External integration boundary

The review draws a sharp line between the first-party payment-service and the
third-party edge proxy. **payments-gateway-service** is a third-party
payment-network edge proxy and is distinct from payment-service: it fronts the
external card networks, whereas payment-service is Meridian's own service that
charges and refunds payments idempotently. The board flagged that these two must
never be conflated in ownership or on-call rotation.

## 3. Datastores Reviewed

The board reviewed the three datastores backing Meridian:

- **users-db** — system of record for user accounts and credentials.
- **orders-db** — system of record for orders.
- **payments-ledger-db** — append-only ledger of payment transactions.

The reviewers found the one-store-per-domain split acceptable and noted that any
future datastore sharing would require its own architecture decision.

## 4. Key Decisions Reviewed

The board reviewed and endorsed the platform's standing decisions: stateless JWT
sessions issued by identity-service; idempotent payment processing in
payment-service; an event-driven approach to order lifecycle handling owned by
order-service; and consolidation of order data on a shared orders datastore. Each
of these is recorded in its own decision record; this review only confirms they
are mutually consistent.

## 5. Findings and Risks

1. The api-gateway is a single point of inbound failure; the board recommends
   active-active deployment.
2. The boundary between payment-service and payments-gateway-service is correct
   but operationally subtle; clear runbooks are required.
3. Shared ownership of order data is acceptable only with strict schema
   governance.

**Review outcome:** Architecture approved with the recommendations above.
