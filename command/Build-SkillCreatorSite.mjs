import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const commandRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(commandRoot, '..');
const sourceRoot = path.join(projectRoot, 'project', 'skillcreator-site-static');
const outputRoot = path.join(
  projectRoot,
  'release',
  'skillcreator-site-static',
  'web',
  'release',
);
const stagingRoot = path.join(
  projectRoot,
  'release',
  'skillcreator-site-static',
  'web',
  `.release-staging-${process.pid}`,
);

const readText = (filePath) => readFile(filePath, 'utf8');
const readJson = async (filePath) => JSON.parse(await readText(filePath));
const fileDetails = (filePath) => stat(filePath).catch(() => null);
const shortRevision = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 12);

const pubspecText = await readText(path.join(projectRoot, 'project', 'skillcreator-flutter', 'pubspec.yaml'));
const versionMatch = pubspecText.match(/^version:\s*([^\s+]+)(?:\+[^\s]+)?\s*$/mu);
const version = String(versionMatch?.[1] || '').trim();
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) {
  throw new Error(`Invalid SkillCreator version: ${version}`);
}

const tag = `v${version}`;
const windowsReleaseRoot = path.join(
  projectRoot,
  'release',
  'skillcreator-flutter',
  'windows',
  'release',
);
const manifestPath = path.join(windowsReleaseRoot, `SkillCreator-${tag}-manifest.json`);
const publishStatusPath = path.join(windowsReleaseRoot, `SkillCreator-${tag}-publish-status.json`);

const fallbackMetadataPath = path.join(sourceRoot, 'release.json');
const releaseNotesPath = path.join(projectRoot, 'RELEASE_NOTES.md');

let metadata = await readJson(fallbackMetadataPath);
const manifestDetails = await fileDetails(manifestPath);
if (manifestDetails?.isFile()) {
  const manifest = await readJson(manifestPath);
  if (manifest.version !== version || manifest.tag !== tag || manifest.platform !== 'windows-x64') {
    throw new Error('Windows release manifest does not match the SkillCreator site version.');
  }

    const portableArchive = manifest.portableArchive;
  if (!portableArchive || typeof portableArchive !== 'object') {
    throw new Error('Windows release manifest is missing portableArchive.');
  }
  if (!Number.isSafeInteger(portableArchive.bytes) || portableArchive.bytes <= 0) {
    throw new Error('Portable archive has an invalid size.');
  }
  if (!/^[a-f0-9]{64}$/u.test(String(portableArchive.sha256 || ''))) {
    throw new Error('Portable archive has an invalid SHA-256.');
  }
  const portableAsset = {
    kind: 'portable',
    name: String(portableArchive.name || ''),
    sizeBytes: portableArchive.bytes,
    sha256: String(portableArchive.sha256).toLowerCase(),
  };
  if (!/-Portable\.zip$/iu.test(portableAsset.name)) {
    throw new Error('Portable archive name does not match the Flutter ZIP contract.');
  }


  const publishStatusDetails = await fileDetails(publishStatusPath);
  const publishStatus = publishStatusDetails?.isFile()
    ? await readJson(publishStatusPath)
    : null;
  const published = publishStatus?.status === 'published';

  metadata = {
    schemaVersion: 1,
    project: 'SkillCreator',
    version,
    tag,
    status: published ? 'published' : 'verified',
    visibility: 'public',
    repository: 'nekobyran/skill-agentmd-creator',
    releaseUrl:
      publishStatus?.url ||
      `https://github.com/nekobyran/skill-agentmd-creator/releases/tag/${tag}`,
    publishedAt: publishStatus?.publishedAt || manifest.generatedAtUtc || null,
    platform: 'Windows',
    architecture: 'x64',
        assets: [portableAsset],

    checks: [
      { label: 'Windows x64 release', result: 'passed' },
      { label: 'SHA-256 manifest', result: 'passed' },
      { label: 'Public repository', result: published ? 'passed' : 'unknown' },
    ],
    domain: 'skillcreator.nkbr.cc',
  };
}

if (
  metadata.project !== 'SkillCreator' ||
  metadata.version !== version ||
  metadata.tag !== tag ||
  metadata.visibility !== 'public' ||
  metadata.repository !== 'nekobyran/skill-agentmd-creator' ||
  metadata.domain !== 'skillcreator.nkbr.cc'
) {
  throw new Error('Generated SkillCreator release metadata failed the identity contract.');
}

if (manifestDetails?.isFile()) {
  await writeFile(fallbackMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });
try {
  await cp(sourceRoot, stagingRoot, { recursive: true });

  const [indexTemplate, stylesheetBytes, scriptBytes] = await Promise.all([
    readText(path.join(stagingRoot, 'index.html')),
    readFile(path.join(stagingRoot, 'styles.css')),
    readFile(path.join(stagingRoot, 'app.js')),
  ]);
  const versionedIndex = indexTemplate
    .replace('./styles.css', `./styles.css?v=${shortRevision(stylesheetBytes)}`)
    .replace('./app.js', `./app.js?v=${shortRevision(scriptBytes)}`);

  await Promise.all([
    writeFile(path.join(stagingRoot, 'index.html'), versionedIndex, 'utf8'),
    writeFile(path.join(stagingRoot, 'release.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8'),
    cp(releaseNotesPath, path.join(stagingRoot, 'release-notes.md')),
  ]);

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(path.dirname(outputRoot), { recursive: true });
  await rename(stagingRoot, outputRoot);
} catch (error) {
  await rm(stagingRoot, { recursive: true, force: true });
  throw error;
}

console.log(`Built SkillCreator release site for ${tag}`);
console.log(`release_status=${metadata.status}`);
console.log(`output=${outputRoot}`);
