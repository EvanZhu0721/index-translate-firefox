const $ = id => document.getElementById(id);
let tab, busy = false;
let blockedSites = [];
const currentHostname = () => {try {const url = new URL(tab?.url); return ['http:', 'https:'].includes(url.protocol) ? url.hostname : '';} catch (_) {return '';}};
const currentBlocked = () => IndexSites.blocked(currentHostname(), blockedSites);
const blankPage = () => /^(about:(blank|newtab|home)(?:[?#]|$))/.test(tab?.url || '');
function showEmpty() {
  $('status').textContent = '暂无可翻译内容';
  $('pageTranslate').checked = false;
  $('pageTranslate').disabled = blankPage();
  $('stop').disabled = true;
}
const ready = (async () => {
  const settings = {...IndexAPI.defaults, ...await browser.storage.local.get()};
  for (const key of ['baseUrl', 'model', 'apiKey', 'target']) $(key).value = settings[key];
  $('stream').checked = settings.stream;
  $('autoTranslate').checked = settings.autoTranslate;
  [tab] = await browser.tabs.query({active: true, currentWindow: true});
  blockedSites = settings.blockedSites || [];
  renderSites();
})();
async function save() {
  if (!$('settings').reportValidity()) throw new Error('请填写有效的接口地址和模型。');
  const url = new URL($('baseUrl').value.trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('请使用不含密码、查询参数的 HTTP(S) 接口地址。');
  await browser.storage.local.set({baseUrl: url.href.replace(/\/$/, ''), model: $('model').value.trim(), apiKey: $('apiKey').value.trim(), target: $('target').value, stream: $('stream').checked});
}
async function action(type) {
  busy = true;
  $('pageTranslate').disabled = true;
  try {
    await ready;
    if (blankPage()) {showEmpty(); return;}
    if (currentBlocked()) {await update(); return;}
    if (type === 'start') await save();
    if (type === 'start') {
      try {await browser.tabs.executeScript(tab.id, {file: 'markup.js'}); await browser.tabs.executeScript(tab.id, {file: 'schedule.js'}); await browser.tabs.executeScript(tab.id, {file: 'sites.js'}); await browser.tabs.executeScript(tab.id, {file: 'content.js'});} catch (_) {throw new Error('Firefox 限制了此页面的扩展访问。');}
    }
    await browser.tabs.sendMessage(tab.id, {type});
    await update();
  } catch (error) {$('status').textContent = error.message; $('pageTranslate').checked = false;}
  finally {busy = false; $('pageTranslate').disabled = blankPage() || currentBlocked();}
}
async function update() {
  await ready;
  if (blankPage()) {showEmpty(); return;}
  if (currentBlocked()) {$('status').textContent = '此网站已屏蔽'; $('pageTranslate').checked = false; $('pageTranslate').disabled = true; $('stop').disabled = true; return;}
  let state;
  try {state = await browser.tabs.sendMessage(tab.id, {type: 'status'});} catch (_) {$('pageTranslate').disabled = false; return;}
  if (state.phase === 'done' && !state.total) {showEmpty(); return;}
  const labels = {idle: '就绪', running: '翻译中', stopped: '已停止', done: '已完成', error: '翻译中断', blocked: '此网站已屏蔽'};
  $('status').textContent = state.error || `${labels[state.phase]}${state.total ? ` · ${state.done} / ${state.total}` : state.phase === 'done' ? ' · 未找到可翻译文本' : ''}${state.hits ? ` · 缓存 ${state.hits}` : ''}`;
  $('pageTranslate').checked = state.phase === 'running' || !!state.translated;
  $('pageTranslate').disabled = false;
  $('stop').disabled = state.phase !== 'running';
}
$('pageTranslate').addEventListener('change', () => action($('pageTranslate').checked ? 'start' : 'restore'));
$('stop').addEventListener('click', () => action('stop'));
$('settings').addEventListener('submit', async event => {
  event.preventDefault(); busy = true;
  try {await save(); $('status').textContent = '设置已保存';} catch (error) {$('status').textContent = error.message;}
  finally {setTimeout(() => {busy = false;}, 2000);}
});
void update(); setInterval(() => {if (!busy) void update();}, 800);
async function cacheCount() {$('cache-status').textContent = `本地缓存 · ${await browser.runtime.sendMessage({type: 'cache-count'})} 条`;}
$('autoTranslate').addEventListener('change', async () => {await browser.storage.local.set({autoTranslate: $('autoTranslate').checked});});
$('clear-cache').addEventListener('click', async () => {await browser.runtime.sendMessage({type: 'cache-clear'}); await cacheCount();});
void cacheCount();
function renderSites() {
  $('blocked-count').textContent = blockedSites.length;
  $('block-current').disabled = !currentHostname() || currentBlocked();
  $('block-current').textContent = currentBlocked() ? '当前网站已屏蔽' : '屏蔽当前网站';
  $('blocked-list').replaceChildren();
  for (const site of blockedSites) {
    const row = document.createElement('li'), label = document.createElement('span'), remove = document.createElement('button');
    label.textContent = site; remove.type = 'button'; remove.textContent = '移除'; remove.setAttribute('aria-label', `移除 ${site}`);
    remove.addEventListener('click', async () => {await browser.storage.local.set({blockedSites: blockedSites.filter(item => item !== site)});});
    row.append(label, remove); $('blocked-list').append(row);
  }
}
async function addSite(value) {
  try {
    const site = IndexSites.normalize(value);
    const {blockedSites: existing = []} = await browser.storage.local.get({blockedSites: []});
    await browser.storage.local.set({blockedSites: [...new Set([...existing, site])].sort()});
    $('site-input').value = ''; $('site-status').textContent = `已屏蔽 ${site}`;
  } catch (error) {$('site-status').textContent = error.message;}
}
$('block-current').addEventListener('click', () => addSite(currentHostname()));
$('add-site').addEventListener('click', () => addSite($('site-input').value));
$('site-input').addEventListener('keydown', event => {if (event.key === 'Enter') {event.preventDefault(); void addSite(event.target.value);}});
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.blockedSites) {blockedSites = changes.blockedSites.newValue || []; renderSites(); void update();}
});
