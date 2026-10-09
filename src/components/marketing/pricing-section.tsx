import { Check } from 'lucide-react';
import Link from 'next/link';

import { Reveal } from '@/components/motion/reveal';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/*
 * PLACEHOLDER PRICES — not a business decision that has been made. Plan codes match
 * `tenant_subscriptions.plan_code` (docs/database.md §3); entitlements are enforced server-side
 * from the same plan codes (ADR-024). Replace the amounts before this page is ever published.
 */
const PLANS = [
  {
    code: 'starter',
    name: 'Starter',
    price: '29',
    tagline: 'For a small team getting off spreadsheets.',
    features: [
      'Up to 3 people',
      'One pipeline, your own stages',
      'Contacts, opportunities and tasks',
      'Documents and checklists',
      'CSV and Excel import',
    ],
    featured: false,
  },
  {
    code: 'team',
    name: 'Team',
    price: '59',
    tagline: 'For a sales team with managers and scopes.',
    features: [
      'Up to 15 people',
      'Unlimited pipelines and custom fields',
      'Teams, roles and record scopes',
      'Referral partners and commissions',
      'Dashboards, reports and exports',
    ],
    featured: true,
  },
  {
    code: 'business',
    name: 'Business',
    price: '99',
    tagline: 'For a business running everything in one place.',
    features: [
      'Unlimited people',
      'Audit log and data retention controls',
      'Your own branding on the workspace',
      'Priority support',
      'API access and webhooks',
    ],
    featured: false,
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-8 sm:pb-32">
      <Reveal className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          Pricing
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          One price per person, everything included
        </h2>
        <p className="mt-4 text-muted-foreground">
          Every plan starts with a 14-day trial, and no card is needed to begin. Change plan or
          cancel from your own settings.
        </p>
      </Reveal>

      {/* Three across at every width, as on desktop; phones get a condensed card. */}
      <div className="mt-12 grid grid-cols-3 gap-2 sm:gap-3 lg:gap-5">
        {PLANS.map((plan, index) => (
          <Reveal key={plan.code} delay={index * 100} className="h-full">
            <article
              className={cn(
                'relative flex h-full flex-col rounded-xl border bg-card px-2.5 pt-5 pb-3 transition-shadow duration-300 hover:shadow-lg sm:p-4 lg:p-6',
                plan.featured && 'border-primary/40 shadow-md ring-1 ring-primary/20',
              )}
            >
              {plan.featured && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium whitespace-nowrap text-primary-foreground sm:text-xs lg:left-6 lg:translate-x-0 lg:px-2.5">
                  Most popular
                </span>
              )}

              <h3 className="text-sm font-medium sm:text-base">{plan.name}</h3>
              <p className="mt-1 hidden text-sm text-muted-foreground md:block">{plan.tagline}</p>

              <p className="mt-2 flex flex-col gap-0.5 md:mt-5 md:flex-row md:items-baseline md:gap-1.5">
                <span className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  ${plan.price}
                </span>
                <span className="text-[10px] leading-tight text-muted-foreground sm:text-xs md:text-sm">
                  per person / month
                </span>
              </p>

              <ul className="mt-4 flex flex-1 flex-col gap-2 text-[11px] leading-snug sm:text-xs md:mt-6 md:gap-2.5 md:text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-1 sm:gap-2">
                    <Check aria-hidden className="mt-0.5 size-3 shrink-0 text-primary md:size-4" />
                    <span className="text-muted-foreground">{feature}</span>
                  </li>
                ))}
              </ul>

              <Button
                asChild
                size="lg"
                variant={plan.featured ? 'default' : 'outline'}
                className="mt-4 px-0 md:mt-7"
              >
                <Link href="/signup">Start free</Link>
              </Button>
            </article>
          </Reveal>
        ))}
      </div>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Prices in AUD, excluding GST. Your data stays exportable on every plan.
      </p>
    </section>
  );
}
