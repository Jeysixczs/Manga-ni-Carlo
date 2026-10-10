import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '../ThemeContext.jsx';
import SiteHeader from './SiteHeader.jsx';
import SiteFooter from './SiteFooter.jsx';
import { migrateLegacyReaderProgress } from '../utils.js';
import '../styles.css';

// Folds any pre-existing `readerPage_*` keys into the single bounded map.
migrateLegacyReaderProgress();

// Shared page frame. The reader opts out of the persistent header and uses
// its own compact, auto-hiding one so the reading canvas stays full-bleed.
export function mountPage(Page, { reader = false, active = null } = {}) {
    ReactDOM.createRoot(document.getElementById('root')).render(
        <React.StrictMode>
            <ThemeProvider>
                {!reader && <SiteHeader active={active} />}
                <main className="container">
                    <Page />
                </main>
                <SiteFooter />
            </ThemeProvider>
        </React.StrictMode>
    );
}
