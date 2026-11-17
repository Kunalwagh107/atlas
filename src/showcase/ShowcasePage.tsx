import { AtlasDemo } from './AtlasDemo';
import { Icon } from '../components/common/Icon';

const FEATURES = [
  {
    icon: 'save',
    title: 'Local by default',
    body: 'Every map, note and image is stored in your browser. No account, no upload, no cloud copy to lose track of.',
    note: 'IndexedDB · offline-ready',
  },
  {
    icon: 'download',
    title: 'Leaves when you do',
    body: 'Take the whole map with you as portable JSON, SVG, PNG, PDF or GIF. Images travel inside the file.',
    note: 'JSON · SVG · PNG · PDF · GIF',
  },
  {
    icon: 'focus',
    title: 'Built for deep work',
    body: 'Four layouts, focus mode, presentation mode and a quiet canvas that gets out of the way of the thinking.',
    note: 'Tree · Radial · Focus · Present',
  },
];

export function ShowcaseContent({
  embedded = false,
  onStart,
  theme = 'light',
}: {
  embedded?: boolean;
  onStart?: () => void;
  /** The tour follows the app's theme, so the demo is never half light. */
  theme?: 'light' | 'dark';
}) {
  const start = embedded ? (
    <button type="button" className="button button--primary" onClick={onStart}>
      Start mapping <Icon name="chevron-right" size={14} />
    </button>
  ) : (
    <a className="button button--primary" href="/">
      Start mapping <Icon name="chevron-right" size={14} />
    </a>
  );

  return (
    <main id={embedded ? 'showcase-main' : 'main'}>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__copy">
          <p className="eyebrow"><span className="eyebrow__dot" /> Local-first mind mapping</p>
          <h1 id="hero-title">Think in{' '}<br />every direction.</h1>
          <p className="hero__lede">
            A quiet workspace for mapping the work before you start it. Branches, notes and
            images stay in your browser — and the map still opens offline.
          </p>
          <div className="hero__actions">
            {start}
            {embedded ? (
              <button
                type="button"
                className="button button--quiet"
                onClick={() => document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              >
                See it in motion <Icon name="play" size={13} />
              </button>
            ) : (
              <a className="button button--quiet" href="#demo">See it in motion <Icon name="play" size={13} /></a>
            )}
          </div>
          <ul className="trust" aria-label="Product principles">
            <li><Icon name="check" size={13} /> No sign-in</li>
            <li><Icon name="check" size={13} /> Offline-ready</li>
            <li><Icon name="check" size={13} /> Export anywhere</li>
          </ul>
        </div>

        <div className="hero__visual" id="demo">
          <div className="hero__demo" role="img" aria-label="Animated preview of Atlas: a Product launch mind map with Audience, Narrative, Channels and Timeline branches. The cursor selects Channels, adds a Press kit child and the map saves locally.">
            <div aria-hidden="true"><AtlasDemo theme={theme} /></div>
          </div>
          <p className="hero__caption">
            <span className="hero__caption-dot" /> Select a branch. Add a thought. It stays on this device.
          </p>
        </div>
      </section>

      <section className="section" id="product" aria-labelledby="product-title">
        <div className="section__head">
          <p className="eyebrow">A calmer way to plan</p>
          <h2 id="product-title">Everything you need to think clearly.</h2>
          <p>No dashboards to configure. No workspace to administer. Just a map, its notes and the files you bring.</p>
        </div>
        <div className="feature-grid">
          {FEATURES.map((feature) => (
            <article className="feature" key={feature.title}>
              <span className="feature__icon"><Icon name={feature.icon} size={18} strokeWidth={1.7} /></span>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
              <span className="feature__note">{feature.note}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="section section--split" id="privacy" aria-labelledby="privacy-title">
        <div>
          <p className="eyebrow">Private by architecture</p>
          <h2 id="privacy-title">Your map is not our business.</h2>
        </div>
        <div className="section__body">
          <p>
            Atlas has no account and no backend. Documents live in IndexedDB on your device;
            images are stored as local blobs. The service worker caches only the app shell, never
            your maps.
          </p>
          <div className="proof">
            <span><Icon name="check" size={12} /> No analytics</span>
            <span><Icon name="check" size={12} /> No remote images</span>
            <span><Icon name="check" size={12} /> No cloud sync</span>
          </div>
        </div>
      </section>

      <section className="section section--split" id="offline" aria-labelledby="offline-title">
        <div>
          <p className="eyebrow">Ready when the network isn't</p>
          <h2 id="offline-title">Open it on a plane.</h2>
        </div>
        <div className="section__body">
          <p>
            Once Atlas has loaded, the shell is cached and a hard reload works offline. Updates
            install in the background and wait for you to reload — no half-updated map.
          </p>
          <div className="proof">
            <span><Icon name="check" size={12} /> Installable PWA</span>
            <span><Icon name="check" size={12} /> Versioned cache</span>
            <span><Icon name="check" size={12} /> Local backups</span>
          </div>
        </div>
      </section>

      {embedded && (
        <section className="section showcase-end" aria-label="Start using Atlas">
          <div>
            <p className="eyebrow">Ready when you are</p>
            <h2>Put the first thought on the canvas.</h2>
          </div>
          <button type="button" className="button button--primary" onClick={onStart}>
            Back to workspace <Icon name="chevron-right" size={14} />
          </button>
        </section>
      )}
    </main>
  );
}

export function ShowcasePage() {
  return (
    <div className="showcase" id="top">
      <a className="skip-link" href="#main">Skip to content</a>

      <header className="site-header">
        <a className="brand" href="/" aria-label="Atlas home">
          <span className="brand__mark"><Icon name="branch" size={18} strokeWidth={1.8} /></span>
          <span className="brand__name">Atlas</span>
        </a>
        <nav className="site-nav" aria-label="Primary">
          <a href="#product">Product</a>
          <a href="#privacy">Privacy</a>
          <a href="#offline">Offline</a>
        </nav>
        <a className="header-cta" href="/">Open Atlas <Icon name="chevron-right" size={13} /></a>
      </header>

      <ShowcaseContent />

      <footer className="site-footer">
        <div className="site-footer__brand">
          <span className="brand__mark"><Icon name="branch" size={16} strokeWidth={1.8} /></span>
          <span>Atlas</span>
        </div>
        <p>Local-first mind mapping. Built to be kept.</p>
        <a href="#top">Back to top <Icon name="arrow-up" size={12} /></a>
      </footer>
    </div>
  );
}
