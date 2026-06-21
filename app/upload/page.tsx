import Link from "next/link";
import UploadDropzone from "@/components/upload-dropzone";

export default function UploadPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Upload documents</h1>
          <p className="mt-1 text-sm text-gray-500">
            Each file is ingested, classified, then indexed into the knowledge graph.
          </p>
        </div>
        <Link href="/" className="text-sm font-medium text-blue-600 hover:underline">
          Dashboard →
        </Link>
      </div>
      <UploadDropzone />
    </main>
  );
}
