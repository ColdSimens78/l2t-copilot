/**
 * Скелет загрузки панели (спека §0.5): строки показателя «дышат» на своих
 * местах — никакого модального спиннера, макет не прыгает до и после данных.
 */

export function PanelSkeleton({ label, rows }: { label: string; rows: string[] }) {
  return (
    <div aria-label={label} className="flex flex-1 animate-pulse flex-col gap-4 p-1 motion-reduce:animate-none" role="status">
      <p className="text-card-foreground text-sm">{label}…</p>
      {rows.map((row) => (
        <div key={row}>
          <div className="bg-muted-foreground/25 h-2.5 w-16 rounded" />
          <div className="bg-muted-foreground/15 mt-2 h-5 w-28 rounded" />
        </div>
      ))}
    </div>
  );
}
