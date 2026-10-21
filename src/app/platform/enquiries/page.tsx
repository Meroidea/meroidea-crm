import { Inbox, Mail, Phone } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/data/empty-state';
import { PageHeader } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { EnquiryStatusSelect } from '@/modules/enquiries/components/enquiry-status';
import type { EnquiryStatus } from '@/modules/enquiries/schemas';
import { listEnquiries } from '@/modules/enquiries/service';
import { requirePlatformAdmin } from '@/server/platform';

export const metadata: Metadata = { title: 'Enquiries' };

const DATE = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Australia/Sydney',
});

export default async function EnquiriesPage() {
  const admin = await requirePlatformAdmin();
  const enquiries = await listEnquiries(admin);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Enquiries"
        description="Messages from the website's “Let's talk” form. Reply by email, then mark them contacted."
      />
      {enquiries.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={Inbox}
            title="No enquiries yet"
            description="When a business gets in touch through the website, it appears here and is emailed to you."
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {enquiries.map((enquiry) => (
            <li
              key={enquiry.id}
              id={enquiry.id}
              className="scroll-mt-20 rounded-xl border bg-card p-4 target:ring-2 target:ring-primary/40 sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {enquiry.company}
                    {enquiry.status === 'new' && <Badge>New</Badge>}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {enquiry.name}
                    {enquiry.businessType ? ` · ${enquiry.businessType}` : ''}
                    {enquiry.teamSize ? ` · team of ${enquiry.teamSize}` : ''} ·{' '}
                    {DATE.format(enquiry.createdAt)}
                  </p>
                </div>
                <EnquiryStatusSelect id={enquiry.id} status={enquiry.status as EnquiryStatus} />
              </div>
              <p className="mt-3 text-sm whitespace-pre-wrap">{enquiry.message}</p>
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <a
                  href={`mailto:${enquiry.email}?subject=${encodeURIComponent('Your Meroidea enquiry')}`}
                  className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline"
                >
                  <Mail aria-hidden className="size-4" /> {enquiry.email}
                </a>
                {enquiry.phone && (
                  <a
                    href={`tel:${enquiry.phone.replace(/[^+\d]/g, '')}`}
                    className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline"
                  >
                    <Phone aria-hidden className="size-4" /> {enquiry.phone}
                  </a>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
