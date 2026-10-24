import type { NextConfig } from 'next';

// Directives that hold without nonces, so they cannot break the editor, video embeds or Next's own
// scripts. A full script policy is a separate step (ADR-059).
const baseDirectives = "base-uri 'self'; form-action 'self'; object-src 'none'";

// Pages whose address carries a one-time secret: never sent onward in a Referer header.
const secretLinkPages = '/:area(offer|agreement|r|support|jobs|f)/:path*';

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Location is for clocking in at the workplace (ADR-033); nothing uses the rest.
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), browsing-topics=()',
          },
        ],
      },
      // No other site may frame the app (clickjacking), except website forms, which a business
      // embeds on its own site (/f/{key}?embed=1).
      {
        source: '/:path((?!f/).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: `frame-ancestors 'none'; ${baseDirectives}` },
        ],
      },
      {
        source: '/f/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: `frame-ancestors *; ${baseDirectives}` },
        ],
      },
      { source: secretLinkPages, headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
      { source: '/auth/confirm', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
    ];
  },
  logging: {
    // The dev server otherwise prints every Server Action's arguments to the terminal, which
    // includes passwords, tax file numbers and bank details.
    serverFunctions: false,
    // The address of a one-time offer link is its secret; keep it out of the request log too.
    incomingRequests: {
      ignore: [
        /^\/offer\//,
        /^\/agreement\//,
        // A set-your-password link: its query string is a one-time sign-in token.
        /^\/auth\/confirm/,
        /^\/jobs\//,
        /^\/api\/jobs\//,
        /^\/r\//,
        /^\/api\/reviews\//,
        /^\/support\//,
        /^\/api\/support\//,
        // A website form's key is what lets anyone post to it.
        /^\/f\//,
        /^\/api\/forms\//,
      ],
    },
  },
};

export default nextConfig;
