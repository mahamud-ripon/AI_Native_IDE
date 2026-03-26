/**
 * HomePage - Bolt.new/FLUX style landing page
 * Root route (/) — prompt bar to start building, navigates to /p/:projectId
 */

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { projectClient } from '../api/projectClient';

// ── Icons ──
const SendIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
  </svg>
);

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const SpinnerIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" style={{ animation: 'spin 1s linear infinite' }}>
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="50" strokeLinecap="round" />
  </svg>
);

// ── Styles ──
const styles = {
  bg: '#050508',
  surface: 'rgba(10,10,20,0.7)',
  cyan: '#00e5ff',
  lime: '#b8ff57',
  magenta: '#ff2d87',
  violet: '#9b5fff',
  text: '#eae8f0',
  muted: '#5c5870',
  glass: 'rgba(255,255,255,0.03)',
  border: 'rgba(255,255,255,0.05)',
};

const suggestions = [
  'Landing page for a fintech startup',
  'Real-time chat app with WebSockets',
  'AI image generator with prompt history',
  'Kanban board with drag and drop',
];

const features = [
  { icon: '⚡', title: 'Instant Prototyping', desc: 'Go from idea to deployed prototype in under 10 seconds. AI understands intent, not just syntax.' },
  { icon: '🧠', title: 'Context-Aware Architecture', desc: 'Every component, every API route, every database schema — all in context.' },
  { icon: '🔄', title: 'Live Preview & Iterate', desc: 'See changes in real-time as you chat. Refine layouts, tweak logic, add features.' },
  { icon: '🔐', title: 'Production-Grade Security', desc: 'Auth, RBAC, input validation, CSRF protection — baked in by default.' },
  { icon: '📊', title: 'Built-In Analytics', desc: 'Every app ships with performance monitoring, error tracking, and user analytics.' },
  { icon: '🚀', title: 'One-Click Deploy', desc: 'Push to production with a single command. Auto-scaling, CDN, SSL — all handled.' },
];

const showcaseItems = [
  { emoji: '📊', name: 'MetricsFlow', desc: 'Real-time analytics dashboard', tag: 'SaaS', gradient: 'linear-gradient(135deg,#0a1628,#1a0a2e)' },
  { emoji: '🛒', name: 'ShopNova', desc: 'Headless storefront with Stripe', tag: 'E-Commerce', gradient: 'linear-gradient(135deg,#1a0a0a,#2e1a0a)' },
  { emoji: '🤖', name: 'GenStudio', desc: 'AI image generation platform', tag: 'AI Tool', gradient: 'linear-gradient(135deg,#0a1a0a,#0a2e1a)' },
  { emoji: '💬', name: 'ChatPulse', desc: 'Real-time messaging with WebSockets', tag: 'Social', gradient: 'linear-gradient(135deg,#0a0a1a,#1a0a2e)' },
  { emoji: '📋', name: 'TaskForge', desc: 'Kanban board with drag-and-drop', tag: 'Productivity', gradient: 'linear-gradient(135deg,#1a1a0a,#2e2e0a)' },
  { emoji: '🎵', name: 'SoundWave', desc: 'Music streaming UI with playlists', tag: 'Media', gradient: 'linear-gradient(135deg,#1a0a1a,#0a1a2e)' },
];

const techStack = ['React', 'Next.js', 'Tailwind', 'TypeScript', 'PostgreSQL', 'Redis', 'Docker', 'AWS', 'Vercel', 'Stripe', 'Auth.js', 'Prisma'];

const stats = [
  { num: '2.4', suffix: 'M+', label: 'Apps Generated' },
  { num: '340', suffix: 'K', label: 'Active Builders' },
  { num: '8', suffix: 's', label: 'Avg Build Time' },
  { num: '99.9', suffix: '%', label: 'Uptime SLA' },
];

export function HomePage() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = React.useState('');
  const [building, setBuilding] = React.useState(false);
  const [buildState, setBuildState] = React.useState<'idle' | 'loading' | 'done'>('idle');
  const [navScrolled, setNavScrolled] = React.useState(false);
  const cursorGlowRef = React.useRef<HTMLDivElement>(null);

  // Cursor glow effect
  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (cursorGlowRef.current) {
        cursorGlowRef.current.style.left = `${e.clientX}px`;
        cursorGlowRef.current.style.top = `${e.clientY}px`;
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Nav scroll effect
  React.useEffect(() => {
    const handleScroll = () => setNavScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleBuild = async () => {
    if (!prompt.trim() || building) return;

    // Check if user is authenticated
    const token = localStorage.getItem('access_token') || localStorage.getItem('auth_token');
    if (!token) {
      // Redirect to login, then come back to build
      navigate(`/login?redirect=${encodeURIComponent('/')}&prompt=${encodeURIComponent(prompt.trim())}`);
      return;
    }

    setBuilding(true);
    setBuildState('loading');

    try {
      const project = await projectClient.createProject({
        name: prompt.trim().slice(0, 50).replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '-').toLowerCase() || 'my-app',
        template: 'react',
        visibility: 'private',
      });

      setBuildState('done');
      setTimeout(() => {
        navigate(`/p/${project.id}`);
      }, 800);
    } catch {
      setBuildState('idle');
      setBuilding(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleBuild();
  };

  return (
    <div style={{ fontFamily: "'DM Mono', 'JetBrains Mono', monospace", background: styles.bg, color: styles.text, minHeight: '100vh', overflowX: 'hidden' }}>
      {/* Cursor Glow */}
      <div
        ref={cursorGlowRef}
        style={{
          position: 'fixed', width: 600, height: 600, borderRadius: '50%', pointerEvents: 'none', zIndex: 0,
          background: 'radial-gradient(circle,rgba(0,229,255,.07) 0%,rgba(155,95,255,.03) 40%,transparent 70%)',
          transform: 'translate(-50%,-50%)', transition: 'opacity .3s',
        }}
      />

      {/* Noise Texture */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none', opacity: 0.035,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
      }} />

      {/* Nav */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, padding: '18px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: `1px solid ${styles.border}`,
        background: navScrolled ? 'rgba(5,5,8,.9)' : 'rgba(5,5,8,.6)', transition: 'all .3s',
      }}>
        <div style={{
          fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 20, letterSpacing: '-.02em',
          background: `linear-gradient(135deg,${styles.cyan},${styles.lime})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>
          AI-Native IDE
        </div>
        <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
          {['Product', 'Docs', 'Pricing'].map(link => (
            <a key={link} href="#" style={{ fontSize: 12, color: styles.muted, textDecoration: 'none', letterSpacing: '.06em', transition: 'color .2s' }}
              onMouseEnter={e => (e.target as HTMLElement).style.color = styles.text}
              onMouseLeave={e => (e.target as HTMLElement).style.color = styles.muted}
            >
              {link}
            </a>
          ))}
          <a href="#" style={{
            padding: '10px 24px', borderRadius: 100, border: `1px solid rgba(0,229,255,.3)`, background: 'rgba(0,229,255,.06)',
            color: styles.cyan, fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase',
            textDecoration: 'none', transition: 'all .3s',
          }}
            onMouseEnter={e => { (e.target as HTMLElement).style.background = styles.cyan; (e.target as HTMLElement).style.color = styles.bg; }}
            onMouseLeave={e => { (e.target as HTMLElement).style.background = 'rgba(0,229,255,.06)'; (e.target as HTMLElement).style.color = styles.cyan; }}
          >
            Get Started
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: '120px 40px 80px', position: 'relative',
      }}>
        {/* Orbiting logos */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 700, height: 700,
          pointerEvents: 'none', opacity: 0.15, animation: 'spin-slow 60s linear infinite',
        }}>
          {['⚛', '🔷', '▲', '◆', '●', '■', '◇', '▽'].map((icon, i) => (
            <div key={i} style={{
              position: 'absolute', top: '50%', left: '50%', width: 40, height: 40, margin: -20, borderRadius: 10,
              border: `1px solid ${styles.border}`, background: styles.glass, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, transform: `rotate(${i * 45}deg) translateX(300px) rotate(-${i * 45}deg)`,
            }}>
              {icon}
            </div>
          ))}
        </div>

        {/* Badge */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 18px', borderRadius: 100,
          border: `1px solid ${styles.border}`, background: styles.glass, fontSize: 11, color: styles.muted,
          letterSpacing: '.06em', marginBottom: 32,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: styles.lime, animation: 'pulse-dot 2s ease infinite' }} />
          Now in Public Beta — v1.0
        </div>

        {/* Title */}
        <h1 style={{
          fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 'clamp(48px,8vw,96px)', lineHeight: 1,
          letterSpacing: '-.04em', marginBottom: 24,
        }}>
          <span style={{ display: 'block' }}>Build apps at the</span>
          <span style={{ display: 'block' }}>
            speed of{' '}
            <span style={{
              background: `linear-gradient(135deg,${styles.cyan},${styles.lime},${styles.cyan})`,
              backgroundSize: '200% 200%', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              animation: 'shimmer 4s ease infinite',
            }}>
              thought
            </span>
          </span>
        </h1>

        {/* Subtitle */}
        <p style={{ fontSize: 15, color: styles.muted, maxWidth: 520, lineHeight: 1.7, marginBottom: 48 }}>
          Describe what you want. AI writes the code, deploys it, and gives you a live URL in seconds. No boilerplate. No config hell. Just ship.
        </p>

        {/* Prompt Bar */}
        <div style={{ width: '100%', maxWidth: 680 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '6px 6px 6px 24px', borderRadius: 16,
            border: `1px solid ${styles.border}`, background: styles.surface, backdropFilter: 'blur(20px)',
            boxShadow: '0 0 60px rgba(0,229,255,.04),0 20px 60px rgba(0,0,0,.3)', transition: 'all .4s',
          }}>
            <input
              type="text"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Build me a SaaS dashboard with dark mode and Stripe integration..."
              style={{
                flex: 1, background: 'none', border: 'none', outline: 'none', color: styles.text,
                fontFamily: "'DM Mono', monospace", fontSize: 14, letterSpacing: '.02em',
              }}
            />
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 10, background: 'rgba(255,255,255,.04)',
              fontSize: 11, color: styles.muted, cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none',
            }}>
              Claude 4
            </div>
            <button
              onClick={handleBuild}
              disabled={building || !prompt.trim()}
              style={{
                width: 44, height: 44, borderRadius: 12, border: 'none',
                background: buildState === 'done' ? `linear-gradient(135deg,${styles.lime},#7acc29)` : `linear-gradient(135deg,${styles.cyan},#00b8d4)`,
                color: styles.bg, cursor: building ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .3s', flexShrink: 0,
              }}
            >
              {buildState === 'loading' ? <SpinnerIcon /> : buildState === 'done' ? <CheckIcon /> : <SendIcon />}
            </button>
          </div>

          {/* Suggestions */}
          <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            {suggestions.map(s => (
              <button
                key={s}
                onClick={() => setPrompt(s)}
                style={{
                  padding: '8px 16px', borderRadius: 100, border: `1px solid ${styles.border}`, background: styles.glass,
                  fontSize: 11, color: styles.muted, cursor: 'pointer', transition: 'all .25s', whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => {
                  (e.target as HTMLElement).style.borderColor = 'rgba(0,229,255,.2)';
                  (e.target as HTMLElement).style.color = styles.cyan;
                  (e.target as HTMLElement).style.background = 'rgba(0,229,255,.04)';
                }}
                onMouseLeave={e => {
                  (e.target as HTMLElement).style.borderColor = styles.border;
                  (e.target as HTMLElement).style.color = styles.muted;
                  (e.target as HTMLElement).style.background = styles.glass;
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Scroll indicator */}
        <div style={{
          position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 9, color: styles.muted, letterSpacing: '.2em', textTransform: 'uppercase' }}>Scroll to explore</span>
          <div style={{ width: 1, height: 40, background: `linear-gradient(${styles.cyan},transparent)`, animation: 'scrollPulse 2s ease infinite' }} />
        </div>
      </section>

      {/* Stats */}
      <div style={{
        display: 'flex', justifyContent: 'center', gap: 60, padding: 40, borderTop: `1px solid ${styles.border}`,
        borderBottom: `1px solid ${styles.border}`, background: styles.glass, flexWrap: 'wrap',
      }}>
        {stats.map(s => (
          <div key={s.label} style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 32,
              background: `linear-gradient(135deg,${styles.cyan},${styles.lime})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>
              {s.num}{s.suffix}
            </div>
            <div style={{ fontSize: 10, color: styles.muted, letterSpacing: '.15em', textTransform: 'uppercase', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Marquee */}
      <div style={{ padding: '20px 0', borderTop: `1px solid ${styles.border}`, borderBottom: `1px solid ${styles.border}`, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 60, animation: 'marquee 30s linear infinite', width: 'max-content' }}>
          {[...techStack, ...techStack].map((tech, i) => (
            <span key={i} style={{
              fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 13, color: styles.muted,
              letterSpacing: '.1em', textTransform: 'uppercase', whiteSpace: 'nowrap', opacity: 0.4,
            }}>
              {tech}
            </span>
          ))}
        </div>
      </div>

      {/* Features */}
      <section style={{ padding: '120px 40px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 72 }}>
          <div style={{ fontSize: 10, color: styles.cyan, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: 12 }}>Capabilities</div>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 'clamp(32px,4vw,52px)', letterSpacing: '-.03em', lineHeight: 1.1 }}>
            Not just code generation.<br />
            <span style={{ color: styles.muted }}>Full-stack intelligence.</span>
          </h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
          {features.map(f => (
            <div key={f.title} style={{
              padding: 40, borderRadius: 20, border: `1px solid ${styles.border}`, background: styles.glass,
              transition: 'all .4s', position: 'relative', overflow: 'hidden', cursor: 'default',
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14, border: `1px solid ${styles.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, marginBottom: 20,
                background: 'linear-gradient(135deg,rgba(0,229,255,.06),rgba(155,95,255,.06))',
              }}>
                {f.icon}
              </div>
              <h3 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 10, letterSpacing: '-.01em' }}>{f.title}</h3>
              <p style={{ fontSize: 12, color: styles.muted, lineHeight: 1.7 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Showcase */}
      <section style={{ padding: '80px 40px 120px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 72 }}>
          <div style={{ fontSize: 10, color: styles.cyan, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: 12 }}>Built with AI-Native IDE</div>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 'clamp(32px,4vw,52px)', letterSpacing: '-.03em', lineHeight: 1.1 }}>
            What people are <span style={{ color: styles.muted }}>shipping.</span>
          </h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {showcaseItems.map(item => (
            <div key={item.name} style={{
              borderRadius: 16, overflow: 'hidden', border: `1px solid ${styles.border}`, background: item.gradient,
              transition: 'all .4s', cursor: 'pointer', position: 'relative', aspectRatio: '4/3',
            }}>
              <div style={{
                width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 48, opacity: 0.15,
              }}>
                {item.emoji}
              </div>
              <div style={{
                position: 'absolute', top: 12, right: 12, padding: '4px 10px', borderRadius: 100,
                background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(10px)', fontSize: 9, color: styles.lime,
                letterSpacing: '.1em', textTransform: 'uppercase', border: '1px solid rgba(184,255,87,.15)',
              }}>
                {item.tag}
              </div>
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20,
                background: 'linear-gradient(transparent,rgba(5,5,8,.95))',
              }}>
                <h4 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{item.name}</h4>
                <p style={{ fontSize: 11, color: styles.muted }}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: '120px 40px', textAlign: 'center', position: 'relative' }}>
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          width: 800, height: 800, borderRadius: '50%',
          background: 'radial-gradient(circle,rgba(0,229,255,.06) 0%,rgba(155,95,255,.03) 40%,transparent 70%)', pointerEvents: 'none',
        }} />
        <h2 style={{
          fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 'clamp(36px,5vw,64px)', letterSpacing: '-.03em', marginBottom: 20, position: 'relative',
        }}>
          Stop planning.<br />Start shipping.
        </h2>
        <p style={{ fontSize: 14, color: styles.muted, marginBottom: 40, position: 'relative' }}>Join thousands of builders who ship faster with AI.</p>
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 10, padding: '18px 40px', borderRadius: 100, border: 'none',
            background: `linear-gradient(135deg,${styles.cyan},#00b8d4)`, color: styles.bg, fontFamily: "'Syne', sans-serif",
            fontWeight: 700, fontSize: 14, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer',
            transition: 'all .3s', position: 'relative', overflow: 'hidden',
          }}
        >
          Start Building Free <ArrowIcon />
        </button>
      </section>

      {/* Footer */}
      <footer style={{
        padding: 40, borderTop: `1px solid ${styles.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 11, color: styles.muted,
      }}>
        <span>&copy; 2026 AI-Native IDE. All rights reserved.</span>
        <div style={{ display: 'flex', gap: 24 }}>
          {['Privacy', 'Terms', 'Status', 'Twitter', 'Discord'].map(link => (
            <a key={link} href="#" style={{ color: styles.muted, textDecoration: 'none', transition: 'color .2s' }}
              onMouseEnter={e => (e.target as HTMLElement).style.color = styles.text}
              onMouseLeave={e => (e.target as HTMLElement).style.color = styles.muted}
            >
              {link}
            </a>
          ))}
        </div>
      </footer>

      {/* Global Animations */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes spin-slow { to { transform: translate(-50%,-50%) rotate(360deg); } }
        @keyframes shimmer { 0%,100% { background-position:0% 50% } 50% { background-position:100% 50% } }
        @keyframes pulse-dot { 0%,100% { opacity:1; box-shadow:0 0 0 0 rgba(184,255,87,.4) } 50% { opacity:.7; box-shadow:0 0 0 6px rgba(184,255,87,0) } }
        @keyframes scrollPulse { 0%,100% { opacity:.3; transform:scaleY(1) } 50% { opacity:.8; transform:scaleY(1.2) } }
        @keyframes marquee { to { transform:translateX(-50%) } }
      `}</style>
    </div>
  );
}

export default HomePage;
