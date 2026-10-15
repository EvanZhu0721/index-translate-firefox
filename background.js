// Match the official CLI headers only for this extension's public API requests.
browser.webRequest.onBeforeSendHeaders.addListener(details => {
  if (!details.originUrl?.startsWith(browser.runtime.getURL(''))) return {};
  const headers = details.requestHeaders.filter(header => !['origin', 'referer', 'user-agent'].includes(header.name.toLowerCase()));
  headers.push({name: 'User-Agent', value: 'Index-Translate-Client/1.0'});
  return {requestHeaders: headers};
}, {urls: ['https://index-translate.bilibili.com/v1/chat/completions'], types: ['xmlhttprequest']}, ['blocking', 'requestHeaders']);

browser.runtime.onConnect.addListener(port => {
  if (port.name !== 'index-translate' || !port.sender.tab) return;
  const controllers = new Map();
  const send = data => {try {port.postMessage(data);} catch (_) { /* page closed */ }};
  port.onDisconnect.addListener(() => {for (const c of controllers.values()) c.abort();});
  port.onMessage.addListener(async message => {
    if (message.type === 'cancel') {for (const c of controllers.values()) c.abort(); return;}
    if (message.type !== 'translate') return;
    const current = new AbortController();
    controllers.set(message.id, current);
    try {
      const settings = await browser.storage.local.get(IndexAPI.defaults);
      settings.format = ['anchor-html-v1', 'paragraph-html-v2'].includes(message.format) ? message.format : 'text';
      const result = await IndexCache.translate(settings, message.text, current.signal, text => send({id: message.id, type: 'chunk', text}));
      send({id: message.id, type: 'done', ...result});
    } catch (error) {
      send({id: message.id, type: 'error', code: error.name, error: error.name === 'AbortError' ? '请求已停止或超时。' : error.message});
    } finally {controllers.delete(message.id);}
  });
});

browser.runtime.onMessage.addListener((message, sender) => {
  if (!sender.url?.startsWith(browser.runtime.getURL(''))) return;
  if (message.type === 'cache-count') return IndexCache.count();
  if (message.type === 'cache-clear') return IndexCache.clear().then(() => ({ok: true}));
});
