// Reads the app's WebView through the DevTools protocol (debug builds only)
// and checks that the push flag matches the build: without Firebase the
// web code must not see BalasFCM, or it would call the crashing plugin.
const [, , port, expectFcm] = process.argv;
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find((p) => p.type === 'page');
if (!page) throw new Error('no WebView page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const evaluate = (expression) => new Promise((resolve) => {
  const id = Math.floor(Math.random() * 1e9);
  ws.addEventListener('message', function on(e) {
    const m = JSON.parse(e.data);
    if (m.id !== id) return;
    ws.removeEventListener('message', on);
    resolve(m.result?.result?.value);
  });
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
});
const ua = await evaluate('navigator.userAgent');
const native = await evaluate('Boolean(window.Capacitor && window.Capacitor.isNativePlatform())');
const url = await evaluate('location.href');
console.log({ ua, native, url });
ws.close();
// The offline page (server unreachable, as in pull request builds) has no bridge.
const offline = /\/index\.html$/.test(new URL(url).pathname);
if (!native && !offline) throw new Error('Capacitor bridge missing');
if (!/BalasAgen\/1/.test(ua)) throw new Error('user agent flag missing');
if (/BalasFCM/.test(ua) !== (expectFcm === 'yes')) throw new Error(`BalasFCM flag should be ${expectFcm}`);
console.log('WebView check ok');
