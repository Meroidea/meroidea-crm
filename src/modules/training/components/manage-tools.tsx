'use client';

import { Archive, ArrowDown, ArrowUp, Eye, Plus, Send, Trash2, Undo2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Field, fieldA11y } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  addAssignmentAction,
  createCourseAction,
  createModuleAction,
  deleteCourseAction,
  deleteModuleAction,
  removeAssignmentAction,
  setCourseStatusAction,
  updateCourseAction,
  updateModuleAction,
} from '@/modules/training/actions';
import type { AssignmentOptions, AssignmentRow } from '@/modules/training/queries';
import {
  AUDIENCE_LABELS,
  moduleSchema,
  type Audience,
  type CourseStatus,
} from '@/modules/training/schemas';

function ErrorText({ children }: { children: string | null }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-destructive-text">
      {children}
    </p>
  );
}

/** Creates a course, or edits one when `course` is given. */
export function CourseForm({
  course,
}: {
  course?: { id: string; title: string; description: string | null; position: number };
}) {
  const router = useRouter();
  const [title, setTitle] = useState(course?.title ?? '');
  const [description, setDescription] = useState(course?.description ?? '');
  const [position, setPosition] = useState(String(course?.position ?? 0));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="grid gap-4 sm:grid-cols-[1fr_8rem]"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setNote(null);
          const values = { title, description, position };
          const result = course
            ? await updateCourseAction({ ...values, id: course.id })
            : await createCourseAction(values);
          setErrors(result.ok ? {} : (result.error.fieldErrors ?? {}));
          if (!result.ok) return setNote(result.error.message);
          if (course) {
            setNote('Saved.');
            router.refresh();
          } else {
            router.push(`/training/manage/${result.data.id}`);
          }
        });
      }}
    >
      <Field name="course-title" label="Course title" error={errors.title?.[0]} required>
        <Input
          value={title}
          maxLength={150}
          onChange={(event) => setTitle(event.target.value)}
          {...fieldA11y('course-title', errors.title?.[0])}
        />
      </Field>
      <Field
        name="course-position"
        label="Order"
        hint="Lower shows first"
        error={errors.position?.[0]}
      >
        <Input
          inputMode="numeric"
          value={position}
          onChange={(event) => setPosition(event.target.value)}
          {...fieldA11y('course-position', errors.position?.[0])}
        />
      </Field>
      <Field
        name="course-description"
        label="What it covers"
        className="sm:col-span-2"
        error={errors.description?.[0]}
      >
        <Textarea
          rows={3}
          maxLength={2000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          {...fieldA11y('course-description', errors.description?.[0])}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={isPending}>
          {course ? 'Save course' : 'Create course'}
        </Button>
        {note && (
          <p role="status" className="text-sm text-muted-foreground">
            {note}
          </p>
        )}
      </div>
    </form>
  );
}

/** Publish, take back to draft, archive or restore, and delete an empty course. */
export function CourseStatusControls({
  courseId,
  status,
  empty,
}: {
  courseId: string;
  status: CourseStatus;
  empty: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const set = (next: CourseStatus) =>
    startTransition(async () => {
      setError(null);
      const result = await setCourseStatusAction({ id: courseId, status: next });
      if (!result.ok) return setError(result.error.message);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {status === 'draft' && (
          <Button disabled={isPending} onClick={() => set('published')}>
            <Send aria-hidden /> Publish to assigned staff
          </Button>
        )}
        {status === 'published' && (
          <Button variant="outline" disabled={isPending} onClick={() => set('draft')}>
            <Undo2 aria-hidden /> Back to draft
          </Button>
        )}
        {status !== 'archived' ? (
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => {
              if (
                window.confirm(
                  'Archive this course? It leaves everyone’s training; results are kept.',
                )
              )
                set('archived');
            }}
          >
            <Archive aria-hidden /> Archive
          </Button>
        ) : (
          <Button variant="outline" disabled={isPending} onClick={() => set('draft')}>
            <Undo2 aria-hidden /> Restore as draft
          </Button>
        )}
        {empty && (
          <Button
            variant="ghost"
            className="text-destructive-text"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                if (!window.confirm('Delete this empty course?')) return;
                const result = await deleteCourseAction({ id: courseId });
                if (!result.ok) return setError(result.error.message);
                router.push('/training/manage');
              })
            }
          >
            <Trash2 aria-hidden /> Delete
          </Button>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** Who must complete the course: everyone, a role, a department or a person (ADR-050). */
export function AssignmentEditor({
  courseId,
  assignments,
  options,
}: {
  courseId: string;
  assignments: AssignmentRow[];
  options: AssignmentOptions;
}) {
  const router = useRouter();
  const audiences = (Object.keys(AUDIENCE_LABELS) as Audience[]).filter(
    (audience) => audience !== 'department' || options.departments.length > 0,
  );
  const [audience, setAudience] = useState<Audience>('role');
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const targets =
    audience === 'role'
      ? options.roles
      : audience === 'department'
        ? options.departments
        : audience === 'person'
          ? options.people
          : [];

  return (
    <div className="flex flex-col gap-4">
      {assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Not assigned to anyone yet. Nobody will see this course until it is assigned and
          published.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {assignments.map((assignment) => (
            <li
              key={assignment.id}
              className="flex items-center gap-1 rounded-full border bg-muted/50 py-1 pr-1 pl-3 text-sm"
            >
              {assignment.label}
              <button
                type="button"
                aria-label={`Remove ${assignment.label}`}
                disabled={isPending}
                className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() =>
                  startTransition(async () => {
                    const result = await removeAssignmentAction({ id: assignment.id });
                    if (!result.ok) return setError(result.error.message);
                    router.refresh();
                  })
                }
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            setError(null);
            const result = await addAssignmentAction({ courseId, audience, targetId });
            if (!result.ok) {
              return setError(result.error.fieldErrors?.targetId?.[0] ?? result.error.message);
            }
            setTargetId('');
            router.refresh();
          });
        }}
      >
        <Field name="assign-audience" label="Assign to">
          <NativeSelect
            id="assign-audience"
            value={audience}
            onChange={(event) => {
              setAudience(event.target.value as Audience);
              setTargetId('');
            }}
          >
            {audiences.map((key) => (
              <option key={key} value={key}>
                {AUDIENCE_LABELS[key]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {audience === 'everyone' ? (
          <p className="pb-2 text-sm text-muted-foreground">Everyone in the business.</p>
        ) : (
          <Field name="assign-target" label="Who">
            <NativeSelect
              id="assign-target"
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
            >
              <option value="">Choose…</option>
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Button type="submit" variant="outline" disabled={isPending}>
          <Plus aria-hidden /> Assign
        </Button>
      </form>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

type QuestionDraft = { prompt: string; options: string[]; correctOption: number };

export type ModuleDraft = {
  title: string;
  body: string;
  videoUrl: string;
  passMark: string;
  position: string;
  questions: QuestionDraft[];
};

/**
 * Writes a module: its content, an optional video and an optional quiz. The quiz is checked here
 * with the same rules the server applies, so every problem shows beside the question it is in.
 */
export function ModuleEditor({
  courseId,
  moduleId,
  initial,
}: {
  courseId: string;
  /** Absent when adding a new module. */
  moduleId?: string;
  initial: ModuleDraft;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const set = <K extends keyof ModuleDraft>(key: K, value: ModuleDraft[K]) =>
    setDraft({ ...draft, [key]: value });
  const setQuestion = (index: number, next: QuestionDraft) =>
    set(
      'questions',
      draft.questions.map((question, at) => (at === index ? next : question)),
    );
  const move = (index: number, by: -1 | 1) => {
    const questions = [...draft.questions];
    const [moved] = questions.splice(index, 1);
    if (moved) questions.splice(index + by, 0, moved);
    set('questions', questions);
  };

  const save = () =>
    startTransition(async () => {
      setNote(null);
      const checked = moduleSchema.safeParse(draft);
      if (!checked.success) {
        const found: Record<string, string> = {};
        for (const issue of checked.error.issues) {
          const key = issue.path.join('.');
          found[key] ??= issue.message;
        }
        setErrors(found);
        return setNote('Please check the highlighted fields.');
      }
      setErrors({});
      const result = moduleId
        ? await updateModuleAction({ ...draft, id: moduleId })
        : await createModuleAction({ ...draft, courseId });
      if (!result.ok) return setNote(result.error.message);
      if (moduleId) {
        setNote('Saved.');
        router.refresh();
      } else {
        router.push(`/training/manage/${courseId}`);
      }
    });

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <section className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-[1fr_8rem]">
        <Field name="module-title" label="Module title" error={errors.title} required>
          <Input
            value={draft.title}
            maxLength={150}
            onChange={(event) => set('title', event.target.value)}
            {...fieldA11y('module-title', errors.title)}
          />
        </Field>
        <Field
          name="module-position"
          label="Order"
          hint="Lower shows first"
          error={errors.position}
        >
          <Input
            inputMode="numeric"
            value={draft.position}
            onChange={(event) => set('position', event.target.value)}
            {...fieldA11y('module-position', errors.position)}
          />
        </Field>
        <Field
          name="module-body"
          label="Content"
          hint="Start a line with “## ” for a heading and “- ” for a bullet point. Leave a blank line between paragraphs."
          error={errors.body}
          className="sm:col-span-2"
        >
          <Textarea
            rows={14}
            value={draft.body}
            onChange={(event) => set('body', event.target.value)}
            {...fieldA11y('module-body', errors.body)}
          />
        </Field>
        <Field
          name="module-video"
          label="Video (optional)"
          hint="A YouTube or Vimeo address plays in the page; any other https:// address is shown as a link."
          error={errors.videoUrl}
          className="sm:col-span-2"
        >
          <Input
            type="url"
            placeholder="https://www.youtube.com/watch?v=…"
            value={draft.videoUrl}
            onChange={(event) => set('videoUrl', event.target.value)}
            {...fieldA11y('module-video', errors.videoUrl)}
          />
        </Field>
      </section>

      <section className="flex flex-col gap-4 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-medium">Quiz</h2>
            <p className="text-sm text-muted-foreground">
              Optional. Without questions, staff mark the module as read and understood.
            </p>
          </div>
          {draft.questions.length > 0 && (
            <Field name="module-pass" label="Pass mark (%)" error={errors.passMark}>
              <Input
                inputMode="numeric"
                className="w-28"
                value={draft.passMark}
                onChange={(event) => set('passMark', event.target.value)}
                {...fieldA11y('module-pass', errors.passMark)}
              />
            </Field>
          )}
        </div>
        <ol className="flex flex-col gap-4">
          {draft.questions.map((question, index) => (
            <li key={index} className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex items-start gap-2">
                <Field
                  name={`question-${index}`}
                  label={`Question ${index + 1}`}
                  error={errors[`questions.${index}.prompt`]}
                  className="flex-1"
                >
                  <Input
                    value={question.prompt}
                    maxLength={500}
                    onChange={(event) =>
                      setQuestion(index, { ...question, prompt: event.target.value })
                    }
                    {...fieldA11y(`question-${index}`, errors[`questions.${index}.prompt`])}
                  />
                </Field>
                <div className="flex gap-1 pt-6">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Move question ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Move question ${index + 1} down`}
                    disabled={index === draft.questions.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove question ${index + 1}`}
                    onClick={() =>
                      set(
                        'questions',
                        draft.questions.filter((_, at) => at !== index),
                      )
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm text-muted-foreground">
                  Answers: choose the right one
                </legend>
                {question.options.map((option, choice) => (
                  <div key={choice} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`correct-${index}`}
                      aria-label={`Answer ${choice + 1} is the right one`}
                      checked={question.correctOption === choice}
                      onChange={() => setQuestion(index, { ...question, correctOption: choice })}
                      className="size-4 accent-primary"
                    />
                    <Input
                      aria-label={`Question ${index + 1}, answer ${choice + 1}`}
                      value={option}
                      maxLength={200}
                      className={cn(question.correctOption === choice && 'border-primary')}
                      onChange={(event) =>
                        setQuestion(index, {
                          ...question,
                          options: question.options.map((value, at) =>
                            at === choice ? event.target.value : value,
                          ),
                        })
                      }
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove answer ${choice + 1}`}
                      disabled={question.options.length <= 2}
                      onClick={() =>
                        setQuestion(index, {
                          ...question,
                          options: question.options.filter((_, at) => at !== choice),
                          correctOption:
                            question.correctOption === choice
                              ? 0
                              : question.correctOption > choice
                                ? question.correctOption - 1
                                : question.correctOption,
                        })
                      }
                    >
                      <X aria-hidden />
                    </Button>
                  </div>
                ))}
                {question.options.length < 6 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="self-start"
                    onClick={() =>
                      setQuestion(index, { ...question, options: [...question.options, ''] })
                    }
                  >
                    <Plus aria-hidden /> Add an answer
                  </Button>
                )}
                <ErrorText>
                  {Object.entries(errors).find(([key]) =>
                    key.startsWith(`questions.${index}.options`),
                  )?.[1] ??
                    errors[`questions.${index}.correctOption`] ??
                    null}
                </ErrorText>
              </fieldset>
            </li>
          ))}
        </ol>
        {draft.questions.length < 30 && (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() =>
              set('questions', [
                ...draft.questions,
                { prompt: '', options: ['', ''], correctOption: 0 },
              ])
            }
          >
            <Plus aria-hidden /> Add a question
          </Button>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {moduleId ? 'Save module' : 'Add module'}
        </Button>
        <Button asChild variant="ghost">
          <Link href={`/training/manage/${courseId}`}>Back to the course</Link>
        </Button>
        {moduleId && (
          <Button asChild variant="ghost">
            <Link href={`/training/modules/${moduleId}`}>
              <Eye aria-hidden /> See it as staff do
            </Link>
          </Button>
        )}
        {note && (
          <p role="status" className="text-sm text-muted-foreground">
            {note}
          </p>
        )}
      </div>
    </form>
  );
}

/** Removes a module nobody has done yet; one with results is kept as their record. */
export function DeleteModuleButton({ moduleId, courseId }: { moduleId: string; courseId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="ghost"
        className="self-start text-destructive-text"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            if (!window.confirm('Delete this module?')) return;
            const result = await deleteModuleAction({ id: moduleId });
            if (!result.ok) return setError(result.error.message);
            router.push(`/training/manage/${courseId}`);
          })
        }
      >
        <Trash2 aria-hidden /> Delete module
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
