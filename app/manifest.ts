import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Bracket Control',
    short_name: 'Bracket Control',
    description: 'Offline-first EUCannon tournament bracket playback.',
    start_url: '/',
    display: 'standalone',
    background_color: '#111111',
    theme_color: '#171717',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
