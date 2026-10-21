import { CalendarCheck, MessagesSquare, ShieldCheck } from 'lucide-react';

import { Reveal } from '@/components/motion/reveal';
import { ContactForm } from '@/modules/enquiries/components/contact-form';

const STEPS = [
  {
    icon: MessagesSquare,
    title: 'Tell us about your business',
    body: 'A few lines on how you work today and what slows you down.',
  },
  {
    icon: CalendarCheck,
    title: 'We talk it through',
    body: 'A short call to understand your team, so the workspace fits from day one.',
  },
  {
    icon: ShieldCheck,
    title: 'We set you up',
    body: 'We prepare your workspace and switch on only what you need. No surprises.',
  },
];

/**
 * Businesses are onboarded by the Meroidea team after a conversation (ADR-029), so the site asks
 * people to get in touch rather than sign up or pick a plan.
 */
export function ContactSection() {
  return (
    <section
      id="contact"
      aria-labelledby="contact-heading"
      className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 pb-24 sm:px-8 sm:pb-32"
    >
      <div className="relative overflow-hidden rounded-3xl border bg-card shadow-sm">
        {/* Soft brand glow behind the panel; decorative. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -left-24 size-96 rounded-full bg-primary/15 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -bottom-32 size-96 rounded-full bg-info/15 blur-3xl"
        />

        <div className="relative grid gap-10 p-6 sm:p-10 lg:grid-cols-[1fr_1.15fr] lg:gap-14 lg:p-14">
          <Reveal>
            <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              Let&rsquo;s talk
            </p>
            <h2
              id="contact-heading"
              className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
            >
              Let&rsquo;s set up your workspace together
            </h2>
            <p className="mt-4 max-w-md text-muted-foreground">
              Every Meroidea workspace is set up with you, not by a sign-up form. Send us a note and
              we&rsquo;ll be in touch soon.
            </p>

            <ol className="mt-8 flex flex-col gap-5">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-4">
                  <span className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <step.icon aria-hidden className="size-5" />
                    <span className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                      {index + 1}
                    </span>
                  </span>
                  <span>
                    <span className="block font-medium">{step.title}</span>
                    <span className="block text-sm text-muted-foreground">{step.body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Reveal>

          <Reveal delay={120}>
            <div className="rounded-2xl border bg-background/80 p-5 shadow-lg backdrop-blur sm:p-7">
              <ContactForm />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
