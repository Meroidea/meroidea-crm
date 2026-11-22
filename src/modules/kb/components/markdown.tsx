import type { ComponentProps } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';

import { cn } from '@/lib/utils';

/**
 * An article's Markdown as the portal and the editor's preview show it (ADR-071). Raw HTML in
 * the Markdown is dropped (`skipHtml`), never rendered; link addresses go through
 * react-markdown's own filter, which removes `javascript:` and other unsafe schemes; pictures
 * load only over https and send no referrer.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 text-[15px] leading-relaxed text-foreground',
        '[&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:text-lg [&_h3]:font-semibold',
        '[&_li]:mt-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6',
        '[&_blockquote]:border-l-4 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground',
        '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-sm [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3',
        '[&_hr]:my-2 [&_hr]:border-border',
        className,
      )}
    >
      <ReactMarkdown
        skipHtml
        urlTransform={defaultUrlTransform}
        components={{
          a: ({ href, children: label }: ComponentProps<'a'>) => (
            <a
              href={href}
              className="text-primary underline underline-offset-4"
              rel="noopener noreferrer nofollow ugc"
              target={href?.startsWith('#') ? undefined : '_blank'}
            >
              {label}
            </a>
          ),
          img: ({ src, alt }: ComponentProps<'img'>) =>
            typeof src === 'string' && src.startsWith('https://') ? (
              // eslint-disable-next-line @next/next/no-img-element -- a business's own pictures from anywhere on the web; no optimiser host list applies
              <img
                src={src}
                alt={alt ?? ''}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="max-w-full rounded-lg"
              />
            ) : null,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
