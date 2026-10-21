/* The browser half of the in-builder preview.
 *
 * A generated project is `.tsx` source. The HTML is what `next build` produces,
 * and nothing on this platform runs `next build` — which is why, until now, a
 * customer who asked for an application was shown a written summary of its
 * files and had to deploy to Vercel to find out what they had actually been
 * given. Deployment was the only renderer, so a deployment that failed took the
 * preview with it.
 *
 * This is the other renderer. It compiles the tree in the browser, in the
 * sandboxed preview document, and runs it: a module registry over the project's
 * own files, a small set of shims standing in for the packages a generated
 * project imports, and a router that reads the App Router's directory
 * conventions. What the customer sees is their application, not an account of
 * it.
 *
 * ── Why this is a string and not a module ─────────────────────────────────
 *
 * It runs inside a document served by src/app/preview/[projectId]/route.ts with
 * `Content-Security-Policy: sandbox`, in an opaque origin, with no access to
 * this origin's cookies or API. It is not part of this application's bundle and
 * must not be — it is the thing being kept at arm's length. So it travels as
 * source, is embedded in that document, and is the only code in this repository
 * that is written to be read by a browser other than its own.
 *
 * NO BACKTICKS BELOW. The whole of this is one template literal, and a stray
 * backtick or ${ in the runtime would end it or interpolate into it. Single
 * quotes and concatenation throughout, deliberately, however much a template
 * literal would read better in places.
 *
 * ── What it is honest about ───────────────────────────────────────────────
 *
 * It is a faithful renderer of the subset a generated project actually uses,
 * not a reimplementation of Next.js. Server components that fetch, route
 * handlers, parallel routes and streaming are not here and are not pretended
 * at: where it cannot render something it says so in the pane, in a sentence,
 * rather than showing a blank rectangle or a plausible-looking mock. A preview
 * that lies about what was built is worse than one that is honest about its
 * limits — the same rule project-summary.ts was written under, applied to a
 * renderer that can now show the real thing nearly all of the time.
 */

/* Edit mode: hovering outlines, a click picks, and the picks travel to the
 * workspace. A fragment rather than a script — it expects report() in scope —
 * shared by PREVIEW_RUNTIME below and the single-page document, which has no
 * runtime of its own (see single-page-edit.ts). */
export const EDIT_MODE = `
  /* ── Edit mode ─────────────────────────────────────────────────────────
   *
   * Switched on by the workspace. Hovering outlines the element under the
   * pointer; a click selects it instead of doing what it would do — no link
   * followed, no form sent — and tells the workspace what it is and where it
   * was written. Changes the workspace is about to make are shown here first
   * (previewChange), on every element written at that same place. */
  var editing = false;
  var hoverBox = null;
  var selectBox = null;
  /* The tag of what is selected, in a badge on its top-left corner — "h1",
     "button" — so it is clear which element a request will be about. */
  var selectLabel = null;
  var lastRect = '';
  /* Everything clicked so far, like clipping: each keeps its own outline until
     it is clicked again, the request is sent, or Escape lets go of them all.
     \`selected\` is the newest, which the badge and the prompt follow. */
  var picks = [];
  var pickBoxes = [];
  var pickSeq = 0;

  function addPick(element) {
    if (!element.__qsPick) { pickSeq += 1; element.__qsPick = pickSeq; }
    picks.push(element);
    pickBoxes.push(overlay('#2563eb', 2));
  }

  function removePick(index) {
    var box = pickBoxes[index];
    if (box && box.parentNode) box.parentNode.removeChild(box);
    picks.splice(index, 1);
    pickBoxes.splice(index, 1);
  }

  function clearPicks() {
    while (picks.length) removePick(0);
  }
  var selected = null;
  var hovered = null;
  var following = 0;
  /* On a phone the workspace's controls are a sheet over the lower part of
     the screen, so a tapped element is brought up above it. */
  var touchLayout = false;

  function overlay(colour, width) {
    var box = document.createElement('div');
    box.setAttribute('data-qs-overlay', '');
    box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border-radius:3px;display:none;box-sizing:border-box;border:' + width + 'px solid ' + colour + ';';
    document.body.appendChild(box);
    return box;
  }

  function label() {
    var tag = document.createElement('div');
    tag.setAttribute('data-qs-overlay', '');
    tag.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;display:none;align-items:center;gap:4px;padding:2px 6px;border-radius:5px;background:#2563eb;color:#fff;font:600 11px/16px ui-sans-serif,system-ui,sans-serif;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.25);';
    document.body.appendChild(tag);
    return tag;
  }

  function placeLabel(element) {
    if (!selectLabel) return;
    if (!element || !element.isConnected) { selectLabel.style.display = 'none'; return; }
    var rect = element.getBoundingClientRect();
    selectLabel.textContent = '\u25C7 ' + element.tagName.toLowerCase();
    selectLabel.style.display = 'flex';
    selectLabel.style.left = Math.max(2, rect.left) + 'px';
    selectLabel.style.top = (rect.top > 22 ? rect.top - 22 : rect.top + 2) + 'px';
  }

  function rectOf(element) {
    var rect = element.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  }

  /* Where the selected element is now, sent only when it moved, so the
     workspace can keep its prompt beside it while the page scrolls. */
  function reportRect() {
    if (!selected || !selected.isConnected) return;
    var rect = rectOf(selected);
    var key = rect.top + ',' + rect.left + ',' + rect.width + ',' + rect.height + ',' + rect.viewportWidth;
    if (key === lastRect) return;
    lastRect = key;
    report('rect', rect);
  }

  function place(box, element) {
    if (!box) return;
    if (!element || !element.isConnected) { box.style.display = 'none'; return; }
    var rect = element.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = rect.left + 'px';
    box.style.top = rect.top + 'px';
    box.style.width = rect.width + 'px';
    box.style.height = rect.height + 'px';
  }

  function taggedFrom(node) {
    while (node && node.nodeType === 1) {
      if (node.hasAttribute('data-qs-src')) return node;
      node = node.parentElement;
    }
    return null;
  }

  function sameSource(src) {
    var escaped = window.CSS && window.CSS.escape ? window.CSS.escape(src) : src.replace(/"/g, '');
    return document.querySelectorAll('[data-qs-src="' + escaped + '"]');
  }

  function onlyText(element) {
    for (var i = 0; i < element.childNodes.length; i += 1) {
      if (element.childNodes[i].nodeType !== 3) return false;
    }
    return element.textContent.trim().length > 0;
  }

  function describeElement(element) {
    var src = element.getAttribute('data-qs-src');
    var style = getComputedStyle(element);
    return {
      src: src,
      tag: element.tagName.toLowerCase(),
      className: element.getAttribute('class') || '',
      text: onlyText(element) ? element.textContent : null,
      imageSrc: element.tagName === 'IMG' ? element.getAttribute('src') : null,
      repeated: sameSource(src).length,
      color: style.color,
      background: style.backgroundColor,
      fontSize: style.fontSize,
      rect: rectOf(element),
      pickId: element.__qsPick || 0
    };
  }

  var touchStyle = null;

  function onHover(event) {
    if (!editing) return;
    hovered = touchLayout ? null : taggedFrom(event.target);
    place(hoverBox, hovered);
  }

  /* Outlines stay on their elements every frame while editing. Positioned
     once and moved only on scroll, they drifted whenever the page moved
     without scrolling — a picture loading above, a phone's address bar
     folding away, the keyboard opening — and sat beside the thing they
     named. One rect per outline per frame is nothing. */
  function tick() {
    if (!editing) { following = 0; return; }
    place(selectBox, selected);
    placeLabel(selected);
    for (var p = 0; p < picks.length; p += 1) place(pickBoxes[p], picks[p]);
    reportRect();
    if (hovered) place(hoverBox, hovered);
    following = window.requestAnimationFrame(tick);
  }

  function reveal(element) {
    if (!touchLayout || !element) return;
    var rect = element.getBoundingClientRect();
    var limit = window.innerHeight * 0.45;
    if (rect.top < 0 || rect.bottom > limit) {
      window.scrollBy({ top: rect.top - window.innerHeight * 0.12, behavior: 'smooth' });
    }
  }

  function selectElement(element) {
    selected = element;
    lastRect = '';
    place(selectBox, element);
    placeLabel(element);
    reveal(element);
    report('select', describeElement(element));
  }

  /* A finger cannot always hit the small thing it means, so the workspace can
     ask for the element around the one that was picked. */
  function selectParentOf() {
    if (!editing || !selected) return;
    var parent = taggedFrom(selected.parentElement);
    if (!parent) return;
    var at = picks.indexOf(selected);
    if (at >= 0) { report('unpick', { pickId: selected.__qsPick || 0 }); removePick(at); }
    if (picks.indexOf(parent) < 0) addPick(parent);
    selectElement(parent);
  }

  /* ── Typing straight into the page ─────────────────────────────────────
     A picked element that holds only text can be typed into where it
     stands: tap (or click) it again, or the workspace's "Edit text". The
     words change as they are typed; Enter or tapping away saves them —
     reported as 'typed' for the workspace to write into the source — and
     Escape puts the old words back. Copies written at the same place (a
     card in a list) follow. */
  var typing = null;
  var typingBefore = '';
  function canType(element) { return Boolean(element) && onlyText(element); }
  function startTyping(element) {
    if (!editing || !canType(element)) return false;
    if (typing === element) return true;
    stopTyping(true);
    typing = element;
    typingBefore = element.textContent;
    element.setAttribute('contenteditable', 'plaintext-only');
    if (element.contentEditable !== 'plaintext-only') element.setAttribute('contenteditable', 'true');
    element.setAttribute('spellcheck', 'true');
    element.style.outline = '2px dashed #f97316';
    element.style.outlineOffset = '3px';
    element.style.cursor = 'text';
    element.style.setProperty('-webkit-user-select', 'text', 'important');
    element.style.setProperty('user-select', 'text', 'important');
    element.addEventListener('keydown', onTypingKey);
    element.addEventListener('blur', onTypingBlur);
    element.focus();
    try {
      var range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      var chosen = window.getSelection();
      chosen.removeAllRanges();
      chosen.addRange(range);
    } catch (ignored) {}
    report('typing', { src: element.getAttribute('data-qs-src') });
    return true;
  }
  function onTypingKey(event) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); typing && typing.blur(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); stopTyping(false); }
  }
  function onTypingBlur() { stopTyping(true); }
  function stopTyping(save) {
    if (!typing) return;
    var element = typing;
    typing = null;
    element.removeEventListener('keydown', onTypingKey);
    element.removeEventListener('blur', onTypingBlur);
    element.removeAttribute('contenteditable');
    element.removeAttribute('spellcheck');
    element.style.outline = '';
    element.style.outlineOffset = '';
    element.style.cursor = '';
    element.style.removeProperty('-webkit-user-select');
    element.style.removeProperty('user-select');
    var text = element.textContent.replace(/\u00a0/g, ' ');
    var src = element.getAttribute('data-qs-src');
    if (!save || !text.trim() || text.trim() === typingBefore.trim()) {
      element.textContent = typingBefore;
      report('typed', { src: src, changed: false });
      return;
    }
    var copies = sameSource(src);
    for (var i = 0; i < copies.length; i += 1) if (copies[i] !== element && onlyText(copies[i])) copies[i].textContent = text;
    report('typed', { src: src, tag: element.tagName.toLowerCase(), className: element.getAttribute('class') || '', before: typingBefore, text: text, changed: true });
  }

  /* A finger, not a mouse. iOS sends no click for a tap on plain text, a
     picture or a box — only on links and buttons — so on a touch screen the
     pick is taken from the tap itself: a touch that ends where it began,
     quickly. One that moved was a scroll and picks nothing. The click that
     may follow is still swallowed (it would follow a link) but picks
     nothing twice. */
  var touchStart = null;
  var tappedAt = 0;
  function onTouchDown(event) {
    if (!editing || event.pointerType === 'mouse') { touchStart = null; return; }
    touchStart = { x: event.clientX, y: event.clientY, t: Date.now() };
  }
  function onTouchUp(event) {
    if (!editing || !touchStart || event.pointerType === 'mouse') return;
    if (typing && typing.contains(event.target)) { touchStart = null; return; }
    var moved = Math.abs(event.clientX - touchStart.x) + Math.abs(event.clientY - touchStart.y);
    var quick = Date.now() - touchStart.t < 700;
    touchStart = null;
    if (moved > 12 || !quick) return;
    tappedAt = Date.now();
    pickAt(document.elementFromPoint(event.clientX, event.clientY) || event.target);
  }

  function onPick(event) {
    if (!editing) return;
    if (typing && typing.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    if (Date.now() - tappedAt < 800) return;
    pickAt(event.target);
  }

  function pickAt(target) {
    var element = taggedFrom(target);
    if (!element) return;
    var at = picks.indexOf(element);
    /* The selected one, tapped again: type into it, when it is words. */
    if (at >= 0 && element === selected && canType(element)) { startTyping(element); return; }
    if (at >= 0) {
      /* Clicked again: let go of that one, and the newest left is the one the
         prompt sits beside. */
      removePick(at);
      report('unpick', { pickId: element.__qsPick || 0 });
      selected = picks.length ? picks[picks.length - 1] : null;
      lastRect = '';
      place(selectBox, selected);
      placeLabel(selected);
      if (selected) report('select', describeElement(selected));
      return;
    }
    addPick(element);
    selectElement(element);
  }

  /* Escape lets go of the selection, in the frame as in the workspace. */
  function onKey(event) {
    if (typing) return;
    if (!editing || event.key !== 'Escape' || !selected) return;
    clearPicks();
    selected = null;
    lastRect = '';
    place(selectBox, null);
    placeLabel(null);
    report('deselect', null);
  }

  function onBlock(event) {
    if (!editing) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function follow() {
    if (!editing) return;
    place(selectBox, selected);
  }

  function setEditing(on) {
    if (on === editing) return;
    if (!on) stopTyping(true);
    editing = on;
    if (!hoverBox) { hoverBox = overlay('rgba(59,130,246,0.7)', 1); selectBox = overlay('#2563eb', 2); selectLabel = label(); }
    if (on) {
      window.addEventListener('mousemove', onHover, true);
      window.addEventListener('click', onPick, true);
      window.addEventListener('pointerdown', onTouchDown, true);
      window.addEventListener('pointerup', onTouchUp, true);
      window.addEventListener('submit', onBlock, true);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('scroll', follow, true);
      window.addEventListener('resize', follow);
      document.documentElement.style.cursor = touchLayout ? 'pointer' : 'crosshair';
      /* While picking on a phone: no text-selection or picture callout on a
         long press, no grey tap flash — the outline is the feedback. */
      if (touchLayout && !touchStyle) {
        touchStyle = document.createElement('style');
        touchStyle.textContent = '*{-webkit-touch-callout:none!important;-webkit-user-select:none!important;user-select:none!important;-webkit-tap-highlight-color:transparent!important}';
        document.head.appendChild(touchStyle);
      }
      if (!following) following = window.requestAnimationFrame(tick);
    } else {
      window.removeEventListener('mousemove', onHover, true);
      window.removeEventListener('click', onPick, true);
      window.removeEventListener('pointerdown', onTouchDown, true);
      window.removeEventListener('pointerup', onTouchUp, true);
      window.removeEventListener('submit', onBlock, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
      document.documentElement.style.cursor = '';
      if (touchStyle) { touchStyle.remove(); touchStyle = null; }
      selected = null;
      hovered = null;
      if (following) { window.cancelAnimationFrame(following); following = 0; }
      place(hoverBox, null);
      place(selectBox, null);
      placeLabel(null);
      clearPicks();
      lastRect = '';
    }
  }

  /* A change shown before it is made: the class string, words and picture the
     workspace has worked out, on every element written at that place. */
  function previewChange(change) {
    /* A font from the style panel: its stylesheet, fetched once, from Google
       Fonts only — the same host the saved page will load it from. */
    if (typeof change.fontHref === 'string' && change.fontHref.indexOf('https://fonts.googleapis.com/css2?') === 0) {
      var have = document.querySelectorAll('link[rel="stylesheet"]');
      var loaded = false;
      for (var l = 0; l < have.length; l += 1) if (have[l].getAttribute('href') === change.fontHref) loaded = true;
      if (!loaded) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = change.fontHref;
        document.head.appendChild(link);
      }
    }
    var elements = sameSource(change.src);
    for (var i = 0; i < elements.length; i += 1) {
      var element = elements[i];
      if (typeof change.className === 'string') element.setAttribute('class', change.className);
      if (typeof change.text === 'string' && onlyText(element)) element.textContent = change.text;
      if (typeof change.imageSrc === 'string' && element.tagName === 'IMG') element.setAttribute('src', change.imageSrc);
      if (change.hide === true) element.style.setProperty('display', 'none', 'important');
    }
    follow();
  }

  /* The project's design tokens — its colours and type sizes — so the panel
     offers the palette the site was designed with rather than any colour. */
  function designTokens() {
    var out = {};
    try {
      for (var s = 0; s < document.styleSheets.length; s += 1) {
        var rules;
        try { rules = document.styleSheets[s].cssRules; } catch (ignored) { continue; }
        for (var r = 0; r < rules.length; r += 1) {
          var rule = rules[r];
          if (!rule.style || !rule.selectorText || rule.selectorText.indexOf(':root') < 0) continue;
          for (var k = 0; k < rule.style.length; k += 1) {
            var name = rule.style[k];
            if (name.indexOf('--') === 0 && !Object.prototype.hasOwnProperty.call(out, name)) out[name] = rule.style.getPropertyValue(name).trim();
          }
        }
      }
    } catch (ignored) {}
    return out;
  }
`;

export const PREVIEW_RUNTIME = `
(function () {
  'use strict';

  var FILES = window.__QS_FILES || {};
  var ROUTES = window.__QS_ROUTES || [];
  var ENTRY = window.__QS_ENTRY || '/';
  /* Paths as the project writes them, for a tree previewed under another
     layout (a src/ project is read as if src/ were the root): what the visual
     editor names must be the file the edit path will open. */
  var ORIGIN = window.__QS_ORIGIN || {};
  /* Repository pictures and svgs, as path -> address. See assetUrl. */
  var ASSETS = window.__QS_ASSETS || {};
  /* A Vite or Create React App project: no routes, one entry that mounts
     itself. See start(). */
  var SPA_ENTRY = window.__QS_SPA_ENTRY || null;

  /* 'process', because generated code reads it.
   *
   * lib/supabase.ts in every backend project reads
   * process.env.NEXT_PUBLIC_SUPABASE_URL and its two siblings - see
   * builder/scaffold.ts, which writes that file. Under next build those reads
   * are inlined at build time and 'process' never survives into the browser.
   * Nothing inlines anything here, so the identifier was still there at
   * evaluation, and a browser has no 'process'.
   *
   * So every screen that imported the Supabase client threw
   * 'ReferenceError: process is not defined' the moment the module was
   * required, and the pane reported a screen that could not be rendered -
   * true, and silent about why. Pages that did not touch the client rendered
   * normally, which made it look like one bad page rather than one missing
   * global.
   *
   * Passed as a module parameter rather than set on window: the project's
   * modules get it, nothing else on this document does, and it cannot be
   * reassigned from inside a generated file.
   *
   * env carries only the NEXT_PUBLIC_ values, which any real build compiles
   * into the bundle and serves to every visitor - so there is nothing here a
   * deployed copy of this project would not already hand out. When the host
   * sends none, env is empty and the generated client reports itself
   * unconfigured on first use, which is exactly what scaffold.ts wrote it to
   * do. Either way the screen renders. */
  var PROCESS = { env: Object.assign({ NODE_ENV: 'development', MODE: 'development', DEV: true, PROD: false, BASE_URL: '/' }, window.__QS_ENV || {}) };

  /* Whether the host gave this preview a real database. Decided before the
     placeholders below are filled in, so they can never be mistaken for one.
   *
     With none, the generated lib/supabase.ts still refused on first use -
     "This app needs NEXT_PUBLIC_SUPABASE_URL..." - and a person looking at
     their app saw an error screen meant for whoever deploys it. So the
     variables are filled with placeholders the client accepts, and the
     client it builds is the stub: every query resolves empty and the page
     renders its own empty state, which is the truthful picture of an app
     whose tables are not there yet. */
  var LIVE_DB = Boolean(PROCESS.env.NEXT_PUBLIC_SUPABASE_URL && PROCESS.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!LIVE_DB) {
    var PLACEHOLDER_ENV = {
      NEXT_PUBLIC_SUPABASE_URL: 'https://preview.supabase.invalid',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'preview-anon-key',
      VITE_SUPABASE_URL: 'https://preview.supabase.invalid',
      VITE_SUPABASE_ANON_KEY: 'preview-anon-key'
    };
    for (var placeholder in PLACEHOLDER_ENV) {
      if (!PROCESS.env[placeholder]) PROCESS.env[placeholder] = PLACEHOLDER_ENV[placeholder];
    }
  }

  /* A picture the project refers to by path - "/logo.png" from public/, "./hero.jpg"
     beside a page - as the address it was stored at. Null for anything that is
     not one of them, which is then left exactly as written. */
  function assetUrl(value) {
    if (typeof value !== 'string' || !value) return null;
    if (value.indexOf('//') >= 0 || value.indexOf('data:') === 0 || value.charAt(0) === '#') return null;
    var clean = value.split('?')[0].split('#')[0];
    while (clean.indexOf('./') === 0) clean = clean.slice(2);
    if (clean.charAt(0) === '/') clean = clean.slice(1);
    var tries = [clean, 'public/' + clean, 'src/' + clean, 'static/' + clean, 'src/assets/' + clean];
    for (var i = 0; i < tries.length; i += 1) {
      if (Object.prototype.hasOwnProperty.call(ASSETS, tries[i])) return ASSETS[tries[i]];
    }
    return null;
  }

  var React = window.React;
  var ReactDOM = window.ReactDOM;
  var h = React.createElement;

  /* ── Telling the workspace what happened ───────────────────────────────
   *
   * The pane around this document needs to know whether the app came up, so it
   * can show the product or a readable failure rather than a white rectangle
   * either way. postMessage because this document is in an opaque origin and
   * has nothing else it is allowed to touch. */
  function report(state, detail) {
    try {
      parent.postMessage({ source: 'quickstark-preview', state: state, detail: detail || null }, '*');
    } catch (ignored) {}
  }

  /* ── The router's state ────────────────────────────────────────────────
   *
   * One store, read by the navigation shims through useSyncExternalStore. It
   * lives outside React because next/navigation's hooks are callable from
   * anywhere in the tree and there is no provider in a generated project to
   * hang a context off. */
  var listeners = [];
  var current = { pathname: ENTRY, search: '', params: {} };

  function snapshot() { return current; }

  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      var at = listeners.indexOf(fn);
      if (at >= 0) listeners.splice(at, 1);
    };
  }

  function navigate(href) {
    if (typeof href !== 'string' || href.length === 0) return;
    /* An address that leaves the project is not ours to route. Opening it in
       the pane would replace the app with somebody else's site inside a
       sandbox that cannot show it properly. */
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && href.indexOf('/') !== 0) {
      try { window.open(href, '_blank', 'noopener'); } catch (ignored) {}
      return;
    }
    var hash = href.indexOf('#');
    if (hash === 0) return;
    var clean = hash > 0 ? href.slice(0, hash) : href;
    var query = '';
    var mark = clean.indexOf('?');
    if (mark >= 0) { query = clean.slice(mark + 1); clean = clean.slice(0, mark); }
    if (clean.charAt(0) !== '/') clean = '/' + clean;
    current = { pathname: clean, search: query, params: current.params };
    for (var i = 0; i < listeners.length; i += 1) listeners[i]();
    report('navigate', clean);
  }

  window.__qsNavigate = navigate;

  /* A plain <a href="/somewhere">, which is not next/link and so never reached
     navigate(): in this document it resolved against the WORKSPACE's address
     and loaded QuickStark's own home page inside the pane. Internal links are
     routed here instead; anything leaving the project is left alone. */
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var node = event.target;
    while (node && node.nodeName !== 'A') node = node.parentNode;
    if (!node || node.target === '_blank' || node.hasAttribute('download')) return;
    var href = node.getAttribute('href');
    if (!href || href.charAt(0) !== '/' || href.charAt(1) === '/') return;
    event.preventDefault();
    navigate(href);
  });

  /* What the pane is offered. A dynamic segment is given something concrete to
     stand in for it, because /products/[slug] is not an address a browser can
     open and the point is to SEE the screen. */
  function routePatterns() {
    var out = [];
    for (var i = 0; i < ROUTES.length; i += 1) {
      var route = ROUTES[i];
      var segments = route.segments || [];
      var path = '';
      for (var j = 0; j < segments.length; j += 1) {
        var segment = segments[j];
        var value = segment.kind === 'static'
          ? segment.value
          : String(segment.param || 'item').replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'item';
        path += '/' + value;
      }
      out.push({ pattern: route.pattern, href: path || '/' });
    }
    return out;
  }

  /* And a way in, so the pane's control can move this document.
   *
   * Accepted only from the parent frame and only in our own shape. This
   * document is sandboxed into an opaque origin precisely because it runs code
   * a prompt produced, and a listener that took navigation from anywhere would
   * be a way for that code to drive the pane around it. */
  window.addEventListener('message', function (event) {
    if (event.source !== parent) return;
    var data = event.data;
    if (!data || data.source !== 'quickstark-workspace') return;
    if (typeof data.editMode === 'boolean') { touchLayout = data.touch === true; setEditing(data.editMode); return; }
    if (data.editText === true) { startTyping(selected); return; }
    if (data.stopTyping === true) { stopTyping(true); return; }
    if (data.deselect === true) { clearPicks(); selected = null; lastRect = ''; place(selectBox, null); placeLabel(null); return; }
    if (data.selectParent === true) { selectParentOf(); return; }
    if (data.preview && typeof data.preview.src === 'string') { previewChange(data.preview); return; }
    if (typeof data.navigate !== 'string') return;
    navigate(data.navigate);
  });

${EDIT_MODE}

  /* ── Module resolution ─────────────────────────────────────────────────
   *
   * The project's own files, addressed the way its source addresses them:
   * '@/components/Nav' as scaffold.ts writes it, './Card' beside a file, and
   * the extensionless imports TypeScript allows. */
  var EXTENSIONS = ['', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'];

  function joinPath(base, relative) {
    var parts = base.split('/');
    parts.pop();
    var pieces = relative.split('/');
    for (var i = 0; i < pieces.length; i += 1) {
      var piece = pieces[i];
      if (piece === '' || piece === '.') continue;
      if (piece === '..') { parts.pop(); continue; }
      parts.push(piece);
    }
    return parts.join('/');
  }

  function resolve(specifier, from) {
    var base = null;
    if (specifier.indexOf('@/') === 0) base = specifier.slice(2);
    else if (specifier.charAt(0) === '.') base = joinPath(from, specifier);
    else if (specifier.charAt(0) === '/') base = specifier.slice(1);
    else return null;

    for (var i = 0; i < EXTENSIONS.length; i += 1) {
      if (Object.prototype.hasOwnProperty.call(FILES, base + EXTENSIONS[i])) return base + EXTENSIONS[i];
    }
    for (var j = 0; j < EXTENSIONS.length; j += 1) {
      var indexed = base + '/index' + EXTENSIONS[j];
      if (Object.prototype.hasOwnProperty.call(FILES, indexed)) return indexed;
    }
    return null;
  }

  /* ── Compiling ─────────────────────────────────────────────────────────
   *
   * Babel standalone, with the TypeScript and React presets and the CommonJS
   * transform, so the project's ES modules become something requireable. The
   * automatic JSX runtime is used because that is what a Next.js project is
   * written against; react/jsx-runtime is supplied below. */
  var compiled = {};

  /* window.location.href = "/dashboard" — how a generated login page sends
     somebody on after signing in. In this document that loads the
     workspace's own site into the pane, so it is routed like a link. Only
     assignments and assign()/replace() calls are rewritten; reading
     location.href is left exactly as written. */
  function rewriteNavigation(source) {
    return String(source)
      .replace(/(?:window\\.)?location\\.href\\s*=(?!=)\\s*([^;\\n]+)/g, 'window.__qsNavigate($1)')
      .replace(/(?:window\\.)?location\\.(?:assign|replace)\\(/g, 'window.__qsNavigate(');
  }

  /* ── Where each element was written ────────────────────────────────────
   *
   * Every HTML element the project renders carries data-qs-src="file:line:col"
   * — line from 1, column from 0 — so a click in edit mode knows exactly what
   * it is pointing at. Components are left alone: the attribute would arrive
   * as a prop they ignore. Only here, in the preview; the published site is
   * built from the files and never sees it. See lib/builder/visual-edit.ts. */
  function tagWithSource(path) {
    return function (api) {
      var t = api.types;
      return {
        visitor: {
          JSXOpeningElement: function (p) {
            var node = p.node;
            var name = node.name;
            if (!name || name.type !== 'JSXIdentifier' || !/^[a-z]/.test(name.name) || !node.loc) return;
            for (var i = 0; i < node.attributes.length; i += 1) {
              var attribute = node.attributes[i];
              if (attribute.type === 'JSXAttribute' && attribute.name && attribute.name.name === 'data-qs-src') return;
            }
            node.attributes.push(t.jsxAttribute(
              t.jsxIdentifier('data-qs-src'),
              t.stringLiteral((ORIGIN[path] || path) + ':' + node.loc.start.line + ':' + node.loc.start.column)
            ));
          }
        }
      };
    };
  }

  function compile(path) {
    if (Object.prototype.hasOwnProperty.call(compiled, path)) return compiled[path];
    var source = FILES[path];
    if (path.slice(-5) !== '.json') source = rewriteNavigation(source);
    /* Vite's import.meta.env, which the CommonJS output below cannot carry:
       the same values a module reads as process.env. */
    if (path.slice(-5) !== '.json' && source.indexOf('import.meta') >= 0) {
      source = source.split('import.meta.env').join('process.env').split('import.meta').join('({ env: process.env, url: location.href })');
    }
    if (path.slice(-5) === '.json') {
      compiled[path] = 'module.exports = ' + source + ';';
      return compiled[path];
    }
    var out = window.Babel.transform(source, {
      filename: path,
      presets: [
        ['react', { runtime: 'automatic' }],
        ['typescript', { isTSX: /\\.tsx$/.test(path), allExtensions: true }]
      ],
      plugins: [tagWithSource(path), 'transform-modules-commonjs'],
      sourceMaps: false
    }).code;
    compiled[path] = out;
    return out;
  }

  var modules = {};
  var loading = {};

  function requireModule(path) {
    if (Object.prototype.hasOwnProperty.call(modules, path)) return modules[path].exports;
    /* A cycle returns the half-built exports rather than recursing forever,
       which is what CommonJS does and what the code was written expecting. */
    if (loading[path]) return loading[path].exports;

    var module = { exports: {} };
    loading[path] = module;
    try {
      var code = compile(path);
      var fn = new Function('require', 'module', 'exports', '__qsPath', 'process', code);
      fn(function (specifier) { return requireFrom(specifier, path); }, module, module.exports, path, PROCESS);
    } finally {
      delete loading[path];
    }
    modules[path] = module;
    return module.exports;
  }

  function requireFrom(specifier, from) {
    var external = externals(specifier);
    if (external) return external;
    /* import logo from './logo.png' - the stored picture's address. */
    var pictured = assetModule(specifier, from);
    if (pictured) return { __esModule: true, default: pictured };
    var path = resolve(specifier, from);
    if (path) return requireModule(path);
    /* A package this preview has no shim for. An empty module rather than a
       thrown error: one unknown icon set must not take down the whole app,
       and a component that renders nothing is a smaller lie than a blank
       pane with a stack trace in it. */
    missing[specifier] = true;
    return emptyModule(specifier);
  }

  var missing = {};

  function assetModule(specifier, from) {
    var base = null;
    if (specifier.indexOf('@/') === 0) base = specifier.slice(2);
    else if (specifier.charAt(0) === '.') base = joinPath(ORIGIN[from] || from, specifier);
    else if (specifier.charAt(0) === '/') base = specifier.slice(1);
    if (!base) return null;
    if (Object.prototype.hasOwnProperty.call(ASSETS, base)) return ASSETS[base];
    if (Object.prototype.hasOwnProperty.call(ASSETS, 'src/' + base)) return ASSETS['src/' + base];
    return assetUrl(base);
  }

  function emptyModule(name) {
    var blank = function () { return null; };
    return new Proxy(
      { __esModule: true, default: blank },
      {
        get: function (target, key) {
          if (key in target) return target[key];
          if (typeof key !== 'string') return undefined;
          return blank;
        }
      }
    );
  }

  /* ── The packages a generated project imports ──────────────────────────
   *
   * Shims, not implementations. Each one is here because scaffold.ts tells the
   * model to use it, and each does the least that makes the page look and
   * behave like itself. */

  function jsxFactory(type, config, maybeKey) {
    var props = Object.assign({}, config);
    if (maybeKey !== undefined) props.key = maybeKey;
    if (typeof type === 'string') {
      var keys = ['src', 'href', 'poster'];
      for (var k = 0; k < keys.length; k += 1) {
        var stored = assetUrl(props[keys[k]]);
        if (stored) props[keys[k]] = stored;
      }
    }
    return React.createElement(type, props);
  }

  var Link = React.forwardRef(function (props, ref) {
    var rest = Object.assign({}, props);
    var href = rest.href;
    delete rest.prefetch;
    delete rest.replace;
    delete rest.scroll;
    delete rest.shallow;
    delete rest.locale;
    if (href && typeof href === 'object') href = href.pathname || '/';
    rest.href = href;
    rest.ref = ref;
    rest.onClick = function (event) {
      if (props.onClick) props.onClick(event);
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
      if (rest.target === '_blank') return;
      event.preventDefault();
      navigate(href);
    };
    return React.createElement('a', rest);
  });

  var Image = React.forwardRef(function (props, ref) {
    var rest = Object.assign({}, props);
    var fill = rest.fill;
    delete rest.fill;
    delete rest.priority;
    delete rest.quality;
    delete rest.placeholder;
    delete rest.blurDataURL;
    delete rest.loader;
    delete rest.unoptimized;
    delete rest.sizes;
    if (fill) {
      rest.style = Object.assign(
        { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' },
        rest.style || {}
      );
      delete rest.width;
      delete rest.height;
    }
    if (typeof rest.src === 'object' && rest.src) rest.src = rest.src.src || '';
    rest.ref = ref;
    return React.createElement('img', rest);
  });

  function useRouterShim() {
    return {
      push: navigate,
      replace: navigate,
      prefetch: function () {},
      back: function () {},
      forward: function () {},
      refresh: function () {}
    };
  }

  function usePathname() {
    return React.useSyncExternalStore(subscribe, function () { return snapshot().pathname; }, function () { return ENTRY; });
  }

  function useSearchParams() {
    var search = React.useSyncExternalStore(subscribe, function () { return snapshot().search; }, function () { return ''; });
    return new URLSearchParams(search);
  }

  function useParams() {
    return React.useSyncExternalStore(subscribe, function () { return snapshot().params; }, function () { return {}; });
  }

  /* next/font. The real thing returns a class name that applies a font the
     build downloaded; there is no build here, so it returns the shape the
     layout destructures and lets the document's own font stack stand. */
  function fontLoader() {
    return function () {
      return { className: 'qs-font', variable: '--qs-font', style: { fontFamily: 'inherit' } };
    };
  }

  /* lucide-react. Every icon in it is the same shape — an svg of stroked
     paths — so when the vanilla package is on the page its data is used, and
     when it is not, a neutral glyph keeps the layout honest rather than
     leaving a hole where an icon was. */
  function iconFor(name) {
    var component = function (props) {
      var rest = Object.assign({}, props);
      var size = rest.size || 24;
      delete rest.size;
      delete rest.absoluteStrokeWidth;
      var attrs = Object.assign(
        {
          xmlns: 'http://www.w3.org/2000/svg',
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: rest.strokeWidth || 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round'
        },
        rest
      );
      var data = window.lucide && window.lucide.icons ? window.lucide.icons[name] : null;
      var children = [];
      if (data && Array.isArray(data)) {
        for (var i = 0; i < data.length; i += 1) {
          var node = data[i];
          if (!Array.isArray(node)) continue;
          children.push(React.createElement(node[0], Object.assign({ key: i }, node[1])));
        }
      }
      if (children.length === 0) {
        children.push(React.createElement('circle', { key: 'a', cx: 12, cy: 12, r: 9 }));
      }
      return React.createElement('svg', attrs, children);
    };
    component.displayName = name;
    return component;
  }

  var iconCache = {};
  var lucideShim = new Proxy(
    { __esModule: true },
    {
      get: function (target, key) {
        if (key === '__esModule') return true;
        if (typeof key !== 'string') return undefined;
        if (key === 'default') return undefined;
        if (!iconCache[key]) iconCache[key] = iconFor(key);
        return iconCache[key];
      }
    }
  );

  /* framer-motion. The animation is dropped and the element is kept: a page
     whose hero is a motion.div must still have its hero. */
  var MOTION_PROPS = [
    'initial', 'animate', 'exit', 'transition', 'variants', 'whileHover', 'whileTap',
    'whileInView', 'whileFocus', 'whileDrag', 'viewport', 'layout', 'layoutId',
    'drag', 'dragConstraints', 'onAnimationStart', 'onAnimationComplete', 'custom'
  ];

  function motionComponent(tag) {
    return React.forwardRef(function (props, ref) {
      var rest = Object.assign({}, props);
      for (var i = 0; i < MOTION_PROPS.length; i += 1) delete rest[MOTION_PROPS[i]];
      rest.ref = ref;
      return React.createElement(tag, rest);
    });
  }

  var motionCache = {};
  var motion = new Proxy(function () {}, {
    get: function (target, key) {
      if (typeof key !== 'string') return undefined;
      if (!motionCache[key]) motionCache[key] = motionComponent(key);
      return motionCache[key];
    },
    apply: function (target, self, args) { return motionComponent(args[0]); }
  });

  /* @supabase/supabase-js. A generated app reads from it in an effect; with no
     project provisioned there is nothing to read, so every query resolves
     empty. That is the truthful answer — the tables are not there yet — and it
     lets the page render its empty state instead of throwing. */
  /* The real client, when the host gave this project's database to the
     preview (see the preview route). Signing in, signing up and every query
     then work exactly as on the published site, against the same database.
     Two things a sandboxed preview cannot have are supplied: storage — the
     session is kept in memory, so it lasts until the preview is reloaded —
     and the cross-tab lock, which an opaque origin is refused. */
  function liveSupabase() {
    var lib = window.supabase;
    if (!lib || typeof lib.createClient !== 'function') return null;
    if (!LIVE_DB) return null;
    /* Seeded from the workspace tab, which keeps the session across reloads
       of this frame — see auth-seed.ts — and told of every change to it. */
    var memory = {};
    var seed = window.__qsAuthSeed;
    if (seed && typeof seed === 'object') {
      for (var seeded in seed) {
        if (Object.prototype.hasOwnProperty.call(seed, seeded) && typeof seed[seeded] === 'string') memory[seeded] = seed[seeded];
      }
    }
    var storage = {
      getItem: function (key) { return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null; },
      setItem: function (key, value) { memory[key] = String(value); report('auth-storage', { key: key, value: String(value) }); },
      removeItem: function (key) { delete memory[key]; report('auth-storage', { key: key, value: null }); }
    };
    function lock(name, timeout, fn) { return fn(); }
    return function createClient(url, key, options) {
      var opts = Object.assign({}, options || {});
      opts.auth = Object.assign(
        { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
        opts.auth || {},
        { storage: storage, lock: lock }
      );
      return lib.createClient(url, key, opts);
    };
  }

  function supabaseStub() {
    var result = Promise.resolve({ data: [], error: null, count: 0 });
    var chain = new Proxy(function () { return chain; }, {
      get: function (target, key) {
        if (key === 'then') return result.then.bind(result);
        if (key === 'catch') return result.catch.bind(result);
        if (key === 'finally') return result.finally.bind(result);
        return function () { return chain; };
      },
      apply: function () { return chain; }
    });
    return {
      from: function () { return chain; },
      rpc: function () { return chain; },
      channel: function () { return { on: function () { return this; }, subscribe: function () { return this; } }; },
      removeChannel: function () {},
      storage: { from: function () { return chain; } },
      auth: {
        getUser: function () { return Promise.resolve({ data: { user: null }, error: null }); },
        getSession: function () { return Promise.resolve({ data: { session: null }, error: null }); },
        onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
        /* These say where sign-in DOES work, not only that it does not work
           here.
         *
           The preview has to stub auth: it compiles a project in an
           opaque-origin sandbox with no cookies and no session, so there is
           nothing for a real one to attach to. That part is right and stays.
         *
           What was wrong is that the sentence arrives in the form's error slot,
           in red, indistinguishable from a real failure — and the author of the
           app is the person reading it. "Sign-in is not available in preview"
           reads as "your sign-in is broken", and it was read that way, by
           somebody who had just been debugging a genuine auth failure on their
           deployed site. A limitation that looks like a defect costs more than
           the limitation does. */
        signInWithPassword: function () { return Promise.resolve({ data: { user: null }, error: { message: 'This is a preview, so there is no session to sign into. Sign-in works on the deployed site.' } }); },
        signUp: function () { return Promise.resolve({ data: { user: null }, error: { message: 'This is a preview, so no account is created. Sign-up works on the deployed site.' } }); },
        signOut: function () { return Promise.resolve({ error: null }); }
      }
    };
  }

  function classNames() {
    var out = [];
    for (var i = 0; i < arguments.length; i += 1) {
      var value = arguments[i];
      if (!value) continue;
      if (typeof value === 'string' || typeof value === 'number') { out.push(String(value)); continue; }
      if (Array.isArray(value)) { out.push(classNames.apply(null, value)); continue; }
      if (typeof value === 'object') {
        for (var key in value) if (value[key]) out.push(key);
      }
    }
    return out.filter(Boolean).join(' ');
  }

  function externals(specifier) {
    switch (specifier) {
      case 'react':
        return React;
      case 'react-dom':
      case 'react-dom/client':
        return ReactDOM;
      case 'react/jsx-runtime':
      case 'react/jsx-dev-runtime':
        return { __esModule: true, jsx: jsxFactory, jsxs: jsxFactory, jsxDEV: jsxFactory, Fragment: React.Fragment };
      case 'next/link':
        return { __esModule: true, default: Link };
      case 'next/image':
        return { __esModule: true, default: Image };
      case 'next/navigation':
        return {
          __esModule: true,
          useRouter: useRouterShim,
          usePathname: usePathname,
          useSearchParams: useSearchParams,
          useParams: useParams,
          redirect: function (to) { navigate(to); },
          notFound: function () { throw new Error('NEXT_NOT_FOUND'); }
        };
      case 'next/head':
        return { __esModule: true, default: function () { return null; } };
      case 'next/script':
        return { __esModule: true, default: function () { return null; } };
      case 'next/dynamic':
        return {
          __esModule: true,
          default: function (loader) {
            return function (props) {
              var state = React.useState(null);
              React.useEffect(function () {
                var live = true;
                Promise.resolve()
                  .then(loader)
                  .then(function (mod) { if (live) state[1](function () { return (mod && mod.default) || mod; }); })
                  .catch(function () {});
                return function () { live = false; };
              }, []);
              return state[0] ? React.createElement(state[0], props) : null;
            };
          }
        };
      case 'react-router-dom':
      case 'react-router':
        return routerShim();
      case 'lucide-react':
        return lucideShim;
      case 'framer-motion':
      case 'motion/react':
        return {
          __esModule: true,
          motion: motion,
          AnimatePresence: function (props) { return props.children || null; },
          useScroll: function () { return { scrollY: { get: function () { return 0; }, on: function () { return function () {}; } }, scrollYProgress: { get: function () { return 0; }, on: function () { return function () {}; } } }; },
          useTransform: function () { return { get: function () { return 0; }, on: function () { return function () {}; } }; },
          useInView: function () { return true; },
          useAnimation: function () { return { start: function () { return Promise.resolve(); }, stop: function () {} }; },
          useMotionValue: function (initial) { return { get: function () { return initial; }, set: function () {}, on: function () { return function () {}; } }; }
        };
      case '@supabase/supabase-js':
        return { __esModule: true, createClient: liveSupabase() || supabaseStub };
      case 'clsx':
      case 'classnames':
        return { __esModule: true, default: classNames, clsx: classNames };
      case 'tailwind-merge':
        return { __esModule: true, twMerge: classNames, twJoin: classNames };
      case 'class-variance-authority':
        return { __esModule: true, cva: function (base) { return function () { return base || ''; }; }, cx: classNames };
      default:
        break;
    }

    if (specifier.indexOf('next/font') === 0) {
      return new Proxy({ __esModule: true }, { get: function () { return fontLoader()(); } });
    }
    if (specifier.indexOf('next/') === 0) return emptyModule(specifier);
    return null;
  }

  /* ── Rendering a route ─────────────────────────────────────────────────
   *
   * A page and its layouts are ordinary components in a generated project,
   * with one exception that matters: they are often \`async\`, because that is
   * how a server component reads data. React cannot render a promise, so one
   * is resolved here before it is handed over. That covers the shape
   * scaffold.ts actually produces — an async page at the top of the tree —
   * and an async component nested deeper is reported rather than guessed at.
   */
  function componentOf(path) {
    var exported = requireModule(path);
    var value = exported && (exported.default || exported['default']);
    if (typeof value !== 'function') {
      throw new Error(path + ' has no default export to render. A page or layout must export its component as the default.');
    }
    return value;
  }

  /* 'ready' means a screen has actually drawn, not that drawing has begun.
     createRoot().render() returns before anything renders, so reporting from
     there told the workspace a version was good before its first screen had
     had the chance to fail - and the workspace, which keeps the previous
     version until the next one is ready, swapped in a broken one. */
  var readySent = false;
  function screenDrawn() {
    if (readySent) return;
    readySent = true;
    report('ready', { routes: routePatterns(), tokens: designTokens() });
  }

  function Resolved(props) {
    var state = React.useState({ node: null, pending: true, error: null });
    var set = state[1];
    var key = props.routeKey;

    /* After the commit, so a child that threw has already been caught by the
       Boundary and this never runs for it. */
    React.useEffect(function () {
      if (!state[0].pending && !state[0].error) screenDrawn();
    }, [state[0]]);

    React.useEffect(function () {
      var live = true;
      set({ node: null, pending: true, error: null });
      try {
        var produced = props.render();
        Promise.resolve(produced).then(
          function (node) { if (live) set({ node: node, pending: false, error: null }); },
          function (error) { if (live) set({ node: null, pending: false, error: error }); }
        );
      } catch (error) {
        set({ node: null, pending: false, error: error });
      }
      return function () { live = false; };
    }, [key]);

    if (state[0].error) throw state[0].error;
    if (state[0].pending) return null;
    return state[0].node;
  }

  var Boundary = (function () {
    function Boundary(props) {
      React.Component.call(this, props);
      this.state = { error: null };
    }
    Boundary.prototype = Object.create(React.Component.prototype);
    Boundary.prototype.constructor = Boundary;
    Boundary.getDerivedStateFromError = function (error) { return { error: error }; };
    Boundary.prototype.componentDidCatch = function (error) {
      report('error', String((error && error.message) || error));
    };
    Boundary.prototype.componentDidUpdate = function (previous) {
      if (previous.routeKey !== this.props.routeKey && this.state.error) this.setState({ error: null });
    };
    Boundary.prototype.render = function () {
      if (!this.state.error) return this.props.children;
      return h('div', { className: 'qs-failure' }, [
        h('p', { key: 'a', className: 'qs-failure-title' }, 'This screen could not be rendered'),
        h('p', { key: 'b', className: 'qs-failure-body' }, String((this.state.error && this.state.error.message) || this.state.error)),
        h('p', { key: 'c', className: 'qs-failure-hint' }, 'The rest of the project is unaffected — try another page from the menu above.')
      ]);
    };
    return Boundary;
  })();

  function App() {
    var pathname = usePathname();
    var match = null;
    for (var i = 0; i < ROUTES.length; i += 1) {
      var candidate = matchOne(ROUTES[i], pathname);
      if (candidate && (!match || candidate.score > match.score)) match = candidate;
    }

    React.useEffect(function () {
      current = { pathname: current.pathname, search: current.search, params: match ? match.params : {} };
    }, [pathname]);

    React.useEffect(function () {
      if (!match) screenDrawn();
    }, [match]);

    if (!match) {
      return h('div', { className: 'qs-failure' }, [
        h('p', { key: 'a', className: 'qs-failure-title' }, 'No page at ' + pathname),
        h('p', { key: 'b', className: 'qs-failure-hint' }, 'This project does not have a page at that address.')
      ]);
    }

    var route = match.route;
    var params = match.params;

    return h(
      Boundary,
      { routeKey: route.file + ':' + pathname },
      h(Resolved, {
        routeKey: route.file + ':' + pathname,
        render: function () {
          return build(route.layouts.slice(), route.file, params, pathname);
        }
      })
    );
  }

  /* ── Calling a component, or letting React call it ─────────────────────
   *
   * The distinction this turns on is whether the component is \`async\`, and
   * getting it wrong fails in both directions.
   *
   * An ASYNC component cannot be handed to React as an element. React calls it,
   * is given a promise, and throws — "Objects are not valid as a React child
   * (found: [object Promise])" — which is what a customer saw instead of every
   * page that read its own route parameters, because \`export default async
   * function Page({ params })\` is exactly what scaffold.ts asks the model to
   * write for a dynamic route. So it is called here and awaited, and what React
   * receives is the tree it returned.
   *
   * A SYNC component must NOT be called that way. Calling a function component
   * directly runs its hooks against whatever fiber happens to be rendering,
   * so a "use client" page with useState would keep its state in the wrong
   * component and lose it on the next navigation. React owns those, as it
   * should — they are ordinary components and it renders them normally.
   */
  function isAsync(fn) {
    return Boolean(fn && fn.constructor && fn.constructor.name === 'AsyncFunction');
  }

  function invoke(Component, props) {
    if (isAsync(Component)) return Promise.resolve(Component(props));
    return React.createElement(Component, props);
  }

  /* Route parameters, in both shapes a generated project reads them.
   *
   * Next 15 made params a promise and scaffold.ts writes \`await params\`
   * accordingly. A model that has read more Next 14 than Next 15 writes
   * \`params.slug\`, and that is not worth failing a whole page over — so this
   * is a promise that also carries the values as properties, and both spellings
   * find what they are looking for. */
  function paramsFor(params) {
    var promise = Promise.resolve(params);
    for (var key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key)) {
        try { promise[key] = params[key]; } catch (ignored) {}
      }
    }
    return promise;
  }

  /* Layouts wrap the page from the outside in, each receiving the next as its
     children — which is what a layout is. Resolved one at a time so an async
     layout is awaited before the one inside it is called. */
  function build(layouts, pageFile, params, pathname) {
    var bound = paramsFor(params);
    var pageProps = { params: bound, searchParams: Promise.resolve({}) };

    function wrap(index, child) {
      if (index < 0) return child;
      var Layout = componentOf(layouts[index]);
      var produced = invoke(Layout, { children: child, params: bound });
      return Promise.resolve(produced).then(function (node) { return wrap(index - 1, node); });
    }

    return Promise.resolve(invoke(componentOf(pageFile), pageProps)).then(function (node) {
      return wrap(layouts.length - 1, node);
    });
  }

  function matchOne(route, pathname) {
    var parts = pathname.split('/').filter(Boolean);
    var params = {};
    var score = 0;
    var index = 0;

    for (var i = 0; i < route.segments.length; i += 1) {
      var segment = route.segments[i];
      if (segment.kind === 'static') {
        if (parts[index] !== segment.value) return null;
        score += 3;
        index += 1;
      } else if (segment.kind === 'dynamic') {
        if (index >= parts.length) return null;
        params[segment.param] = decodeURIComponent(parts[index]);
        score += 2;
        index += 1;
      } else {
        var rest = parts.slice(index);
        if (rest.length === 0 && !segment.optional) return null;
        params[segment.param] = rest;
        score += 1;
        index = parts.length;
      }
    }

    if (index !== parts.length) return null;
    return { route: route, params: params, score: score };
  }

  /* ── Start ─────────────────────────────────────────────────────────────
   *
   * The root layout renders <html> and <body>, which cannot be mounted inside
   * an existing document. React renders them as ordinary elements and the
   * browser ignores the nesting; what matters is that the layout's classes and
   * its nav and footer come through, so the app looks like itself. */
  function start() {
    var root = document.getElementById('qs-root');
    /* A single-page React app mounts itself: its entry calls createRoot on
       #root, as it does in the browser it was written for. */
    if (SPA_ENTRY) {
      try {
        if (!document.getElementById('root')) {
          var mount = document.createElement('div');
          mount.id = 'root';
          document.body.insertBefore(mount, root);
        }
        root.style.display = 'none';
        requireModule(SPA_ENTRY);
        report('ready', { routes: [], tokens: designTokens() });
      } catch (error) {
        report('error', String((error && error.message) || error));
        root.style.display = '';
        root.innerHTML = '';
        root.appendChild(failureNode(String((error && error.message) || error)));
      }
      return;
    }
    try {
      ReactDOM.createRoot(root).render(h(App, null));
      /* The routes travel out with the ready report, sent by screenDrawn()
         once the first screen has actually rendered.
       *
       * A project has screens a visitor cannot reach by clicking — an admin
       * area, an account page, a dynamic route — and the customer has to be
       * able to look at what was built for them. That used to be a bar of
       * chips ON the page, which is chrome over their own design and is gone.
       *
       * So the list goes to the pane instead, and the pane puts the control
       * in its own toolbar where it belongs: ours in our furniture, theirs
       * left alone. Patterns only — nothing about the files. */
    } catch (error) {
      report('error', String((error && error.message) || error));
      root.innerHTML = '';
      root.appendChild(failureNode(String((error && error.message) || error)));
    }
  }

  /* react-router, enough of it for the apps people actually write: routes
     declared as <Routes>/<Route> or as objects for RouterProvider, nested
     routes with <Outlet>, :params and *, Link and NavLink, Navigate and the
     hooks - all driven by the same address store the Next.js shims use. */
  var routerCache = null;
  function routerShim() {
    if (routerCache) return routerCache;
    var RouteContext = React.createContext({ params: {}, outlet: null });

    function segs(value) { return String(value || '').split('/').filter(Boolean); }
    function matchSegs(pattern, pathname, prefix) {
      var ps = segs(pattern);
      var xs = segs(pathname);
      var params = {};
      for (var i = 0; i < ps.length; i += 1) {
        var s = ps[i];
        if (s === '*') { params['*'] = xs.slice(i).join('/'); return params; }
        var optional = s.charAt(s.length - 1) === '?';
        if (optional) s = s.slice(0, -1);
        if (i >= xs.length) { if (optional) continue; return null; }
        if (s.charAt(0) === ':') { params[s.slice(1)] = decodeURIComponent(xs[i]); continue; }
        if (s.toLowerCase() !== xs[i].toLowerCase()) return null;
      }
      if (!prefix && xs.length > ps.length) return null;
      return params;
    }
    function joinRoute(base, path) {
      if (!path) return base;
      if (path.charAt(0) === '/') return path;
      var b = base.charAt(base.length - 1) === '/' ? base.slice(0, -1) : base;
      return b + '/' + path;
    }
    function fromChildren(children) {
      var out = [];
      React.Children.forEach(children, function (child) {
        if (!child || !child.props) return;
        if (child.type === React.Fragment) { out = out.concat(fromChildren(child.props.children)); return; }
        out.push({
          path: child.props.path,
          index: child.props.index,
          element: child.props.element !== undefined ? child.props.element : child.props.Component ? h(child.props.Component) : null,
          children: child.props.children ? fromChildren(child.props.children) : null
        });
      });
      return out;
    }
    function fromObjects(routes) {
      return (routes || []).map(function (route) {
        return {
          path: route.path,
          index: route.index,
          element: route.element !== undefined ? route.element : route.Component ? h(route.Component) : null,
          children: route.children ? fromObjects(route.children) : null
        };
      });
    }
    function matchAll(routes, pathname, base) {
      for (var i = 0; i < routes.length; i += 1) {
        var route = routes[i];
        var full = route.index ? base : joinRoute(base, route.path);
        if (route.children && route.children.length) {
          var at = matchSegs(full, pathname, true);
          if (at) {
            var below = matchAll(route.children, pathname, full);
            if (below) return [{ route: route, params: at }].concat(below);
            if (matchSegs(full, pathname, false)) return [{ route: route, params: at }];
          }
        } else {
          var exact = matchSegs(full, pathname, false);
          if (exact) return [{ route: route, params: exact }];
        }
      }
      return null;
    }
    function renderChain(chain, i, params) {
      if (!chain || i >= chain.length) return null;
      var outlet = renderChain(chain, i + 1, params);
      var element = chain[i].route.element;
      return h(RouteContext.Provider, { value: { params: params, outlet: outlet } }, element !== undefined && element !== null ? element : outlet);
    }
    function renderRoutes(routes, pathname) {
      var chain = matchAll(routes, pathname, '/');
      if (!chain) return null;
      var params = {};
      for (var i = 0; i < chain.length; i += 1) Object.assign(params, chain[i].params);
      return renderChain(chain, 0, params);
    }
    function useLocationShim() {
      var pathname = usePathname();
      var search = React.useSyncExternalStore(subscribe, function () { return snapshot().search; }, function () { return ''; });
      return { pathname: pathname, search: search ? '?' + search : '', hash: '', state: null, key: 'default' };
    }
    function target(to) { return typeof to === 'string' ? to : (to && to.pathname) || '/'; }
    var LinkShim = React.forwardRef(function (props, ref) {
      var to = target(props.to);
      var rest = Object.assign({}, props);
      ['to', 'replace', 'state', 'end', 'caseSensitive', 'reloadDocument', 'relative', 'preventScrollReset', 'viewTransition'].forEach(function (key) { delete rest[key]; });
      rest.ref = ref;
      rest.href = to;
      var onClick = props.onClick;
      rest.onClick = function (event) {
        if (onClick) onClick(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        navigate(to);
      };
      return h('a', rest);
    });
    function NavLinkShim(props) {
      var pathname = usePathname();
      var to = target(props.to);
      var active = props.end ? pathname === to : pathname === to || (to !== '/' && pathname.indexOf(to + '/') === 0);
      var state = { isActive: active, isPending: false, isTransitioning: false };
      return h(LinkShim, Object.assign({}, props, {
        className: typeof props.className === 'function' ? props.className(state) : props.className,
        style: typeof props.style === 'function' ? props.style(state) : props.style,
        children: typeof props.children === 'function' ? props.children(state) : props.children,
        'aria-current': active ? 'page' : undefined
      }));
    }
    function useNavigateShim() {
      return function (to) {
        if (typeof to === 'number') { try { history.go(to); } catch (ignored) {} return; }
        navigate(target(to));
      };
    }
    function Passthrough(props) { return props.children || null; }
    routerCache = {
      __esModule: true,
      BrowserRouter: Passthrough,
      HashRouter: Passthrough,
      MemoryRouter: Passthrough,
      Router: Passthrough,
      Routes: function (props) { return renderRoutes(fromChildren(props.children), usePathname()); },
      Route: function () { return null; },
      Outlet: function () { return React.useContext(RouteContext).outlet; },
      Link: LinkShim,
      NavLink: NavLinkShim,
      Navigate: function (props) {
        React.useEffect(function () { navigate(target(props.to)); }, [target(props.to)]);
        return null;
      },
      useNavigate: useNavigateShim,
      useParams: function () { return React.useContext(RouteContext).params; },
      useLocation: useLocationShim,
      useSearchParams: function () {
        var location = useLocationShim();
        var params = new URLSearchParams(location.search);
        return [params, function (next) {
          var value = typeof next === 'function' ? next(params) : next;
          var query = new URLSearchParams(value).toString();
          navigate(location.pathname + (query ? '?' + query : ''));
        }];
      },
      useMatch: function (pattern) { return matchSegs(target(pattern), usePathname(), false) ? { params: {} } : null; },
      createBrowserRouter: function (routes) { return { routes: routes }; },
      createHashRouter: function (routes) { return { routes: routes }; },
      createMemoryRouter: function (routes) { return { routes: routes }; },
      RouterProvider: function (props) { return renderRoutes(fromObjects(props.router && props.router.routes), usePathname()); },
      ScrollRestoration: function () { return null; }
    };
    return routerCache;
  }

  function failureNode(message) {
    var wrap = document.createElement('div');
    wrap.className = 'qs-failure';
    var title = document.createElement('p');
    title.className = 'qs-failure-title';
    title.textContent = 'This project could not be rendered in the preview';
    var body = document.createElement('p');
    body.className = 'qs-failure-body';
    body.textContent = message;
    wrap.appendChild(title);
    wrap.appendChild(body);
    return wrap;
  }

  window.addEventListener('error', function (event) {
    report('error', String((event && event.message) || 'render failed'));
  });

  start();
})();
`;
