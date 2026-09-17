import React from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../ThemeContext.jsx';

function ThemeToggleButton() {
    const { theme, toggleTheme } = useTheme();
    return (
        <button className="theme-toggle" aria-label="Toggle theme" onClick={toggleTheme}>
            {theme === 'dark' ? (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
            ) : (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
            )}
        </button>
    );
}

// Persistent brand + navigation chrome for the gallery and details pages.
// The reader page opts out of this (see App.jsx) in favor of its own
// compact, auto-hiding header, so the reading canvas stays full-bleed.
export default function SiteHeader() {
    return (
        <header className="site-header">
            <div className="site-header-inner">
                <Link to="/" className="brand">
                    <span className="brand-mark">MC</span>
                    <span>
                        Manhwa ni Carlo
                        <span className="brand-text-sub">Read manhwa &amp; manga, ad-free</span>
                    </span>
                </Link>
                <div className="header-actions">
                    <ThemeToggleButton />
                </div>
            </div>
        </header>
    );
}
