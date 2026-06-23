// Static Frame-07 explainer: "Off-domain & extensibility".
// A before→after concept diagram — neutral substrate card (green-✓ / grey-×
// capability rows) → accent "register package" arrow → accent "lights up" card
// with entity/relation chips. All copy verbatim from catalog 07 §3–§5, §7.
// Not a route; folded into the dashboard as an about-extensibility panel.

const OK_SWATCH = "color-mix(in srgb, var(--ok) 14%, var(--surface))";

function CapabilityRow({
  ok,
  lead,
  cont,
}: {
  ok: boolean;
  lead: string;
  cont: string;
}) {
  return (
    <div className="flex items-center gap-[11px]">
      <span
        className="flex h-6 w-6 items-center justify-center rounded-[7px] text-[13px]"
        style={
          ok
            ? { background: OK_SWATCH, color: "var(--ok)" }
            : { background: "var(--surface-2)", color: "var(--text-3)" }
        }
      >
        {ok ? "✓" : "×"}
      </span>
      <span className={`text-[12.5px] ${ok ? "" : "text-text-3"}`}>
        <span className="font-semibold">{lead}</span>{" "}
        <span className={ok ? "text-text-2" : ""}>{cont}</span>
      </span>
    </div>
  );
}

function EntityChip({ label }: { label: string }) {
  return (
    <span className="rounded-[7px] border border-border-2 bg-surface px-[10px] py-[5px] font-mono text-[11px]">
      {label}
    </span>
  );
}

function RelationChip({ label }: { label: string }) {
  return (
    <span
      className="rounded-[7px] bg-surface px-[10px] py-[5px] font-mono text-[11px] text-accent"
      style={{ border: "1px dashed var(--accent-line)" }}
    >
      {label}
    </span>
  );
}

export default function ExtensibilityPanel() {
  return (
    <section className="mt-[28px]">
      {/* Section header (catalog 07 §1) */}
      <div className="mb-[14px] flex items-baseline gap-[12px]">
        <span className="font-mono text-[12px] font-semibold text-accent">07</span>
        <span className="text-[15px] font-semibold">Off-domain &amp; extensibility</span>
        <span className="text-[13px] text-text-2">
          A r&eacute;sum&eacute; isn&apos;t software-dev &mdash; it&apos;s still classified,
          chunked &amp; embedded into the shared substrate. It just has no graph until a
          package exists.
        </span>
      </div>

      {/* Frame card (catalog 07 §2) */}
      <div className="overflow-hidden rounded-[13px] border border-border-2 bg-app shadow">
        <div className="flex flex-col gap-[28px] p-[30px_36px] md:flex-row">
          {/* LEFT — In the substrate today (catalog 07 §3) */}
          <div className="flex flex-1 flex-col">
            <div className="mb-[12px] font-mono text-[10px] uppercase tracking-[.05em] text-text-3">
              In the substrate today
            </div>
            <div className="flex flex-1 flex-col rounded-[12px] border border-border bg-surface p-[18px]">
              <div className="mb-[14px] flex items-center justify-between">
                <span className="font-mono text-[14px] font-semibold">resume.txt</span>
                <span
                  className="rounded-[20px] px-[9px] py-[3px] font-mono text-[10.5px] font-semibold text-warn"
                  style={{
                    background: "color-mix(in srgb, var(--warn) 13%, var(--surface))",
                  }}
                >
                  domain: hiring
                </span>
              </div>
              <div className="flex flex-col gap-[10px]">
                <CapabilityRow ok lead="Classified" cont="— doc_type: resume · domain: hiring" />
                <CapabilityRow ok lead="Chunked & embedded" cont="— 4 chunks · pgvector" />
                <CapabilityRow ok lead="RAG-queryable" cont="— answerable via free-text fallback" />
                <CapabilityRow ok={false} lead="No graph" cont="— no Hiring package registered" />
              </div>
            </div>
          </div>

          {/* CENTER — register package arrow (catalog 07 §4) */}
          <div className="flex flex-none flex-col items-center justify-center gap-[8px] md:w-[60px]">
            <div className="text-center font-mono text-[9.5px] leading-[1.3] text-text-3">
              register
              <br />
              package
            </div>
            <svg
              width="40"
              height="24"
              viewBox="0 0 40 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="rotate-90 md:rotate-0"
            >
              <path d="M2 12h32M26 5l8 7-8 7" />
            </svg>
          </div>

          {/* RIGHT — It lights up (catalog 07 §5) */}
          <div className="flex flex-1 flex-col">
            <div className="mb-[12px] font-mono text-[10px] uppercase tracking-[.05em] text-accent">
              It lights up — no pipeline change
            </div>
            <div
              className="flex flex-1 flex-col rounded-[12px] p-[18px]"
              style={{
                border: "1px solid var(--accent-line)",
                background: "color-mix(in srgb, var(--accent) 5%, var(--surface))",
              }}
            >
              <p className="mb-[16px] text-[13px] leading-[1.6] text-text-2">
                Adding a domain is{" "}
                <span className="font-semibold text-text">
                  registering a code-defined package
                </span>{" "}
                (entity types + relations + competency questions) &mdash; not rewriting the
                pipeline. The same r&eacute;sum&eacute; that sat in the substrate would resolve
                into typed nodes and edges.
              </p>
              <div className="flex flex-wrap gap-[7px]">
                <EntityChip label="Candidate" />
                <EntityChip label="Role" />
                <EntityChip label="Skill" />
                <EntityChip label="Company" />
                <RelationChip label="HAS_SKILL →" />
                <RelationChip label="WORKED_AT →" />
              </div>
              <div className="mt-auto pt-[14px] font-mono text-[10.5px] text-text-3">
                // lib/packages/hiring.ts — future work
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
