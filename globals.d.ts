// Ambient declaration so TypeScript accepts side-effect CSS imports
// (e.g. `import "./globals.css"` in app/layout.tsx). Next.js's webpack handles
// the actual import; this only satisfies `tsc --noEmit` / `next build` type-check.
declare module "*.css";
