# Implementation Plan — Notifications

**Scope:** notification-service work to deliver order lifecycle notifications.
**Owner:** Marcus Webb

## 1. Goals

This plan delivers order notifications. notification-service implements the
at-least-once delivery requirement and is owned by Marcus Webb.

## 2. Requirement Ownership (IMPLEMENTS)

| Requirement | Text | Implemented by |
| --- | --- | --- |
| REQ-M6 | Order events are delivered at least once. | notification-service |

- notification-service implements REQ-M6: order events are delivered at least
  once.

## 3. Ownership (OWNS)

Marcus Webb owns notification-service. Marcus Webb is the primary on-call
engineer for notification delivery.

## 4. Data and Dependencies

- notification-service depends on order-service and consumes its events
  (CONSUMES_EVENT): notification-service subscribes to the order lifecycle events
  that order-service publishes, so notification-service depends on order-service
  for those events.
- order-service shares the orders-db datastore with notification-service
  (SHARES_DATA): order-service depends on notification-service through the shared
  orders-db, which both services read.
- notification-service reads order state directly from the shared orders-db.
- notification-service reads payment status from payment-service (READS_FROM):
  notification-service reads from payment-service to know whether an order has
  been paid before sending a "payment confirmed" message.

## 5. Milestones

1. Consume order lifecycle events and read orders-db for full order context.
2. notification-service reads from payment-service for payment status.
3. Guarantee at-least-once delivery (REQ-M6) with retry and dead-lettering.
