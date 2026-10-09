'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { UserX } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { Field, fieldA11y } from '@/components/forms/field';
import { FormSection } from '@/components/forms/form-section';
import { NativeSelect } from '@/components/forms/native-select';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { endEmploymentAction, updateEmployeeProfileAction } from '@/modules/hiring/staff-actions';
import {
  updateProfileSchema,
  type ProfileFormValues,
  type UpdateProfileInput,
} from '@/modules/hiring/staff-schemas';
import type { DepartmentRow, EmployeeDetail } from '@/modules/hiring/types';

function ageOn(dateOfBirth: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const years = Number(today.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
  return today.slice(5) < dateOfBirth.slice(5) ? years - 1 : years;
}

export function ProfileForm({
  employee,
  departments,
  today,
}: {
  employee: EmployeeDetail;
  departments: DepartmentRow[];
  /** Today's calendar date in the workspace timezone, for showing an age. */
  today: string;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileFormValues, unknown, UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      id: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      preferredName: employee.preferredName ?? '',
      email: employee.email,
      phone: employee.phone ?? '',
      dateOfBirth: employee.dateOfBirth ?? '',
      address: employee.address ?? '',
      departmentId: employee.departmentId ?? '',
      emergencyContactName: employee.emergencyContactName ?? '',
      emergencyContactRelationship: employee.emergencyContactRelationship ?? '',
      emergencyContactPhone: employee.emergencyContactPhone ?? '',
    },
  });
  const dateOfBirth = useWatch({ control, name: 'dateOfBirth' });
  const age = typeof dateOfBirth === 'string' ? ageOn(dateOfBirth, today) : null;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setSaved(false);
    const result = await updateEmployeeProfileAction(values);
    if (!result.ok) {
      for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
        setError(field as keyof ProfileFormValues, { message: messages[0] });
      }
      setFormError(result.error.message);
      return;
    }
    setSaved(true);
    router.refresh();
  });

  const input = (name: keyof ProfileFormValues) => ({
    ...fieldA11y(name, errors[name]?.message),
    ...register(name),
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <FormSection title="Name and contact" description="Legal names appear on contracts.">
        <Field name="firstName" label="First name" error={errors.firstName?.message} required>
          <Input autoComplete="off" {...input('firstName')} />
        </Field>
        <Field name="lastName" label="Last name" error={errors.lastName?.message} required>
          <Input autoComplete="off" {...input('lastName')} />
        </Field>
        <Field
          name="preferredName"
          label="Preferred name"
          hint="Used in lists and rosters instead of the legal name"
          error={errors.preferredName?.message}
          className="sm:col-span-2"
        >
          <Input autoComplete="off" {...input('preferredName')} />
        </Field>
        <Field name="email" label="Email" error={errors.email?.message} required>
          <Input type="email" autoComplete="off" {...input('email')} />
        </Field>
        <Field name="phone" label="Phone" error={errors.phone?.message}>
          <Input type="tel" autoComplete="off" {...input('phone')} />
        </Field>
        <Field
          name="address"
          label="Address"
          error={errors.address?.message}
          className="sm:col-span-2"
        >
          <Textarea rows={2} autoComplete="off" {...input('address')} />
        </Field>
      </FormSection>

      <FormSection title="About" description="Where they sit and the basics payroll asks for.">
        <Field name="departmentId" label="Department" error={errors.departmentId?.message}>
          <NativeSelect {...input('departmentId')}>
            <option value="">Unassigned</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          name="dateOfBirth"
          label="Date of birth"
          hint={age !== null && age >= 0 ? `Age: ${age}` : undefined}
          error={errors.dateOfBirth?.message}
        >
          <Input type="date" max={today} {...input('dateOfBirth')} />
        </Field>
      </FormSection>

      <FormSection
        title="Emergency contact"
        description="Who to call if something happens at work."
      >
        <Field
          name="emergencyContactName"
          label="Name"
          error={errors.emergencyContactName?.message}
        >
          <Input autoComplete="off" {...input('emergencyContactName')} />
        </Field>
        <Field
          name="emergencyContactRelationship"
          label="Relationship"
          error={errors.emergencyContactRelationship?.message}
        >
          <Input autoComplete="off" {...input('emergencyContactRelationship')} />
        </Field>
        <Field
          name="emergencyContactPhone"
          label="Phone"
          error={errors.emergencyContactPhone?.message}
        >
          <Input type="tel" autoComplete="off" {...input('emergencyContactPhone')} />
        </Field>
      </FormSection>

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          Save changes
        </Button>
        {saved && !isDirty && (
          <p role="status" className="text-sm text-muted-foreground">
            Saved.
          </p>
        )}
        {formError && (
          <p role="alert" className="text-sm text-destructive-text">
            {formError}
          </p>
        )}
      </div>
    </form>
  );
}

/** Ending someone's employment is deliberate: it asks for the last day and confirms first. */
export function EndEmployment({
  employeeId,
  name,
  today,
}: {
  employeeId: string;
  name: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [endedOn, setEndedOn] = useState(today);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const confirm = () =>
    startTransition(async () => {
      setError(null);
      const result = await endEmploymentAction({ id: employeeId, endedOn, reason });
      if (!result.ok) return setError(result.error.message);
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <Button variant="outline" className="text-destructive-text" onClick={() => setOpen(true)}>
        <UserX aria-hidden /> End employment
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End {name}’s employment?</AlertDialogTitle>
            <AlertDialogDescription>
              Their record, contracts and payroll details are kept. They move to the Ended list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ended-on">Last day</Label>
              <Input
                id="ended-on"
                type="date"
                value={endedOn}
                onChange={(event) => setEndedOn(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="end-reason">Reason (optional)</Label>
              <Input
                id="end-reason"
                value={reason}
                maxLength={300}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive-text">
                {error}
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={isPending || !endedOn} onClick={confirm}>
              End employment
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Jump straight to another person's profile, keeping the section being looked at. */
export function EmployeeSwitcher({
  currentId,
  section,
  people,
}: {
  currentId: string;
  section: string;
  people: { id: string; name: string }[];
}) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="switch-employee" className="text-xs text-muted-foreground">
        Switch employee
      </Label>
      <NativeSelect
        id="switch-employee"
        className="w-52"
        value={currentId}
        onChange={(event) => router.push(`/staff/${event.target.value}?section=${section}`)}
      >
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
