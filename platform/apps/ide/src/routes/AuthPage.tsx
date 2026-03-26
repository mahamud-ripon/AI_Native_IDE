/**
 * AuthPage - NEXUS style login/signup portal
 * Unified login and signup with tab switching
 */

import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';

// ── Particle Canvas ──
function ParticleCanvas() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = () => canvas.width;
    const height = () => canvas.height;

    let particles: Particle[] = [];
    const PARTICLE_COUNT = 60;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    class Particle {
      x = 0; y = 0; vx = 0; vy = 0; r = 0; alpha = 0; color = '';
      constructor() { this.reset(); }
      reset() {
        this.x = Math.random() * width();
        this.y = Math.random() * height();
        this.vx = (Math.random() - 0.5) * 0.3;
        this.vy = (Math.random() - 0.5) * 0.3;
        this.r = Math.random() * 1.5 + 0.5;
        this.alpha = Math.random() * 0.4 + 0.1;
        const colors = ['0,240,255', '255,0,200', '123,47,255'];
        this.color = colors[Math.floor(Math.random() * colors.length)];
      }
      update() {
        this.x += this.vx;
        this.y += this.vy;
        if (this.x < 0 || this.x > width()) this.vx *= -1;
        if (this.y < 0 || this.y > height()) this.vy *= -1;
      }
      draw() {
        ctx!.beginPath();
        ctx!.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${this.color},${this.alpha})`;
        ctx!.fill();
      }
    }

    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(new Particle());

    const drawLines = () => {
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 150) {
            ctx!.beginPath();
            ctx!.moveTo(particles[i].x, particles[i].y);
            ctx!.lineTo(particles[j].x, particles[j].y);
            ctx!.strokeStyle = `rgba(0,240,255,${0.04 * (1 - dist / 150)})`;
            ctx!.lineWidth = 0.5;
            ctx!.stroke();
          }
        }
      }
    };

    let animId: number;
    const animate = () => {
      ctx!.clearRect(0, 0, width(), height());
      particles.forEach(p => { p.update(); p.draw(); });
      drawLines();
      animId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, zIndex: 0 }} />;
}

// ── Styles ──
const colors = {
  bg: '#06060e',
  surface: 'rgba(12,12,28,0.65)',
  cyan: '#00f0ff',
  magenta: '#ff00c8',
  violet: '#7b2fff',
  text: '#e8e6f0',
  muted: '#5a5670',
  glass: 'rgba(255,255,255,0.04)',
  border: 'rgba(255,255,255,0.06)',
};

export function AuthPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'signup' ? 'signup' : 'login';
  const [activeTab, setActiveTab] = React.useState<'login' | 'signup'>(initialTab);
  const [email, setEmail] = React.useState('');
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [rememberMe, setRememberMe] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [success, setSuccess] = React.useState(false);

  const pwStrength = React.useMemo(() => {
    let score = 0;
    if (password.length >= 6) score++;
    if (password.length >= 10) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
    return score;
  }, [password]);

  const handleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const response = await api.auth.login(email, password);
      if (response.success && response.data?.accessToken) {
        localStorage.setItem('access_token', response.data.accessToken);
        setSuccess(true);
        setTimeout(() => navigate('/'), 1500);
      } else {
        setError(typeof response.error === 'string' ? response.error : 'Invalid credentials');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async () => {
    setError(null);
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      const response = await api.auth.register(email, password, username);
      if (response.success && response.data?.accessToken) {
        localStorage.setItem('access_token', response.data.accessToken);
        setSuccess(true);
        setTimeout(() => navigate('/'), 1500);
      } else {
        setError(typeof response.error === 'string' ? response.error : 'Registration failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeTab === 'login') handleLogin();
    else handleSignup();
  };

  return (
    <div style={{ fontFamily: "'DM Mono', monospace", background: colors.bg, color: colors.text, height: '100vh', overflow: 'hidden' }}>
      <ParticleCanvas />

      {/* Ambient glows */}
      <div style={{ position: 'fixed', width: 600, height: 600, borderRadius: '50%', filter: 'blur(120px)', opacity: 0.35, pointerEvents: 'none', zIndex: 0, background: colors.cyan, top: '-15%', left: '-10%', animation: 'drift 18s ease-in-out infinite alternate' }} />
      <div style={{ position: 'fixed', width: 500, height: 500, borderRadius: '50%', filter: 'blur(120px)', opacity: 0.35, pointerEvents: 'none', zIndex: 0, background: colors.magenta, bottom: '-20%', right: '-8%', animation: 'drift 22s ease-in-out infinite alternate-reverse' }} />
      <div style={{ position: 'fixed', width: 400, height: 400, borderRadius: '50%', filter: 'blur(120px)', opacity: 0.35, pointerEvents: 'none', zIndex: 0, background: colors.violet, top: '50%', left: '50%', transform: 'translate(-50%,-50%)', animation: 'pulse-glow 8s ease-in-out infinite' }} />

      {/* Grid overlay */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0,
        backgroundImage: 'linear-gradient(rgba(255,255,255,.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.015) 1px,transparent 1px)',
        backgroundSize: '60px 60px',
        maskImage: 'radial-gradient(ellipse at 50% 50%,black 30%,transparent 75%)',
        WebkitMaskImage: 'radial-gradient(ellipse at 50% 50%,black 30%,transparent 75%)',
      }} />

      {/* Scanline */}
      <div style={{ position: 'fixed', left: 0, right: 0, height: 2, zIndex: 1, pointerEvents: 'none', background: `linear-gradient(90deg,transparent,${colors.cyan},transparent)`, opacity: 0.15, animation: 'scan 6s linear infinite' }} />

      {/* Main wrapper */}
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', padding: 20 }}>
        <div style={{
          position: 'relative', width: 440, maxWidth: '100%', borderRadius: 24, overflow: 'hidden',
          background: colors.surface, backdropFilter: 'blur(40px) saturate(1.4)', WebkitBackdropFilter: 'blur(40px) saturate(1.4)',
          border: `1px solid ${colors.border}`,
          boxShadow: `0 0 80px rgba(0,240,255,.06),0 0 160px rgba(255,0,200,.04),inset 0 1px 0 rgba(255,255,255,.06)`,
        }}>
          {/* Corner accents */}
          {['tl', 'tr', 'bl', 'br'].map(pos => (
            <div key={pos} style={{
              position: 'absolute', width: 20, height: 20, zIndex: 3, opacity: 0.3,
              top: pos.includes('t') ? -1 : undefined, bottom: pos.includes('b') ? -1 : undefined,
              left: pos.includes('l') ? -1 : undefined, right: pos.includes('r') ? -1 : undefined,
            }}>
              <div style={{ position: 'absolute', background: colors.cyan, borderRadius: 1, ...(pos.includes('t') ? { top: 0 } : { bottom: 0 }), ...(pos.includes('l') ? { left: 0 } : { right: 0 }), width: 20, height: 1 }} />
              <div style={{ position: 'absolute', background: colors.cyan, borderRadius: 1, ...(pos.includes('t') ? { top: 0 } : { bottom: 0 }), ...(pos.includes('l') ? { left: 0 } : { right: 0 }), width: 1, height: 20 }} />
            </div>
          ))}

          {/* Header */}
          <div style={{ padding: '40px 40px 0', textAlign: 'center' }}>
            <div style={{
              fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 11, letterSpacing: '.35em', textTransform: 'uppercase',
              background: `linear-gradient(135deg,${colors.cyan},${colors.magenta})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', marginBottom: 6,
            }}>
              AI-Native IDE
            </div>
            <div style={{ fontSize: 10, color: colors.muted, letterSpacing: '.18em', textTransform: 'uppercase' }}>Secure Access Portal</div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', margin: '28px 40px 0', background: 'rgba(255,255,255,.03)', borderRadius: 12, padding: 4, position: 'relative' }}>
            <button
              onClick={() => { setActiveTab('login'); setError(null); }}
              style={{
                flex: 1, padding: 12, textAlign: 'center', fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 13,
                letterSpacing: '.08em', textTransform: 'uppercase', color: activeTab === 'login' ? colors.text : colors.muted,
                cursor: 'pointer', borderRadius: 10, transition: 'color .35s', position: 'relative', zIndex: 1, background: 'none', border: 'none', userSelect: 'none',
              }}
            >
              Sign In
            </button>
            <button
              onClick={() => { setActiveTab('signup'); setError(null); }}
              style={{
                flex: 1, padding: 12, textAlign: 'center', fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 13,
                letterSpacing: '.08em', textTransform: 'uppercase', color: activeTab === 'signup' ? colors.text : colors.muted,
                cursor: 'pointer', borderRadius: 10, transition: 'color .35s', position: 'relative', zIndex: 1, background: 'none', border: 'none', userSelect: 'none',
              }}
            >
              Sign Up
            </button>
            {/* Slider */}
            <div style={{
              position: 'absolute', top: 4, left: 4, width: 'calc(50% - 4px)', height: 'calc(100% - 8px)',
              background: colors.glass, border: '1px solid rgba(255,255,255,.06)', borderRadius: 10,
              transform: activeTab === 'signup' ? 'translateX(100%)' : 'translateX(0)',
              transition: 'transform .45s cubic-bezier(.68,-.4,.27,1.3)', pointerEvents: 'none',
            }} />
          </div>

          {/* Form area */}
          <div style={{ padding: '28px 40px 40px', position: 'relative' }}>
            {error && (
              <div style={{
                background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.5)', color: '#f87171',
                padding: '12px 16px', borderRadius: 12, fontSize: 12, marginBottom: 16,
              }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              {/* Login form */}
              {activeTab === 'login' && (
                <div style={{ animation: 'fadeIn .3s ease' }}>
                  <InputGroup
                    id="loginEmail"
                    type="email"
                    label="Email Address"
                    value={email}
                    onChange={setEmail}
                    required
                    autoComplete="email"
                  />
                  <InputGroup
                    id="loginPw"
                    type={showPassword ? 'text' : 'password'}
                    label="Password"
                    value={password}
                    onChange={setPassword}
                    required
                    autoComplete="current-password"
                    showToggle
                    onToggle={() => setShowPassword(!showPassword)}
                    showPassword={showPassword}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, fontSize: 11 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.muted, cursor: 'pointer', userSelect: 'none' }}>
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={e => setRememberMe(e.target.checked)}
                        style={{ appearance: 'none', WebkitAppearance: 'none', width: 16, height: 16, border: '1px solid rgba(255,255,255,.12)', borderRadius: 4, background: 'rgba(255,255,255,.03)', cursor: 'pointer', accentColor: colors.cyan }}
                      />
                      Remember me
                    </label>
                    <a href="#" style={{ color: colors.muted, textDecoration: 'none', cursor: 'pointer' }}>Forgot password?</a>
                  </div>
                  <SubmitButton loading={loading} label="Initialize Session" variant="login" />
                </div>
              )}

              {/* Signup form */}
              {activeTab === 'signup' && (
                <div style={{ animation: 'fadeIn .3s ease' }}>
                  <InputGroup
                    id="signupName"
                    type="text"
                    label="Full Name"
                    value={username}
                    onChange={setUsername}
                    required
                    autoComplete="name"
                  />
                  <InputGroup
                    id="signupEmail"
                    type="email"
                    label="Email Address"
                    value={email}
                    onChange={setEmail}
                    required
                    autoComplete="email"
                  />
                  <InputGroup
                    id="signupPw"
                    type={showPassword ? 'text' : 'password'}
                    label="Create Password"
                    value={password}
                    onChange={setPassword}
                    required
                    autoComplete="new-password"
                    showToggle
                    onToggle={() => setShowPassword(!showPassword)}
                    showPassword={showPassword}
                  />
                  {/* Strength meter */}
                  <div style={{ display: 'flex', gap: 4, marginTop: -12, marginBottom: 18, padding: '0 2px' }}>
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} style={{
                        height: 3, flex: 1, borderRadius: 2,
                        background: i <= pwStrength
                          ? pwStrength <= 1 ? colors.magenta : pwStrength <= 2 ? '#ff6b2f' : pwStrength <= 3 ? '#f0c030' : colors.cyan
                          : 'rgba(255,255,255,.06)',
                        transition: 'background .3s',
                      }} />
                    ))}
                  </div>
                  <InputGroup
                    id="confirmPw"
                    type="password"
                    label="Confirm Password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    required
                    autoComplete="new-password"
                  />
                  <SubmitButton loading={loading} label="Create Account" variant="signup" />
                </div>
              )}
            </form>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '24px 0', fontSize: 10, color: colors.muted, letterSpacing: '.15em', textTransform: 'uppercase' }}>
              <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.06),transparent)' }} />
              or continue with
              <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.06),transparent)' }} />
            </div>

            {/* Social buttons */}
            <div style={{ display: 'flex', gap: 10 }}>
              <SocialButton icon="github" label="GitHub" />
              <SocialButton icon="google" label="Google" />
            </div>

            {/* Switch link */}
            <div style={{ textAlign: 'center', marginTop: 20, fontSize: 11, color: colors.muted }}>
              {activeTab === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <button
                onClick={() => { setActiveTab(activeTab === 'login' ? 'signup' : 'login'); setError(null); }}
                style={{ color: colors.cyan, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', textDecoration: 'underline' }}
              >
                {activeTab === 'login' ? 'Create one' : 'Sign in'}
              </button>
            </div>
          </div>

          {/* Success overlay */}
          {success && (
            <div style={{
              position: 'absolute', inset: 0, background: colors.surface, backdropFilter: 'blur(40px)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10, borderRadius: 24,
            }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%', border: `2px solid ${colors.cyan}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20, fontSize: 28, color: colors.cyan,
              }}>
                ✓
              </div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: '.08em', marginBottom: 6 }}>
                {activeTab === 'login' ? 'Access Granted' : 'Account Created'}
              </div>
              <div style={{ fontSize: 11, color: colors.muted, letterSpacing: '.06em' }}>Redirecting to your dashboard...</div>
            </div>
          )}
        </div>
      </div>

      {/* Global Animations */}
      <style>{`
        @keyframes drift { 0% { transform: translate(0,0) scale(1) } 100% { transform: translate(60px,-40px) scale(1.15) } }
        @keyframes pulse-glow { 0%,100% { opacity:.2; transform:translate(-50%,-50%) scale(.9) } 50% { opacity:.4; transform:translate(-50%,-50%) scale(1.1) } }
        @keyframes scan { 0% { top:-2px } 100% { top:100% } }
        @keyframes fadeIn { from { opacity:0; transform:translateX(10px) } to { opacity:1; transform:translateX(0) } }
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  );
}

// ── Input Group Component ──
interface InputGroupProps {
  id: string;
  type: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  autoComplete?: string;
  showToggle?: boolean;
  onToggle?: () => void;
  showPassword?: boolean;
}

function InputGroup({ id, type, label, value, onChange, required, autoComplete, showToggle, onToggle, showPassword }: InputGroupProps) {
  const [focused, setFocused] = React.useState(false);
  const hasValue = value.length > 0;
  const labelUp = focused || hasValue;

  return (
    <div style={{ position: 'relative', marginBottom: 22 }}>
      <input
        id={id}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        required={required}
        autoComplete={autoComplete}
        placeholder=" "
        style={{
          width: '100%', padding: '16px 18px 8px', fontFamily: "'DM Mono', monospace", fontSize: 13, color: colors.text,
          background: 'rgba(255,255,255,.03)', border: `1px solid ${focused ? 'rgba(0,240,255,.3)' : colors.border}`,
          borderRadius: 12, outline: 'none', transition: 'all .3s', boxSizing: 'border-box',
          boxShadow: focused ? '0 0 20px rgba(0,240,255,.06),inset 0 0 20px rgba(0,240,255,.02)' : 'none',
        }}
      />
      <label
        htmlFor={id}
        style={{
          position: 'absolute', left: 18, top: labelUp ? 10 : '50%', transform: labelUp ? 'none' : 'translateY(-50%)',
          fontSize: labelUp ? 9 : 12, color: labelUp ? colors.cyan : colors.muted,
          letterSpacing: labelUp ? '.12em' : '.04em', textTransform: labelUp ? 'uppercase' : 'none',
          pointerEvents: 'none', transition: 'all .25s cubic-bezier(.16,1,.3,1)',
        }}
      >
        {label}
      </label>
      {showToggle && (
        <button
          type="button"
          onClick={onToggle}
          style={{
            position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none',
            color: colors.muted, cursor: 'pointer', fontSize: 16, padding: 4,
          }}
        >
          {showPassword ? '◉' : '◌'}
        </button>
      )}
    </div>
  );
}

// ── Submit Button ──
function SubmitButton({ loading, label, variant }: { loading: boolean; label: string; variant: 'login' | 'signup' }) {
  const bg = variant === 'login'
    ? 'linear-gradient(135deg,#00f0ff,#00c8ff)'
    : 'linear-gradient(135deg,#ff00c8,#7b2fff)';
  const hoverShadow = variant === 'login'
    ? '0 8px 30px rgba(0,240,255,.25)'
    : '0 8px 30px rgba(255,0,200,.25)';

  return (
    <button
      type="submit"
      disabled={loading}
      style={{
        width: '100%', padding: 16, fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13,
        letterSpacing: '.15em', textTransform: 'uppercase', color: colors.bg, border: 'none', borderRadius: 12,
        cursor: loading ? 'default' : 'pointer', position: 'relative', overflow: 'hidden',
        background: loading ? '#21262d' : bg, transition: 'transform .2s,box-shadow .3s',
      }}
    >
      {loading ? (
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <svg viewBox="0 0 24 24" width="18" height="18" style={{ animation: 'spin 1s linear infinite' }}>
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="50" strokeLinecap="round" />
          </svg>
          Processing...
        </span>
      ) : label}
    </button>
  );
}

// ── Social Button ──
function SocialButton({ icon, label }: { icon: 'github' | 'google'; label: string }) {
  const iconSvg = icon === 'github' ? (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="16" height="16">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );

  return (
    <button
      type="button"
      style={{
        flex: 1, padding: 12, border: `1px solid ${colors.border}`, borderRadius: 12, background: colors.glass,
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        fontFamily: "'DM Mono', monospace", fontSize: 11, color: colors.muted, transition: 'all .25s',
      }}
      onMouseEnter={e => {
        (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,.12)';
        (e.target as HTMLElement).style.color = colors.text;
        (e.target as HTMLElement).style.background = 'rgba(255,255,255,.06)';
      }}
      onMouseLeave={e => {
        (e.target as HTMLElement).style.borderColor = colors.border;
        (e.target as HTMLElement).style.color = colors.muted;
        (e.target as HTMLElement).style.background = colors.glass;
      }}
    >
      {iconSvg}
      {label}
    </button>
  );
}

export default AuthPage;
