import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

export const JOB_TYPES = ['casual', 'part_time', 'full_time', 'contract'] as const;
export const JOB_TYPE_LABELS: Record<(typeof JOB_TYPES)[number], string> = {
  casual: 'Casual',
  part_time: 'Part-time',
  full_time: 'Full-time',
  contract: 'Contract',
};

export const STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  applied: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  hired: 'Hired',
  rejected: 'Not progressing',
};

export const OPENING_STATUS_LABELS = { draft: 'Draft', open: 'Open', closed: 'Closed' } as const;
export type OpeningStatus = keyof typeof OPENING_STATUS_LABELS;

export const saveOpeningSchema = z.object({
  id: z.uuid().optional(),
  title: z.string().trim().min(2, 'Enter the job title').max(120),
  employmentType: z.enum(JOB_TYPES),
  location: optionalText(120),
  description: z.string().trim().min(20, 'Describe the job in a few sentences').max(8000),
});

export const openingStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(['draft', 'open', 'closed']),
});

/** What an applicant sends from the public page, and what staff type when adding one by hand. */
export const applicantFieldsSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name').max(120),
  email: z.email('Enter a valid email address').max(200),
  phone: optionalText(40),
  coverNote: optionalText(3000),
});
export const addApplicantSchema = applicantFieldsSchema.extend({ jobOpeningId: z.uuid() });

export const moveApplicantSchema = z.object({
  id: z.uuid(),
  stage: z.enum(STAGES),
  rejectionReason: optionalText(300),
});
export const rateApplicantSchema = z.object({
  id: z.uuid(),
  rating: z.number().int().min(1).max(5).nullable(),
});
export const addNoteSchema = z.object({
  applicantId: z.uuid(),
  body: z.string().trim().min(1, 'Write a note').max(4000),
});
export const idSchema = z.object({ id: z.uuid() });

export type SaveOpeningInput = z.output<typeof saveOpeningSchema>;
export type SaveOpeningValues = z.input<typeof saveOpeningSchema>;
export type ApplicantFields = z.output<typeof applicantFieldsSchema>;
export type AddApplicantInput = z.output<typeof addApplicantSchema>;
export type MoveApplicantInput = z.output<typeof moveApplicantSchema>;
