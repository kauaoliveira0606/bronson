// Blocks visitors from Africa and South Asia (Vercel geo headers) from loading any page or posting to any form API.
const BLOCKED_COUNTRIES = new Set(['IN', 'PK', 'BD', 'LK', 'NP']);
export const config = {
  matcher: ['/((?!.*\\.(?:png|jpg|jpeg|webp|avif|svg|ico|css|js|woff2?|mp4|txt|xml)$).*)'],
};

export default function middleware(request) {
  const continent = request.headers.get('x-vercel-ip-continent');
  const country = request.headers.get('x-vercel-ip-country');
  if (continent === 'AF' || BLOCKED_COUNTRIES.has(country)) {
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not available</title><body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#333;text-align:center;padding:24px"><p>Sorry, this page is not available in your region.</p></body>',
      { status: 403, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
    );
  }
}
