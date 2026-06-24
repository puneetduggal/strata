# ADR-M001 — Adopt JWT for stateless sessions

**Status:** Accepted
**Decision:** ADR-M001

## Context

Meridian needs a session mechanism that scales horizontally without a shared
session store. Server-side session tables became a bottleneck under load.

## Decision

Adopt JWT for stateless sessions. Sessions are represented as signed,
stateless JSON Web Tokens minted at login; no server-side session state is kept.
This decision (ADR-M001) is recorded with status Accepted.

## Rationale

Adopt JWT for stateless sessions because stateless tokens remove the shared
session store from the hot path, allowing every service to validate a session
locally from the token signature.

## Consequences

This decision affects identity-service: identity-service becomes the sole issuer
of JWTs and owns the signing keys and their rotation. ADR-M001 affects
identity-service directly, since identity-service must mint and sign every token.

**Status:** Accepted.
