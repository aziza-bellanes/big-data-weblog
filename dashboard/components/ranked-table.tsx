import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInt } from "@/lib/format";

interface RankedTableProps {
  rows: { label: string; hits: number }[];
  labelHeader: string;
  /** Share of the largest value, drawn as a bar behind each row. */
  showBars?: boolean;
}

/** Ordered list of labels with their hit counts, used for top pages and top hosts. */
export function RankedTable({ rows, labelHeader, showBars = true }: RankedTableProps) {
  const max = Math.max(1, ...rows.map((row) => row.hits));
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">#</TableHead>
          <TableHead>{labelHeader}</TableHead>
          <TableHead className="text-right">Requests</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={row.label}>
            <TableCell className="text-muted-foreground tabular-nums">{index + 1}</TableCell>
            <TableCell className="max-w-0 w-full">
              <div className="relative">
                {showBars && (
                  <span
                    className="absolute inset-y-[-4px] left-0 rounded bg-secondary/70"
                    style={{ width: `${(row.hits / max) * 100}%` }}
                    aria-hidden
                  />
                )}
                <span className="relative block truncate px-1.5 font-mono text-xs" title={row.label}>
                  {row.label}
                </span>
              </div>
            </TableCell>
            <TableCell className="text-right font-mono text-xs tabular-nums">{formatInt(row.hits)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
