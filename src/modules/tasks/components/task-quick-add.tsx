'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createTaskAction } from '@/modules/tasks/actions';
import { TASK_TYPE_LABELS, TASK_TYPES } from '@/modules/tasks/schemas';

function isoDay(offset: number) {
  // The browser's own calendar day, which is what the person means by "tomorrow".
  return new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA');
}

/** One-line task entry; expands for due date, type, priority and assignee. */
export function TaskQuickAdd({
  contactId,
  opportunityId,
  assignees,
  currentUserId,
  placeholder = 'Add a follow-up…',
}: {
  contactId?: string;
  opportunityId?: string;
  assignees?: { value: string; label: string }[];
  currentUserId: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState(isoDay(1));
  const [type, setType] = useState<(typeof TASK_TYPES)[number]>('follow_up');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [assignedTo, setAssignedTo] = useState(currentUserId);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await createTaskAction({
        title,
        dueDate,
        type,
        priority,
        assignedTo,
        contactId,
        opportunityId,
      });
      if (!result.ok) {
        setError(result.error.fieldErrors?.title?.[0] ?? result.error.message);
        return;
      }
      setTitle('');
      router.refresh();
    });

  return (
    <form
      className="flex flex-col gap-2 rounded-xl border bg-card p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim()) submit();
      }}
    >
      <div className="flex gap-2">
        <Input
          aria-label="Task"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={placeholder}
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Add task"
          disabled={isPending || !title.trim()}
        >
          <Plus aria-hidden />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          type="date"
          aria-label="Due date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          className="h-8 w-auto"
        />
        <NativeSelect
          aria-label="Type"
          value={type}
          onChange={(event) => setType(event.target.value as typeof type)}
          className="h-8 w-auto"
        >
          {TASK_TYPES.map((option) => (
            <option key={option} value={option}>
              {TASK_TYPE_LABELS[option]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Priority"
          value={priority}
          onChange={(event) => setPriority(event.target.value as typeof priority)}
          className="h-8 w-auto"
        >
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High priority</option>
        </NativeSelect>
        {assignees && assignees.length > 1 && (
          <NativeSelect
            aria-label="Assignee"
            value={assignedTo}
            onChange={(event) => setAssignedTo(event.target.value)}
            className="h-8 w-auto"
          >
            {assignees.map((assignee) => (
              <option key={assignee.value} value={assignee.value}>
                {assignee.label}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </form>
  );
}
