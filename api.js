/* Shared by the Firefox background page and the protocol tests. */
(() => {
  const defaults = {baseUrl: 'https://index-translate.bilibili.com/v1', model: 'Index-Translate-35B-A3B', apiKey: '', target: '简体中文', stream: true, autoTranslate: true};
  function clean(text) {
    return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').replace(/<\/?(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/, '').trim();
  }
  async function translate(settings, source, signal, onText) {
    const headers = {'Content-Type': 'application/json', 'User-Agent': 'Index-Translate-Client/1.0'};
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
    const markup = settings.format === 'anchor-html-v1';
    const transport = markup ? IndexMarkup.transport(source) : null;
    const segmented = settings.format === 'paragraph-html-v2';
    if (segmented && Object.keys(JSON.parse(source)).length === 1) {
      const [key, original] = Object.entries(JSON.parse(source))[0];
      const text = await translate({...settings, format: 'text', paragraphText: true}, original, signal, () => {});
      const result = JSON.stringify({[key]: text}); onText(result); return result;
    }
    const prompt = markup ? `请将下面HTML的全部可见文本翻译为${settings.target}。保持每个p的数量、顺序，每个a的href及边界不变，不删除、合并、添加或嵌套链接。跨行内元素理解完整上下文。code内文本原样保留。带data-node属性的span代表本地非文本元素，保留其编号及所属链接，不删除或重复；标签内说明文字可以翻译。只输出合法闭合的HTML，&写作&amp;。不要解释。\n\n${transport.source}` : `请将以下文本翻译为${settings.target}，直接输出翻译结果，不要进行任何解释。\n\n${segmented ? IndexSegments.encode(source) : source}`;
    const response = await fetch(settings.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', headers, signal, credentials: 'omit', referrerPolicy: 'no-referrer',
      body: JSON.stringify({model: settings.model, messages: [{role: 'user', content: prompt}], temperature: 0, max_tokens: markup || segmented || settings.paragraphText ? 8192 : 2048, stream: settings.stream, chat_template_kwargs: {enable_thinking: false}})
    });
    if (!response.ok) throw new Error(`API HTTP ${response.status}。${[403, 412].includes(response.status) ? '接口拒绝了此请求。' : response.status === 429 ? '请求过多，请稍后重试。' : '请检查接口地址和模型。'}`);
    let result = '', ended = false;
    function accept(data) {
      if (data.error) throw new Error('API 返回错误，请检查模型或服务状态。');
      const choice = data.choices?.[0];
      if (choice?.finish_reason === 'length') throw new Error('译文超过接口输出上限，请换用支持更长输出的服务。');
      if (choice?.finish_reason && choice.finish_reason !== 'stop') throw new Error(`翻译未完成：${choice.finish_reason}`);
      if (choice?.finish_reason === 'stop') ended = true;
      const text = choice?.delta?.content ?? choice?.message?.content;
      if (typeof text === 'string') {result += text; onText(clean(result));}
    }
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '', doneMarker = false;
      function event(raw) {
        const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) return;
        if (data.trim() === '[DONE]') {doneMarker = true; return;}
        accept(JSON.parse(data));
      }
      try {
        while (!doneMarker) {
          const {value, done} = await reader.read();
          buffer += decoder.decode(value, {stream: !done});
          let match;
          while ((match = /\r?\n\r?\n/.exec(buffer))) {
            event(buffer.slice(0, match.index));
            buffer = buffer.slice(match.index + match[0].length);
            if (doneMarker) break;
          }
          if (done) {if (buffer.trim() && !doneMarker) event(buffer); break;}
        }
        if (!doneMarker && !ended) throw new Error('流式连接提前结束，请重试。');
      } finally {await reader.cancel().catch(() => {}); reader.releaseLock();}
    } else accept(await response.json());
    if (!clean(result)) throw new Error('接口未返回译文。');
    if (markup) {
      result = transport.restore(clean(result));
      IndexMarkup.parse(source, result);
    }
    return segmented ? IndexSegments.decode(source, clean(result)) : clean(result);
  }
  globalThis.IndexAPI = {defaults, clean, translate};
})();
