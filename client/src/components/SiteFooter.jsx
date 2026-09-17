import React from 'react';

const CURRENT_YEAR = new Date().getFullYear();

export default function SiteFooter() {
    return (
        <footer>
            <p>&copy; {CURRENT_YEAR} ManhwaniCarlo. All rights reserved.</p>
            <p className="footer-credit">
                Created by <a href="https://jeysidev.vercel.app/" target="_blank" rel="noopener noreferrer">JeysiDev</a>
            </p>
            <p className="footer-note">
                Powered by <a target="_blank" rel="noopener noreferrer" href="https://mangadex.org">MangaDex API</a>
            </p>
        </footer>
    );
}
