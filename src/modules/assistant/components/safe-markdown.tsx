import { Fragment, type ReactNode } from 'react';

/*
 * The small part of Markdown the assistant writes in (ADR-064): headings, paragraphs, bullet and
 * numbered lists, tables, **bold**, *italic*, `code` and fenced code. Built as React elements, so
 * nothing is ever injected as HTML. Links and images are shown as their text only: the model's
 * output can echo names typed by anyone, and a rendered image or link could carry the
 * business's figures to another site in its address (ADR-063).
 */

const INLINE =
  /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_|!?\[[^\]]*\]\([^)]*\))/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).map((piece, index) => {
    const key = `${keyPrefix}-${index}`;
    if (!piece) return null;
    if (
      (piece.startsWith('**') && piece.endsWith('**')) ||
      (piece.startsWith('__') && piece.endsWith('__'))
    ) {
      return <strong key={key}>{piece.slice(2, -2)}</strong>;
    }
    if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 1) {
      return (
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {piece.slice(1, -1)}
        </code>
      );
    }
    const link = /^!?\[([^\]]*)\]\([^)]*\)$/.exec(piece);
    if (link) return <Fragment key={key}>{link[1]}</Fragment>;
    if (
      (piece.startsWith('*') && piece.endsWith('*')) ||
      (piece.startsWith('_') && piece.endsWith('_'))
    ) {
      if (piece.length > 2) return <em key={key}>{piece.slice(1, -1)}</em>;
    }
    return <Fragment key={key}>{piece}</Fragment>;
  });
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

const isTableDivider = (line: string) =>
  /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function SafeMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const key = `b${index}`;

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trim().startsWith('```')) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      blocks.push(
        <pre key={key} className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
          {code.join('\n')}
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <p key={key} className="pt-1 font-semibold text-foreground">
          {inline(heading[2] ?? '', key)}
        </p>,
      );
      index += 1;
      continue;
    }

    if (line.includes('|') && isTableDivider(lines[index + 1] ?? '')) {
      const header = cells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? '').includes('|')) {
        rows.push(cells(lines[index] ?? ''));
        index += 1;
      }
      blocks.push(
        <div key={key} className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/60">
              <tr>
                {header.map((cell, column) => (
                  <th key={column} className="px-2 py-1.5 text-left font-medium">
                    {inline(cell, `${key}h${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t">
                  {header.map((_, column) => (
                    <td key={column} className="px-2 py-1.5 tabular-nums">
                      {inline(row[column] ?? '', `${key}r${rowIndex}c${column}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const listItem = /^\s*([-*•]|\d+[.)])\s+(.*)$/;
    if (listItem.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (index < lines.length && listItem.test(lines[index] ?? '')) {
        items.push(listItem.exec(lines[index] ?? '')?.[2] ?? '');
        index += 1;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={key} className={`space-y-0.5 pl-5 ${ordered ? 'list-decimal' : 'list-disc'}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{inline(item, `${key}i${itemIndex}`)}</li>
          ))}
        </List>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() &&
      !listItem.test(lines[index] ?? '')
    ) {
      paragraph.push(lines[index] ?? '');
      index += 1;
      if ((lines[index] ?? '').trim().startsWith('```') || /^#{1,4}\s/.test(lines[index] ?? ''))
        break;
    }
    blocks.push(<p key={key}>{inline(paragraph.join(' '), key)}</p>);
  }

  return <div className="space-y-2 leading-relaxed break-words">{blocks}</div>;
}
