import { TopBar } from "@/components/shell/top-bar";
import UploadDropzone from "@/components/upload-dropzone";

// Upload & ingest (catalog 01). The 60px icon rail and the <main> wrapper
// live in the global app shell (app/layout.tsx).
export default function UploadPage() {
  return (
    <>
      <TopBar
        leaf="Upload"
        right={
          <span className="font-mono text-[11px] text-text-3">
            single workspace · no auth (v1)
          </span>
        }
      />
      <div className="flex-1 overflow-auto p-[26px_30px]">
        <div className="grid h-full grid-cols-2 gap-6">
          <UploadDropzone />
        </div>
      </div>
    </>
  );
}
