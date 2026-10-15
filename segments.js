(() => {
  function invalid(message) {const error = new Error(message); error.name = 'ParagraphFormatError'; return error;}
  function parse(source, translated) {
    const input = JSON.parse(source);
    let output;
    try {output = JSON.parse(translated.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, ''));}
    catch (_) {throw invalid('段落译文格式不完整，已保留原文。');}
    const keys = Object.keys(input);
    if (!output || Array.isArray(output) || typeof output !== 'object' || Object.keys(output).length !== keys.length ||
        keys.some(key => !Object.hasOwn(output, key) || typeof output[key] !== 'string' || (/\p{L}/u.test(input[key]) && !output[key].trim()))) {
      throw invalid('段落标记缺失或不匹配，已保留原文。');
    }
    return keys.map(key => output[key]);
  }
  function encode(source) {
    const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return '<p>' + Object.entries(JSON.parse(source)).map(([key, value]) => `<span data-i="${escape(key)}">${escape(value)}</span>`).join('') + '</p>';
  }
  function decode(source, translated) {
    const text = translated.trim().replace(/^```(?:html|xml)?\s*\n?/, '').replace(/\n?```$/, '');
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const root = doc.documentElement, result = {};
    if (doc.querySelector('parsererror') || root.localName !== 'p' || root.attributes.length) throw invalid('接口未保留段落标签，翻译未完成。');
    for (const node of root.childNodes) {
      if (node.nodeType === 3 && !node.textContent.trim()) continue;
      if (node.nodeType !== 1 || node.localName !== 'span' || node.attributes.length !== 1 || !node.hasAttribute('data-i') || node.children.length) throw invalid('接口改变了段落标签，翻译未完成。');
      const key = node.getAttribute('data-i');
      if (!/^\d+$/.test(key) || Object.hasOwn(result, key)) throw invalid('接口返回了重复或无效的段落标签。');
      result[key] = node.textContent;
    }
    const output = JSON.stringify(result); parse(source, output); return output;
  }
  globalThis.IndexSegments = {parse, encode, decode};
})();
