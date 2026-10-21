import type { MetadataRoute } from 'next';

/** Lets people add Meroidea to a phone's home screen with its own icon and name. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Meroidea',
    short_name: 'Meroidea',
    description: 'One workspace to run your business.',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#f5f7ff',
    theme_color: '#4b49ac',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
