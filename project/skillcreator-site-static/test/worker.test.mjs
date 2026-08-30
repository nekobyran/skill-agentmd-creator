import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../worker.js';

const env = {
  ASSETS: {
    fetch: async () => new Response('<!doctype html><title>SkillCreator</title>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  },
};

test('dynamic release API maps the latest non-draft GitHub release and assets', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json([
    {
      draft: true,
      tag_name: 'ignored-draft',
      html_url: 'https://github.com/nekobyran/skill-agentmd-creator/releases/tag/ignored-draft',
      assets: [],
    },
    {
      draft: false,
      prerelease: true,
      tag_name: 'v1.2.3-rc.1',
      name: 'SkillCreator 1.2.3 RC1',
      html_url: 'https://github.com/nekobyran/skill-agentmd-creator/releases/tag/v1.2.3-rc.1',
      published_at: '2026-07-29T00:00:00Z',
      assets: [
        {
          name: 'SkillCreator-v1.2.3-Windows-x64-Setup.exe',
          size: 12345,
          digest: `sha256:${'a'.repeat(64)}`,
          browser_download_url: 'https://github.com/nekobyran/skill-agentmd-creator/releases/download/v1.2.3-rc.1/SkillCreator-v1.2.3-Windows-x64-Setup.exe',
        },
        {
          name: 'SkillCreator-v1.2.3-Windows-x64-Portable.exe',
          size: 54321,
          digest: `sha256:${'b'.repeat(64)}`,
          browser_download_url: 'https://github.com/nekobyran/skill-agentmd-creator/releases/download/v1.2.3-rc.1/SkillCreator-v1.2.3-Windows-x64-Portable.exe',
        },
      ],
    },
  ]));

  const response = await worker.fetch(new Request('https://skillcreator.nkbr.cc/api/release'), env);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.status, 'published');
  assert.equal(payload.discovery, 'github-prerelease');
  assert.equal(payload.tag, 'v1.2.3-rc.1');
  assert.equal(payload.assets.length, 2);
  assert.equal(payload.assets[0].kind, 'installer');
  assert.equal(payload.assets[0].sha256, 'a'.repeat(64));
  assert.match(payload.assets[0].url, /\/releases\/download\/v1\.2\.3-rc\.1\//u);
  assert.match(response.headers.get('cache-control') || '', /no-transform/u);
});

test('dynamic release API falls back to the repository releases page when no public release exists', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json([]));
  const response = await worker.fetch(new Request('https://skillcreator.nkbr.cc/api/release'), env);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.status, 'unavailable');
  assert.equal(payload.discovery, 'no-public-release');
  assert.equal(payload.releaseUrl, 'https://github.com/nekobyran/skill-agentmd-creator/releases');
  assert.deepEqual(payload.assets, []);
});

test('static HTML keeps strict security headers', async () => {
  const response = await worker.fetch(new Request('https://skillcreator.nkbr.cc/'), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy') || '', /default-src 'self'/u);
  assert.match(response.headers.get('strict-transport-security') || '', /max-age=31536000/u);
  assert.match(response.headers.get('cache-control') || '', /no-transform/u);
});
