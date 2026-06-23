import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Strata",
  description: "Documents → queryable knowledge graph, every answer cited to source",
};

const noFlash = `(function(){try{var t=localStorage.getItem('strata-theme');var a=localStorage.getItem('strata-accent');var e=document.documentElement;if(t==='dark')e.setAttribute('data-theme','dark');if(a)e.setAttribute('data-accent',a);}catch(_){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: noFlash }} /></head>
      <body className="bg-canvas text-text font-sans antialiased">{children}</body>
    </html>
  );
}
