const repository = 'streletskiy/archi-helper';
const latestRelease = `https://github.com/${repository}/releases/latest`;

function setupTheme() {
  const toggle = document.querySelector('.theme-toggle');
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  const storageKey = 'archi-helper-theme';
  const validTheme = (value) => value === 'light' || value === 'dark';
  let preference;
  try { preference = localStorage.getItem(storageKey); } catch {}

  function applyTheme() {
    const theme = validTheme(preference) ? preference : systemTheme.matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#17181b' : '#f8f8f2';
    const label = theme === 'dark' ? toggle.dataset.lightLabel : toggle.dataset.darkLabel;
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  }

  toggle.addEventListener('click', () => {
    preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(storageKey, preference); } catch {}
    applyTheme();
  });
  systemTheme.addEventListener('change', applyTheme);
  window.addEventListener('storage', (event) => {
    if (event.key !== storageKey && event.key !== null) return;
    preference = event.newValue;
    applyTheme();
  });
  applyTheme();
  toggle.hidden = false;
}

async function loadRelease() {
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return;
    const release = await response.json();
    if (release.draft || release.prerelease || !Array.isArray(release.assets)) return;
    const assetFor = (kind) => release.assets.find((asset) => {
      const pattern = new RegExp(`^Archi-Helper-${kind}-[0-9]+\\.[0-9]+\\.[0-9]+-x64\\.exe$`);
      return pattern.test(asset.name) && typeof asset.browser_download_url === 'string'
        && asset.browser_download_url.startsWith(`https://github.com/${repository}/releases/download/`);
    });
    const setup = assetFor('Setup');
    const portable = assetFor('Portable');
    for (const link of document.querySelectorAll('[data-download]')) {
      const asset = link.dataset.download === 'setup' ? setup : portable;
      link.href = asset?.browser_download_url || latestRelease;
    }
    if (setup && /^v?\d+\.\d+\.\d+$/.test(release.tag_name)) {
      const meta = document.querySelector('[data-release-meta]');
      const size = Number.isFinite(setup.size) && setup.size > 0
        ? ` \u00b7 ${Math.round(setup.size / 1024 / 1024)} ${meta.dataset.sizeUnit}` : '';
      meta.textContent = `${release.tag_name}${size} \u00b7 Windows x64`;
    }
  } catch {
    // The static links always lead to the latest release, including offline/API failures.
  }
}

async function setupMascot() {
  const mascot = document.querySelector('.mascot');
  const repertoire = ['wave', 'reading', 'measure', 'inspect', 'build', 'idea', 'celebrate', 'idle'];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  try {
    const response = await fetch(new URL('./assets/mascot-animations.json', import.meta.url));
    if (!response.ok) return;
    const sheet = await response.json();
    let current = 0;
    let timer;
    mascot.style.setProperty('--sprite-count', sheet.frameCount);

    function show(index) {
      current = index;
      const name = repertoire[index];
      const animation = sheet.animations[name];
      mascot.dataset.animation = name;
      mascot.dataset.animated = 'false';
      mascot.style.setProperty('--sprite-start', animation.start);
      mascot.style.setProperty('--sprite-end', animation.start + animation.frames);
      mascot.style.setProperty('--sprite-frames', animation.frames);
      mascot.style.setProperty('--sprite-duration', `${animation.frames * animation.ms}ms`);
      // Restart at the first frame when switching to another strip of the sheet.
      void mascot.offsetWidth;
      mascot.dataset.animated = 'true';
    }

    function syncMotion() {
      clearInterval(timer);
      const stopped = reducedMotion.matches || document.hidden;
      mascot.dataset.paused = String(stopped);
      if (!stopped) timer = setInterval(() => show((current + 1) % repertoire.length), 5600);
    }

    reducedMotion.addEventListener('change', syncMotion);
    document.addEventListener('visibilitychange', syncMotion);
    show(0);
    syncMotion();
  } catch {
    // Keep the static mascot if its optional animation metadata cannot load.
  }
}

setupTheme();
void loadRelease();
void setupMascot();
