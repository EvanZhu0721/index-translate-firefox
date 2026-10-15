(() => {
  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open('index-translations', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('translations', {keyPath: 'key'}).createIndex('created', 'created');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async function transaction(mode, operation) {
    const db = await database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('translations', mode);
      let result;
      operation(tx.objectStore('translations'), value => {result = value;});
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Cache transaction aborted'));
    });
  }
  let revision = 0;
  const jobs = new Map();
  const keyFor = (settings, source) => JSON.stringify([2, settings.format || 'text', settings.baseUrl.replace(/\/$/, ''), settings.model, settings.target, source]);
  const get = key => transaction('readonly', (store, done) => {store.get(key).onsuccess = event => done(event.target.result?.text);});
  const put = (key, text) => transaction('readwrite', store => {
    store.put({key, text, created: Date.now()});
    store.count().onsuccess = event => {
      let excess = event.target.result - 5000;
      if (excess > 0) store.index('created').openCursor().onsuccess = event => {
        const cursor = event.target.result;
        if (cursor && excess-- > 0) {cursor.delete(); cursor.continue();}
      };
    };
  });
  function translate(settings, source, signal, update) {
    const key = keyFor(settings, source);
    if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    let job = jobs.get(key);
    if (!job) {
      job = {controller: new AbortController(), clients: new Set(), text: '', revision};
      jobs.set(key, job);
      job.promise = (async () => {
        const cached = await get(key);
        if (job.controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (cached !== undefined) return {text: cached, cached: true};
        const timer = setTimeout(() => job.controller.abort(), 120000);
        try {
          const text = await IndexAPI.translate(settings, source, job.controller.signal, text => {
            job.text = text;
            for (const client of job.clients) client.update(text);
          });
          if (job.controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          if (settings.format === 'paragraph-html-v2') IndexSegments.parse(source, text);
          if (settings.format === 'anchor-html-v1') IndexMarkup.parse(source, text);
          if (job.revision === revision) await put(key, text);
          return {text, cached: false};
        } finally {clearTimeout(timer);}
      })().finally(() => {if (jobs.get(key) === job) jobs.delete(key);});
    }
    return new Promise((resolve, reject) => {
      const client = {update};
      job.clients.add(client);
      if (job.text) update(job.text);
      function remove() {job.clients.delete(client); signal.removeEventListener('abort', abort);}
      function abort() {
        remove();
        if (!job.clients.size) {job.controller.abort(); if (jobs.get(key) === job) jobs.delete(key);}
        reject(new DOMException('Aborted', 'AbortError'));
      }
      signal.addEventListener('abort', abort, {once: true});
      job.promise.then(result => {remove(); resolve(result);}, error => {remove(); reject(error);});
    });
  }
  globalThis.IndexCache = {
    translate,
    count: () => transaction('readonly', (store, done) => {store.count().onsuccess = event => done(event.target.result);}),
    clear: () => {revision++; return transaction('readwrite', store => {store.clear();});}
  };
})();
