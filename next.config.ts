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
        /^\/jobs\//,
        /^\/api\/jobs\//,
        /^\/r\//,
        /^\/api\/reviews\//,
        /^\/support\//,
        /^\/api\/support\//,
      ],
    },
  },
};

export default nextConfig;
