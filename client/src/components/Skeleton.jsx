import React from 'react';

export function SkeletonLine({ width = '100%', height = 12, style = {} }) {
    return <div className="skeleton skeleton-line" style={{ width, height, ...style }} />;
}

export function MangaCardSkeleton() {
    return (
        <div className="manga-card skeleton-card" aria-hidden="true">
            <div className="manga-cover skeleton" />
            <div className="manga-info">
                <SkeletonLine width="85%" height={14} />
                <SkeletonLine width="55%" height={11} />
                <SkeletonLine width="100%" height={11} />
                <SkeletonLine width="90%" height={11} />
            </div>
        </div>
    );
}

export function ChapterItemSkeleton() {
    return (
        <div className="chapter-item skeleton-card" aria-hidden="true">
            <SkeletonLine width="65%" height={13} style={{ marginBottom: 8 }} />
            <SkeletonLine width="45%" height={11} />
        </div>
    );
}

export function MangaDetailsSkeleton() {
    return (
        <div id="manga-details-view" className="view active" aria-hidden="true">
            <div className="container">
                <div className="skeleton skeleton-line" style={{ width: 150, height: 34, borderRadius: 'var(--radius)', marginBottom: 20 }} />
                <div className="skeleton skeleton-line" style={{ width: '50%', height: 28, margin: '8px auto 28px' }} />

                <div className="manga-details-content">
                    <div className="manga-cover-section">
                        <div className="skeleton details-cover" />
                        <div className="manga-meta">
                            <SkeletonLine width="80%" height={13} style={{ marginBottom: 12 }} />
                            <SkeletonLine width="65%" height={13} style={{ marginBottom: 12 }} />
                            <SkeletonLine width="90%" height={13} style={{ marginBottom: 12 }} />
                            <SkeletonLine width="70%" height={13} style={{ marginBottom: 12 }} />
                            <SkeletonLine width="60%" height={13} />
                        </div>
                    </div>

                    <div className="manga-info-section">
                        <div className="manga-alternative-titles">
                            <SkeletonLine width="140px" height={20} style={{ marginBottom: 12 }} />
                            <SkeletonLine width="95%" height={13} style={{ marginBottom: 8 }} />
                            <SkeletonLine width="70%" height={13} />
                        </div>

                        <div className="manga-description" style={{ marginTop: 28 }}>
                            <SkeletonLine width="140px" height={20} style={{ marginBottom: 12 }} />
                            <SkeletonLine width="100%" height={13} style={{ marginBottom: 8 }} />
                            <SkeletonLine width="100%" height={13} style={{ marginBottom: 8 }} />
                            <SkeletonLine width="80%" height={13} />
                        </div>

                        <div className="manga-chapters" style={{ marginTop: 28 }}>
                            <SkeletonLine width="120px" height={20} style={{ marginBottom: 14 }} />
                            <div className="chapters-list">
                                {Array.from({ length: 6 }).map((_, i) => <ChapterItemSkeleton key={i} />)}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function ReaderPageSkeleton({ count = 3 }) {
    return (
        <>
            {Array.from({ length: count }).map((_, i) => (
                <div className="page-container" key={i} aria-hidden="true">
                    {/* Same markup as a real loading page (see ChapterPage in
                        ChapterReaderPage.jsx) so the placeholder shown while the
                        page *list* is being fetched doesn't visibly reflow when
                        the individual page skeletons replace it. */}
                    <div className="page-frame is-loading">
                        <div className="page-skeleton skeleton">
                            <span className="page-skeleton-label">{i + 1}</span>
                        </div>
                    </div>
                </div>
            ))}
        </>
    );
}
