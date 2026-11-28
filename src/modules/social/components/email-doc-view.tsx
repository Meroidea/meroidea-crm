import { Fragment, type ReactNode } from 'react';

import {
  EMAIL_COLORS,
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
  if (item.color || item.bg || (item.size && item.size !== 'normal')) {
    node = (
      <span
        style={{
          color: item.color ? EMAIL_COLORS[item.color] : undefined,
          backgroundColor: item.bg ? EMAIL_HIGHLIGHTS[item.bg] : undefined,
          fontSize: item.size && item.size !== 'normal' ? EMAIL_SIZES[item.size] : undefined,
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

export function EmailDocView({ doc }: { doc: EmailDoc }) {
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
        }
      })}
    </div>
  );
}
