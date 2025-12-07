/**
 * Cloudflare Pages Function - Multi-Storage Data Proxy
 * 
 * Serves data files from multiple storage backends with configurable fetch order.
 * Supports: R2 (native binding), DO Spaces (HTTP)
 * 
 * Environment Variables (set in wrangler.toml):
 *   STORAGE_ORDER    - Comma-separated fetch order: "do,r2" (default)
 *   DO_SPACES_URL    - Base URL for DO Spaces (required if 'do' in STORAGE_ORDER)
 * 
 * R2 Binding (required if 'r2' in STORAGE_ORDER):
 *   DATA_BUCKET - R2 bucket binding
 */

// === MIME Types ===
const MIME_TYPES = {
  json: 'application/json',
  html: 'text/html; charset=utf-8',
  css: 'text/css',
  js: 'application/javascript',
  png: 'image/png',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  txt: 'text/plain',
};

// === Utility Functions ===

function getExtension(path) {
  return path.split('.').pop()?.toLowerCase() || '';
}

function getMimeType(path) {
  return MIME_TYPES[getExtension(path)] || 'application/octet-stream';
}

function normalizePath(params) {
  let path = '';
  if (Array.isArray(params.path)) {
    path = params.path.join('/');
  } else if (params.path) {
    path = String(params.path);
  }
  if (!path || path === '') return 'index.json';
  return path;
}

function getCacheKey(request) {
  const url = new URL(request.url);
  return new Request(`${url.origin}${url.pathname}`, { method: 'GET' });
}

function buildResponse(body, path, source, cacheTTL = 300) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': getMimeType(path),
      'Cache-Control': `public, max-age=${cacheTTL}`,
      'CDN-Cache-Control': `public, max-age=${cacheTTL}`,
      'X-Served-From': source,
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// === Storage Fetchers ===

async function fetchFromR2(env, path) {
  if (!env.DATA_BUCKET) return null;

  const object = await env.DATA_BUCKET.get(path);
  if (!object) return null;

  return buildResponse(object.body, path, 'cloudflare-r2');
}

async function fetchFromSpaces(env, path) {
  const baseUrl = env.DO_SPACES_URL;
  if (!baseUrl) return null;

  const url = `${baseUrl.replace(/\/$/, '')}/${path}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Cloudflare-Pages/1.0' },
  });

  if (!response.ok) return null;

  return buildResponse(response.body, path, 'digitalocean-spaces');
}

// === Source Chain ===

const STORAGE_BACKENDS = {
  r2: { name: 'cloudflare-r2', fetch: fetchFromR2 },
  do: { name: 'digitalocean-spaces', fetch: fetchFromSpaces },
};

function getSourceChain(env) {
  const orderStr = env.STORAGE_ORDER || 'do,r2';
  const order = orderStr.split(',').map(s => s.trim().toLowerCase());
  
  const sources = [];
  
  for (const backend of order) {
    if (backend === 'r2' && env.DATA_BUCKET) {
      sources.push(STORAGE_BACKENDS.r2);
    } else if (backend === 'do' && env.DO_SPACES_URL) {
      sources.push(STORAGE_BACKENDS.do);
    }
  }
  
  return sources;
}

// === Main Handler ===

export async function onRequest(context) {
  const { request, env, params } = context;
  const path = normalizePath(params);

  // Check edge cache first
  const cache = caches.default;
  const cacheKey = getCacheKey(request);
  const cached = await cache.match(cacheKey);

  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set('X-Cache-Status', 'HIT');
    return response;
  }

  // Try each source in chain
  const sources = getSourceChain(env);
  let lastError = null;

  for (const source of sources) {
    try {
      const response = await source.fetch(env, path);
      if (response) {
        // Clone for cache, return original
        const responseToCache = response.clone();
        context.waitUntil(cache.put(cacheKey, responseToCache));

        response.headers.set('X-Cache-Status', 'MISS');
        return response;
      }
    } catch (err) {
      console.error(`${source.name} error for ${path}: ${err.message}`);
      lastError = err;
    }
  }

  // Nothing found
  return new Response(`Not Found: ${path}`, {
    status: 404,
    headers: {
      'Content-Type': 'text/plain',
      'X-Cache-Status': 'MISS',
      'X-Error': lastError?.message || 'not-found',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

