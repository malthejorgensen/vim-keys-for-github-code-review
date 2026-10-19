(() => {
  "use strict";

  const FILE_SELECTOR = '[id^="diff-"][role="region"]';
  const KEYS = new Set(["j", "k", "x", " ", "p", "f"]);
  const heldKeys = new Set();
  let selectedId = null;
  let selectedTop = null;
  let pendingNavigation = null;
  let reviewLocation = location.pathname + location.search;

  function resetForNavigation() {
    const nextLocation = location.pathname + location.search;
    if (nextLocation === reviewLocation) return;
    reviewLocation = nextLocation;
    selectedId = null;
    selectedTop = null;
    pendingNavigation = null;
    document.querySelectorAll('[data-review-vikeys-selected]').forEach(element => {
      element.removeAttribute('data-review-vikeys-selected');
    });
  }

  // Recheck the URL and DOM on each key: GitHub navigates without reloading.
  function isReviewPage() {
    return /^\/[^/]+\/[^/]+\/pull\/\d+\/(?:files|changes)(?:\/|$)/.test(location.pathname);
  }

  function isVisible(element) {
    return element.getClientRects().length > 0 && !element.closest('[hidden], [inert]');
  }

  function shouldIgnore(event) {
    if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return true;
    if (event.shiftKey && !['j', 'k'].includes(event.key.toLowerCase())) return true;
    if (event.composedPath().some(element => element instanceof Element && (
      element.matches('input, textarea, select, [role="textbox"], [role="combobox"]') ||
      element.isContentEditable
    ))) return true;
    return [...document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]')].some(isVisible);
  }

  function files() {
    return [...document.querySelectorAll(FILE_SELECTOR)].filter(isVisible);
  }

  function header(file) {
    return file.querySelector('[data-diff-header-wrapper]') || file;
  }

  function topOffset(file) {
    const offset = parseFloat(getComputedStyle(header(file)).getPropertyValue('--header-sticky-offset')) || 0;
    return Math.max(96, offset + 16);
  }

  function currentFile(list) {
    const selected = list.find(file => file.id === selectedId);
    if (selected) return selected;
    const focused = document.activeElement?.closest(FILE_SELECTOR);
    if (list.includes(focused)) {
      const rect = focused.getBoundingClientRect();
      if (rect.bottom > topOffset(focused) && rect.top < innerHeight) return focused;
    }
    // Use the file at the top of the viewport after manual scrolling.
    return list.find(file => file.getBoundingClientRect().bottom > topOffset(file)) || list.at(-1);
  }

  function select(file, scroll = false) {
    document.querySelectorAll('[data-review-vikeys-selected]').forEach(element => {
      element.removeAttribute('data-review-vikeys-selected');
    });
    selectedId = file.id;
    selectedTop = file.getBoundingClientRect().top + window.scrollY;
    file.setAttribute('data-review-vikeys-selected', '');
    if (scroll) {
      file.style.scrollMarginTop = `${topOffset(file)}px`;
      file.scrollIntoView({ block: 'start', behavior: 'instant' });
      // Leave focus on the selected file, rather than a button in the previous one.
      if (!file.hasAttribute('tabindex')) file.setAttribute('tabindex', '-1');
      file.focus({ preventScroll: true });
    }
  }

  function navigationActive(task) {
    return pendingNavigation === task && location.pathname + location.search === task.location;
  }

  // Allow React time to mount a virtualized file after scrolling to it.
  async function waitForFile(find, task) {
    const deadline = Date.now() + 1500;
    while (navigationActive(task)) {
      const file = find();
      if (file) return file;
      if (Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return null;
  }

  async function restoreCurrent(task) {
    const list = files();
    if (!selectedId) {
      const current = currentFile(list);
      if (current) select(current);
      return current;
    }
    const mounted = list.find(file => file.id === selectedId);
    if (mounted) {
      select(mounted);
      return mounted;
    }
    // Never substitute the first rendered diff for the remembered file.
    const id = selectedId;
    if (selectedTop === null) return null;
    window.scrollTo({ top: Math.max(0, selectedTop - 96), behavior: 'instant' });
    const restored = await waitForFile(() => files().find(file => file.id === id), task);
    if (restored && navigationActive(task)) select(restored);
    return restored;
  }

  function moveFile(current, direction, task, savedBounds) {
    const list = files();
    const index = list.findIndex(file => file.id === current.id);
    const adjacent = index >= 0 ? list[index + direction] : null;
    // GitHub can leave an empty wrapper for the next unmounted diff.
    const entry = current.closest('[data-sticky-enabled]') || current;
    const sibling = direction > 0 ? entry.nextElementSibling : entry.previousElementSibling;
    const placeholder = sibling && !sibling.matches(FILE_SELECTOR) && !sibling.querySelector(FILE_SELECTOR) &&
      (sibling.hasAttribute('data-sticky-enabled') || sibling.hasAttribute('data-estimated-height'));
    if (adjacent && !placeholder) {
      select(adjacent, true);
      return;
    }

    const id = current.id;
    const beforeScroll = window.scrollY;
    const rect = current.isConnected ? entry.getBoundingClientRect() : {
      top: savedBounds.top - beforeScroll,
      bottom: savedBounds.bottom - beforeScroll,
    };
    const boundary = (direction > 0 ? rect.bottom : rect.top) + beforeScroll;
    if (placeholder) {
      sibling.style.scrollMarginTop = `${topOffset(current)}px`;
      sibling.scrollIntoView({ block: 'start', behavior: 'instant' });
    } else {
      // Jump over a large diff instead of scrolling through every line.
      const target = direction > 0 ? boundary - topOffset(current) + 1 : boundary - innerHeight;
      window.scrollTo({ top: Math.max(0, target), behavior: 'instant' });
    }
    if (!placeholder && window.scrollY === beforeScroll) {
      select(current, true);
      return;
    }
    return (async () => {
      const next = await waitForFile(() => {
        if (placeholder && sibling.isConnected) return sibling.querySelector(FILE_SELECTOR);
        const rendered = files();
        const currentIndex = rendered.findIndex(file => file.id === id);
        if (currentIndex >= 0) return rendered[currentIndex + direction];
        // The old file may disappear once its neighbor enters the viewport.
        const candidates = rendered.filter(file => {
          const bounds = file.getBoundingClientRect();
          return file.id !== id && (direction > 0
            ? bounds.top + window.scrollY >= boundary - 1
            : bounds.bottom + window.scrollY <= boundary + 1);
        });
        return direction > 0 ? candidates[0] : candidates.at(-1);
      }, task);
      if (!navigationActive(task)) return;
      if (next) select(next, true);
      else {
        // End of the list or a render timeout: retain selection and scroll position.
        window.scrollTo({ top: beforeScroll, behavior: 'instant' });
        const mounted = files().find(file => file.id === id);
        if (mounted) select(mounted);
      }
    })();
  }

  function navigate(direction, markViewed = false) {
    const task = { location: reviewLocation };
    pendingNavigation = task;
    const run = async () => {
      try {
        // Keep the already-mounted path synchronous for fast repeated j/k.
        const mounted = files().find(file => file.id === selectedId);
        const current = mounted || await restoreCurrent(task);
        if (!current || !navigationActive(task)) return;
        select(current);
        const bounds = (current.closest('[data-sticky-enabled]') || current).getBoundingClientRect();
        const savedBounds = { top: bounds.top + window.scrollY, bottom: bounds.bottom + window.scrollY };
        if (markViewed) {
          const button = viewedButton(current);
          if (!button || button.disabled) return;
          const wasViewed = button.getAttribute('aria-pressed') === 'true';
          button.click();
          if (wasViewed) return;
        }
        // Viewed may replace/collapse the current file before navigation.
        const updated = files().find(file => file.id === current.id) || current;
        const moving = moveFile(updated, direction, task, savedBounds);
        if (moving) await moving;
      } finally {
        if (pendingNavigation === task) pendingNavigation = null;
      }
    };
    void run();
  }

  function accessibleLabel(button) {
    const direct = button.getAttribute('aria-label');
    if (direct) return direct.trim();
    return (button.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
  }

  function viewedButton(file) {
    return [...header(file).querySelectorAll('button[aria-pressed]')].find(button =>
      /^(?:Not Viewed|Viewed|Mark as viewed|Mark as not viewed)$/i.test(accessibleLabel(button))
    );
  }

  function collapseButton(file) {
    return [...header(file).querySelectorAll('button')].find(button =>
      /^(?:Collapse|Expand) file$/i.test(accessibleLabel(button))
    );
  }

  function reviewButton() {
    return [...document.querySelectorAll('button')].find(button =>
      isVisible(button) && /\bSubmit review/i.test(button.textContent)
    );
  }

  function filesChangedLink() {
    const pullRequest = location.pathname.match(/^\/[^/]+\/[^/]+\/pull\/\d+(?=\/|$)/)?.[0];
    if (!pullRequest) return null;
    const paths = new Set([`${pullRequest}/files`, `${pullRequest}/changes`]);
    const links = [...document.querySelectorAll('a[href]')].filter(link =>
      link.origin === location.origin && paths.has(link.pathname.replace(/\/$/, '')) && isVisible(link)
    );
    // Prefer the tab over links to individual diff lines in comments.
    return links.find(link => /\bFiles changed\b/i.test(accessibleLabel(link) || link.textContent)) || links[0];
  }

  function intercept(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onKeyDown(event) {
    resetForNavigation();
    const key = event.shiftKey ? event.key.toLowerCase() : event.key;
    if (!KEYS.has(key) || shouldIgnore(event)) return;
    // This shortcut also works on Conversation, Commits, and Checks, where
    // there are no rendered diff files to navigate yet.
    if (key === 'f') {
      const link = filesChangedLink();
      if (!link) return;
      intercept(event);
      heldKeys.add(event.code || event.key);
      pendingNavigation = null;
      if (!event.repeat && !isReviewPage()) link.click();
      return;
    }
    if (!isReviewPage()) return;
    const list = files();
    if (!list.length && selectedId === null) return;

    // Capture on window before document, React, or GitHub hotkey listeners.
    // Consume repeats too, but only navigation and scrolling repeat their actions.
    intercept(event);
    heldKeys.add(event.code || event.key);
    if (event.shiftKey && (key === 'j' || key === 'k')) {
      pendingNavigation = null;
      const current = list.find(file => file.id === selectedId) || (!selectedId && currentFile(list));
      if (current) select(current);
      window.scrollBy({ top: key === 'j' ? 100 : -100, behavior: 'instant' });
      return;
    }
    if (event.repeat && key !== 'j' && key !== 'k') return;
    if (pendingNavigation) return;

    if (event.key === 'p') {
      const button = reviewButton();
      if (button && !button.disabled) button.click();
      return;
    }

    if (event.key === 'j' || event.key === 'k') {
      if (!selectedId) select(currentFile(list));
      navigate(event.key === 'j' ? 1 : -1);
      return;
    }

    if (event.key === 'x') {
      if (!selectedId) select(currentFile(list));
      navigate(1, true);
    } else if (event.key === ' ') {
      const current = list.find(file => file.id === selectedId) || (!selectedId && currentFile(list));
      if (!current) return;
      select(current);
      const button = collapseButton(current);
      if (button && !button.disabled) button.click();
    }
  }

  window.addEventListener('keydown', onKeyDown, true);
  // Some shortcuts listen to keypress/keyup. Keep ownership of the whole
  // keystroke even if clicking p moved focus into the review dialog.
  for (const type of ['keypress', 'keyup']) {
    window.addEventListener(type, event => {
      const key = event.code || event.key;
      if (!heldKeys.has(key)) return;
      intercept(event);
      if (type === 'keyup') heldKeys.delete(key);
    }, true);
  }
  window.addEventListener('blur', () => heldKeys.clear());
  window.addEventListener('pointerdown', event => {
    pendingNavigation = null;
    const file = event.target instanceof Element ? event.target.closest(FILE_SELECTOR) : null;
    if (file) {
      resetForNavigation();
      select(file);
    }
  }, true);
  for (const type of ['wheel', 'touchmove']) {
    // Manual scrolling cancels an in-flight jump, but preserves the selection.
    window.addEventListener(type, () => { pendingNavigation = null; }, { passive: true });
  }
  // React may replace a file element and drop our marker while keeping its ID.
  const pageDocument = document;
  new MutationObserver(() => {
    if (!pageDocument.defaultView?.document) return;
    resetForNavigation();
    const selected = selectedId && document.getElementById(selectedId);
    if (selected?.matches(FILE_SELECTOR)) selected.setAttribute('data-review-vikeys-selected', '');
  }).observe(document, { childList: true, subtree: true });
})();
