import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { documents } from "@/lib/db/schema";
import { extractStructured } from "@/lib/llm/claude";
import { SOFTWARE_PACKAGE } from "@/lib/packages/software";
import { markDoc } from "./jobs";

const ClassifySchema = z.object({
  domain: z.string(),
  docType: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  docDate: z.string(),
  summary: z.string(),
});
type Classification = z.infer<typeof ClassifySchema>;

const DOC_TYPE_HINTS: Record<string, string> = {
  PRD: "PRD = product requirements document",
  HLD: "HLD = high-level design",
  LLD: "LLD = low-level design",
  ARD: "ARD = architecture/requirements DESIGN doc (distinct from ADR)",
  ADR: "ADR = architecture DECISION record (a single decision; distinct from ARD)",
  impl_plan: "impl_plan = implementation plan",
  load_test_report: "load_test_report = load/performance test report",
};

const SYSTEM = `You classify a single document for a documents→knowledge-graph system.

Determine its domain, document type, title, authors, date, and a one-paragraph summary.

The software-engineering document types are:
${SOFTWARE_PACKAGE.docTypes.map((t) => `- ${DOC_TYPE_HINTS[t] ?? t}`).join("\n")}

Note: ARD is an architecture/requirements DESIGN doc; ADR is an architecture DECISION record — they are different, do not confuse them.

If the document is a software-engineering document, set domain to "software_dev" and pick the closest docType from the list above.
If this is NOT a software-engineering document, set domain to its best-guess domain (e.g. "hiring" for a resume/job posting) — NOT software_dev — and set docType to the most fitting label for that domain.

Fields: leave authors as [] if none are stated; use an empty string for title/docDate/summary you cannot determine.`;

export async function classifyDoc(documentId: number): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc) throw new Error(`classify: document ${documentId} not found`);

  const c: Classification = await extractStructured<Classification>({
    system: SYSTEM,
    user: `Filename: ${doc.filename}\n\n---\n${doc.rawText}`,
    schema: ClassifySchema,
  });

  await db
    .update(documents)
    .set({
      domain: c.domain,
      docType: c.docType,
      title: c.title,
      authors: c.authors,
      docDate: c.docDate,
      summary: c.summary,
    })
    .where(eq(documents.id, documentId));

  await markDoc(documentId, c.domain === "software_dev" ? "classified" : "unrouted");
}
