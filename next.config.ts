import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
