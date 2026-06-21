import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Strata",
  description: "Document to knowledge graph",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
