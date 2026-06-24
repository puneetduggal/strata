# Load Test Report — order-checkout

**Result label:** order-checkout
**Scenario:** Checkout throughput
**Metric:** requests/second and p99 latency
**Validates:** REQ-M4

## 1. Objective

Validate that checkout meets the performance target defined by REQ-M4: checkout
sustains 10,000 requests/second at p99 < 250 ms. This load test (order-checkout)
validates REQ-M4.

## 2. Method

A 30-minute sustained-load run against a production-equivalent environment,
ramping concurrent virtual users until throughput plateaued. The checkout path
became payment-bound before reaching the target throughput.

## 3. Results

| Result | Scenario | Observed | Target | Verdict |
| --- | --- | --- | --- | --- |
| order-checkout | Checkout throughput | 6,000 requests/second at p99 400 ms | 10,000 requests/second at p99 < 250 ms | FAIL |

- **Observed value:** 6,000 requests/second at p99 400 ms.
- **Target value:** 10,000 requests/second at p99 < 250 ms.

## 4. Verdict

**FAIL.** order-checkout observed only 6,000 requests/second at p99 400 ms,
short of the target of 10,000 requests/second at p99 < 250 ms. REQ-M4 is not met;
remediation of the checkout path is required before launch.
