export function locateSpan(rawText: string, snippet: string) {
  const s = snippet.trim();
  if (!s) return null;
  let i = rawText.indexOf(s);
  if (i >= 0) return { charStart: i, charEnd: i + s.length };
  // whitespace-normalized fallback: collapse runs of whitespace
  const norm = (x: string) => x.replace(/\s+/g, " ");
  const ni = norm(rawText).indexOf(norm(s));
  if (ni < 0) return null;
  // map normalized index back: re-scan rawText counting normalized chars
  let raw = 0, normCount = 0, start = -1;
  const target = norm(s).length;
  const normRaw = norm(rawText);
  void normRaw;
  for (; raw < rawText.length; raw++) {
    const isWs = /\s/.test(rawText[raw]);
    const prevWs = raw > 0 && /\s/.test(rawText[raw - 1]);
    if (isWs && prevWs) continue;
    if (normCount === ni) start = raw;
    normCount++;
    if (start >= 0 && normCount - ni >= target) return { charStart: start, charEnd: raw + 1 };
  }
  return null;
}
