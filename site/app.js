const root = document.documentElement;
root.classList.add('js');

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
const saveData = navigator.connection?.saveData === true;
const deviceMemory = Number(navigator.deviceMemory || 8);
const hardwareConcurrency = Number(navigator.hardwareConcurrency || 8);
const reducedMotion = motionQuery.matches;
const lowQuality = saveData || deviceMemory <= 4 || hardwareConcurrency <= 4;

root.dataset.motion = reducedMotion ? 'reduced' : 'full';
root.dataset.quality = lowQuality ? 'low' : 'high';

const byId = (id) => document.getElementById(id);
const revealItems = [...document.querySelectorAll('[data-reveal]')];
const topbar = document.querySelector('.topbar');
const machine = document.querySelector('.hero-machine');
const toast = byId('toast');
let toastTimer = 0;

const showToast = (message) => {
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2600);
};

const formatFileSize = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '大小待发布';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : value >= 100 ? 0 : 1)} ${units[exponent]}`;
};

const formatReleaseDate = (value) => {
  if (!value) return '发布时间待记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '发布时间待记录';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const FALLBACK_RELEASE = {
  schemaVersion: 1,
  project: 'SkillCreator',
  version: '',
  tag: '',
  status: 'unavailable',
  visibility: 'public',
  repository: 'nekobyran/skill-agentmd-creator',
  releaseUrl: 'https://github.com/nekobyran/skill-agentmd-creator/releases',
  publishedAt: null,
  platform: 'Windows',
  architecture: 'x64',
  assets: [],
};

const renderRelease = (release) => {
  const data = { ...FALLBACK_RELEASE, ...release };
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const installer = assets.find((asset) => asset.kind === 'installer') || {};
  const portable = assets.find((asset) => asset.kind === 'portable') || {};
  const releaseUrl = data.releaseUrl || FALLBACK_RELEASE.releaseUrl;
  const tag = data.tag || (data.version ? `v${data.version}` : 'Latest');
  const ready = data.status === 'published';

  const primaryRelease = byId('primary-release-link');
  if (primaryRelease) primaryRelease.href = installer.url || releaseUrl;
  const releaseLink = byId('release-link');
  if (releaseLink) releaseLink.href = releaseUrl;
  const headerRelease = document.querySelector('.header-release');
  if (headerRelease) headerRelease.href = releaseUrl;

  byId('header-version').textContent = tag;
  byId('release-version').textContent = tag;
  byId('release-date').textContent = formatReleaseDate(data.publishedAt);
  byId('release-state').textContent = ready ? 'RELEASED' : 'UNAVAILABLE';
  byId('installer-name').textContent = installer.name || '发布清单暂不可用';
  byId('installer-size').textContent = formatFileSize(installer.sizeBytes);
  byId('portable-name').textContent = portable.name || '发布清单暂不可用';
  byId('portable-size').textContent = formatFileSize(portable.sizeBytes);
  byId('release-checksum').textContent = installer.sha256 || 'SHA-256 unavailable';

  const copyButton = byId('copy-checksum');
  if (copyButton) {
    copyButton.disabled = true;
    delete copyButton.dataset.checksum;
    if (/^[a-f0-9]{64}$/iu.test(installer.sha256 || '')) {
      copyButton.disabled = false;
      copyButton.dataset.checksum = installer.sha256;
    }
  }

};

const loadRelease = async () => {
  try {
    const response = await fetch('/api/release', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderRelease(await response.json());
  } catch (error) {
    renderRelease(FALLBACK_RELEASE);
    console.info('Release metadata is unavailable.', error);
  }
};

const copyText = async (value) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement('textarea');
  field.value = value;
  field.readOnly = true;
  field.className = 'clipboard-fallback';
  document.body.append(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('Copy failed');
};

byId('copy-checksum')?.addEventListener('click', async (event) => {
  const checksum = event.currentTarget.dataset.checksum;
  if (!checksum) return;
  try {
    await copyText(checksum);
    showToast('安装包 SHA-256 已复制。');
  } catch {
    showToast('复制失败，请手动选择校验值。');
  }
});

const revealAll = () => revealItems.forEach((item) => item.classList.add('is-visible'));

if ('IntersectionObserver' in window && !reducedMotion && !saveData) {
  const observer = new IntersectionObserver(
    (entries, currentObserver) => {
      for (const entry of entries) {
        const passedViewport = entry.boundingClientRect.top < window.innerHeight;
        if (!entry.isIntersecting && !passedViewport) continue;
        entry.target.classList.add('is-visible');
        currentObserver.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  root.classList.add('reveal-enhanced');
  for (const item of revealItems) observer.observe(item);
  window.setTimeout(() => {
    revealAll();
    observer.disconnect();
  }, 900);
} else {
  revealAll();
}

let scrollTicking = false;
const updateScrollState = () => {
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const range = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  root.style.setProperty('--scroll', String(Math.min(1, scrollTop / range)));
  topbar?.classList.toggle('is-scrolled', scrollTop > 24);

  for (const item of revealItems) {
    if (item.classList.contains('is-visible')) continue;
    if (item.getBoundingClientRect().top < window.innerHeight * 1.08) {
      item.classList.add('is-visible');
    }
  }
  scrollTicking = false;
};

window.addEventListener(
  'scroll',
  () => {
    if (scrollTicking) return;
    scrollTicking = true;
    window.requestAnimationFrame(updateScrollState);
  },
  { passive: true },
);
updateScrollState();

if (finePointerQuery.matches && !reducedMotion && !lowQuality) {
  let pointerTicking = false;
  let pointerX = window.innerWidth / 2;
  let pointerY = window.innerHeight / 2;

  window.addEventListener(
    'pointermove',
    (event) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (pointerTicking) return;
      pointerTicking = true;
      window.requestAnimationFrame(() => {
        const normalizedX = pointerX / Math.max(1, window.innerWidth) - 0.5;
        const normalizedY = pointerY / Math.max(1, window.innerHeight) - 0.5;
        root.style.setProperty('--pointer-x', `${pointerX}px`);
        root.style.setProperty('--pointer-y', `${pointerY}px`);
        root.style.setProperty('--machine-x', `${normalizedX * 18}px`);
        root.style.setProperty('--machine-y', `${normalizedY * 14}px`);
        root.style.setProperty('--machine-rx', `${normalizedY * -5}deg`);
        root.style.setProperty('--machine-ry', `${normalizedX * 7}deg`);
        machine?.classList.add('is-active');
        pointerTicking = false;
      });
    },
    { passive: true },
  );

  for (const element of document.querySelectorAll('.magnetic')) {
    element.addEventListener('pointermove', (event) => {
      const bounds = element.getBoundingClientRect();
      const x = (event.clientX - bounds.left - bounds.width / 2) * 0.13;
      const y = (event.clientY - bounds.top - bounds.height / 2) * 0.13;
      element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    });
    element.addEventListener('pointerleave', () => {
      element.style.transform = '';
    });
  }
}

const initializeRuleField = () => {
  const canvas = byId('rule-field');
  if (!canvas || reducedMotion || saveData || deviceMemory <= 2) return;
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return;

  const nodeCount = lowQuality ? 26 : 54;
  const frameInterval = lowQuality ? 1000 / 30 : 1000 / 60;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let frame = 0;
  let lastTime = 0;
  let pointerX = 0.5;
  let pointerY = 0.35;
  let stopped = false;
  const nodes = [];

  const resetNode = (node, randomize = false) => {
    node.x = Math.random() * width;
    node.y = randomize ? Math.random() * height : height + Math.random() * 120;
    node.vx = (Math.random() - 0.5) * (lowQuality ? 0.08 : 0.13) * dpr;
    node.vy = -(0.03 + Math.random() * 0.09) * dpr;
    node.radius = (0.7 + Math.random() * 1.5) * dpr;
    node.phase = Math.random() * Math.PI * 2;
    node.accent = Math.random() > 0.82;
  };

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, lowQuality ? 1 : 1.5);
    const nextWidth = Math.max(1, Math.floor(window.innerWidth * dpr));
    const nextHeight = Math.max(1, Math.floor(window.innerHeight * dpr));
    if (nextWidth === width && nextHeight === height) return;
    width = nextWidth;
    height = nextHeight;
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    if (nodes.length === 0) {
      for (let index = 0; index < nodeCount; index += 1) {
        const node = {};
        resetNode(node, true);
        nodes.push(node);
      }
    } else {
      for (const node of nodes) {
        node.x = Math.min(width, node.x);
        node.y = Math.min(height, node.y);
      }
    }
  };

  const drawGrid = (scrollRatio) => {
    const spacing = 92 * dpr;
    const offsetX = (scrollRatio * 45 * dpr) % spacing;
    const offsetY = (scrollRatio * 74 * dpr) % spacing;
    context.lineWidth = 0.45 * dpr;
    context.strokeStyle = 'rgba(165, 225, 195, 0.035)';
    context.beginPath();
    for (let x = -spacing + offsetX; x < width + spacing; x += spacing) {
      context.moveTo(x, 0);
      context.lineTo(x, height);
    }
    for (let y = -spacing + offsetY; y < height + spacing; y += spacing) {
      context.moveTo(0, y);
      context.lineTo(width, y);
    }
    context.stroke();
  };

  const render = (timestamp) => {
    if (stopped) return;
    frame = window.requestAnimationFrame(render);
    if (document.visibilityState !== 'visible') return;
    if (timestamp - lastTime < frameInterval) return;
    lastTime = timestamp;
    resize();

    context.clearRect(0, 0, width, height);
    const range = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const scrollRatio = (window.scrollY || document.documentElement.scrollTop) / range;
    drawGrid(scrollRatio);

    const pointerPixelX = pointerX * width;
    const pointerPixelY = pointerY * height;
    const threshold = (lowQuality ? 150 : 190) * dpr;

    for (const node of nodes) {
      const dxPointer = node.x - pointerPixelX;
      const dyPointer = node.y - pointerPixelY;
      const pointerDistance = Math.hypot(dxPointer, dyPointer);
      if (pointerDistance < 220 * dpr && pointerDistance > 0) {
        const strength = (1 - pointerDistance / (220 * dpr)) * 0.018;
        node.vx += (dxPointer / pointerDistance) * strength;
        node.vy += (dyPointer / pointerDistance) * strength;
      }
      node.vx *= 0.998;
      node.vy *= 0.999;
      node.x += node.vx + Math.sin(timestamp * 0.0003 + node.phase) * 0.03 * dpr;
      node.y += node.vy - scrollRatio * 0.018 * dpr;
      if (node.y < -50 * dpr || node.x < -70 * dpr || node.x > width + 70 * dpr) {
        resetNode(node, false);
      }
    }

    for (let left = 0; left < nodes.length; left += 1) {
      const a = nodes[left];
      for (let right = left + 1; right < nodes.length; right += 1) {
        const b = nodes[right];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distance = Math.hypot(dx, dy);
        if (distance >= threshold) continue;
        const alpha = (1 - distance / threshold) * (a.accent || b.accent ? 0.16 : 0.075);
        context.strokeStyle = a.accent || b.accent
          ? `rgba(201, 255, 67, ${alpha})`
          : `rgba(125, 232, 189, ${alpha})`;
        context.lineWidth = (a.accent || b.accent ? 0.8 : 0.45) * dpr;
        context.beginPath();
        const middleX = (a.x + b.x) / 2 + Math.sin(timestamp * 0.0004 + a.phase) * 9 * dpr;
        const middleY = (a.y + b.y) / 2 + Math.cos(timestamp * 0.00035 + b.phase) * 7 * dpr;
        context.moveTo(a.x, a.y);
        context.quadraticCurveTo(middleX, middleY, b.x, b.y);
        context.stroke();
      }
    }

    for (const node of nodes) {
      const pulse = 0.62 + Math.sin(timestamp * 0.0018 + node.phase) * 0.28;
      context.fillStyle = node.accent
        ? `rgba(201, 255, 67, ${0.46 + pulse * 0.32})`
        : `rgba(185, 231, 207, ${0.24 + pulse * 0.28})`;
      context.beginPath();
      context.arc(node.x, node.y, node.radius * (0.8 + pulse * 0.28), 0, Math.PI * 2);
      context.fill();
    }
  };

  window.addEventListener(
    'pointermove',
    (event) => {
      pointerX = event.clientX / Math.max(1, window.innerWidth);
      pointerY = event.clientY / Math.max(1, window.innerHeight);
    },
    { passive: true },
  );
  window.addEventListener('resize', resize, { passive: true });
  resize();
  root.classList.add('canvas-ready');
  frame = window.requestAnimationFrame(render);

  window.addEventListener('pagehide', () => {
    stopped = true;
    window.cancelAnimationFrame(frame);
  });
};

motionQuery.addEventListener?.('change', (event) => {
  root.dataset.motion = event.matches ? 'reduced' : 'full';
});

document.addEventListener('visibilitychange', () => {
  root.classList.toggle('page-hidden', document.visibilityState !== 'visible');
});

await loadRelease();
initializeRuleField();
