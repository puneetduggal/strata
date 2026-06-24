# ADR-M002 — Event-driven order notifications

**Status:** Accepted
**Decision:** ADR-M002

## Context

Customers must be told about order lifecycle events (placed, paid, shipped)
without coupling that work to the synchronous checkout path.

## Decision

Adopt event-driven order notifications. order-service emits an event for every
order lifecycle change, and notification-service reacts to those events
asynchronously. This decision (ADR-M002) is recorded with status Accepted.

## Rationale

Event-driven order notifications keep the checkout path fast and let
notification-service scale independently of order-service.

## Consequences

- This decision affects order-service: order-service must publish a durable event
  for every lifecycle transition. ADR-M002 affects order-service.
- This decision affects notification-service: notification-service consumes
  order-service's events and turns them into customer messages. ADR-M002 affects
  notification-service.
- In dependency terms, notification-service depends on order-service:
  notification-service subscribes to and consumes the order-lifecycle events that
  order-service publishes. This is a CONSUMES_EVENT dependency from
  notification-service to order-service — notification-service depends on
  order-service for those events.

**Status:** Accepted.
