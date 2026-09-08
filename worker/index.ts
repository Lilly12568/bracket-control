import { GET as importBracket } from '../app/api/import/route';
import { GET as importPlayer } from '../app/api/player/route';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function withCors(response: Response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'GET') {
      return withCors(new Response('Method not allowed.', { status: 405 }));
    }

    const { pathname } = new URL(request.url);
    if (pathname === '/api/import') return withCors(await importBracket(request));
    if (pathname === '/api/player') return withCors(await importPlayer(request));

    return withCors(new Response('Bracket Control API', { status: 200 }));
  },
};
