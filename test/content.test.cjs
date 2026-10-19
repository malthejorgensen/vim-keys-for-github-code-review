const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync('content.js', 'utf8');
const fixture = fs.readFileSync('github_code_review_individual_files.html', 'utf8') +
  fs.readFileSync('github_code_review_submit_review_button.html', 'utf8');

function setup() {
  const dom = new JSDOM(fixture, { url: 'https://github.com/example/repo/pull/1/files', runScripts: 'outside-only' });
  const { window } = dom;
  const { document } = window;
  const files = [...document.querySelectorAll('[id^="diff-"][role="region"]')];
  let scroll = 0;
  Object.defineProperty(window, 'scrollY', { get: () => scroll });
  const positions = [100, 600];
  // jsdom has no layout: emulate two consecutive 500px file regions.
  window.Element.prototype.getClientRects = function () { return this.hidden ? [] : [{}]; };
  window.scrollTo = ({ top }) => { scroll = Math.max(0, Math.min(332, top)); };
  window.HTMLElement.prototype.scrollIntoView = function () {
    window.scrollTo({ top: positions[files.findIndex(file => file.id === this.id)] - 96 });
  };
  files.forEach((file, i) => {
    file.getBoundingClientRect = () => ({ top: positions[i] - scroll, bottom: positions[i] + 500 - scroll });
    file.parentElement.getBoundingClientRect = file.getBoundingClientRect;
    const viewed = file.querySelector('button[aria-pressed]');
    viewed.addEventListener('click', () => {
      viewed.setAttribute('aria-pressed', viewed.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    });
    const collapse = file.querySelector('button');
    collapse.addEventListener('click', () => {
      const tooltip = document.getElementById(collapse.getAttribute('aria-labelledby'));
      tooltip.textContent = tooltip.textContent === 'Collapse file' ? 'Expand file' : 'Collapse file';
    });
  });
  window.eval(source);
  const nativeEvents = [];
  for (const type of ['keydown', 'keypress', 'keyup']) {
    window.addEventListener(type, event => nativeEvents.push(`window:${event.type}`), true);
    document.addEventListener(type, event => nativeEvents.push(`document:${event.type}`), true);
    document.addEventListener(type, event => nativeEvents.push(`bubble:${event.type}`));
  }
  function dispatch(key, type = 'keydown', options = {}, target = document.activeElement) {
    const event = new window.KeyboardEvent(type, {
      key, code: key === ' ' ? 'Space' : `Key${key.toUpperCase()}`, bubbles: true, cancelable: true, ...options,
    });
    target.dispatchEvent(event);
    return event;
  }
  function press(key, options, target) {
    const down = dispatch(key, 'keydown', options, target);
    dispatch(key, 'keypress', options, target);
    dispatch(key, 'keyup', options, target);
    return down;
  }
  return { dom, window, document, files, nativeEvents, dispatch, press, setScroll: value => { scroll = value; } };
}

function largeDiffLayout(s) {
  const entries = s.files.map(file => file.parentElement);
  s.files.forEach((file, i) => {
    const top = i === 0 ? 100 : 10100;
    const bottom = i === 0 ? 10100 : 10600;
    file.getBoundingClientRect = () => ({ top: top - s.window.scrollY, bottom: bottom - s.window.scrollY });
    entries[i].getBoundingClientRect = file.getBoundingClientRect;
  });
  s.window.scrollTo = ({ top }) => s.setScroll(Math.max(0, top));
  s.window.HTMLElement.prototype.scrollIntoView = function () {
    s.window.scrollTo({ top: this.getBoundingClientRect().top + s.window.scrollY - 96 });
  };
  return entries;
}

async function eventually(check) {
  const deadline = Date.now() + 2200;
  while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(check(), 'expected virtualized navigation to complete');
}

test('f opens the current pull request Files changed tab without requiring rendered diffs', () => {
  for (const tabPath of ['/files', '/changes']) {
    const s = setup();
    s.document.body.innerHTML = `
      <a href="/example/repo/pull/2/files">Files changed for another PR</a>
      <a href="https://example.com/example/repo/pull/1/files">Files changed elsewhere</a>
      <a href="/example/repo/pull/1${tabPath}#diff-123">A comment's diff link</a>
      <a href="/example/repo/pull/1${tabPath}"><span>Files changed</span><span> 12</span></a>`;
    const target = s.document.querySelector('a:last-child');
    const clicked = [];
    s.document.addEventListener('click', event => {
      clicked.push(event.target);
      event.preventDefault();
    });
    for (const suffix of ['', '/commits', '/checks', '/commits/abc123']) {
      s.window.history.pushState({}, '', `/example/repo/pull/1${suffix}`);
      assert.equal(s.press('f').defaultPrevented, true);
      assert.equal(clicked.at(-1), target);
    }
    assert.equal(clicked.length, 4);
    s.dispatch('f', 'keydown', { repeat: true });
    s.dispatch('f', 'keyup');
    assert.equal(clicked.length, 4);
    s.window.history.pushState({}, '', `/example/repo/pull/1${tabPath}`);
    assert.equal(s.press('f').defaultPrevented, true);
    assert.equal(clicked.length, 4, 'already on Files changed: do not reset review state');
    assert.deepEqual(s.nativeEvents, []);
    s.dom.window.close();
  }
});

test('f ignores unrelated pages and unavailable Files changed links', () => {
  const s = setup();
  s.document.body.innerHTML = '<a href="/example/repo/pull/1/files">Files changed</a>';
  for (const path of ['/example/repo/issues/1', '/example/repo/pulls', '/example/repo/pull/12']) {
    s.window.history.pushState({}, '', path);
    assert.equal(s.press('f').defaultPrevented, false);
  }
  s.window.history.pushState({}, '', '/example/repo/pull/1');
  s.document.querySelector('a').hidden = true;
  assert.equal(s.press('f').defaultPrevented, false);
  s.document.body.innerHTML = '';
  assert.equal(s.press('f').defaultPrevented, false);
  s.dom.window.close();
});

test('j/k reveal virtualized neighbors across a large diff, even when the current file unmounts', async () => {
  const s = setup();
  const entries = largeDiffLayout(s);
  const parent = entries[0].parentElement;
  entries[1].remove();
  s.window.scrollTo = ({ top }) => {
    s.setScroll(Math.max(0, top));
    if (top >= 10000 && !entries[1].isConnected) {
      entries[0].remove();
      s.window.setTimeout(() => parent.append(entries[1]), 30);
    } else if (top < 10000 && !entries[0].isConnected) {
      s.window.setTimeout(() => parent.prepend(entries[0]), 30);
    }
  };
  s.files[0].dispatchEvent(new s.window.Event('pointerdown', { bubbles: true }));
  assert.equal(s.press('j').defaultPrevented, true);
  s.dispatch('j', 'keydown', { repeat: true });
  s.dispatch('j', 'keyup');
  await eventually(() => s.document.activeElement === s.files[1]);
  assert.ok(s.window.scrollY >= 10000);
  s.press('k');
  await eventually(() => s.document.activeElement === s.files[0]);
  assert.ok(s.files[0].hasAttribute('data-review-vikeys-selected'));
  assert.deepEqual(s.nativeEvents, []);
  s.dom.window.close();
});

test('navigation restores an unmounted remembered file before finding its neighbor', async () => {
  const s = setup();
  const entries = largeDiffLayout(s);
  const parent = entries[0].parentElement;
  s.press('j');
  entries[0].remove();
  entries[1].remove();
  s.setScroll(0);
  let restored = false;
  s.window.scrollTo = ({ top }) => {
    s.setScroll(Math.max(0, top));
    if (top >= 10000 && !entries[1].isConnected) {
      restored = true;
      s.window.setTimeout(() => parent.append(...entries), 30);
    }
  };
  assert.equal(s.press('k').defaultPrevented, true);
  await eventually(() => s.document.activeElement === s.files[0]);
  assert.equal(restored, true);
  assert.deepEqual(s.nativeEvents, []);
  s.dom.window.close();
});

test('x auto-advance waits for an unmounted next file', async () => {
  const s = setup();
  const entries = largeDiffLayout(s);
  const parent = entries[0].parentElement;
  entries[1].remove();
  s.window.scrollTo = ({ top }) => {
    s.setScroll(Math.max(0, top));
    if (top >= 10000 && !entries[1].isConnected) s.window.setTimeout(() => parent.append(entries[1]), 30);
  };
  s.press('x');
  assert.equal(s.files[0].querySelector('button[aria-pressed]').getAttribute('aria-pressed'), 'true');
  await eventually(() => s.document.activeElement === s.files[1]);
  assert.equal(s.files[1].querySelector('button[aria-pressed]').getAttribute('aria-pressed'), 'false');
  s.dom.window.close();
});

test('navigation scrolls an empty file wrapper into view before selecting its mounted diff', async () => {
  const s = setup();
  const entries = largeDiffLayout(s);
  const second = s.files[1];
  second.remove();
  s.window.scrollTo = ({ top }) => {
    s.setScroll(Math.max(0, top));
    if (top >= 10000 && !second.isConnected) s.window.setTimeout(() => entries[1].append(second), 30);
  };
  s.press('j');
  await eventually(() => s.document.activeElement === second);
  assert.ok(second.hasAttribute('data-review-vikeys-selected'));
  s.dom.window.close();
});

test('navigation timeout keeps selection and restores the previous scroll position', async () => {
  const s = setup();
  const entries = largeDiffLayout(s);
  entries[1].remove();
  s.press('j');
  assert.ok(s.window.scrollY >= 10000);
  await eventually(() => s.window.scrollY === 0);
  assert.ok(s.files[0].hasAttribute('data-review-vikeys-selected'));
  assert.deepEqual(s.nativeEvents, []);
  s.dom.window.close();
});

test('SPA navigation cancels pending virtualized navigation without moving the new page', async () => {
  const s = setup();
  const entries = largeDiffLayout(s);
  const parent = entries[0].parentElement;
  entries[1].remove();
  s.press('j');
  s.window.history.pushState({}, '', '/example/repo/pull/2/files');
  s.setScroll(123);
  parent.append(entries[1]);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(s.window.scrollY, 123);
  assert.equal(s.document.querySelector('[data-review-vikeys-selected]'), null);
  s.dom.window.close();
});

test('manual scrolling cancels a pending jump while preserving the remembered file', async () => {
  const s = setup();
  const entries = largeDiffLayout(s);
  entries[1].remove();
  s.press('j');
  s.window.dispatchEvent(new s.window.Event('wheel'));
  s.setScroll(500);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(s.window.scrollY, 500);
  assert.ok(s.files[0].hasAttribute('data-review-vikeys-selected'));
  s.dom.window.close();
});

test('j/k navigate adjacent fixture files and clamp at either end', () => {
  const s = setup();
  s.press('j');
  assert.equal(s.document.activeElement, s.files[1]);
  assert.ok(s.files[1].hasAttribute('data-review-vikeys-selected'));
  s.press('j');
  assert.equal(s.document.activeElement, s.files[1]);
  s.press('k');
  s.press('k');
  assert.equal(s.document.activeElement, s.files[0]);
  assert.equal(s.document.querySelectorAll('[data-review-vikeys-selected]').length, 1);
  assert.equal(s.files[0].style.scrollMarginTop, '96px');
  assert.deepEqual(s.nativeEvents, []);
  s.dom.window.close();
});

test('Shift+j/k scroll down/up, repeat, and intercept GitHub without navigating files', () => {
  const s = setup();
  const scrolls = [];
  s.window.scrollBy = options => scrolls.push({ ...options });
  assert.equal(s.press('J', { shiftKey: true }).defaultPrevented, true);
  s.dispatch('J', 'keydown', { shiftKey: true, repeat: true });
  // Shift may be released before the letter's keyup.
  assert.equal(s.dispatch('j', 'keyup').defaultPrevented, true);
  assert.equal(s.press('K', { shiftKey: true }).defaultPrevented, true);
  assert.deepEqual(scrolls, [
    { top: 100, behavior: 'instant' },
    { top: 100, behavior: 'instant' },
    { top: -100, behavior: 'instant' },
  ]);
  assert.equal(s.document.querySelector('[data-review-vikeys-selected]'), s.files[0]);
  assert.equal(s.document.activeElement, s.document.body);
  assert.deepEqual(s.nativeEvents, []);
  s.dom.window.close();
});

test('x toggles viewed status, advances only when marking viewed, and suppresses held-key repeats', () => {
  const s = setup();
  const viewed = s.files[0].querySelector('button[aria-pressed]');
  s.press('x');
  assert.equal(viewed.getAttribute('aria-pressed'), 'true');
  assert.equal(s.document.activeElement, s.files[1]);
  assert.equal(s.files[1].querySelector('button[aria-pressed]').getAttribute('aria-pressed'), 'false');
  s.dispatch('x', 'keydown', { repeat: true });
  s.dispatch('x', 'keyup');
  assert.equal(s.files[1].querySelector('button[aria-pressed]').getAttribute('aria-pressed'), 'false');
  s.press('x');
  assert.equal(s.files[1].querySelector('button[aria-pressed]').getAttribute('aria-pressed'), 'true');
  assert.equal(s.document.activeElement, s.files[1]);
  s.press('x');
  assert.equal(s.files[1].querySelector('button[aria-pressed]').getAttribute('aria-pressed'), 'false');
  assert.equal(s.document.activeElement, s.files[1]);
  s.press('k');
  s.press('x');
  assert.equal(viewed.getAttribute('aria-pressed'), 'false');
  assert.equal(s.document.activeElement, s.files[0]);
  s.dispatch('x', 'keydown', { repeat: true });
  s.dispatch('x', 'keyup');
  assert.equal(viewed.getAttribute('aria-pressed'), 'false');
  assert.equal(s.document.activeElement, s.files[0]);
  s.press('x');
  assert.equal(viewed.getAttribute('aria-pressed'), 'true');
  assert.equal(s.document.activeElement, s.files[1]);
  assert.deepEqual(s.nativeEvents, []);
  s.dom.window.close();
});

test('Space clicks collapse and expand without toggling on held-key repeats', () => {
  const s = setup();
  const tooltip = s.document.getElementById(s.files[0].querySelector('button').getAttribute('aria-labelledby'));
  s.press(' ');
  assert.equal(tooltip.textContent, 'Expand file');
  s.dispatch(' ', 'keydown', { repeat: true });
  assert.equal(tooltip.textContent, 'Expand file');
  s.dispatch(' ', 'keyup');
  s.press(' ');
  assert.equal(tooltip.textContent, 'Collapse file');
  assert.deepEqual(s.nativeEvents, []);
  s.dom.window.close();
});

test('selection survives scrolling out of view, lost focus, and React replacement', async () => {
  const s = setup();
  s.press('j');
  const replacement = s.files[1].cloneNode(true);
  replacement.removeAttribute('data-review-vikeys-selected');
  replacement.getBoundingClientRect = s.files[1].getBoundingClientRect;
  s.files[1].replaceWith(replacement);
  s.setScroll(3000);
  await Promise.resolve();
  assert.ok(replacement.hasAttribute('data-review-vikeys-selected'));
  s.press('k');
  assert.equal(s.document.activeElement, s.files[0]);
  assert.deepEqual(s.nativeEvents, []);
  s.dom.window.close();
});

test('scrolling keeps selection until another diff is clicked', () => {
  const s = setup();
  s.press('j');
  s.window.dispatchEvent(new s.window.Event('wheel'));
  s.setScroll(0);
  s.press('x');
  assert.equal(s.files[1].querySelector('button[aria-pressed]').getAttribute('aria-pressed'), 'true');
  assert.equal(s.files[0].querySelector('button[aria-pressed]').getAttribute('aria-pressed'), 'false');
  s.files[0].dispatchEvent(new s.window.Event('pointerdown', { bubbles: true }));
  s.press('x');
  assert.equal(s.files[0].querySelector('button[aria-pressed]').getAttribute('aria-pressed'), 'true');
  s.dom.window.close();
});

test('p opens review; keypress/keyup stay intercepted when focus moves to its textarea', () => {
  const s = setup();
  let clicks = 0;
  s.document.querySelector('button[data-variant="primary"]').addEventListener('click', () => {
    clicks++;
    const dialog = s.document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.innerHTML = '<textarea></textarea>';
    s.document.body.append(dialog);
    dialog.firstChild.focus();
  });
  assert.equal(s.press('p').defaultPrevented, true);
  assert.equal(clicks, 1);
  assert.deepEqual(s.nativeEvents, []);
  assert.equal(s.press('j').defaultPrevented, false);
  assert.equal(s.document.querySelector('[data-review-vikeys-selected]'), null);
  s.dom.window.close();
});

test('typing, modifiers, composition, other keys, and open dialogs keep normal behavior', () => {
  const s = setup();
  const tab = s.document.createElement('a');
  tab.href = '/example/repo/pull/1/files';
  tab.textContent = 'Files changed';
  s.document.body.append(tab);
  for (const html of ['<input>', '<textarea></textarea>', '<select></select>', '<div role="textbox" tabindex="0"></div>', '<div contenteditable="true" tabindex="0"></div>']) {
    const wrapper = s.document.createElement('div');
    wrapper.innerHTML = html;
    const input = wrapper.firstChild;
    // jsdom does not implement isContentEditable.
    if (input.hasAttribute('contenteditable')) Object.defineProperty(input, 'isContentEditable', { value: true });
    s.document.body.append(wrapper);
    input.focus();
    for (const key of ['j', 'k', 'x', ' ', 'p', 'f']) assert.equal(s.press(key).defaultPrevented, false);
    for (const key of ['J', 'K']) assert.equal(s.press(key, { shiftKey: true }).defaultPrevented, false);
    wrapper.remove();
  }
  for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'isComposing']) {
    assert.equal(s.press('j', { [modifier]: true }).defaultPrevented, false);
    assert.equal(s.press('f', { [modifier]: true }).defaultPrevented, false);
    assert.equal(s.press('J', { shiftKey: true, [modifier]: true }).defaultPrevented, false);
  }
  for (const key of ['X', 'P', 'F', ' ']) assert.equal(s.press(key, { shiftKey: true }).defaultPrevented, false);
  assert.equal(s.press('q').defaultPrevented, false);
  const dialog = s.document.createElement('dialog');
  dialog.setAttribute('open', '');
  s.document.body.append(dialog);
  assert.equal(s.press('x').defaultPrevented, false);
  assert.equal(s.press('f').defaultPrevented, false);
  assert.equal(s.press('J', { shiftKey: true }).defaultPrevented, false);
  assert.equal(s.files[0].querySelector('button[aria-pressed]').getAttribute('aria-pressed'), 'false');
  assert.ok(s.nativeEvents.length > 0);
  s.dom.window.close();
});

test('click and manual scroll select the intended file, including collapsed files', async () => {
  const s = setup();
  s.files[1].dispatchEvent(new s.window.Event('pointerdown', { bubbles: true }));
  s.press('x');
  assert.equal(s.files[1].querySelector('button[aria-pressed]').getAttribute('aria-pressed'), 'true');
  await new Promise(resolve => setTimeout(resolve, 1600));
  s.window.dispatchEvent(new s.window.Event('wheel'));
  s.setScroll(510);
  s.press(' ');
  const tooltip = s.document.getElementById(s.files[1].querySelector('button').getAttribute('aria-labelledby'));
  assert.equal(tooltip.textContent, 'Expand file');
  assert.equal(s.files[0].querySelector('button[aria-pressed]').getAttribute('aria-pressed'), 'false');
  s.dom.window.close();
});

test('SPA navigation, DOM replacement, and empty review pages are handled without reinjection', () => {
  const s = setup();
  s.window.history.pushState({}, '', '/example/repo/issues');
  assert.equal(s.press('j').defaultPrevented, false);
  s.window.history.pushState({}, '', '/example/repo/pull/2/changes');
  assert.equal(s.press('j').defaultPrevented, true);
  const replacement = s.files[1].cloneNode(true);
  replacement.getBoundingClientRect = s.files[1].getBoundingClientRect;
  s.files[1].replaceWith(replacement);
  let clicks = 0;
  replacement.querySelector('button[aria-pressed]').addEventListener('click', () => clicks++);
  s.press('x');
  assert.equal(clicks, 1);
  s.document.body.innerHTML = '';
  s.window.history.pushState({}, '', '/example/repo/pull/3/files');
  assert.equal(s.press('j').defaultPrevented, false);
  s.dom.window.close();
});

test('manifest injects capture handler at document_start across GitHub SPA entry points', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.content_scripts[0].run_at, 'document_start');
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://github.com/*']);
  for (const path of [...manifest.content_scripts[0].js, ...manifest.content_scripts[0].css]) {
    assert.ok(fs.existsSync(path));
  }
});
