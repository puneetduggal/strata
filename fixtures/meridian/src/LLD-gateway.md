# api-gateway — Low-Level Design (LLD)

**Service:** api-gateway (Go)
**Owner:** Lena Ortiz

## 1. Responsibilities

api-gateway is the edge service that routes and rate-limits inbound API traffic.
It is written in Go and is owned by Lena Ortiz. Every external request enters the
platform through api-gateway.

## 2. Rate Limiting

api-gateway enforces per-tenant rate limiting at the edge. Each tenant is given a
token bucket; requests beyond the tenant's configured rate receive HTTP 429. Rate
limits are evaluated before any downstream routing so that abusive tenants cannot
exhaust shared inbound capacity.

| Component | Responsibility |
| --- | --- |
| router | Maps inbound routes to downstream services. |
| rate-limiter | Per-tenant token-bucket enforcement. |
| auth-filter | Attaches the verified session context to each request. |

## 3. Routing

api-gateway terminates TLS, authenticates the request, applies the per-tenant
rate limit, and then forwards to the appropriate downstream service.

Lena Ortiz owns the api-gateway runbook and the per-tenant rate-limit
configuration.
