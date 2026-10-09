import Image from 'next/image';

/*
 * Placeholder logos for invented companies, generated as transparent PNGs. Swap the files in
 * public/logos and the names below for real client logos once workspaces are live — and only
 * claim a company as a client when it actually is one.
 */
const LOGOS = [
  { slug: 'acme', name: 'Acme Group', width: 756 },
  { slug: 'northwind', name: 'Northwind', width: 657 },
  { slug: 'lumen', name: 'Lumen Studio', width: 819 },
  { slug: 'harbour', name: 'Harbour Logistics', width: 990 },
  { slug: 'beacon', name: 'Beacon Health', width: 852 },
  { slug: 'cedarline', name: 'Cedarline', width: 618 },
  { slug: 'vantage', name: 'Vantage Partners', width: 960 },
  { slug: 'kestrel', name: 'Kestrel Freight', width: 846 },
  { slug: 'orbit', name: 'Orbit Labs', width: 657 },
  { slug: 'meridian', name: 'Meridian Group', width: 894 },
];

const HEIGHT = 171;

export function LogoCloud() {
  return (
    <div className="mt-16 sm:mt-20">
      <p className="text-center text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
        Placeholder client logos
      </p>

      <div
        className="group relative mt-7 overflow-hidden"
        style={{
          maskImage: 'linear-gradient(to right, transparent, #000 7%, #000 93%, transparent)',
          WebkitMaskImage: 'linear-gradient(to right, transparent, #000 7%, #000 93%, transparent)',
        }}
      >
        {/* The list is rendered twice so the strip can loop seamlessly at -50%. */}
        <div className="marquee flex w-max items-center gap-12 sm:gap-16">
          {[0, 1].map((pass) =>
            LOGOS.map((logo) => (
              <Image
                key={`${pass}-${logo.slug}`}
                src={`/logos/${logo.slug}.png`}
                alt={pass === 0 ? logo.name : ''}
                aria-hidden={pass === 1}
                width={logo.width}
                height={HEIGHT}
                className="h-6 w-auto opacity-55 grayscale transition-opacity duration-300 sm:h-7"
                priority={false}
              />
            )),
          )}
        </div>
      </div>
    </div>
  );
}
