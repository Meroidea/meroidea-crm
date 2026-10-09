'use client';

import { Check, FolderTree, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { NativeSelect } from '@/components/forms/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  assignDepartmentAction,
  createDepartmentAction,
  deleteDepartmentAction,
  renameDepartmentAction,
} from '@/modules/hiring/staff-actions';
import type { DepartmentRow } from '@/modules/hiring/types';

/** Add, rename and remove departments without leaving the staff list. */
export function DepartmentManager({ departments }: { departments: DepartmentRow[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (
    action: () => Promise<{ ok: boolean; error?: { message: string } }>,
    after?: () => void,
  ) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) return setError(result.error?.message ?? 'Something went wrong.');
      after?.();
      router.refresh();
    });

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">
          <FolderTree aria-hidden /> Departments
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Departments</SheetTitle>
          <SheetDescription>
            Group people however your business is organised: by department, division, site or team.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim())
                run(
                  () => createDepartmentAction({ name }),
                  () => setName(''),
                );
            }}
          >
            <Input
              aria-label="New department name"
              placeholder="New department"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
            />
            <Button type="submit" disabled={isPending || !name.trim()}>
              <Plus aria-hidden /> Add
            </Button>
          </form>
          {error && (
            <p role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          )}

          {departments.length === 0 ? (
            <p className="rounded-lg bg-muted px-3 py-4 text-center text-sm text-muted-foreground">
              No departments yet. Add your first one above.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {departments.map((department) => (
                <li key={department.id} className="flex items-center gap-2 px-3 py-2">
                  {editing?.id === department.id ? (
                    <form
                      className="flex flex-1 gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        run(
                          () => renameDepartmentAction(editing),
                          () => setEditing(null),
                        );
                      }}
                    >
                      <Input
                        autoFocus
                        aria-label={`Rename ${department.name}`}
                        value={editing.name}
                        maxLength={60}
                        onChange={(event) =>
                          setEditing({ id: department.id, name: event.target.value })
                        }
                      />
                      <Button type="submit" size="icon" aria-label="Save name" disabled={isPending}>
                        <Check aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Cancel"
                        onClick={() => setEditing(null)}
                      >
                        <X aria-hidden />
                      </Button>
                    </form>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {department.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {department.headcount} {department.headcount === 1 ? 'person' : 'people'}
                        </span>
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Rename ${department.name}`}
                        onClick={() => setEditing({ id: department.id, name: department.name })}
                      >
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${department.name}`}
                        disabled={isPending}
                        onClick={() => {
                          const people = department.headcount;
                          const note = people
                            ? ` Its ${people === 1 ? 'person' : `${people} people`} will become unassigned.`
                            : '';
                          if (window.confirm(`Delete “${department.name}”?${note}`)) {
                            run(() => deleteDepartmentAction({ id: department.id }));
                          }
                        }}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** A compact picker on each row of the staff list: move someone without opening their profile. */
export function DepartmentSelect({
  employeeId,
  employeeName,
  value,
  departments,
}: {
  employeeId: string;
  employeeName: string;
  value: string | null;
  departments: DepartmentRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <NativeSelect
      aria-label={`Department for ${employeeName}`}
      className="h-8 w-36 text-xs sm:w-44"
      value={value ?? ''}
      disabled={isPending || departments.length === 0}
      onChange={(event) =>
        startTransition(async () => {
          await assignDepartmentAction({ employeeId, departmentId: event.target.value });
          router.refresh();
        })
      }
    >
      <option value="">Unassigned</option>
      {departments.map((department) => (
        <option key={department.id} value={department.id}>
          {department.name}
        </option>
      ))}
    </NativeSelect>
  );
}
