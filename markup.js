/* Whole-context HTML translation. No phrase alignment or model-supplied IDs.
 * parse(source, response) returns {paragraphs: [canonical safe HTML strings]}.
 * The array preserves response order; structural checks cannot prove semantics.
 */
(() => {
  'use strict';
  const INLINE = new Set(['a', 'code', 'em', 'strong', 'span', 'b', 'i', 'u', 's', 'small', 'sub', 'sup', 'br', 'kbd', 'samp', 'mark', 'abbr']);
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const opaque = node => !INLINE.has(node.localName) || node.isContentEditable || node.hasAttribute('contenteditable') || node.hasAttribute('role');
  function encode(block, objects = []) {
    function visit(node) {
      if (node.nodeType === 3) return escape(node.data);
      if (node.nodeType === 8) return '';
      if (node.nodeType !== 1) throw new Error('不支持此段落节点');
      const tag = node.localName;
      if (opaque(node)) {
        const id = objects.push(node) - 1;
        return '<span data-node="' + id + '">' + escape(node.getAttribute('alt') || node.getAttribute('aria-label') || '') + '</span>';
      }
      if (tag === 'br') return '<br/>';
      if (tag === 'a' && (!node.hasAttribute('href') || node.querySelector('a'))) throw new Error('链接结构无效');
      const attr = tag === 'a' ? ' href="' + escape(node.href) + '"' : '';
      return '<' + tag + attr + '>' + [...node.childNodes].map(visit).join('') + '</' + tag + '>';
    }
    return '<p>' + [...block.childNodes].map(visit).join('') + '</p>';
  }

  function read(markup) {
    let raw = String(markup).trim().replace(/^```(?:html|xml)?\s*\n?/i, '').replace(/\n?```$/, '');
    // XML parsing preserves invalid nested anchors instead of silently repairing them.
    // Common HTML entities and HTML's void BR spelling are canonicalized first.
    raw = raw.replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (whole, name) => {
      if (['amp', 'lt', 'gt', 'quot', 'apos'].includes(name)) return whole;
      const decoded = new DOMParser().parseFromString(whole, 'text/html').body.textContent;
      return decoded === whole ? whole : escape(decoded);
    }).replace(/<br\s*>/gi, '<br/>');
    const doc = new DOMParser().parseFromString('<root>' + raw + '</root>', 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('译文 HTML 未正确闭合或转义');
    const root = doc.documentElement;
    for (const node of root.childNodes) {
      if (node.nodeType === 3 && !node.data.trim()) continue;
      if (node.nodeType !== 1 || node.localName !== 'p') throw new Error('译文必须只包含段落 p');
    }
    function validate(element) {
      const tag = element.localName;
      if (element.namespaceURI || (tag !== 'p' && !INLINE.has(tag))) throw new Error('译文包含不支持的标签：' + tag);
      if (tag === 'p' && element.parentNode !== root) throw new Error('译文包含嵌套段落');
      for (const attr of element.attributes) {
        if (!(tag === 'a' && attr.name === 'href') && !(tag === 'span' && attr.name === 'data-node')) throw new Error('译文包含未允许的属性：' + attr.name);
      }
      if (element.hasAttribute('data-node') && (!/^\d+$/.test(element.getAttribute('data-node')) || element.children.length)) throw new Error('非文本元素占位符无效');
      if (tag === 'a' && (!element.hasAttribute('href') || element.querySelector('a') || (!element.textContent.trim() && !element.querySelector('[data-node]')))) throw new Error('译文链接为空或嵌套');
      for (const node of element.childNodes) {
        if (node.nodeType === 1) validate(node);
        else if (node.nodeType !== 3) throw new Error('译文包含不支持的节点');
      }
    }
    [...root.children].forEach(validate);
    return [...root.children];
  }

  function serialize(node) {
    if (node.nodeType === 3) return escape(node.data);
    if (node.localName === 'br') return '<br/>';
    const attr = node.localName === 'a' ? ' href="' + escape(node.getAttribute('href')) + '"' : node.hasAttribute('data-node') ? ' data-node="' + node.getAttribute('data-node') + '"' : '';
    return '<' + node.localName + attr + '>' + [...node.childNodes].map(serialize).join('') + '</' + node.localName + '>';
  }
  function equalCounts(source, result, selector, value, message) {
    const count = root => {
      const values = [...root.querySelectorAll(selector)].map(value).sort();
      return JSON.stringify(values);
    };
    if (count(source) !== count(result)) throw new Error(message);
  }
  function parse(source, response) {
    const expected = read(source), actual = read(response);
    if (!expected.length || expected.length !== actual.length) throw new Error('译文段落数量不匹配');
    actual.forEach((paragraph, i) => {
      if (expected[i].textContent.trim() && !paragraph.textContent.trim()) throw new Error('译文段落为空');
      equalCounts(expected[i], paragraph, 'a', a => a.getAttribute('href'), '译文链接缺失、增加或 href 改变');
      equalCounts(expected[i], paragraph, '[data-node]', n => n.getAttribute('data-node') + ':' + (n.closest('a')?.getAttribute('href') || ''), '译文非文本元素缺失、重复、改变或移动到其他链接');
      equalCounts(expected[i], paragraph, 'code, kbd, samp', code => code.localName + ':' + code.textContent, '译文行内代码被改变或遗漏');
    });
    return {paragraphs: actual.map(serialize)};
  }

  function snapshot(root) {
    return [...root.childNodes].map(node => ({node, value: node.nodeType === 3 ? node.data : null,
      attrs: node.nodeType === 1 ? [...node.attributes].map(a => [a.name, a.value]) : [], children: snapshot(node)}));
  }
  function unchanged(root, saved) {
    return root.childNodes.length === saved.length && saved.every((entry, i) => {
      const node = root.childNodes[i];
      return node === entry.node && (node.nodeType !== 3 || node.data === entry.value) &&
        (node.nodeType !== 1 || JSON.stringify([...node.attributes].map(a => [a.name, a.value])) === JSON.stringify(entry.attrs)) && unchanged(node, entry.children);
    });
  }
  function apply(block, source, response) {
    const validated = parse(source, response);
    if (validated.paragraphs.length !== 1) throw new Error('回填必须为单段');
    const objects = [];
    if (encode(block, objects) !== source) throw new Error('翻译期间网页内容已经改变');
    const originals = [...block.childNodes];
    const objectParents = new Map(objects.map(node => [node.parentNode, [...node.parentNode.childNodes]]));
    const anchors = new Map(), anchorChildren = [];
    for (const anchor of block.querySelectorAll('a')) {
      if (objects.some(node => node === anchor || node.contains(anchor))) continue;
      const href = anchor.href;
      if (!anchors.has(href)) anchors.set(href, []);
      anchors.get(href).push(anchor);
      anchorChildren.push([anchor, [...anchor.childNodes]]);
    }
    const translated = read(validated.paragraphs[0])[0];
    const doc = block.ownerDocument;
    function construct(node) {
      if (node.nodeType === 3) return doc.createTextNode(node.data);
      if (node.hasAttribute('data-node')) return objects[Number(node.getAttribute('data-node'))];
      const result = node.localName === 'a' ? anchors.get(node.getAttribute('href')).shift() : doc.createElement(node.localName);
      // Reusing the source anchor preserves href, attributes and event listeners.
      result.replaceChildren(...[...node.childNodes].map(construct));
      return result;
    }
    block.replaceChildren(...[...translated.childNodes].map(construct));
    const applied = snapshot(block);
    let active = true;
    return function restore() {
      if (!active) return false;
      active = false;
      if (!unchanged(block, applied)) return false;
      for (const [parent, children] of objectParents) parent.replaceChildren(...children);
      for (const [anchor, children] of anchorChildren) anchor.replaceChildren(...children);
      block.replaceChildren(...originals);
      return true;
    };
  }
  function transport(source) {
    const paragraphs = read(source), links = [];
    for (const paragraph of paragraphs) for (const anchor of paragraph.querySelectorAll('a')) {
      links.push(anchor.getAttribute('href'));
      anchor.setAttribute('href', '#link-' + (links.length - 1));
    }
    const encoded = paragraphs.map(serialize).join('');
    return {source: encoded, restore(response) {
      const validated = parse(encoded, response);
      return validated.paragraphs.map(html => {
        const paragraph = read(html)[0];
        for (const anchor of paragraph.querySelectorAll('a')) {
          anchor.setAttribute('href', links[Number(anchor.getAttribute('href').slice(6))]);
        }
        return serialize(paragraph);
      }).join('');
    }};
  }
  globalThis.IndexMarkup = {encode, parse, apply, transport, opaque};
})();
