import { pgTable, serial, text, integer, boolean, jsonb, timestamp, customType, real, index } from "drizzle-orm/pg-core";

export const vector = customType<{ data: number[]; driverData: string }>({
  dataType() { return "vector(1024)"; },
  toDriver(v) { return `[${v.join(",")}]`; },
  fromDriver(v) { return (v as string).slice(1, -1).split(",").map(Number); },
});

// ---- Substrate ----
export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  rawText: text("raw_text").notNull().default(""),
  pageCount: integer("page_count").notNull().default(0),
  docType: text("doc_type"),          // "PRD","HLD","LLD","ADR","impl_plan","load_test_report","resume",...
  domain: text("domain"),             // "software_dev" | "hiring" | null
  title: text("title"),
  authors: jsonb("authors").$type<string[]>().default([]),
  docDate: text("doc_date"),
  summary: text("summary"),
  status: text("status").notNull().default("ingested"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

export const chunks = pgTable("chunks", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  page: integer("page").notNull().default(1),
  charStart: integer("char_start").notNull(),
  charEnd: integer("char_end").notNull(),
  text: text("text").notNull(),
  embedding: vector("embedding"),
});

// ---- Typed entity tables (Software Dev package) ----
const entityBase = { id: serial("id").primaryKey(), packageId: text("package_id").notNull().default("software_dev"), label: text("label").notNull() };
export const systems = pgTable("systems", { ...entityBase, description: text("description") });
export const features = pgTable("features", { ...entityBase, description: text("description"), systemId: integer("system_id") });
export const requirements = pgTable("requirements", { ...entityBase, text: text("text"), kind: text("kind"), metric: text("metric"), targetValue: text("target_value"), priority: text("priority") });
export const services = pgTable("services", { ...entityBase, language: text("language"), description: text("description"), owner: text("owner") });
export const datastores = pgTable("datastores", { ...entityBase, engine: text("engine"), purpose: text("purpose") });
export const tests = pgTable("tests", { ...entityBase, kind: text("kind"), description: text("description") });
export const loadTestResults = pgTable("load_test_results", { ...entityBase, scenario: text("scenario"), metric: text("metric"), observedValue: text("observed_value"), targetValue: text("target_value"), passed: boolean("passed") });
export const decisions = pgTable("decisions", { ...entityBase, status: text("status"), rationale: text("rationale") });
export const persons = pgTable("persons", { ...entityBase, role: text("role") });

// ---- Edges (one directed table for all relations) ----
export const edges = pgTable("edges", {
  id: serial("id").primaryKey(),
  packageId: text("package_id").notNull().default("software_dev"),
  relationType: text("relation_type").notNull(),  // PART_OF, SPECIFIES, IMPLEMENTS, DEPENDS_ON, USES, VERIFIES, VALIDATES, AFFECTS, OWNS, MENTIONS
  kind: text("kind"),                              // dependency "how": CALLS|CONSUMES_EVENT|READS_FROM|USES_LIBRARY|SHARES_DATA|CONFIG
  sourceType: text("source_type").notNull(),
  sourceId: integer("source_id").notNull(),
  targetType: text("target_type").notNull(),
  targetId: integer("target_id").notNull(),
  confidence: real("confidence").notNull().default(1),
  active: boolean("active").notNull().default(false),
  evidenceDocumentId: integer("evidence_document_id"),
  chunkId: integer("chunk_id"),
  charStart: integer("char_start"),
  charEnd: integer("char_end"),
  snippet: text("snippet"),
  attributes: jsonb("attributes").$type<Record<string, unknown>>().default({}),
}, (t) => ({ srcIdx: index("edges_src_idx").on(t.sourceType, t.sourceId), tgtIdx: index("edges_tgt_idx").on(t.targetType, t.targetId) }));

// ---- Provenance + search + orchestration ----
export const attributeProvenance = pgTable("attribute_provenance", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(), entityId: integer("entity_id").notNull(),
  field: text("field").notNull(), value: text("value"),
  documentId: integer("document_id").notNull(), charStart: integer("char_start").notNull(), charEnd: integer("char_end").notNull(),
  snippet: text("snippet").notNull(), confidence: real("confidence").notNull().default(1),
});

export const entityIndex = pgTable("entity_index", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(), entityId: integer("entity_id").notNull(),
  label: text("label").notNull(), aliases: jsonb("aliases").$type<string[]>().default([]),
  searchText: text("search_text").notNull(), embedding: vector("embedding"),
});

export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  stage: text("stage").notNull(),        // ingest|classify|index|extract|resolve|link|done
  status: text("status").notNull(),      // pending|running|completed|failed
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
