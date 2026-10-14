'use client';

import type { UseFormRegisterReturn } from 'react-hook-form';

import { Field, fieldA11y } from '@/components/forms/field';
import { NativeSelect } from '@/components/forms/native-select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

import type { CustomFieldDefinition } from '../validation';

/**
 * The business's own fields on a record form (docs/database.md §8). The parent form registers
 * each one under `customFields.<key>`; the server validates them again against the definitions.
 */
export function CustomFieldInputs({
  fields,
  register,
  errorFor,
}: {
  fields: CustomFieldDefinition[];
  register: (key: string) => UseFormRegisterReturn;
  errorFor: (key: string) => string | undefined;
}) {
  return (
    <>
      {fields
        .filter((field) => field.isActive)
        .map((field) => {
          const name = `custom-${field.key}`;
          const error = errorFor(field.key);
          const a11y = fieldA11y(name, error);
          const control = (() => {
            switch (field.fieldType) {
              case 'textarea':
                return <Textarea rows={3} {...a11y} {...register(field.key)} />;
              case 'number':
                return (
                  <Input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    {...a11y}
                    {...register(field.key)}
                  />
                );
              case 'date':
                return <Input type="date" {...a11y} {...register(field.key)} />;
              case 'email':
                return <Input type="email" autoComplete="off" {...a11y} {...register(field.key)} />;
              case 'phone':
                return <Input type="tel" autoComplete="off" {...a11y} {...register(field.key)} />;
              case 'url':
                return (
                  <Input
                    type="url"
                    autoComplete="off"
                    placeholder="https://"
                    {...a11y}
                    {...register(field.key)}
                  />
                );
              case 'boolean':
                return (
                  <label className="flex items-center gap-2 pt-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      id={name}
                      {...register(field.key)}
                    />
                    <span>Yes</span>
                  </label>
                );
              case 'select':
                return (
                  <NativeSelect {...a11y} {...register(field.key)}>
                    <option value="">Not set</option>
                    {field.choices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </NativeSelect>
                );
              case 'multi_select':
                return (
                  <select
                    multiple
                    className="min-h-24 rounded-md border bg-background px-2 py-1 text-sm"
                    {...a11y}
                    {...register(field.key)}
                  >
                    {field.choices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                );
              default:
                return <Input autoComplete="off" {...a11y} {...register(field.key)} />;
            }
          })();
          return (
            <Field
              key={field.id}
              name={name}
              label={field.label}
              required={field.isRequired}
              error={error}
              hint={
                field.description ??
                (field.fieldType === 'multi_select' ? 'Hold Ctrl or ⌘ to pick several.' : undefined)
              }
            >
              {control}
            </Field>
          );
        })}
    </>
  );
}
