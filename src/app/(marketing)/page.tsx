import { AboutSection } from '@/components/marketing/about-section';
import { FeatureRow } from '@/components/marketing/feature-row';
import { PricingSection } from '@/components/marketing/pricing-section';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { HeroCta } from '@/components/marketing/hero-cta';
import { WorkspacePreview } from '@/components/marketing/workspace-preview';
import { Reveal } from '@/components/motion/reveal';
import { WavyBackground } from '@/components/motion/wavy-background';

export default function HomePage() {
  return (
    <main className="overflow-x-clip">
      <section className="mx-auto w-full max-w-6xl px-4 pt-[max(3rem,calc((100svh-44rem)*0.5))] text-center sm:px-8 sm:pt-8">
        {/* Full-bleed: the waves run edge to edge behind the whole hero, text and calls to action,
            while the content keeps the column width. */}
        <WavyBackground
          containerClassName="left-1/2 w-screen -translate-x-1/2"
          className="mx-auto max-w-6xl px-4 pt-8 pb-4 sm:px-8 sm:pt-10 sm:pb-6"
        >
          <Reveal>
            <h1 className="mx-auto max-w-4xl text-4xl leading-[1.08] font-semibold tracking-[-0.035em] sm:text-6xl sm:leading-[1.05]">
              One workspace to
              <br />
              <span className="relative inline-block whitespace-nowrap">
                <span className="bg-gradient-to-r from-primary via-info to-primary bg-clip-text text-transparent">
                  run your business
                </span>
                {/* Hand-drawn underline: decorative, so it stays out of the accessibility tree. */}
                <svg
                  aria-hidden
                  viewBox="0 0 300 12"
                  preserveAspectRatio="none"
                  className="absolute -bottom-1.5 left-0 h-2 w-full text-chart-2 sm:-bottom-2 sm:h-3"
                >
                  <path
                    d="M3 8.5C52 3 118 2 168 4.5s92 2.5 129-1"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
              People, sales, work, documents and the numbers behind them — in one place, shaped
              around how your team already works.
            </p>
          </Reveal>
          <Reveal delay={140} className="mt-8">
            <HeroCta />
          </Reveal>
        </WavyBackground>
      </section>

      <WorkspacePreview />
      <AboutSection />
      <HowItWorks />
      <PricingSection />
      <FeatureRow />
    </main>
  );
}
