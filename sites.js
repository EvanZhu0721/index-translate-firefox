(() => {
  function normalize(input) {
    const value = input.trim().replace(/^\*\./, '');
    let url;
    try {url = new URL(value.includes('://') ? value : `https://${value}`);} catch (_) {throw new Error('请输入有效的网站域名或网址。');}
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || /\s/.test(value)) throw new Error('请输入有效的网站域名或网址。');
    return url.hostname.toLowerCase().replace(/\.$/, '');
  }
  function blocked(hostname, sites) {
    const host = hostname.toLowerCase().replace(/\.$/, '');
    return sites.some(site => host === site || host.endsWith('.' + site));
  }
  globalThis.IndexSites = {normalize, blocked};
})();
