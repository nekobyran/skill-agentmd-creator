import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const commandRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandRoot, '..');
const requireRelease = process.argv.includes('--require-release');
const explicitRoot = process.argv.find((argument) => argument.startsWith('--root='));
const siteRoot = explicitRoot
  ? path.resolve(projectRoot, explicitRoot.slice('--root='.length))
  : path.join(projectRoot, 'site');

const requiredFiles = [
  'index.html',
  '404.html',
  'styles.css',
  'app.js',
  'favicon.svg',
  'manifest.webmanifest',
  '_headers',
  '_redirects',
  'release.json',
  'robots.txt',
  'sitemap.xml',
];

const failures = [];
const notices = [];
const readText = (relativePath) => readFile(path.join(siteRoot, relativePath), 'utf8');

for (const relativePath of requiredFiles) {
  const details = await stat(path.join(siteRoot, relativePath)).catch(() => null);
  if (!details?.isFile()) failures.push(`Missing static site file: ${relativePath}`);
}

if (failures.length === 0) {
  const [html, notFound, css, script, headers, redirects, releaseText, manifestText] =
    await Promise.all([
      readText('index.html'),
      readText('404.html'),
      readText('styles.css'),
      readText('app.js'),
      readText('_headers'),
      readText('_redirects'),
      readText('release.json'),
      readText('manifest.webmanifest'),
    ]);

  let release;
  try {
    release = JSON.parse(releaseText);
    JSON.parse(manifestText);
  } catch (error) {
    failures.push(`Static JSON is invalid: ${error.message}`);
    release = {};
  }

  const checks = [
    [html.includes('lang="zh-CN"'), 'HTML language is zh-CN'],
    [html.includes('class="skip-link"'), 'Keyboard skip link exists'],
    [html.includes('aria-live="polite"'), 'Live status region exists'],
    [html.includes('https://skillcreator.nkbr.cc/'), 'Canonical SkillCreator domain exists'],
    [html.includes('nekobyran/skill-agentmd-creator'), 'Public repository links exist'],
    [html.includes('noscript'), 'No-script fallback exists'],
    [notFound.includes('规则路径'), 'Custom 404 page exists'],
    [css.includes('prefers-reduced-motion: reduce'), 'Reduced-motion CSS exists'],
    [script.includes('prefers-reduced-motion: reduce'), 'Reduced-motion runtime detection exists'],
    [script.includes('navigator.connection?.saveData'), 'Data-saver adaptation exists'],
    [script.includes('navigator.deviceMemory'), 'Memory-aware quality adaptation exists'],
    [script.includes('document.visibilityState'), 'Hidden-tab animation pause exists'],
    [script.includes('IntersectionObserver'), 'Viewport reveal uses IntersectionObserver'],
    [script.includes("getContext('2d'"), 'Adaptive Canvas rule field exists'],
    [headers.includes('Content-Security-Policy'), 'Content Security Policy exists'],
    [headers.includes('Permissions-Policy'), 'Permissions Policy exists'],
    [redirects.includes('/index.html'), 'Canonical index redirect exists'],
    [release.project === 'SkillCreator', 'Release project identity is SkillCreator'],
    [release.visibility === 'public', 'Release visibility is public'],
    [release.repository === 'nekobyran/skill-agentmd-creator', 'Release repository matches'],
    [release.domain === 'skillcreator.nkbr.cc', 'Release domain matches'],
    [release.releaseUrl?.startsWith('https://github.com/'), 'Release URL uses HTTPS GitHub'],
  ];

  if (siteRoot.includes(`${path.sep}release${path.sep}`)) {
    checks.push(
      [/\.\/styles\.css\?v=[a-f0-9]{12}/u.test(html), 'Stylesheet has a content revision'],
      [/\.\/app\.js\?v=[a-f0-9]{12}/u.test(html), 'Script has a content revision'],
    );
  }

  if (requireRelease) {
    const assets = Array.isArray(release.assets) ? release.assets : [];
    checks.push(
      [release.status === 'verified' || release.status === 'published', 'Windows release is verified'],
      [assets.length === 2, 'Installer and portable assets exist'],
      [assets.every((asset) => Number.isSafeInteger(asset.sizeBytes) && asset.sizeBytes > 0), 'Asset sizes are valid'],
      [assets.every((asset) => /^[a-f0-9]{64}$/u.test(asset.sha256 || '')), 'Asset SHA-256 values are valid'],
    );
  }

  for (const [passed, label] of checks) {
    if (!passed) failures.push(label);
  }

  const forbiddenPatterns = [
    /CLOUDFLARE_API_TOKEN\s*[:=]\s*["'][^"']+/iu,
    /GITHUB_TOKEN\s*[:=]\s*["'][^"']+/iu,
    /ghp_[a-z0-9]{20,}/iu,
    /github_pat_[a-z0-9_]{20,}/iu,
    /Bearer\s+[a-z0-9._-]{24,}/iu,
    /[A-Z]:\\vibecoding\\/u,
  ];

  const entries = await readdir(siteRoot, { recursive: true });
  for (const relativePath of entries) {
    if (/\.(?:exe|msi|zip|pdb|dll)$/iu.test(relativePath)) {
      failures.push(`Static site must not host release binary: ${relativePath}`);
      continue;
    }
    if (!/\.(?:html|css|js|json|md|txt|xml|svg|webmanifest)$/iu.test(relativePath)) continue;
    const content = await readText(relativePath);
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(content)) failures.push(`Potential secret or local path in ${relativePath}`);
    }
  }

  const budgets = new Map([
    ['index.html', 32 * 1024],
    ['styles.css', 96 * 1024],
    ['app.js', 64 * 1024],
    ['release.json', 16 * 1024],
  ]);
  for (const [relativePath, limit] of budgets) {
    const details = await stat(path.join(siteRoot, relativePath));
    if (details.size > limit) {
      failures.push(`${relativePath} exceeds budget: ${details.size} > ${limit}`);
    } else {
      notices.push(`${relativePath}: ${details.size} bytes`);
    }
  }
}

if (failures.length > 0) {
  console.error('SkillCreator release site verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`SkillCreator release site verification passed: ${siteRoot}`);
  for (const notice of notices) console.log(`- ${notice}`);
}
