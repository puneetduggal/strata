import { expect, test } from "vitest";
import { SOFTWARE_PACKAGE } from "@/lib/packages/software"; // exists after Task 6; stub now
test("software package id", () => {
  expect(SOFTWARE_PACKAGE.id).toBe("software_dev");
});
