import React from 'react';
import { NAV_TABS, tabHref } from '../navLinks.js';
import KitsuneMark from './KitsuneMark.jsx';
import FooterBackdrop from './FooterBackdrop.jsx';

const CURRENT_YEAR = new Date().getFullYear();

export default function SiteFooter() {
    return (
        <footer className="site-footer">
            <FooterBackdrop />
            <div className="site-footer-inner">
                <div className="footer-brand">
                    <a href="/" className="brand" aria-label="Kitsunescan home">
                        <span className="brand-mark"><KitsuneMark /></span>
                        <span className="brand-words"><span className="brand-name">Kitsune<em>scan</em></span></span>
                    </a>
                    <p>A quiet, ad-free place to read manga and manhwa. Pick a series, pick a chapter, keep your place.</p>
                </div>

                <nav className="footer-col" aria-label="Browse">
                    <h4>Browse</h4>
                    {NAV_TABS.map((t) => <a key={t.key} href={tabHref(t.key)}>{t.label}</a>)}
                </nav>

                <nav className="footer-col" aria-label="Genres">
                    <h4>Popular genres</h4>
                    <a href="/?q=action">Action</a>
                    <a href="/?q=romance">Romance</a>
                    <a href="/?q=fantasy">Fantasy</a>
                    <a href="/?q=comedy">Comedy</a>
                </nav>

                <nav className="footer-col" aria-label="About">
                    <h4>About</h4>
                    <a target="_blank" rel="noopener noreferrer" href="https://mangadex.org">Powered by MangaDex API</a>
                    <a target="_blank" rel="noopener noreferrer" href="https://jeysidev.vercel.app/">Created by JeysiDev</a>
                    <a href="#top" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Back to top ↑</a>
                </nav>
            </div>

            <div className="footer-bar">
                <p>&copy; {CURRENT_YEAR} Kitsunescan. All rights reserved.</p>
                <p className="footer-note">Kitsunescan does not host any files. All content is provided by MangaDex and its scanlation groups.</p>
            </div>
        </footer>
    );
}
