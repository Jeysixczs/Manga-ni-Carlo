import React from 'react';

// Decorative footer scene: dusk glow, layered ridges, a torii gate and drifting
// fox-fire wisps (the blue flames from the mascot). Colours come from CSS
// variables so it follows the light/dark theme. Purely decorative.
const WISPS = [
    { x: 150, y: 300, s: 1.0 },
    { x: 420, y: 340, s: 0.7 },
    { x: 760, y: 310, s: 0.85 },
    { x: 1010, y: 350, s: 0.6 },
    { x: 1290, y: 300, s: 1.1 },
];
const SPARKS = [[260, 250], [610, 230], [900, 270], [1180, 220], [1380, 260]];

export default function FooterBackdrop() {
    return (
        <svg className="footer-art" viewBox="0 0 1440 420" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
            <defs>
                <radialGradient id="fa-glow" cx="82%" cy="30%" r="55%">
                    <stop className="fa-glow-stop" offset="0" stopOpacity=".28" />
                    <stop className="fa-glow-stop" offset="1" stopOpacity="0" />
                </radialGradient>
                <filter id="fa-blur" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="5" /></filter>
                <path id="fa-flame" d="M0 0C-9-2-12-12-6-22C-4-16-1-15 0-19C2-28-1-34 3-40C9-30 14-22 11-10C9-3 4 0 0 0Z" />
                <path id="fa-spark" d="M0-7C1-2 2-1 7 0C2 1 1 2 0 7C-1 2-2 1-7 0C-2-1-1-2 0-7Z" />
            </defs>

            <rect width="1440" height="420" fill="url(#fa-glow)" />
            <circle className="fa-moon" cx="1180" cy="120" r="56" />
            <circle className="fa-moon-ring" cx="1180" cy="120" r="76" />

            <path className="fa-far" d="M0 260 L120 215 L230 250 L360 190 L500 245 L640 205 L780 250 L930 195 L1070 240 L1210 200 L1330 235 L1440 210 V420 H0Z" />
            <path className="fa-mid" d="M0 310 C140 260 260 300 400 285 C560 268 640 320 800 300 C960 280 1060 250 1200 275 C1300 292 1380 280 1440 270 V420 H0Z" />

            {/* torii gate on the mid ridge */}
            <g className="fa-torii" transform="translate(1235 0)">
                <path d="M-46 252 Q0 240 46 252 L43 262 Q0 253 -43 262Z" />
                <rect x="-38" y="266" width="76" height="6" rx="1" />
                <rect x="-30" y="262" width="8" height="62" rx="1" />
                <rect x="22" y="262" width="8" height="62" rx="1" />
            </g>

            <path className="fa-near" d="M0 360 C180 325 300 350 470 338 C660 324 760 360 960 346 C1140 334 1290 322 1440 340 V420 H0Z" />
            <path className="fa-near-edge" d="M0 360 C180 325 300 350 470 338 C660 324 760 360 960 346 C1140 334 1290 322 1440 340" />

            {SPARKS.map(([x, y], i) => <use key={i} href="#fa-spark" className="fa-spark" transform={`translate(${x} ${y})`} />)}

            {WISPS.map((w, i) => (
                <g key={i} className="fa-wisp">
                    <g transform={`translate(${w.x} ${w.y}) scale(${w.s})`}>
                        <use href="#fa-flame" className="fa-fire" filter="url(#fa-blur)" />
                        <use href="#fa-flame" className="fa-fire" />
                        <use href="#fa-flame" className="fa-fire-core" transform="scale(.45) translate(0 -2)" />
                    </g>
                </g>
            ))}
        </svg>
    );
}
