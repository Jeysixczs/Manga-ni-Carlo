import { useCallback, useEffect, useState } from 'react';

// Drop-in replacement for react-router's useSearchParams, now that each screen
// is its own HTML page. Updates push a history entry so Back still works.
export function useSearchParams() {
    const [params, setParams] = useState(() => new URLSearchParams(window.location.search));

    useEffect(() => {
        const onPop = () => setParams(new URLSearchParams(window.location.search));
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);

    const setSearchParams = useCallback((next) => {
        const qs = next.toString();
        window.history.pushState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
        setParams(new URLSearchParams(qs));
    }, []);

    return [params, setSearchParams];
}
