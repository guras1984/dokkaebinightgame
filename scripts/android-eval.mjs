setTimeout(() => process.exit(0), 8000);
const list = (await (await fetch('http://localhost:9222/json')).json()).filter((p) => p.type === 'page' && p.url.includes('ttuk'));
for (const page of list) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.onopen = r);
  const v = await new Promise((res) => { ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) res(m.result.result.value ?? m.result.result.description); }; ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: process.argv[2], awaitPromise: true, returnByValue: true } })); });
  console.log(page.id, page.url, JSON.stringify(v)); ws.close();
}
process.exit(0);
