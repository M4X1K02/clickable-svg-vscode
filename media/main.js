(function() {
    const PANZOOM_EXCLUDE_CLASS = 'panzoom-exclude';

    const vscode = acquireVsCodeApi();

    const container = document.getElementById('svg-container');
    if (!container) {
        return;
    }

    const scriptPolicy = container.getAttribute('data-script-policy') || 'prompt';
    const hasScripts = container.getAttribute('data-has-scripts') === 'true';
    const allowScripts = container.getAttribute('data-allow-scripts') === 'true';

    // Only prompt when settings allow it (`prompt` policy); avoids pointless messages when strict/permissive.
    if (scriptPolicy === 'prompt' && hasScripts && !allowScripts) {
        vscode.postMessage({ command: 'requestAllowScripts' });
    }

    const stage = container.querySelector('.panzoom-stage');
    const svgElement = stage && stage.querySelector('svg');

    if (stage && svgElement) {
        const links = svgElement.querySelectorAll('a');
        // Panzoom steals pointer events unless excluded (otherwise clicks feel "stuck")
        links.forEach(link => link.classList.add(PANZOOM_EXCLUDE_CLASS));

        // Panzoom on the wrapper div — not the root <svg> — so wheel zoom stays anchored to the cursor
        // (SVG transform-origin defaults break focal-point math vs HTML elements).
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

        links.forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                let href = link.getAttribute('href') || link.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
                if (href) {
                    vscode.postMessage({ command: 'openLink', href: href });
                }
            });
        });
    }
}());
