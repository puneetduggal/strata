import { describe, expect, test } from "vitest";
import { buildHighlights } from "@/lib/doc/highlight";

// Task 7 — buildHighlights segments a document's raw text into ordered, non-overlapping
// pieces for the doc viewer. The span that matches the page's ?start&end gets tier "active"
// (accent glow); every other located span gets tier "passive" with its entityType (the
// --e-* color); the gaps between spans are tier "none". Reassembling the segment texts in
// order must reproduce rawText exactly (lossless).

const RAW = "auth-service is owned by Alice Chen. It calls token-service. It uses user-db.";

describe("buildHighlights (pure)", () => {
  test("no spans → a single 'none' segment equal to the whole text", () => {
    const segs = buildHighlights(RAW, [], null);
    expect(segs).toEqual([{ text: RAW, tier: "none" }]);
    expect(segs.map((s) => s.text).join("")).toBe(RAW);
  });

  test("a passive span carries its entityType; gaps are 'none'; reassembly is lossless", () => {
    // "Alice Chen" is at [24, 34)
    const start = RAW.indexOf("Alice Chen");
    const end = start + "Alice Chen".length;
    const segs = buildHighlights(RAW, [{ charStart: start, charEnd: end, entityType: "Person" }], null);

    expect(segs).toEqual([
      { text: RAW.slice(0, start), tier: "none" },
      { text: "Alice Chen", tier: "passive", entityType: "Person" },
      { text: RAW.slice(end), tier: "none" },
    ]);
    expect(segs.map((s) => s.text).join("")).toBe(RAW);
  });

  test("the span matching activeSpan (by start/end) gets tier 'active'; others stay passive", () => {
    const aStart = RAW.indexOf("Alice Chen");
    const aEnd = aStart + "Alice Chen".length;
    const cStart = RAW.indexOf("calls token-service");
    const cEnd = cStart + "calls token-service".length;

    const segs = buildHighlights(
      RAW,
      [
        { charStart: aStart, charEnd: aEnd, entityType: "Person" },
        { charStart: cStart, charEnd: cEnd, entityType: "Service" },
      ],
      { start: cStart, end: cEnd },
    );

    const active = segs.find((s) => s.tier === "active");
    expect(active?.text).toBe("calls token-service");
    // the active span should NOT also carry a passive entityType-driven tier
    const passive = segs.filter((s) => s.tier === "passive");
    expect(passive).toHaveLength(1);
    expect(passive[0]).toEqual({ text: "Alice Chen", tier: "passive", entityType: "Person" });
    expect(segs.map((s) => s.text).join("")).toBe(RAW);
  });

  test("adjacent spans split into back-to-back segments with no 'none' gap between them", () => {
    // two touching spans: [0,4)="auth" and [4,12)="-service" (adjacent, share boundary 4)
    const segs = buildHighlights(
      RAW,
      [
        { charStart: 0, charEnd: 4, entityType: "Service" },
        { charStart: 4, charEnd: 12, entityType: "Service" },
      ],
      null,
    );
    expect(segs[0]).toEqual({ text: "auth", tier: "passive", entityType: "Service" });
    expect(segs[1]).toEqual({ text: "-service", tier: "passive", entityType: "Service" });
    expect(segs[2].tier).toBe("none"); // the remainder of the doc
    expect(segs.map((s) => s.text).join("")).toBe(RAW);
  });

  test("overlapping spans: the first-claimed span wins the overlap; reassembly stays lossless", () => {
    // span A [0,12)="auth-service", span B [5,20) overlaps A. A is listed first → it claims
    // its full range; B only contributes the non-overlapping tail [12,20).
    const segs = buildHighlights(
      RAW,
      [
        { charStart: 0, charEnd: 12, entityType: "Service" },
        { charStart: 5, charEnd: 20, entityType: "Person" },
      ],
      null,
    );
    // no character is covered twice; the texts still reassemble to RAW
    expect(segs.map((s) => s.text).join("")).toBe(RAW);
    // first segment is A's full claim
    expect(segs[0]).toEqual({ text: "auth-service", tier: "passive", entityType: "Service" });
    // B's surviving slice starts at 12
    const b = segs.find((s) => s.entityType === "Person");
    expect(b?.text).toBe(RAW.slice(12, 20));
  });

  test("activeSpan with no matching located span still highlights that range as active", () => {
    const start = RAW.indexOf("user-db");
    const end = start + "user-db".length;
    const segs = buildHighlights(RAW, [], { start, end });
    const active = segs.find((s) => s.tier === "active");
    expect(active?.text).toBe("user-db");
    expect(segs.map((s) => s.text).join("")).toBe(RAW);
  });

  test("out-of-range / inverted spans are ignored; text is preserved", () => {
    const segs = buildHighlights(
      RAW,
      [
        { charStart: -5, charEnd: 3 }, // negative start
        { charStart: 10, charEnd: 5 }, // inverted
        { charStart: 1000, charEnd: 2000 }, // beyond length
      ],
      null,
    );
    expect(segs).toEqual([{ text: RAW, tier: "none" }]);
  });
});
