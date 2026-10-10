import React from 'react';

// Brand mascot. The artwork lives in /public/kitsune-logo.png (transparent PNG).
export default function KitsuneMark({ size = 40 }) {
    return (
        <img
            className="brand-logo"
            src="/kitsune-logo.png"
            width={size}
            height={size}
            alt=""
            decoding="async"
            aria-hidden="true"
        />
    );
}
