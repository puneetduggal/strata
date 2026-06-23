import { TopBar } from "@/components/shell/top-bar";
import ProcessingDashboard from "@/components/processing-dashboard";
import ExtensibilityPanel from "@/components/extensibility-panel";

// Home / Pipeline dashboard (catalog 02 + 07). The 60px icon rail and the
// <main> wrapper live in the global app shell (app/layout.tsx).
export default function Home() {
  return (
    <>
      <TopBar
        leaf="Pipeline"
        right={
          <div className="flex items-center gap-[7px]">
            <span className="h-[7px] w-[7px] rounded-full bg-ok" />
            <span className="font-mono text-[11px] text-text-2">
              polling /api/status · 1.5s
            </span>
          </div>
        }
      />
      <div className="flex-1 overflow-auto p-[24px_28px]">
        <ProcessingDashboard />
        <ExtensibilityPanel />
      </div>
    </>
  );
}
