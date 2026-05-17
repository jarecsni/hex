// Minimal htmx-subset for the Hex marketplace (M9.9).
//
// The full htmx library can't be vendored from this environment, so this
// implements exactly the slice the site uses: an element with `hx-get`
// fetches that URL on its `hx-trigger` event (with an optional
// `delay:Nms` debounce), sends `HX-Request: true`, and swaps the
// response HTML into the `hx-target` selector. Attribute names match
// htmx, so dropping in the real htmx.min.js later is a no-op swap.
(() => {
  function parseTrigger(spec, el) {
    const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
    const raw = spec || (isInput ? 'input' : 'click');
    const parts = raw.split(/\s+/);
    const event = parts[0];
    let delay = 0;
    for (const p of parts.slice(1)) {
      const m = /^delay:(\d+)ms$/.exec(p);
      if (m) delay = Number(m[1]);
    }
    return { event, delay };
  }

  function targetUrl(el) {
    const base = el.getAttribute('hx-get');
    if (el.name && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      const u = new URL(base, location.origin);
      u.searchParams.set(el.name, el.value);
      return u.pathname + u.search;
    }
    return base;
  }

  async function fire(el) {
    const url = targetUrl(el);
    const target = document.querySelector(el.getAttribute('hx-target') || 'body');
    if (!target) return;
    try {
      const res = await fetch(url, { headers: { 'HX-Request': 'true' } });
      target.innerHTML = await res.text();
      if (el.getAttribute('hx-push-url') === 'true') {
        history.replaceState(null, '', url);
      }
    } catch {
      // network blip — leave the current results in place
    }
  }

  function wire(el) {
    const { event, delay } = parseTrigger(el.getAttribute('hx-trigger'), el);
    let timer = null;
    el.addEventListener(event, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fire(el), delay);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    for (const el of document.querySelectorAll('[hx-get]')) wire(el);
  });
})();
