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

export const PREVIEW_RUNTIME = `
(function () {
  'use strict';

  var FILES = window.__QS_FILES || {};
  var ROUTES = window.__QS_ROUTES || [];
  var ENTRY = window.__QS_ENTRY || '/';

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
  var PROCESS = { env: window.__QS_ENV || {} };

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
    if (typeof data.navigate !== 'string') return;
    navigate(data.navigate);
  });

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

  function compile(path) {
    if (Object.prototype.hasOwnProperty.call(compiled, path)) return compiled[path];
    var source = FILES[path];
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
      plugins: ['transform-modules-commonjs'],
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
        signInWithPassword: function () { return Promise.resolve({ data: { user: null }, error: { message: 'Sign-in is not available in preview.' } }); },
        signUp: function () { return Promise.resolve({ data: { user: null }, error: { message: 'Sign-up is not available in preview.' } }); },
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
        return { __esModule: true, createClient: supabaseStub };
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

  function Resolved(props) {
    var state = React.useState({ node: null, pending: true, error: null });
    var set = state[1];
    var key = props.routeKey;

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
    try {
      ReactDOM.createRoot(root).render(h(App, null));
      /* The routes travel out with the boot report.
       *
       * A project has screens a visitor cannot reach by clicking — an admin
       * area, an account page, a dynamic route — and the customer has to be
       * able to look at what was built for them. That used to be a bar of
       * chips ON the page, which is chrome over their own design and is gone.
       *
       * So the list goes to the pane instead, and the pane puts the control
       * in its own toolbar where it belongs: ours in our furniture, theirs
       * left alone. Patterns only — nothing about the files. */
      report('ready', { routes: routePatterns() });
    } catch (error) {
      report('error', String((error && error.message) || error));
      root.innerHTML = '';
      root.appendChild(failureNode(String((error && error.message) || error)));
    }
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
