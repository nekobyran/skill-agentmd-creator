const CSP = "default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; manifest-src 'self'; media-src 'none'; worker-src 'none'; upgrade-insecure-requests";
const REPOSITORY = 'nekobyran/skill-agentmd-creator';
const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`;
const GITHUB_API = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=20`;

function securityHeaders(headers, contentType = '') {
  headers.set('Content-Security-Policy', CSP);
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), publickey-credentials-get=(), usb=()');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  if (contentType.includes('text/html')) {
    headers.set('Cache-Control', 'public, max-age=0, must-revalidate, no-transform');
  }
  return headers;
}

function fallbackRelease(reason = 'unavailable') {
  return {
    schemaVersion: 1,
    project: 'SkillCreator',
    version: '',
    tag: '',
    status: 'unavailable',
    visibility: 'public',
    repository: REPOSITORY,
    releaseUrl: RELEASES_URL,
    publishedAt: null,
    platform: 'Windows',
    architecture: 'x64',
    assets: [],
    discovery: reason,
  };
}

function digest(asset) {
  const match = String(asset?.digest || '').match(/^sha256:([a-f0-9]{64})$/iu);
  return match ? match[1].toLowerCase() : null;
}

function validAssetUrl(value) {
  const prefix = `${RELEASES_URL}/download/`;
  return typeof value === 'string' && value.startsWith(prefix);
}

function normalizeAsset(asset, kind) {
  const url = validAssetUrl(asset?.browser_download_url) ? asset.browser_download_url : null;
  if (!url) return null;
  return {
    kind,
    name: String(asset.name || ''),
    sizeBytes: Number.isSafeInteger(asset.size) && asset.size > 0 ? asset.size : 0,
    sha256: digest(asset),
    url,
  };
}

function selectAsset(assets, patterns) {
  for (const pattern of patterns) {
    const found = assets.find((asset) => pattern.test(String(asset?.name || '')));
    if (found) return found;
  }
  return null;
}

async function resolveLatestRelease() {
  const response = await fetch(GITHUB_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'skillcreator.nkbr.cc',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cf: { cacheEverything: true, cacheTtl: 300 },
  });
  if (!response.ok) return fallbackRelease(`github-http-${response.status}`);
  const releases = await response.json();
  const latest = Array.isArray(releases)
    ? releases.find((release) => release && release.draft !== true)
    : null;
  if (!latest) return fallbackRelease('no-public-release');

  const releaseUrl = typeof latest.html_url === 'string' && latest.html_url.startsWith(`${RELEASES_URL}/`)
    ? latest.html_url
    : RELEASES_URL;
  const assets = Array.isArray(latest.assets) ? latest.assets : [];
  const installer = normalizeAsset(selectAsset(assets, [
    /skillcreator.*windows.*x64.*setup\.exe$/iu,
    /windows.*x64.*setup\.exe$/iu,
    /setup\.exe$/iu,
  ]), 'installer');
  const portable = normalizeAsset(selectAsset(assets, [
    /skillcreator.*windows.*x64.*portable\.exe$/iu,
    /windows.*x64.*portable\.exe$/iu,
    /portable\.exe$/iu,
  ]), 'portable');

  return {
    schemaVersion: 1,
    project: 'SkillCreator',
    version: String(latest.tag_name || '').replace(/^v/iu, ''),
    tag: String(latest.tag_name || ''),
    status: 'published',
    visibility: 'public',
    repository: REPOSITORY,
    releaseUrl,
    publishedAt: latest.published_at || latest.created_at || null,
    platform: 'Windows',
    architecture: 'x64',
    assets: [installer, portable].filter(Boolean),
    discovery: latest.prerelease ? 'github-prerelease' : 'github-release',
  };
}

async function releaseApi(request) {
  let payload;
  try {
    payload = await resolveLatestRelease();
  } catch (error) {
    console.warn(JSON.stringify({ event: 'github_release_lookup_failed', message: String(error) }));
    payload = fallbackRelease('github-request-failed');
  }
  const headers = securityHeaders(new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600, no-transform',
  }));
  return new Response(request.method === 'HEAD' ? null : `${JSON.stringify(payload)}\n`, {
    status: 200,
    headers,
  });
}

export default {
  async fetch(request, env) {
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const url = new URL(request.url);
    if (url.pathname === '/api/release') return releaseApi(request);

    const response = await env.ASSETS.fetch(request);
    const headers = securityHeaders(new Headers(response.headers), response.headers.get('Content-Type') || '');
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
