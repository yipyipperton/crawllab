import fs from 'node:fs'
import path from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { minifyJs } from '../re/minify.js'
import { sleep } from '../util.js'
import {
  FLAKE_MODULUS,
  OVERLOAD_FAST_MS,
  OVERLOAD_LIMIT,
  OVERLOAD_SLOW_MS,
  RATE_MAX,
  RATE_WINDOW_MS,
  flakeDecision,
  slidingWindowAllow,
} from './policy.js'

export type FixtureStats = {
  privateHits: number
  requests: number
  flaky: {
    ok: number
    http500: number
    http429: number
    overloadFast: number
    overloadSlow: number
  }
  rateWindowMs: number
  rateMax: number
  flakeModulus: number
  overloadLimit: number
  overloadFastMs: number
  overloadSlowMs: number
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { font: 16px/1.45 ui-sans-serif, system-ui, sans-serif; margin: 32px; color: #1c2430; background: #f4f1ea; }
    code { font-family: ui-monospace, monospace; }
  </style>
</head>
<body>
${body}
</body>
</html>`
}

function emptyStats(): FixtureStats {
  return {
    privateHits: 0,
    requests: 0,
    flaky: { ok: 0, http500: 0, http429: 0, overloadFast: 0, overloadSlow: 0 },
    rateWindowMs: RATE_WINDOW_MS,
    rateMax: RATE_MAX,
    flakeModulus: FLAKE_MODULUS,
    overloadLimit: OVERLOAD_LIMIT,
    overloadFastMs: OVERLOAD_FAST_MS,
    overloadSlowMs: OVERLOAD_SLOW_MS,
  }
}

export async function createFixtureServer(port = 0, options?: { logger?: boolean }): Promise<{
  url: string
  stats: FixtureStats
  reset: () => void
  close: () => Promise<void>
  app: FastifyInstance
}> {
  const app = Fastify({ logger: options?.logger ?? false })
  const stats = emptyStats()
  let flakeSeq = 0
  let rateHits: number[] = []
  let inFlight = 0
  let generation = 0
  const gateSource = fs.readFileSync(path.resolve('fixtures/js/gate.source.js'), 'utf8')
  const gateMin = minifyJs(gateSource)

  app.addHook('onRequest', async (request, reply) => {
    stats.requests += 1
    reply.header('cache-control', 'no-store')
    reply.header('x-crawllab-fixture', '1')
    void request
  })

  const reset = () => {
    const next = emptyStats()
    stats.privateHits = next.privateHits
    stats.requests = 0
    stats.flaky.ok = 0
    stats.flaky.http500 = 0
    stats.flaky.http429 = 0
    stats.flaky.overloadFast = 0
    stats.flaky.overloadSlow = 0
    flakeSeq = 0
    rateHits = []
    inFlight = 0
    generation += 1
  }

  app.get('/health', async () => ({ ok: true, service: 'crawllab-fixtures' }))
  app.get('/robots.txt', async (_, reply) => {
    reply.type('text/plain')
    return [
      '# CrawlLab fixture policy. The engine must honor this file.',
      'User-agent: *',
      'Disallow: /private',
      'Allow: /',
      '',
      'User-agent: CrawlLabBot',
      'Disallow: /private',
      'Allow: /',
      '',
    ].join('\n')
  })

  app.get('/api/fixture-stats', async () => stats)
  app.post('/api/fixture-stats/reset', async () => {
    reset()
    return stats
  })

  app.get('/api/ping', async () => ({ ok: true, t: Date.now() }))
  app.get('/api/catalog', async () => ({
    source: 'documented-json',
    items: ['Copper kettle', 'Field notebook', 'Brass compass'],
  }))

  app.get('/api/echo-headers', async (request) => {
    const allow = [
      'user-agent',
      'accept',
      'accept-language',
      'accept-encoding',
      'sec-ch-ua',
      'sec-ch-ua-mobile',
      'sec-ch-ua-platform',
      'sec-fetch-site',
      'sec-fetch-mode',
      'sec-fetch-dest',
      'upgrade-insecure-requests',
    ]
    const headers: Record<string, string> = {}
    for (const key of allow) {
      const value = request.headers[key]
      if (typeof value === 'string') headers[key] = value
    }
    return { headers }
  })

  app.get('/api/flaky', async (request, reply) => {
    const query = request.query as { mode?: string; delay?: string }
    const mode = query.mode ?? 'flake'
    if (mode === 'flake') {
      flakeSeq += 1
      const seq = flakeSeq
      await sleep(40)
      if (flakeDecision(seq) === 'fail') {
        stats.flaky.http500 += 1
        return reply.code(500).send({ error: 'injected_failure', seq })
      }
      stats.flaky.ok += 1
      return { token: `ok-${seq}`, seq }
    }
    if (mode === 'ratelimit') {
      const decision = slidingWindowAllow(rateHits, Date.now())
      rateHits = decision.next
      if (!decision.allow) {
        stats.flaky.http429 += 1
        reply.header('retry-after', '3')
        return reply.code(429).send({ error: 'rate_limited', windowMs: RATE_WINDOW_MS, max: RATE_MAX })
      }
      stats.flaky.ok += 1
      return { token: 'admitted', windowMs: RATE_WINDOW_MS, max: RATE_MAX }
    }
    if (mode === 'overload') {
      const gen = generation
      inFlight += 1
      const slow = inFlight > OVERLOAD_LIMIT
      try {
        if (slow) {
          stats.flaky.overloadSlow += 1
          await sleep(OVERLOAD_SLOW_MS)
          return { token: 'slow', inFlight }
        }
        stats.flaky.overloadFast += 1
        await sleep(OVERLOAD_FAST_MS)
        return { token: 'fast', inFlight }
      } finally {
        if (gen === generation) inFlight -= 1
      }
    }
    if (mode === 'slow') {
      const delay = Math.min(10_000, Math.max(0, Number(query.delay ?? 1200)))
      await sleep(delay)
      stats.flaky.ok += 1
      return { token: 'slow-ok', delay }
    }
    return reply.code(400).send({ error: 'unknown mode' })
  })

  app.get('/pages/static', async (_, reply) => {
    reply.type('text/html')
    return page(
      'Static catalog',
      `<h1>Northwind field catalog</h1>
       <p>This list is in the first HTML payload.</p>
       <ul id="catalog"><li>Copper kettle</li><li>Field notebook</li><li>Brass compass</li></ul>`,
    )
  })

  app.get('/pages/async', async (_, reply) => {
    reply.type('text/html')
    return page(
      'Async catalog',
      `<div data-crawllab-render="deferred">
       <h1>Northwind field catalog</h1>
       <p id="pending">Rendering catalog from the client.</p>
       <div id="slot"></div>
       </div>
       <script>
         setTimeout(function () {
           var node = document.createElement('div');
           node.id = 'catalog';
           node.textContent = 'Copper kettle, Field notebook, Brass compass';
           document.getElementById('slot').appendChild(node);
           document.getElementById('pending').textContent = 'Catalog ready';
         }, 1200);
         setInterval(function () { fetch('/api/ping').catch(function () {}); }, 250);
       </script>`,
    )
  })

  app.get('/pages/missing', async (_, reply) => {
    reply.type('text/html')
    return page('Missing catalog', '<h1>Packing slip</h1><p>This page never renders a catalog.</p>')
  })

  app.get('/pages/slow', async (request, reply) => {
    const delay = Math.min(10_000, Math.max(0, Number((request.query as { delay?: string }).delay ?? 1200)))
    reply.type('text/html')
    return page(
      'Slow ready',
      `<h1>Delayed ready state</h1>
       <div id="slot"></div>
       <script>
         setTimeout(function () {
           var node = document.createElement('span');
           node.id = 'ready-label';
           node.textContent = 'ready';
           document.getElementById('slot').appendChild(node);
         }, ${delay});
       </script>`,
    )
  })

  app.get('/pages/flaky', async (request, reply) => {
    const query = request.query as { mode?: string }
    const mode = query.mode ?? 'flake'
    reply.type('text/html')
    return page(
      'Flaky upstream',
      `<h1>Upstream-backed catalog</h1>
       <div id="slot"></div>
       <div id="error"></div>
       <script>
         var mode = ${JSON.stringify(mode)};
         fetch('/api/flaky?mode=' + encodeURIComponent(mode)).then(function (response) {
           if (!response.ok) {
             var box = document.getElementById('error');
             box.dataset.state = 'error';
             box.textContent = 'HTTP ' + response.status;
             console.error('upstream HTTP ' + response.status);
             return;
           }
           return response.json().then(function (data) {
             var span = document.createElement('span');
             span.id = 'payload';
             span.dataset.ready = '1';
             span.textContent = data.token;
             document.getElementById('slot').appendChild(span);
           });
         }).catch(function (error) {
           var box = document.getElementById('error');
           box.dataset.state = 'error';
           box.textContent = 'network';
           console.error(String(error));
         });
       </script>`,
    )
  })

  app.get('/pages/redirect-chain', async (_, reply) => reply.redirect('/pages/redirect-mid'))
  app.get('/pages/redirect-mid', async (_, reply) => reply.redirect('/pages/unexpected-landing'))
  app.get('/pages/redirect-ok', async (_, reply) => reply.redirect('/pages/static'))
  app.get('/pages/unexpected-landing', async (_, reply) => {
    reply.type('text/html')
    return page('Unexpected landing', '<h1>You were redirected</h1><p id="landing">This is not the static catalog.</p>')
  })

  app.get('/pages/status/:code', async (request, reply) => {
    const allowed = new Set([401, 403, 404, 429, 500, 502, 503])
    const code = Number((request.params as { code: string }).code)
    if (!allowed.has(code)) return reply.code(400).send({ error: 'unsupported status' })
    if (code === 429) reply.header('retry-after', '2')
    reply.code(code).type('text/html')
    return page(`HTTP ${code}`, `<h1>HTTP ${code}</h1><p>Fixture status page.</p>`)
  })

  app.get('/pages/broken', async (_, reply) => {
    reply.type('text/html')
    return page(
      'Broken resources',
      `<h1 id="title">Resource page</h1>
       <img src="/assets/missing.png" alt="" />
       <script src="/assets/missing.js"></script>`,
    )
  })
  app.get('/assets/missing.png', async (_, reply) => reply.code(404).send('missing'))
  app.get('/assets/missing.js', async (_, reply) => reply.code(404).type('text/javascript').send('missing'))

  app.get('/pages/console-error', async (_, reply) => {
    reply.type('text/html')
    return page(
      'Console error',
      `<div id="app"></div>
       <script>
         try { window.renderPipeline(); }
         catch (error) {
           console.error('catalog widget failed: ' + error.message);
         }
       </script>`,
    )
  })

  app.get('/pages/fingerprint', async (_, reply) => {
    reply.type('text/html')
    return page(
      'Fingerprint lab',
      `<h1>Browser configuration lab</h1>
       <p>This page records signals. It does not block automation and it does not ask the browser to hide <code>navigator.webdriver</code>.</p>
       <table id="signal-table">
         <thead><tr><th>Signal</th><th>How it is read</th><th>What it is for</th><th>Value</th></tr></thead>
         <tbody id="signal-body"></tbody>
       </table>
       <pre id="fp-json">{}</pre>
       <script>
         var rows = [
           ['userAgent', 'navigator.userAgent', 'Identifies the advertised browser. A custom config can change it without changing webdriver.'],
           ['webdriver', 'navigator.webdriver', 'Automation-controlled flag. Stock Playwright leaves this true. This lab does not delete it.'],
           ['language', 'navigator.language', 'Locale from the browser context.'],
           ['languages', 'navigator.languages', 'Full locale list. Often follows the context locale.'],
           ['platform', 'navigator.platform', 'Host platform string exposed to script.'],
           ['vendor', 'navigator.vendor', 'Browser vendor string.'],
           ['hardwareConcurrency', 'navigator.hardwareConcurrency', 'Logical CPU count reported to script.'],
           ['pluginsLength', 'navigator.plugins.length', 'Plugin list length. Headless Chromium often reports 0.'],
           ['viewport', 'window.innerWidth/innerHeight', 'Layout viewport from the context.'],
           ['screen', 'screen.width/height', 'Screen metrics. Headless values follow the viewport and display.'],
           ['timezone', 'Intl.DateTimeFormat().resolvedOptions().timeZone', 'Context timezone.'],
           ['chromeObject', 'typeof window.chrome', 'Presence of the chrome object. Not a reliable bot test by itself.'],
           ['webgl', 'WEBGL_debug_renderer_info', 'GPU strings available to script. Useful as a config difference, not as an access control.']
         ];
         function glInfo() {
           try {
             var canvas = document.createElement('canvas');
             var gl = canvas.getContext('webgl');
             if (!gl) return 'none';
             var dbg = gl.getExtension('WEBGL_debug_renderer_info');
             if (!dbg) return String(gl.getParameter(gl.VENDOR));
             return String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) + ' / ' + String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
           } catch (error) { return 'error'; }
         }
         var signals = {
           userAgent: navigator.userAgent,
           webdriver: navigator.webdriver,
           language: navigator.language,
           languages: Array.from(navigator.languages || []),
           platform: navigator.platform,
           vendor: navigator.vendor,
           hardwareConcurrency: navigator.hardwareConcurrency,
           pluginsLength: navigator.plugins ? navigator.plugins.length : null,
           viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
           screen: { width: screen.width, height: screen.height, colorDepth: screen.colorDepth },
           timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
           chromeObject: typeof window.chrome !== 'undefined',
           webgl: glInfo(),
           headlessTokenInUa: /HeadlessChrome/i.test(navigator.userAgent)
         };
         var body = document.getElementById('signal-body');
         rows.forEach(function (row) {
           var tr = document.createElement('tr');
           row.forEach(function (cell) {
             var td = document.createElement('td');
             td.textContent = cell;
             tr.appendChild(td);
           });
           var value = document.createElement('td');
           value.textContent = JSON.stringify(signals[row[0]]);
           tr.appendChild(value);
           body.appendChild(tr);
         });
         function publish() {
           var node = document.getElementById('fp-json');
           node.textContent = JSON.stringify(signals);
           node.setAttribute('data-ready', '1');
         }
         fetch('/api/echo-headers').then(function (response) { return response.json(); }).then(function (data) {
           signals.requestHeaders = data.headers || {};
           publish();
         }).catch(function () { publish(); });
       </script>`,
    )
  })

  app.get('/pages/gate', async (_, reply) => {
    reply.type('text/html')
    return page(
      'Gate fixture',
      `<h1>Lab gate</h1>
       <p>The minified script chooses teaser, partial, or full. The full branch is documented in the research report. This page does not hide automation signals.</p>
       <pre id="gate-result">pending</pre>
       <script src="/js/gate.min.js"></script>`,
    )
  })
  app.get('/js/gate.min.js', async (_, reply) => {
    reply.type('text/javascript')
    return gateMin
  })

  app.get('/private/secret', async (_, reply) => {
    stats.privateHits += 1
    reply.type('text/html')
    return page(
      'Private',
      '<h1>Disallowed path</h1><p>The server returns this if asked. CrawlLab must refuse it because robots.txt disallows /private.</p>',
    )
  })

  await app.listen({ port, host: '127.0.0.1' })
  const address = app.server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  return {
    url: `http://127.0.0.1:${actualPort}`,
    stats,
    reset,
    close: () => app.close(),
    app,
  }
}
