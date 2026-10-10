import React from 'react';
import { DEFAULTS } from './useReaderSettings.js';
import { IconClose } from './Icons.jsx';

function Seg({ label, value, options, onChange, hint }) {
    return (
        <div className="rs-group">
            <div className="rs-label">{label}</div>
            <div className="rs-seg" role="radiogroup" aria-label={label}>
                {options.map((o) => (
                    <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value}
                        className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
                        {o.label}
                    </button>
                ))}
            </div>
            {hint && <p className="rs-hint">{hint}</p>}
        </div>
    );
}

const BGS = [
    { value: 'default', label: 'Theme', color: 'var(--bg)' },
    { value: 'black', label: 'Black', color: '#000' },
    { value: 'dim', label: 'Dim', color: '#16131a' },
    { value: 'sepia', label: 'Sepia', color: '#f1e4cc' },
    { value: 'white', label: 'White', color: '#fff' },
];

export default function ReaderSettings({ open, onClose, settings, update, reset, onShowKeys }) {
    const s = settings;
    const paged = s.mode === 'paged';
    return (
        <>
            <div className={`rs-scrim${open ? ' open' : ''}`} onClick={onClose} aria-hidden="true" />
            <aside className={`rs-panel${open ? ' open' : ''}`} aria-label="Reader settings" aria-hidden={!open} {...(!open ? { inert: '' } : {})}>
                <div className="rs-head">
                    <h3>Reader settings</h3>
                    <button type="button" className="icon-btn" aria-label="Close settings" onClick={onClose}><IconClose /></button>
                </div>

                <div className="rs-body">
                    <Seg label="Reading mode" value={s.mode} onChange={(v) => update({ mode: v })}
                        options={[{ value: 'webtoon', label: 'Webtoon' }, { value: 'paged', label: 'Paged' }]}
                        hint={paged ? 'One page at a time. Tap the screen edges or use the arrow keys.' : 'Continuous vertical scroll, made for manhwa and webtoons.'} />

                    {paged && (
                        <Seg label="Direction" value={s.direction} onChange={(v) => update({ direction: v })}
                            options={[{ value: 'ltr', label: 'Left → Right' }, { value: 'rtl', label: 'Right → Left' }]} />
                    )}

                    {!paged && (
                        <>
                            <Seg label="Page width" value={s.width} onChange={(v) => update({ width: v })}
                                options={[{ value: 'narrow', label: 'Narrow' }, { value: 'medium', label: 'Medium' }, { value: 'wide', label: 'Wide' }, { value: 'full', label: 'Full' }]} />
                            <Seg label="Space between pages" value={s.gap} onChange={(v) => update({ gap: v })}
                                options={[{ value: 0, label: 'None' }, { value: 6, label: 'Small' }, { value: 16, label: 'Large' }]} />
                        </>
                    )}

                    <div className="rs-group">
                        <div className="rs-label">Background</div>
                        <div className="rs-swatches" role="radiogroup" aria-label="Background">
                            {BGS.map((b) => (
                                <button key={b.value} type="button" role="radio" aria-checked={s.bg === b.value} title={b.label}
                                    className={s.bg === b.value ? 'on' : ''} onClick={() => update({ bg: b.value })}>
                                    <span style={{ background: b.color }} />
                                    <em>{b.label}</em>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="rs-group">
                        <div className="rs-label">Brightness <b>{s.brightness}%</b></div>
                        <input type="range" min="50" max="100" step="5" value={s.brightness} onChange={(e) => update({ brightness: Number(e.target.value) })} aria-label="Brightness" />
                    </div>

                    <Seg label="Image quality" value={s.dataSaver} onChange={(v) => update({ dataSaver: v })}
                        options={[{ value: false, label: 'Original' }, { value: true, label: 'Data saver' }]}
                        hint="Data saver loads smaller images, handy on mobile data." />

                    <div className="rs-group">
                        <div className="rs-label">Auto-scroll speed <b>{s.speed}</b></div>
                        <input type="range" min="1" max="10" step="1" value={s.speed} onChange={(e) => update({ speed: Number(e.target.value) })} aria-label="Auto-scroll speed" />
                        <p className="rs-hint">Start it with the play button or the P key (webtoon mode).</p>
                    </div>

                    <label className="rs-switch">
                        <span>Hide toolbar while scrolling<small>Scroll up or tap the screen to bring it back.</small></span>
                        <input type="checkbox" checked={s.autoHide} onChange={(e) => update({ autoHide: e.target.checked })} />
                        <i aria-hidden="true" />
                    </label>
                </div>

                <div className="rs-foot">
                    <button type="button" className="rs-btn" onClick={onShowKeys}>Keyboard shortcuts</button>
                    <button type="button" className="rs-btn ghost" onClick={reset} disabled={JSON.stringify(s) === JSON.stringify(DEFAULTS)}>Reset</button>
                </div>
            </aside>
        </>
    );
}
