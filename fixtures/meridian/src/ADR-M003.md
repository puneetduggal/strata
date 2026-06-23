# ADR-M003 — Idempotency keys for payment processing

**Status:** Accepted
**Decision:** ADR-M003

## Context

Network retries and client double-submits could otherwise charge a customer
twice. Payment processing must be safe to retry.

## Decision

Adopt idempotency keys for payment processing. Every charge request carries a
client-supplied idempotency key; a repeated key returns the original result
rather than issuing a new charge. This decision (ADR-M003) is recorded with
status Accepted.

## Rationale

Idempotency keys for payment processing make retries safe and guarantee
exactly-once financial effect even when the network duplicates a request.

## Consequences

This decision affects payment-service: payment-service must persist idempotency
keys alongside each ledger entry and short-circuit duplicate keys. ADR-M003
affects payment-service.

**Status:** Accepted.
