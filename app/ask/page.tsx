import Link from "next/link";
import AskBox from "@/components/ask-box";

// Task 18 — the ask surface. A thin server page that frames the client AskBox.
export default function AskPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Back
      </Link>
      <header className="mt-4 mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Ask</h1>
        <p className="mt-1 text-sm text-gray-500">
          Ask a question about the system. Answers cite the graph edges or document passages they
          came from.
        </p>
      </header>
      <AskBox />
    </main>
  );
}
