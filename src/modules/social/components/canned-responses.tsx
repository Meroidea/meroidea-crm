'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { ErrorNote, useActionRunner } from '@/components/forms/use-action-runner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { deleteCannedResponseAction, saveCannedResponseAction } from '@/modules/social/actions';

import { CANNED_PLACEHOLDERS } from '../canned';
import type { CannedResponseRow } from '../queries';
import { cannedResponseSchema } from '../schemas';

type FormValues = z.input<typeof cannedResponseSchema>;
type SubmitValues = z.output<typeof cannedResponseSchema>;

function ReplyForm({
  reply,
  canManageShared,
  onDone,
}: {
  reply: CannedResponseRow | null;
  canManageShared: boolean;
  onDone: () => void;
}) {
  const { run, error, isPending } = useActionRunner();
  const form = useForm<FormValues, unknown, SubmitValues>({
    resolver: zodResolver(cannedResponseSchema),
    defaultValues: {
      id: reply?.id,
      title: reply?.title ?? '',
      shortcut: reply?.shortcut ?? '',
      body: reply?.body ?? '',
      shared: reply?.shared ?? false,
    },
  });
  const errors = form.formState.errors;
  const insert = (token: string) => {
    const current = form.getValues('body');
    form.setValue(
      'body',
      current ? `${current}${current.endsWith(' ') ? '' : ' '}${token}` : token,
    );
  };
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
      onSubmit={form.handleSubmit((values) => run(() => saveCannedResponseAction(values), onDone))}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="canned-title">Title</Label>
          <Input
            id="canned-title"
            aria-invalid={Boolean(errors.title)}
            {...form.register('title')}
          />
          {errors.title && <p className="text-xs text-destructive-text">{errors.title.message}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="canned-shortcut">Shortcut (optional)</Label>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">/</span>
            <Input
              id="canned-shortcut"
              placeholder="opening-hours"
              aria-invalid={Boolean(errors.shortcut)}
              {...form.register('shortcut')}
            />
          </div>
          {errors.shortcut && (
            <p className="text-xs text-destructive-text">{errors.shortcut.message}</p>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="canned-body">Reply</Label>
        <Textarea
          id="canned-body"
          rows={4}
          aria-invalid={Boolean(errors.body)}
          {...form.register('body')}
        />
        {errors.body && <p className="text-xs text-destructive-text">{errors.body.message}</p>}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          Fill in when used:
          {CANNED_PLACEHOLDERS.map((placeholder) => (
            <Button
              key={placeholder.token}
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => insert(placeholder.token)}
            >
              {placeholder.label}
            </Button>
          ))}
        </div>
      </div>
      {canManageShared && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" {...form.register('shared')} />
          Share with the whole team
        </label>
      )}
      <ErrorNote error={error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The saved replies list, with adding, changing and deleting in place. */
export function CannedResponses({
  replies,
  canManageShared,
}: {
  replies: CannedResponseRow[];
  canManageShared: boolean;
}) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const { run, error, isPending } = useActionRunner();
  return (
    <div className="flex flex-col gap-4">
      {editing === 'new' ? (
        <ReplyForm reply={null} canManageShared={canManageShared} onDone={() => setEditing(null)} />
      ) : (
        <Button className="w-fit" size="sm" onClick={() => setEditing('new')}>
          <Plus aria-hidden /> New saved reply
        </Button>
      )}
      <ErrorNote error={error} />
      {replies.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
          No saved replies yet.
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {replies.map((reply) =>
            editing === reply.id ? (
              <li key={reply.id} className="p-2">
                <ReplyForm
                  reply={reply}
                  canManageShared={canManageShared}
                  onDone={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={reply.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 basis-60">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{reply.title}</span>
                    {reply.shortcut && (
                      <span className="text-xs text-muted-foreground">/{reply.shortcut}</span>
                    )}
                    {reply.shared ? (
                      <Badge variant="secondary">
                        <Users aria-hidden /> Team
                      </Badge>
                    ) : (
                      <Badge variant="outline">Only you</Badge>
                    )}
                  </p>
                  <p className="line-clamp-2 text-sm whitespace-pre-wrap text-muted-foreground">
                    {reply.body}
                  </p>
                </div>
                {(!reply.shared || canManageShared) && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Change “${reply.title}”`}
                      onClick={() => setEditing(reply.id)}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete “${reply.title}”`}
                      disabled={isPending}
                      onClick={() => {
                        if (window.confirm(`Delete the saved reply “${reply.title}”?`)) {
                          run(() => deleteCannedResponseAction({ id: reply.id }));
                        }
                      }}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
