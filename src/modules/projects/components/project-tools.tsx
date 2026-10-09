'use client';

import { Clock, Pencil, Play, Plus, Square, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { Field } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  deleteProjectAction,
  deleteTaskAction,
  logTimeAction,
  saveProjectAction,
  saveTaskAction,
  setTaskStatusAction,
  startTimerAction,
  stopTimerAction,
} from '@/modules/projects/actions';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUSES,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type TaskStatus,
} from '@/modules/projects/schemas';

type Person = { userId: string; fullName: string };
type Result =
  | { ok: true; data: { id: string } }
  | { ok: false; error: { message: string; fieldErrors?: Record<string, string[]> } };

function useRun() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const run = (action: () => Promise<Result>, after?: (id: string) => void) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) {
        return setError(
          Object.values(result.error.fieldErrors ?? {})[0]?.[0] ?? result.error.message,
        );
      }
      after?.(result.data.id);
      router.refresh();
    });
  return { run, error, isPending };
}

const ErrorNote = ({ error }: { error: string | null }) =>
  error ? (
    <p role="alert" className="text-sm text-destructive-text">
      {error}
    </p>
  ) : null;

export type ProjectValues = {
  id?: string;
  name: string;
  description: string;
  startsOn: string;
  dueOn: string;
  leadUserId: string;
  status: (typeof PROJECT_STATUSES)[number];
};

export function ProjectButton({ project, people }: { project?: ProjectValues; people: Person[] }) {
  const router = useRouter();
  const { run, error, isPending } = useRun();
  const [open, setOpen] = useState(false);
  const blank: ProjectValues = {
    name: '',
    description: '',
    startsOn: '',
    dueOn: '',
    leadUserId: '',
    status: 'active',
  };
  const [values, setValues] = useState<ProjectValues>(project ?? blank);
  const set = (key: keyof ProjectValues) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  return (
    <>
      <Button variant={project ? 'outline' : 'default'} onClick={() => setOpen(true)}>
        {project ? <Pencil aria-hidden /> : <Plus aria-hidden />}
        {project ? 'Edit project' : 'New project'}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{project ? 'Edit project' : 'New project'}</SheetTitle>
            <SheetDescription>
              A piece of work with an end. Add its tasks once it is created.
            </SheetDescription>
          </SheetHeader>
          <form
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
            onSubmit={(event) => {
              event.preventDefault();
              run(
                () => saveProjectAction(values),
                (id) => {
                  setOpen(false);
                  if (!project) {
                    setValues(blank);
                    router.push(`/projects/${id}`);
                  }
                },
              );
            }}
          >
            <Field name="project-name" label="Name">
              <Input id="project-name" required value={values.name} onChange={set('name')} />
            </Field>
            <Field name="project-description" label="What is it for? (optional)">
              <Textarea
                id="project-description"
                rows={3}
                value={values.description}
                onChange={set('description')}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field name="project-start" label="Starts (optional)">
                <Input
                  id="project-start"
                  type="date"
                  value={values.startsOn}
                  onChange={set('startsOn')}
                />
              </Field>
              <Field name="project-due" label="Due (optional)">
                <Input id="project-due" type="date" value={values.dueOn} onChange={set('dueOn')} />
              </Field>
            </div>
            <Field name="project-lead" label="Who is responsible?">
              <NativeSelect
                id="project-lead"
                value={values.leadUserId}
                onChange={set('leadUserId')}
              >
                <option value="">Nobody yet</option>
                {people.map((person) => (
                  <option key={person.userId} value={person.userId}>
                    {person.fullName}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {project && (
              <Field name="project-status" label="Status">
                <NativeSelect id="project-status" value={values.status} onChange={set('status')}>
                  {PROJECT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {PROJECT_STATUS_LABELS[status]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <ErrorNote error={error} />
            <SheetFooter className="mt-auto flex-row justify-between px-0">
              {project?.id ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => {
                    if (!window.confirm('Delete this project and its tasks?')) return;
                    run(
                      () => deleteProjectAction({ id: project.id }),
                      () => router.replace('/projects'),
                    );
                  }}
                >
                  <Trash2 aria-hidden /> Delete
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Saving…' : 'Save'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

export type TaskValues = {
  id?: string;
  title: string;
  description: string;
  priority: (typeof PRIORITIES)[number];
  assigneeUserId: string;
  dueOn: string;
  estimateHours: string;
};

export function TaskButton({
  projectId,
  task,
  people,
}: {
  projectId: string;
  task?: TaskValues;
  people: Person[];
}) {
  const { run, error, isPending } = useRun();
  const [open, setOpen] = useState(false);
  const blank: TaskValues = {
    title: '',
    description: '',
    priority: 'normal',
    assigneeUserId: '',
    dueOn: '',
    estimateHours: '',
  };
  const [values, setValues] = useState<TaskValues>(task ?? blank);
  const set = (key: keyof TaskValues) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  return (
    <>
      {task ? (
        <Button size="sm" variant="ghost" aria-label="Edit task" onClick={() => setOpen(true)}>
          <Pencil aria-hidden />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus aria-hidden /> Add task
        </Button>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{task ? 'Edit task' : 'Add a task'}</SheetTitle>
            <SheetDescription>What needs doing, who does it, and by when.</SheetDescription>
          </SheetHeader>
          <form
            className="flex flex-1 flex-col gap-4 px-4 pb-4"
            onSubmit={(event) => {
              event.preventDefault();
              run(
                () => saveTaskAction({ ...values, projectId }),
                () => {
                  setOpen(false);
                  if (!task) setValues(blank);
                },
              );
            }}
          >
            <Field name="task-title" label="Task">
              <Input id="task-title" required value={values.title} onChange={set('title')} />
            </Field>
            <Field name="task-description" label="Details (optional)">
              <Textarea
                id="task-description"
                rows={4}
                value={values.description}
                onChange={set('description')}
              />
            </Field>
            <Field name="task-assignee" label="Assigned to">
              <NativeSelect
                id="task-assignee"
                value={values.assigneeUserId}
                onChange={set('assigneeUserId')}
              >
                <option value="">Nobody yet</option>
                {people.map((person) => (
                  <option key={person.userId} value={person.userId}>
                    {person.fullName}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field name="task-priority" label="Priority">
                <NativeSelect id="task-priority" value={values.priority} onChange={set('priority')}>
                  {PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {PRIORITY_LABELS[priority]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field name="task-due" label="Due">
                <Input id="task-due" type="date" value={values.dueOn} onChange={set('dueOn')} />
              </Field>
              <Field name="task-estimate" label="Estimate (h)">
                <Input
                  id="task-estimate"
                  inputMode="decimal"
                  placeholder="2"
                  value={values.estimateHours}
                  onChange={set('estimateHours')}
                />
              </Field>
            </div>
            <ErrorNote error={error} />
            <SheetFooter className="mt-auto flex-row justify-between px-0">
              {task?.id ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() =>
                    run(
                      () => deleteTaskAction({ id: task.id as string }),
                      () => setOpen(false),
                    )
                  }
                >
                  <Trash2 aria-hidden /> Delete
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Saving…' : 'Save'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function TaskStatusSelect({
  id,
  status,
  title,
}: {
  id: string;
  status: TaskStatus;
  title: string;
}) {
  const { run, error, isPending } = useRun();
  return (
    <div className="flex flex-col gap-1">
      <NativeSelect
        aria-label={`Status of ${title}`}
        value={status}
        disabled={isPending}
        className="h-8"
        onChange={(event) =>
          run(() => setTaskStatusAction({ id, status: event.target.value as TaskStatus }))
        }
      >
        {TASK_STATUSES.map((option) => (
          <option key={option} value={option}>
            {TASK_STATUS_LABELS[option]}
          </option>
        ))}
      </NativeSelect>
      <ErrorNote error={error} />
    </div>
  );
}

/** Start or stop the timer on a task, or type time in afterwards. */
export function TaskTime({
  taskId,
  running,
  today,
}: {
  taskId: string;
  /** True when the signed-in person's timer is running on this task. */
  running: boolean;
  today: string;
}) {
  const { run, error, isPending } = useRun();
  const [logging, setLogging] = useState(false);
  const [hours, setHours] = useState('');
  const [date, setDate] = useState(today);

  if (logging) {
    return (
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          run(
            () => logTimeAction({ taskId, date, hours }),
            () => {
              setHours('');
              setLogging(false);
            },
          );
        }}
      >
        <div className="flex gap-1.5">
          <Input
            aria-label="Hours worked"
            placeholder="Hours"
            inputMode="decimal"
            required
            value={hours}
            onChange={(event) => setHours(event.target.value)}
            className="h-8 w-20"
          />
          <Input
            aria-label="Date worked"
            type="date"
            max={today}
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="h-8 min-w-0 flex-1"
          />
        </div>
        <div className="flex gap-1.5">
          <Button type="submit" size="sm" disabled={isPending}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setLogging(false)}>
            Cancel
          </Button>
        </div>
        <ErrorNote error={error} />
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1.5">
        {running ? (
          <Button
            size="sm"
            variant="destructive"
            disabled={isPending}
            onClick={() => run(() => stopTimerAction({}))}
          >
            <Square aria-hidden /> Stop
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => run(() => startTimerAction({ taskId }))}
          >
            <Play aria-hidden /> Start
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setLogging(true)}>
          <Clock aria-hidden /> Log time
        </Button>
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

/** Shown wherever the person is while their timer runs, so it is never forgotten. */
export function RunningTimer({
  since,
  taskTitle,
  projectId,
}: {
  since: number;
  taskTitle: string;
  projectId: string;
}) {
  const { run, error, isPending } = useRun();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 15_000);
    return () => clearInterval(timer);
  }, []);
  const minutes = now === null ? null : Math.max(0, Math.floor((now - since) / 60_000));

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-accent px-4 py-3">
      <span aria-hidden className="size-2 animate-pulse rounded-full bg-primary" />
      <p className="min-w-0 flex-1 text-sm">
        Timing{' '}
        <Link href={`/projects/${projectId}`} className="font-medium underline underline-offset-4">
          {taskTitle}
        </Link>
        <span className="ml-2 tabular-nums">
          {minutes === null
            ? ''
            : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`}
        </span>
      </p>
      <Button
        size="sm"
        variant="destructive"
        disabled={isPending}
        onClick={() => run(() => stopTimerAction({}))}
      >
        <Square aria-hidden /> Stop
      </Button>
      <ErrorNote error={error} />
    </div>
  );
}
