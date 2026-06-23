import EntityTable from "@/components/entity-table";

// Entities — faceted entity browser (catalog 06). The 60px icon rail and the
// <main> wrapper live in the global app shell (app/layout.tsx). The TopBar
// (with the "Filter entities…" pill) and the facet-rail + table body split are
// owned by the client EntityTable so the pill can drive client-side filtering.
export default function TablePage() {
  return <EntityTable />;
}
