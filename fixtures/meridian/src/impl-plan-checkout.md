# Implementation Plan — Checkout

**Scope:** order-service and payment-service work to deliver atomic, idempotent checkout.

## 1. Goals

This plan delivers the checkout requirements. order-service implements the order
and throughput requirements; payment-service implements the idempotency
requirement.

## 2. Requirement Ownership (IMPLEMENTS)

| Requirement | Text | Implemented by |
| --- | --- | --- |
| REQ-M3 | Checkout completes the order and payment atomically. | order-service |
| REQ-M4 | Checkout must handle a sustained 10,000 orders/sec, with 99th-percentile response time under 250 ms. | order-service |
| REQ-M7 | Payment processing is idempotent. | payment-service |

- order-service implements REQ-M3: checkout completes the order and payment
  atomically.
- order-service implements REQ-M4: checkout must handle a sustained 10,000
  orders/sec, with 99th-percentile response time under 250 ms.
- payment-service implements REQ-M7: payment processing is idempotent.

## 3. Test Plan

| Test | Kind | Description | Verifies |
| --- | --- | --- | --- |
| T-checkout | integration | Verifies atomic checkout. | REQ-M3 |
| T-payment-idempotency | integration | Verifies idempotent payment retries. | REQ-M7 |

- T-checkout is an integration test that verifies atomic checkout. T-checkout
  verifies REQ-M3.
- T-payment-idempotency is an integration test that verifies idempotent payment
  retries. T-payment-idempotency verifies REQ-M7.

## 4. Milestones

1. order-service writes a pending order and commits atomically (REQ-M3).
2. payment-service enforces idempotency keys (REQ-M7).
3. Load-harden the checkout path toward REQ-M4.
