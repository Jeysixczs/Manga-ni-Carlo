import React, { Suspense, lazy } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { ThemeProvider } from './ThemeContext.jsx';
import SiteHeader from './components/SiteHeader.jsx';
import SiteFooter from './components/SiteFooter.jsx';
import GalleryPage from './components/GalleryPage.jsx';
import { MangaDetailsSkeleton } from './components/Skeleton.jsx';

// The gallery is the landing route, so it stays in the main bundle. The details
// and reader views are split out: a first-time visitor no longer downloads and
// parses the reader before they have picked anything to read.
const MangaDetailsPage = lazy(() => import('./components/MangaDetailsPage.jsx'));
const ChapterReaderPage = lazy(() => import('./components/ChapterReaderPage.jsx'));

const READER_PATH = /\/chapter\//;

function AppRoutes() {
    return (
        <Suspense fallback={<MangaDetailsSkeleton />}>
            <Routes>
                <Route path="/" element={<GalleryPage />} />
                <Route path="/manga/:mangaId" element={<MangaDetailsPage />} />
                <Route path="/manga/:mangaId/chapter/:chapterId" element={<ChapterReaderPage />} />
                <Route path="*" element={<GalleryPage />} />
            </Routes>
        </Suspense>
    );
}

function AppShell() {
    // The reader route keeps its own compact, auto-hiding header instead of the
    // persistent site header, so the reading canvas stays full-bleed and the
    // two navigation bars never compete for the same space.
    const { pathname } = useLocation();
    const isReader = READER_PATH.test(pathname);

    return (
        <>
            {!isReader && <SiteHeader />}
            <div className="container">
                <AppRoutes />
            </div>
            <SiteFooter />
        </>
    );
}

export default function App() {
    return (
        <ThemeProvider>
            <AppShell />
        </ThemeProvider>
    );
}
