import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NAV_TABS, tabHref } from '../navLinks.js';
import { mangaUrl } from '../routes.js';
import { fetchRandomManga } from '../api.js';
import { useTheme } from '../ThemeContext.jsx';
import KitsuneMark from './KitsuneMark.jsx';

function ThemeIcon({ theme }) {
    return theme === 'dark' ? (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
    ) : (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
    );
}

const NAV_ICONS = {
    featured: 'M3 11.5 12 4l9 7.5M5 10v10h5v-6h4v6h5V10',
    popular: 'M12 3c1 3 4 4.500 4 8a4 4 0 0 1-8 0c0-1.500.6-2.500 1.500-3.500C9.800 9 10 10 11 10c0-3 0-5 1-7Zm0 18a6 6 0 0 0 6-6',
    'recent-updates': 'M12 7v5l3 2M21 12a9 9 0 1 1-3-6.700M21 4v5h-5',
    season: 'M12 3v2m0 14v2M5.6 5.6 7 7m10 10 1.4 1.4M3 12h2m14 0h2M5.6 18.4 7 17m10-10 1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    'new-releases': 'M12 3l2.600 5.600 6.100.7-4.500 4.200 1.200 6L12 16.500 6.600 19.500l1.200-6L3.300 9.300l6.100-.7L12 3Z',
};

// Persistent brand + navigation chrome. The burger is available at every
// width: it opens a slide-in drawer with the browse destinations, a random
// pick and the theme switch.
export default function SiteHeader({ active = null }) {
    const { theme, toggleTheme } = useTheme();
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const burgerRef = useRef(null);
    const drawerRef = useRef(null);

    const close = useCallback(() => setOpen(false), []);

    // Esc closes; the page behind stops scrolling while the drawer is open.
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); burgerRef.current?.focus(); } };
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        drawerRef.current?.querySelector('a, button')?.focus();
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prev;
        };
    }, [open]);

    async function surprise() {
        if (busy) return;
        setBusy(true);
        try {
            const m = await fetchRandomManga();
            window.location.href = mangaUrl(m.id);
        } catch {
            setBusy(false);
        }
    }

    return (
        <>
            <header className="site-header">
                <div className="site-header-inner">
                    <button
                        ref={burgerRef}
                        type="button"
                        className={`burger${open ? ' is-open' : ''}`}
                        aria-label={open ? 'Close menu' : 'Open menu'}
                        aria-expanded={open}
                        aria-controls="site-drawer"
                        onClick={() => setOpen((o) => !o)}
                    >
                        <span /><span /><span />
                    </button>

                    <a href="/" className="brand" aria-label="Kitsunescan home">
                        <span className="brand-mark"><KitsuneMark /></span>
                        <span className="brand-words">
                            <span className="brand-name">Kitsune<em>scan</em></span>
                            <span className="brand-text-sub">Read manga &amp; manhwa, ad-free</span>
                        </span>
                    </a>

                    <nav className="site-nav" aria-label="Browse">
                        {NAV_TABS.map((t) => (
                            <a key={t.key} href={tabHref(t.key)} className={`site-nav-link${active === t.key ? ' active' : ''}`} aria-current={active === t.key ? 'page' : undefined}>
                                {t.label}
                            </a>
                        ))}
                    </nav>

                    <div className="header-actions">
                        <a className="icon-btn" href="/?tab=featured#search" aria-label="Search">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="m20 20-3.500-3.500" /></svg>
                        </a>
                        <button className="theme-toggle" aria-label="Toggle theme" onClick={toggleTheme}>
                            <ThemeIcon theme={theme} />
                        </button>
                    </div>
                </div>
            </header>

            <div className={`drawer-scrim${open ? ' is-open' : ''}`} onClick={close} aria-hidden="true" />
            <aside
                id="site-drawer"
                ref={drawerRef}
                className={`drawer${open ? ' is-open' : ''}`}
                aria-hidden={!open}
                aria-label="Site menu"
                // Closed drawer must not be tabbable.
                {...(!open ? { inert: '' } : {})}
            >
                <div className="drawer-head">
                    <a href="/" className="brand" onClick={close}>
                        <span className="brand-mark"><KitsuneMark /></span>
                        <span className="brand-words"><span className="brand-name">Kitsune<em>scan</em></span></span>
                    </a>
                    <button type="button" className="icon-btn" aria-label="Close menu" onClick={close}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
                    </button>
                </div>

                <p className="drawer-label">Browse</p>
                <nav className="drawer-nav" aria-label="Browse">
                    {NAV_TABS.map((t) => (
                        <a key={t.key} href={tabHref(t.key)} className={`drawer-link${active === t.key ? ' active' : ''}`} onClick={close}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={NAV_ICONS[t.key]} /></svg>
                            {t.label}
                        </a>
                    ))}
                </nav>

                <p className="drawer-label">Discover</p>
                <div className="drawer-nav">
                    <button type="button" className="drawer-link" onClick={surprise} disabled={busy}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
                        {busy ? 'Finding something…' : 'Surprise me'}
                    </button>
                    <a className="drawer-link" href="https://mangadex.org" target="_blank" rel="noopener noreferrer" onClick={close}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4 10 14M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
                        MangaDex
                    </a>
                </div>

                <div className="drawer-foot">
                    <button type="button" className="drawer-theme" onClick={toggleTheme}>
                        <span className="theme-toggle" aria-hidden="true"><ThemeIcon theme={theme} /></span>
                        {theme === 'dark' ? 'Dark mode' : 'Light mode'}
                        <span className="drawer-theme-hint">Tap to switch</span>
                    </button>
                </div>
            </aside>
        </>
    );
}
