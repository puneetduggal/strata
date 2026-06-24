# Implementation Plan — Gateway

**Scope:** api-gateway work to deliver per-tenant rate limiting.

## 1. Goals

This plan delivers edge rate limiting. api-gateway implements the per-tenant
rate-limiting requirement.

## 2. Requirement Ownership (IMPLEMENTS)

| Requirement | Text | Implemented by |
| --- | --- | --- |
| REQ-M8 | The gateway enforces per-tenant rate limiting. | api-gateway |

- api-gateway implements REQ-M8: the gateway enforces per-tenant rate limiting.

## 3. Test Plan

| Test | Kind | Description | Verifies |
| --- | --- | --- | --- |
| T-gateway-ratelimit | integration | Verifies per-tenant rate limiting. | REQ-M8 |

- T-gateway-ratelimit is an integration test that verifies per-tenant rate
  limiting. T-gateway-ratelimit verifies REQ-M8.

## 4. Milestones

1. Implement the per-tenant token bucket in api-gateway (REQ-M8).
2. Return HTTP 429 on limit breach with a Retry-After header.
3. Make per-tenant limits configurable at runtime.
