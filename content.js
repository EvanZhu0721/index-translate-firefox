(() => {
  if (globalThis.__indexTranslator) return;
  globalThis.__indexTranslator = true;
  const excluded = 'script,style,noscript,textarea,input,select,button,pre,svg,math,canvas,iframe,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],[data-index-translation]';
  let generation = 0, port, count = 0;
  const pending = new Map(), outputs = new Set();
  let state = {phase: 'idle', done: 0, total: 0, hits: 0, failed: 0, error: ''};
  let siteBlocked = false;
  function collect() {
    if (!document.body) return [];
    const selector = 'p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,div';
    const groups = [];
    for (const block of document.body.querySelectorAll(selector)) {
      const nestedTextBlock = [...block.querySelectorAll(selector)].some(child => {
        for (let parent = child.parentElement; parent !== block; parent = parent.parentElement) {
          if (parent.matches('svg,math,canvas,iframe,object,video,audio,picture,button,select,[contenteditable]')) return false;
        }
        return true;
      });
      if (block.closest(excluded) || nestedTextBlock || !block.getClientRects().length || getComputedStyle(block).visibility !== 'visible' || !/\p{L}/u.test(block.textContent)) continue;
      try {
        const source = IndexMarkup.encode(block);
        groups.push({block, source, original: block.innerHTML, article: !!block.closest('article,main,[role="main"],.mw-parser-output,.post-content,.entry-content')});
      } catch (_) { /* Interactive/unsupported blocks are outside text translation. */ }
    }
    return groups;
  }
  function stop() {
    generation++;
    for (const item of pending.values()) item.reject(new Error('cancelled'));
    pending.clear(); port?.disconnect(); port = null;
    if (state.phase === 'running') state.phase = 'stopped';
  }
  function restore() {
    stop(); for (const undo of [...outputs].reverse()) undo(); outputs.clear();
    state = {phase: 'idle', done: 0, total: 0, hits: 0, failed: 0, error: ''};
  }
  function request(source) {
    return new Promise((resolve, reject) => {
      const id = ++count; pending.set(id, {resolve, reject});
      port.postMessage({type: 'translate', id, text: source, format: 'anchor-html-v1'});
    });
  }
  async function start() {
    restore(); const current = generation;
    const settings = await browser.storage.local.get({blockedSites: []});
    if (current !== generation) return;
    siteBlocked = IndexSites.blocked(location.hostname, settings.blockedSites);
    if (siteBlocked) {state.phase = 'blocked'; return;}
    const groups = collect();
    state = {phase: 'running', done: 0, total: groups.length, hits: 0, failed: 0, error: ''};
    port = browser.runtime.connect({name: 'index-translate'}); const activePort = port;
    port.onMessage.addListener(message => {
      if (current !== generation || message.type === 'chunk') return;
      const item = pending.get(message.id); if (!item) return;
      pending.delete(message.id); if (message.cached) state.hits++;
      message.type === 'done' ? item.resolve(message.text) : item.reject(new Error(message.error));
    });
    port.onDisconnect.addListener(() => {
      if (port !== activePort) return;
      for (const item of pending.values()) item.reject(new Error('翻译连接已关闭。'));
      pending.clear();
    });
    try {
      await IndexSchedule.execute(groups, async batch => {
        const source = batch.map(g => g.source).join('');
        try {
          const translated = await request(source);
          if (current !== generation) return;
          const {paragraphs} = IndexMarkup.parse(source, translated);
          batch.forEach((group, i) => {
            if (group.block.isConnected && group.block.innerHTML === group.original) outputs.add(IndexMarkup.apply(group.block, group.source, paragraphs[i]));
            else throw new Error('页面内容已更新，未覆盖新内容。');
          });
        } catch (error) {
          if (current !== generation) return;
          state.failed += batch.length;
          state.error = `${state.failed} 段失败：${error.message}`;
        }
        if (current === generation) state.done += batch.length;
      }, () => current === generation);
      if (current === generation) state.phase = state.failed ? 'error' : 'done';
    } finally {if (current === generation) {port?.disconnect(); port = null;}}
  }
  browser.runtime.onMessage.addListener(message => {
    if (message.type === 'start') {void start(); return Promise.resolve({ok: true});}
    if (message.type === 'stop') stop();
    if (message.type === 'restore') restore();
    return Promise.resolve({...state, translated: outputs.size > 0});
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.blockedSites) {
      const wasBlocked = siteBlocked;
      siteBlocked = IndexSites.blocked(location.hostname, changes.blockedSites.newValue || []);
      if (siteBlocked) {restore(); state.phase = 'blocked';}
      else if (wasBlocked) {
        state.phase = 'idle';
        const current = generation;
        browser.storage.local.get({autoTranslate: true}).then(settings => {if (settings.autoTranslate && current === generation && !siteBlocked) void start();});
      }
    }
    if (changes.autoTranslate) {
      if (changes.autoTranslate.newValue) void start(); else stop();
    }
  });
  const initialGeneration = generation;
  browser.storage.local.get({autoTranslate: true, blockedSites: []}).then(settings => {
    if (generation !== initialGeneration) return;
    siteBlocked = IndexSites.blocked(location.hostname, settings.blockedSites);
    if (siteBlocked) state.phase = 'blocked';
    else if (settings.autoTranslate) void start();
  });
})();
