import { Fragment, type ReactNode } from 'react';

import {
  EMAIL_COLORS,
  EMAIL_FONTS,
  EMAIL_HIGHLIGHTS,
  EMAIL_SIZES,
  safeHref,
  type EmailDoc,
  type EmailInline,
} from '../email-doc';

/*
 * A formatted email the business sent (ADR-090), shown in the thread as React elements built
 * from its checked document: never as HTML, so nothing stored can run in the page. Colours and
 * sizes are the email's own content, as the recipient sees them.
 */

function Inline({ item }: { item: EmailInline }) {
  let node: ReactNode = item.text.split('\n').map((line, index) => (
    <Fragment key={index}>
      {index > 0 && <br />}
      {line}
    </Fragment>
  ));
  if (item.b) node = <strong>{node}</strong>;
  if (item.i) node = <em>{node}</em>;
  if (item.u) node = <u>{node}</u>;
  if (item.s) node = <s>{node}</s>;
  if (item.color || item.bg || item.font || (item.size && item.size !== 'normal')) {
    node = (
      <span
        style={{
          color: item.color ? EMAIL_COLORS[item.color] : undefined,
          backgroundColor: item.bg ? EMAIL_HIGHLIGHTS[item.bg] : undefined,
          fontSize: item.size && item.size !== 'normal' ? EMAIL_SIZES[item.size] : undefined,
          fontFamily: item.font ? EMAIL_FONTS[item.font].stack : undefined,
        }}
      >
        {node}
      </span>
    );
  }
  const href = item.href ? safeHref(item.href) : null;
  if (href) {
    node = (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow">
        {node}
      </a>
    );
  }
  return node;
}

const Inlines = ({ items }: { items: EmailInline[] }) =>
  items.map((item, index) => <Inline key={index} item={item} />);

export function EmailDocView({
  doc,
  imageSrc,
}: {
  doc: EmailDoc;
  /** Where a picture is served from: the message's own file, through the permission check. */
  imageSrc?: (path: string) => string | null;
}) {
  return (
    <div className="email-rich text-sm leading-relaxed break-words" data-sensitive>
      {doc.map((block, index) => {
        const align =
          'align' in block && block.align && block.align !== 'left'
            ? { textAlign: block.align }
            : undefined;
        switch (block.type) {
          case 'paragraph':
            return (
              <p key={index} style={align}>
                {block.content.length > 0 ? <Inlines items={block.content} /> : <br />}
              </p>
            );
          case 'heading': {
            const Tag = (['h1', 'h2', 'h3'] as const)[block.level - 1]!;
            return (
              <Tag key={index} style={align}>
                <Inlines items={block.content} />
              </Tag>
            );
          }
          case 'quote':
            return (
              <blockquote key={index}>
                <Inlines items={block.content} />
              </blockquote>
            );
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul';
            return (
              <Tag key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <Inlines items={item} />
                  </li>
                ))}
              </Tag>
            );
          }
          case 'rule':
            return <hr key={index} />;
          case 'table':
            return (
              <div key={index} className="overflow-x-auto">
                <table>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) =>
                          block.header && rowIndex === 0 ? (
                            <th key={cellIndex}>
                              <Inlines items={cell} />
                            </th>
                          ) : (
                            <td key={cellIndex}>
                              <Inlines items={cell} />
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'image': {
            const src = imageSrc?.(block.path);
            if (!src) return null;
            return (
              <p key={index} style={align}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a private, permission-checked file */}
                <img
                  src={src}
                  alt={block.alt}
                  width={block.width}
                  referrerPolicy="no-referrer"
                  className="inline-block h-auto max-w-full"
                />
              </p>
            );
          }
        }
      })}
    </div>
  );
}
