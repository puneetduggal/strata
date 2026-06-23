// 53px breadcrumb top bar. Pages render this as the first child of <main>.
// Recipe: catalog 01 §4a.

export function TopBar({
  leaf,
  root = "Helios workspace",
  right,
}: {
  leaf: string;
  root?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="h-[53px] flex-none border-b border-border flex items-center justify-between px-5">
      <div className="flex items-center gap-2 text-[13.5px]">
        <span className="text-text-3">{root}</span>
        <span className="text-text-3">/</span>
        <span className="font-semibold">{leaf}</span>
      </div>
      {right}
    </div>
  );
}
