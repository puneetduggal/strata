# Load Test Report — identity-login

**Result label:** identity-login
**Scenario:** Login throughput
**Metric:** requests/second and p99 latency
**Validates:** REQ-M5

## 1. Objective

Validate that login meets the performance target defined by REQ-M5: login
sustains 15,000 requests/second at p99 < 150 ms. This load test (identity-login)
validates REQ-M5.

## 2. Method

A 30-minute sustained-load run against a production-equivalent environment,
ramping concurrent virtual users until throughput plateaued.

## 3. Results

| Result | Scenario | Observed | Target | Verdict |
| --- | --- | --- | --- | --- |
| identity-login | Login throughput | 16,000 requests/second at p99 120 ms | 15,000 requests/second at p99 < 150 ms | PASS |

- **Observed value:** 16,000 requests/second at p99 120 ms.
- **Target value:** 15,000 requests/second at p99 < 150 ms.

## 4. Verdict

**PASS.** identity-login observed 16,000 requests/second at p99 120 ms, exceeding
the target of 15,000 requests/second at p99 < 150 ms. REQ-M5 is met.
