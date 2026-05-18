(function() {
    const PANZOOM_EXCLUDE_CLASS = 'panzoom-exclude';
    const MSG_OPEN_LINK = 'openLink';
    const MSG_OPEN_EXTERNAL_LINK = 'openExternalLink';
    const MSG_SCHEME_LINK = 'schemeLink';
    const MSG_REQUEST_ALLOW_SCRIPTS = 'requestAllowScripts';
    const EXTERNAL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
    const HTTP_SCHEME_RE = /^https?:/i;

    const vscode = acquireVsCodeApi();

    const container = document.getElementById('svg-container');
    if (!container) {
        return;
    }

    const scriptPolicy = container.getAttribute('data-script-policy') || 'prompt';
    const hasScripts = container.getAttribute('data-has-scripts') === 'true';
    const allowScripts = container.getAttribute('data-allow-scripts') === 'true';

    if (scriptPolicy === 'prompt' && hasScripts && !allowScripts) {
        vscode.postMessage({ command: MSG_REQUEST_ALLOW_SCRIPTS });
    }

    const stage = container.querySelector('.panzoom-stage');

    function getLinkHref(link) {
        return link.getAttribute('href') || link.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    }

    function markPanzoomExcluded(link) {
        link.classList.add(PANZOOM_EXCLUDE_CLASS);
    }

    function dispatchLinkHref(href, event) {
        if (!href) {
            return;
        }
        if (HTTP_SCHEME_RE.test(href)) {
            event.preventDefault();
            event.stopPropagation();
            vscode.postMessage({ command: MSG_OPEN_EXTERNAL_LINK, href: href });
            return;
        }
        if (EXTERNAL_SCHEME_RE.test(href)) {
            event.preventDefault();
            event.stopPropagation();
            vscode.postMessage({ command: MSG_SCHEME_LINK, href: href });
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        vscode.postMessage({ command: MSG_OPEN_LINK, href: href });
    }

    const encodedSvg = stage.getAttribute('data-svg');
    if (encodedSvg) {
        const svgString = atob(encodedSvg);
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgString, 'image/svg+xml');

        if (doc.querySelector('parsererror')) {
            stage.innerHTML = '<div style="color: red;">Error parsing SVG</div>';
        } else {
            stage.appendChild(doc.documentElement);

            if (allowScripts) {
                const scripts = stage.querySelectorAll('script');
                scripts.forEach(s => {
                    const newScript = document.createElement('script');
                    newScript.textContent = s.textContent;
                    document.body.appendChild(newScript);
                });
            }
        }
    }

    const svgElement = stage && stage.querySelector('svg');

    if (stage && svgElement) {
        stage.querySelectorAll('a').forEach(markPanzoomExcluded);

        const panzoom = Panzoom(stage, {
            maxScale: 50,
            minScale: 0.1,
            step: 0.3,
            excludeClass: PANZOOM_EXCLUDE_CLASS
        });

        const wheelTarget = stage.parentElement;
        if (wheelTarget) {
            wheelTarget.addEventListener('wheel', panzoom.zoomWithWheel, { passive: false });
        }

        document.getElementById('zoom-in').addEventListener('click', panzoom.zoomIn);
        document.getElementById('zoom-out').addEventListener('click', panzoom.zoomOut);
        document.getElementById('zoom-reset').addEventListener('click', panzoom.reset);

        stage.addEventListener('click', event => {
            const link = event.target.closest('a');
            if (!link || !stage.contains(link)) {
                return;
            }
            dispatchLinkHref(getLinkHref(link), event);
        });

        const linkObserver = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType !== Node.ELEMENT_NODE) {
                        return;
                    }
                    const element = /** @type {Element} */ (node);
                    if (element.matches('a')) {
                        markPanzoomExcluded(element);
                    }
                    element.querySelectorAll('a').forEach(markPanzoomExcluded);
                });
            }
        });
        linkObserver.observe(stage, { childList: true, subtree: true });
    }
}());
