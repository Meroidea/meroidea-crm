import { ExternalLink } from 'lucide-react';

import { videoEmbedUrl } from '../video';

/**
 * A module's content. Written as plain text: "## " starts a heading, "- " a bullet point, and a
 * blank line a new paragraph. Rendered as text only, so nothing typed can run in the page.
 */
export function TrainingBody({ body, videoUrl }: { body: string; videoUrl: string | null }) {
  const embed = videoEmbedUrl(videoUrl);
  const blocks = body.split(/\n{2,}/).filter((block) => block.trim().length > 0);
  return (
    <div className="flex flex-col gap-4">
      {embed && (
        <div className="aspect-video w-full overflow-hidden rounded-xl border bg-muted">
          <iframe
            src={embed}
            title="Training video"
            className="size-full"
            allow="encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            loading="lazy"
          />
        </div>
      )}
      {videoUrl && !embed && (
        <a
          href={videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-primary underline underline-offset-4"
        >
          Watch the video <ExternalLink aria-hidden className="size-3.5" />
        </a>
      )}
      <div className="space-y-3 text-sm leading-relaxed">
        {blocks.map((block, index) => {
          const lines = block.split('\n');
          if (block.startsWith('## ')) {
            return (
              <h2 key={index} className="pt-2 text-base font-semibold first:pt-0">
                {block.slice(3)}
              </h2>
            );
          }
          if (lines.every((line) => line.trim().startsWith('- '))) {
            return (
              <ul key={index} className="list-disc space-y-1 pl-5 text-foreground/85">
                {lines.map((line, item) => (
                  <li key={item}>{line.trim().slice(2)}</li>
                ))}
              </ul>
            );
          }
          return (
            <p key={index} className="whitespace-pre-line text-foreground/85">
              {block}
            </p>
          );
        })}
      </div>
    </div>
  );
}
