CREATE TABLE "attribute_provenance" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"field" text NOT NULL,
	"value" text,
	"document_id" integer NOT NULL,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"snippet" text NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"page" integer DEFAULT 1 NOT NULL,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(1024)
);
--> statement-breakpoint
CREATE TABLE "datastores" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_id" text DEFAULT 'software_dev' NOT NULL,
	"label" text NOT NULL,
	"engine" text,
	"purpose" text
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_id" text DEFAULT 'software_dev' NOT NULL,
	"label" text NOT NULL,
	"status" text,
	"rationale" text
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"raw_text" text DEFAULT '' NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"doc_type" text,
	"domain" text,
	"title" text,
	"authors" jsonb DEFAULT '[]'::jsonb,
	"doc_date" text,
	"summary" text,
	"status" text DEFAULT 'ingested' NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edges" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_id" text DEFAULT 'software_dev' NOT NULL,
	"relation_type" text NOT NULL,
	"kind" text,
	"source_type" text NOT NULL,
	"source_id" integer NOT NULL,
	"target_type" text NOT NULL,
	"target_id" integer NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"evidence_document_id" integer,
	"chunk_id" integer,
	"char_start" integer,
	"char_end" integer,
	"snippet" text,
	"attributes" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "entity_index" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"label" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb,
	"search_text" text NOT NULL,
	"embedding" vector(1024)
);
--> statement-breakpoint
CREATE TABLE "features" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_id" text DEFAULT 'software_dev' NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"system_id" integer
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"stage" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "load_test_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_id" text DEFAULT 'software_dev' NOT NULL,
	"label" text NOT NULL,
	"scenario" text,
	"metric" text,
	"observed_value" text,
	"target_value" text,
	"passed" boolean
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_id" text DEFAULT 'software_dev' NOT NULL,
	"label" text NOT NULL,
	"role" text
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_id" text DEFAULT 'software_dev' NOT NULL,
	"label" text NOT NULL,
	"text" text,
	"kind" text,
	"metric" text,
	"target_value" text,
	"priority" text
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_id" text DEFAULT 'software_dev' NOT NULL,
	"label" text NOT NULL,
	"language" text,
	"description" text,
	"owner" text
);
--> statement-breakpoint
CREATE TABLE "systems" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_id" text DEFAULT 'software_dev' NOT NULL,
	"label" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"package_id" text DEFAULT 'software_dev' NOT NULL,
	"label" text NOT NULL,
	"kind" text,
	"description" text
);
--> statement-breakpoint
CREATE INDEX "edges_src_idx" ON "edges" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "edges_tgt_idx" ON "edges" USING btree ("target_type","target_id");