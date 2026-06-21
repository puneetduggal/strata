import { expect, test } from "vitest";
import { locateSpan } from "@/lib/provenance/locate";
test("locates exact snippet", () => {
  const raw = "The auth-service calls payment-service /charge.";
  const s = locateSpan(raw, "payment-service /charge");
  expect(raw.slice(s!.charStart, s!.charEnd)).toBe("payment-service /charge");
});
test("returns null for hallucinated snippet", () => {
  expect(locateSpan("abc def", "not present")).toBeNull();
});
