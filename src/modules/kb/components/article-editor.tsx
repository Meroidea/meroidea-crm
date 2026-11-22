'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ExternalLink, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';

import { Field } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { deleteArticleAction, saveArticleAction } from '@/modules/kb/actions';

import { ARTICLE_STATUS_LABELS, ARTICLE_STATUSES, articleSchema, articleSlug } from '../schemas';
import { Markdown } from './markdown';

type FormValues = z.input<typeof articleSchema>;
type SubmitValues = z.output<typeof articleSchema>;

/**
 * Writing an article (ADR-071): Markdown on the left, or a preview of exactly what the portal
 * will show. Raw HTML is not shown on the portal, so the preview leaves it out too.
 */
export function ArticleEditor({
  article,
  categories,
  portalBase,
}: {
  article: {
    id: string;
    title: string;
    slug: string;
    categoryId: string | null;
    summary: string | null;
    bodyMarkdown: string;
    status: 'draft' | 'published';
  } | null;
  categories: { id: string; name: string }[];
  /** The portal's address, to open a published article on it. */
  portalBase: string;
}) {
  const router = useRouter();
  const { run, error, isPending } = useActionRunner();
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const form = useForm<FormValues, unknown, SubmitValues>({
    resolver: zodResolver(articleSchema),
    defaultValues: {
      id: article?.id,
      title: article?.title ?? '',
      slug: article?.slug ?? '',
      categoryId: article?.categoryId ?? '',
      summary: article?.summary ?? '',
      bodyMarkdown: article?.bodyMarkdown ?? '',
      status: article?.status ?? 'draft',
    },
  });
  const errors = form.formState.errors;
  const [title, slug, body] = useWatch({
    control: form.control,
    name: ['title', 'slug', 'bodyMarkdown'],
  });
  const address = slug || articleSlug(title ?? '');

  return (
    <form
      className="grid gap-5 lg:grid-cols-[1fr_17rem]"
      onSubmit={form.handleSubmit((values) =>
        run(
          () => saveArticleAction(values),
          (data) => {
            if (!article) router.push(`/kb/${data.id}`);
          },
        ),
      )}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <Field name="title" label="Title" error={errors.title?.message}>
          <Input id="title" className="text-lg" {...form.register('title')} />
        </Field>
        <Field
          name="summary"
          label="Summary (optional)"
          error={errors.summary?.message}
          hint="Shown in the portal's list and to search engines."
        >
          <Textarea id="summary" rows={2} {...form.register('summary')} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <div role="tablist" aria-label="Article body" className="flex gap-1">
            {(['write', 'preview'] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground',
                  tab === key && 'bg-accent font-medium text-foreground',
                )}
              >
                {key === 'write' ? 'Write' : 'Preview'}
              </button>
            ))}
          </div>
          {tab === 'write' ? (
            <>
              <Textarea
                aria-label="Article body in Markdown"
                rows={20}
                className="font-mono text-sm"
                {...form.register('bodyMarkdown')}
              />
              <p className="text-xs text-muted-foreground">
                Markdown: # Heading, **bold**, *italic*, - list, 1. numbered list,
                [link](https://…), ![picture](https://…). HTML is not shown.
              </p>
              {errors.bodyMarkdown && (
                <p className="text-sm text-destructive-text">{errors.bodyMarkdown.message}</p>
              )}
            </>
          ) : (
            <div className="min-h-64 rounded-xl border bg-card p-4">
              {body ? (
                <Markdown>{body}</Markdown>
              ) : (
                <p className="text-sm text-muted-foreground">Nothing written yet.</p>
              )}
            </div>
          )}
        </div>
      </div>
      <aside className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <Field name="status" label="Status" error={errors.status?.message}>
          <NativeSelect id="status" {...form.register('status')}>
            {ARTICLE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {ARTICLE_STATUS_LABELS[status]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field name="categoryId" label="Category" error={errors.categoryId?.message}>
          <NativeSelect id="categoryId" {...form.register('categoryId')}>
            <option value="">None</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          name="slug"
          label="Address"
          error={errors.slug?.message}
          hint={address ? `…/${address}` : 'Made from the title'}
        >
          <Input id="slug" placeholder={articleSlug(title ?? '')} {...form.register('slug')} />
        </Field>
        <ErrorNote error={error} />
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : article ? 'Save' : 'Create article'}
        </Button>
        {article?.status === 'published' && (
          <a
            href={`${portalBase}/${article.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
          >
            Open on the portal <ExternalLink aria-hidden className="size-3.5" />
          </a>
        )}
        {article && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit text-destructive-text"
            disabled={isPending}
            onClick={() => {
              if (window.confirm('Delete this article? It disappears from the portal.')) {
                run(
                  () => deleteArticleAction({ id: article.id }),
                  () => router.push('/kb'),
                );
              }
            }}
          >
            <Trash2 aria-hidden /> Delete
          </Button>
        )}
      </aside>
    </form>
  );
}
