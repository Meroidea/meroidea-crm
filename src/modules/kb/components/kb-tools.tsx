'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Field } from '@/components/forms/field';
import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { deleteCategoryAction, saveCategoryAction, savePortalAction } from '@/modules/kb/actions';

import { categorySchema, portalSchema } from '../schemas';

/** Opens or closes the public help portal, with its title and introduction (ADR-071). */
export function PortalSettings({
  settings,
}: {
  settings: { isPublic: boolean; title: string | null; intro: string | null; url: string };
}) {
  const { run, error, isPending } = useActionRunner();
  const form = useForm<z.input<typeof portalSchema>, unknown, z.output<typeof portalSchema>>({
    resolver: zodResolver(portalSchema),
    defaultValues: {
      isPublic: settings.isPublic,
      title: settings.title ?? '',
      intro: settings.intro ?? '',
    },
  });
  const errors = form.formState.errors;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={form.handleSubmit((values) => run(() => savePortalAction(values)))}
    >
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-primary" {...form.register('isPublic')} />
        The help portal is open to everyone
      </label>
      <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        Its address:
        <a
          href={settings.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
        >
          {settings.url} <ExternalLink aria-hidden className="size-3.5" />
        </a>
      </p>
      <Field
        name="title"
        label="Title"
        error={errors.title?.message}
        hint="For example: Help centre"
      >
        <Input id="title" {...form.register('title')} />
      </Field>
      <Field name="intro" label="Introduction" error={errors.intro?.message}>
        <Textarea id="intro" rows={2} {...form.register('intro')} />
      </Field>
      <ErrorNote error={error} />
      <Button type="submit" size="sm" className="w-fit" disabled={isPending}>
        {isPending ? 'Saving…' : 'Save portal'}
      </Button>
    </form>
  );
}

type Category = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  articles: number;
};

function CategoryForm({ category, onDone }: { category: Category | null; onDone: () => void }) {
  const { run, error, isPending } = useActionRunner();
  const form = useForm<z.input<typeof categorySchema>, unknown, z.output<typeof categorySchema>>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      id: category?.id,
      name: category?.name ?? '',
      slug: category?.slug ?? '',
      description: category?.description ?? '',
      position: category?.position ?? 0,
    },
  });
  const errors = form.formState.errors;
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border p-3"
      onSubmit={form.handleSubmit((values) => run(() => saveCategoryAction(values), onDone))}
    >
      <div className="grid gap-2 sm:grid-cols-[1fr_6rem]">
        <Field name="cat-name" label="Name" error={errors.name?.message}>
          <Input id="cat-name" {...form.register('name')} />
        </Field>
        <Field name="cat-position" label="Order" error={errors.position?.message}>
          <Input
            id="cat-position"
            type="number"
            min={0}
            {...form.register('position', { valueAsNumber: true })}
          />
        </Field>
      </div>
      <Field
        name="cat-description"
        label="Description (optional)"
        error={errors.description?.message}
      >
        <Input id="cat-description" {...form.register('description')} />
      </Field>
      <ErrorNote error={error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The portal's headings: add, rename, reorder or remove (articles keep, without one). */
export function CategoryManager({ categories }: { categories: Category[] }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const { run, error, isPending } = useActionRunner();
  return (
    <div className="flex flex-col gap-2">
      {categories.length === 0 && editing !== 'new' && (
        <p className="text-sm text-muted-foreground">No categories yet.</p>
      )}
      <ul className="flex flex-col gap-1">
        {categories.map((category) =>
          editing === category.id ? (
            <li key={category.id}>
              <CategoryForm category={category} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={category.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                {category.name}{' '}
                <span className="text-muted-foreground">
                  · {category.articles} {category.articles === 1 ? 'article' : 'articles'}
                </span>
              </span>
              <span className="flex shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Change ${category.name}`}
                  onClick={() => setEditing(category.id)}
                >
                  <Pencil aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${category.name}`}
                  disabled={isPending}
                  onClick={() => {
                    if (
                      window.confirm(`Remove the category “${category.name}”? Its articles stay.`)
                    ) {
                      run(() => deleteCategoryAction({ id: category.id }));
                    }
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </span>
            </li>
          ),
        )}
      </ul>
      {editing === 'new' ? (
        <CategoryForm category={null} onDone={() => setEditing(null)} />
      ) : (
        <Button variant="outline" size="sm" className="w-fit" onClick={() => setEditing('new')}>
          <Plus aria-hidden /> Add a category
        </Button>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
