// Content script: runs on x.com, reads the home timeline and inserts Bluesky
// posts (fetched by background.js) at their chronological positions.
(() => {
  'use strict';

  console.log('BlueXky extension loaded');

  const { computePlacements } = globalThis.BskyxMerge;

  const HOME_PATH = '/home';
  const MAX_PER_ANCHOR = 3; // more than this between two tweets collapses behind "Show more"
  const MAX_PAGES = 30; // Bluesky pages per page load
  const FETCH_GAP_MS = 1500;
  const HEAD_REFRESH_MS = 120000;
  const RETRY_MS = 15000;
  const SCAN_DEBOUNCE_MS = 150;
  const IMAGE_CACHE_MAX = 300;

  const xTweets = new Map(); // tweet id -> { id, time }
  const posts = new Map(); // bsky uri -> post
  const placements = new Map(); // bsky uri -> { anchorId, pos }
  const byAnchor = new Map(); // tweet id -> { before: [uri], after: [uri] }
  const expanded = new Set(); // `${anchorId}|${pos}` groups the user expanded
  const imageCache = new Map(); // url -> Promise<dataUrl>
  const drafts = new Map(); // bsky uri -> reply text, for cards with an open composer
  const PENDING = 'pending'; // like/repost sent, record uri not known yet
  const MAX_REPLY_LENGTH = 300;

  let cursor;
  let exhausted = false;
  let oldestBsky = null;
  let fetching = false;
  let pagesFetched = 0;
  let lastFetchAt = 0;
  let blockedUntil = 0;
  let activeTab = null;
  let scanTimer = null;
  let dead = false;
  let warned = false;

  // ---- messaging ----

  async function send(msg) {
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch (err) {
      // Extension was reloaded/removed; this script instance is orphaned.
      if (!chrome.runtime?.id) shutdown();
      return { ok: false, error: 'SEND_FAILED', message: String(err?.message || err) };
    }
  }

  function shutdown() {
    dead = true;
    observer.disconnect();
    clearInterval(headTimer);
    clearTimeout(scanTimer);
  }

  // ---- Bluesky data ----

  async function fetchPage(head) {
    if (fetching || dead || Date.now() < blockedUntil) return;
    fetching = true;
    try {
      const res = await send({ type: 'bskyx:getTimeline', cursor: head ? undefined : cursor });
      if (!res?.ok) {
        blockedUntil = Date.now() + RETRY_MS;
        if (!warned) {
          warned = true;
          console.warn('[BlueXky]', res?.message || res?.error || 'timeline request failed');
        }
        return;
      }
      warned = false;
      for (const post of res.posts) {
        if (!posts.has(post.uri)) posts.set(post.uri, post);
        if (oldestBsky === null || post.sortAt < oldestBsky) oldestBsky = post.sortAt;
      }
      if (!head) {
        cursor = res.cursor || undefined;
        exhausted = !res.cursor;
        pagesFetched++;
      }
    } finally {
      fetching = false;
      lastFetchAt = Date.now();
    }
    schedule();
  }

  // Keep paging Bluesky until it reaches as far back as the loaded X timeline.
  function maybeFetch() {
    if (fetching || exhausted || pagesFetched >= MAX_PAGES || !xTweets.size) return;
    let oldestX = Infinity;
    for (const t of xTweets.values()) if (t.time < oldestX) oldestX = t.time;
    if (oldestBsky !== null && oldestBsky <= oldestX) return;
    const wait = Math.max(lastFetchAt + FETCH_GAP_MS, blockedUntil) - Date.now();
    if (wait > 0) setTimeout(schedule, wait);
    else fetchPage(false);
  }

  // ---- X timeline ----

  function readTweet(article) {
    const cell = article.closest('[data-testid="cellInnerDiv"]');
    // The tweet's own timestamp is a permalink; a quoted tweet's is not.
    const timeEl = article.querySelector('a[href*="/status/"] time[datetime]');
    if (!cell || !timeEl) return null; // ads have no timestamp
    const id = timeEl.closest('a').getAttribute('href').match(/\/status\/(\d+)/)?.[1];
    const time = Date.parse(timeEl.getAttribute('datetime'));
    if (!id || !Number.isFinite(time)) return null;
    // Reposts, "X liked", pinned etc. show the original post's time, which is
    // out of timeline order, so they are not used as time references.
    const anchorable = !article.querySelector('[data-testid="socialContext"]');
    return { id, time, cell, anchorable };
  }

  function resetPlacement() {
    xTweets.clear();
    placements.clear();
    byAnchor.clear();
    expanded.clear();
    for (const el of document.querySelectorAll('.bskyx-group')) el.remove();
  }

  // "For you" and "Following" are different timelines; start over on switch.
  function checkTab(column) {
    const tab = column.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]');
    if (!tab) return;
    const name = tab.textContent.trim();
    if (activeTab !== null && name !== activeTab) resetPlacement();
    activeTab = name;
  }

  function place() {
    const unplaced = [];
    for (const post of posts.values()) if (!placements.has(post.uri)) unplaced.push(post);
    if (!unplaced.length) return;
    // Placements are final once made, so cards never jump around while reading.
    for (const p of computePlacements([...xTweets.values()], unplaced)) {
      placements.set(p.uri, p);
      let groups = byAnchor.get(p.anchorId);
      if (!groups) byAnchor.set(p.anchorId, (groups = { before: [], after: [] }));
      groups[p.pos].push(p.uri);
      groups[p.pos].sort((a, b) => posts.get(b).sortAt - posts.get(a).sortAt);
    }
  }

  function render(column, tweets) {
    const live = new Set();
    for (const { id, cell } of tweets) {
      const groups = byAnchor.get(id);
      if (!groups) continue;
      for (const pos of ['before', 'after']) {
        const uris = groups[pos];
        if (!uris.length) continue;
        const isExpanded = expanded.has(`${id}|${pos}`);
        const key = `${id}|${pos}|${isExpanded}|${uris.join(',')}`;
        let el = cell.querySelector(`:scope > .bskyx-group[data-pos="${pos}"]`);
        if (el && el.dataset.key !== key) {
          el.remove();
          el = null;
        }
        if (!el) {
          el = buildGroup(id, pos, uris, isExpanded);
          el.dataset.key = key;
          if (pos === 'before') cell.prepend(el);
          else cell.append(el);
        }
        live.add(el);
      }
    }
    // X recycles timeline cells; drop groups left behind on the wrong tweet.
    for (const el of column.querySelectorAll('.bskyx-group')) if (!live.has(el)) el.remove();
  }

  function scan() {
    scanTimer = null;
    if (dead || location.pathname !== HOME_PATH) return;
    const column = document.querySelector('[data-testid="primaryColumn"]');
    if (!column) return;
    checkTab(column);
    const tweets = [];
    for (const article of column.querySelectorAll('article[data-testid="tweet"]')) {
      const tweet = readTweet(article);
      if (!tweet || !tweet.anchorable) continue;
      tweets.push(tweet);
      if (!xTweets.has(tweet.id)) xTweets.set(tweet.id, { id: tweet.id, time: tweet.time });
    }
    place();
    render(column, tweets);
    maybeFetch();
  }

  function schedule() {
    if (dead || scanTimer !== null) return;
    scanTimer = setTimeout(scan, SCAN_DEBOUNCE_MS);
  }

  // ---- rendering ----

  function h(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function safeHref(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
    } catch {
      return null;
    }
  }

  function link(href, className, text) {
    const a = h('a', className, text);
    const safe = safeHref(href);
    if (safe) {
      a.href = safe;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    return a;
  }

  function loadImage(img, url) {
    if (!url) return;
    let pending = imageCache.get(url);
    if (!pending) {
      pending = send({ type: 'bskyx:image', url }).then((res) => (res?.ok ? res.dataUrl : null));
      imageCache.set(url, pending);
      if (imageCache.size > IMAGE_CACHE_MAX) imageCache.delete(imageCache.keys().next().value);
    }
    pending.then((dataUrl) => {
      if (dataUrl) img.src = dataUrl;
      else imageCache.delete(url);
    });
  }

  function relativeTime(ms) {
    const diff = Math.max(0, Date.now() - ms);
    if (diff < 60e3) return 'now';
    if (diff < 3600e3) return `${Math.floor(diff / 60e3)}m`;
    if (diff < 86400e3) return `${Math.floor(diff / 3600e3)}h`;
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function compact(n) {
    return n ? new Intl.NumberFormat(undefined, { notation: 'compact' }).format(n) : '';
  }

  function facetHref(feature) {
    switch (feature?.$type) {
      case 'app.bsky.richtext.facet#link':
        return feature.uri;
      case 'app.bsky.richtext.facet#mention':
        return `https://bsky.app/profile/${feature.did}`;
      case 'app.bsky.richtext.facet#tag':
        return `https://bsky.app/hashtag/${encodeURIComponent(feature.tag)}`;
      default:
        return null;
    }
  }

  // Facet ranges are UTF-8 byte offsets into the post text.
  function renderText(text, facets) {
    const frag = document.createDocumentFragment();
    if (!facets?.length) {
      frag.append(text);
      return frag;
    }
    const bytes = new TextEncoder().encode(text);
    const decoder = new TextDecoder();
    const sorted = [...facets].sort((a, b) => a.index.byteStart - b.index.byteStart);
    let pos = 0;
    for (const facet of sorted) {
      const { byteStart, byteEnd } = facet.index || {};
      const href = safeHref(facetHref(facet.features?.[0]));
      if (!href || !(byteStart >= pos) || !(byteEnd > byteStart) || byteEnd > bytes.length) continue;
      frag.append(decoder.decode(bytes.slice(pos, byteStart)));
      frag.append(link(href, 'bskyx-link', decoder.decode(bytes.slice(byteStart, byteEnd))));
      pos = byteEnd;
    }
    frag.append(decoder.decode(bytes.slice(pos)));
    return frag;
  }

  function buildMedia(media, postHref) {
    if (media.type === 'images') {
      const grid = h('div', `bskyx-images bskyx-images-${Math.min(media.images.length, 4)}`);
      for (const image of media.images.slice(0, 4)) {
        const a = link(postHref, 'bskyx-image');
        const img = h('img');
        img.alt = image.alt;
        if (media.images.length === 1 && image.aspectRatio?.width && image.aspectRatio?.height) {
          img.style.aspectRatio = `${image.aspectRatio.width} / ${image.aspectRatio.height}`;
        }
        loadImage(img, image.thumb);
        a.append(img);
        grid.append(a);
      }
      return grid;
    }
    if (media.type === 'video') {
      const a = link(postHref, 'bskyx-video');
      const img = h('img');
      img.alt = 'Video';
      if (media.aspectRatio?.width && media.aspectRatio?.height) {
        img.style.aspectRatio = `${media.aspectRatio.width} / ${media.aspectRatio.height}`;
      }
      loadImage(img, media.thumb);
      a.append(img, h('span', 'bskyx-play', '▶ Watch on Bluesky'));
      return a;
    }
    if (media.type === 'external') {
      const a = link(media.uri, 'bskyx-external');
      if (media.thumb) {
        const img = h('img');
        img.alt = '';
        loadImage(img, media.thumb);
        a.append(img);
      }
      const info = h('div', 'bskyx-external-info');
      let host = '';
      try {
        host = new URL(media.uri).hostname;
      } catch {}
      info.append(h('div', 'bskyx-external-title', media.title || media.uri), h('div', 'bskyx-muted', host));
      a.append(info);
      return a;
    }
    return null;
  }

  function buildQuote(quote) {
    const a = link(quote.url, 'bskyx-quote');
    const head = h('div', 'bskyx-quote-head');
    head.append(h('span', 'bskyx-name', quote.author.displayName), h('span', 'bskyx-muted', `@${quote.author.handle}`));
    a.append(head, h('div', 'bskyx-text', quote.text));
    return a;
  }

  // Outline icons (24x24, drawn with strokes) for the action buttons.
  // From Lucide (https://lucide.dev), ISC License; see THIRD_PARTY_NOTICES.md.
  const ICONS = {
    reply: ['M7.9 20A9 9 0 1 0 4 16.1L2 22Z'],
    repost: ['m2 9 3-3 3 3', 'M13 18H7a2 2 0 0 1-2-2V6', 'm22 15-3 3-3-3', 'M11 6h6a2 2 0 0 1 2 2v10'],
    like: ['M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'],
  };
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of ICONS[name]) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
  }

  function actionButton(kind, label) {
    const button = h('button', `bskyx-action bskyx-${kind}-btn`);
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.count = h('span', 'bskyx-count');
    button.append(icon(kind), button.count);
    return button;
  }

  // Like / repost / reply act on Bluesky through background.js.
  function buildActions(post, body) {
    const bar = h('div', 'bskyx-actions');
    const reply = actionButton('reply', 'Reply on Bluesky');
    const repost = actionButton('repost', 'Repost on Bluesky');
    const like = actionButton('like', 'Like on Bluesky');

    const paint = () => {
      reply.count.textContent = compact(post.counts.reply);
      repost.count.textContent = compact(post.counts.repost);
      repost.classList.toggle('bskyx-on', !!post.viewer.repost);
      like.count.textContent = compact(post.counts.like);
      like.classList.toggle('bskyx-on', !!post.viewer.like);
    };

    // viewer[kind] holds the uri of the user's like/repost record, if any.
    // isTrusted: only real user clicks count, not ones synthesized by the page.
    const toggle = (kind, button) => async (e) => {
      const existing = post.viewer[kind];
      if (!e.isTrusted || button.disabled || existing === PENDING) return;
      button.disabled = true;
      post.viewer[kind] = existing ? null : PENDING;
      post.counts[kind] += existing ? -1 : 1;
      paint();
      const res = existing
        ? await send({ type: `bskyx:un${kind}`, recordUri: existing })
        : await send({ type: `bskyx:${kind}`, uri: post.uri, cid: post.cid });
      if (res?.ok) {
        post.viewer[kind] = existing ? null : res.uri;
      } else {
        post.viewer[kind] = existing;
        post.counts[kind] += existing ? 1 : -1;
        if (res?.error === 'POST_NOT_FOUND') post.deleted = true;
        console.warn('[BlueXky]', `${kind} failed:`, res?.message || res?.error);
      }
      button.disabled = false;
      paint();
      if (post.deleted) markDeleted(bar.closest('.bskyx-card'));
    };

    like.addEventListener('click', toggle('like', like));
    repost.addEventListener('click', toggle('repost', repost));
    reply.addEventListener('click', () => {
      let composer = body.querySelector('.bskyx-composer');
      if (!composer) {
        drafts.set(post.uri, drafts.get(post.uri) || '');
        composer = buildComposer(post, paint);
        body.append(composer);
      }
      composer.querySelector('textarea').focus();
    });

    paint();
    bar.append(reply, repost, like);
    return bar;
  }

  function graphemes(text) {
    return [...new Intl.Segmenter().segment(text)].length;
  }

  function buildComposer(post, onSent) {
    const box = h('div', 'bskyx-composer');
    const input = h('textarea', 'bskyx-input');
    input.rows = 2;
    input.placeholder = `Reply to @${post.author.handle} on Bluesky`;
    input.value = drafts.get(post.uri) || '';
    const foot = h('div', 'bskyx-composer-foot');
    const note = h('span', 'bskyx-muted bskyx-note');
    const cancel = h('button', 'bskyx-btn bskyx-btn-plain', 'Cancel');
    const submit = h('button', 'bskyx-btn', 'Reply');
    cancel.type = submit.type = 'button';

    const update = () => {
      const count = graphemes(input.value.trim());
      note.textContent = `${count}/${MAX_REPLY_LENGTH}`;
      note.classList.toggle('bskyx-error', count > MAX_REPLY_LENGTH);
      submit.disabled = !count || count > MAX_REPLY_LENGTH;
    };

    input.addEventListener('input', () => {
      drafts.set(post.uri, input.value);
      update();
    });
    cancel.addEventListener('click', () => {
      drafts.delete(post.uri);
      box.remove();
    });
    submit.addEventListener('click', async (e) => {
      if (!e.isTrusted) return;
      submit.disabled = input.disabled = true;
      const res = await send({
        type: 'bskyx:reply',
        text: input.value,
        parent: { uri: post.uri, cid: post.cid },
        root: post.replyRoot || { uri: post.uri, cid: post.cid },
      });
      if (res?.ok) {
        drafts.delete(post.uri);
        post.counts.reply++;
        box.remove();
        onSent?.();
        return;
      }
      if (res?.error === 'POST_NOT_FOUND') {
        post.deleted = true;
        drafts.delete(post.uri);
        markDeleted(box.closest('.bskyx-card'));
        return;
      }
      input.disabled = false;
      update();
      note.textContent = res?.message || res?.error || 'Reply failed';
      note.classList.add('bskyx-error');
    });

    update();
    foot.append(note, cancel, submit);
    box.append(input, foot);
    return box;
  }

  // The post turned out to be gone from Bluesky when the user acted on it.
  function markDeleted(card) {
    if (!card || card.classList.contains('bskyx-deleted')) return;
    card.classList.add('bskyx-deleted');
    for (const button of card.querySelectorAll('.bskyx-action')) button.disabled = true;
    card.querySelector('.bskyx-composer')?.remove();
    card.querySelector('.bskyx-body').append(h('div', 'bskyx-muted bskyx-deleted-note', 'This post was deleted on Bluesky.'));
  }

  function buildCard(post) {
    const card = h('article', 'bskyx-card');
    card.dataset.uri = post.uri;
    // Like a tweet on X: clicking the card itself opens the post (on Bluesky).
    card.addEventListener('click', (e) => {
      if (e.target.closest('a, button, .bskyx-composer') || String(getSelection())) return;
      window.open(post.url, '_blank', 'noopener');
    });

    if (post.repostedBy) {
      card.append(h('div', 'bskyx-context', `Reposted by ${post.repostedBy.displayName}`));
    }

    const row = h('div', 'bskyx-row');
    const avatar = h('img', 'bskyx-avatar');
    avatar.alt = '';
    if (post.author.avatar) loadImage(avatar, post.author.avatar.replace('/img/avatar/', '/img/avatar_thumbnail/'));

    const body = h('div', 'bskyx-body');
    const head = h('div', 'bskyx-head');
    const time = link(post.url, 'bskyx-muted bskyx-time', relativeTime(post.sortAt));
    time.title = new Date(post.sortAt).toLocaleString();
    head.append(
      h('span', 'bskyx-name', post.author.displayName),
      h('span', 'bskyx-muted bskyx-handle', `@${post.author.handle}`),
      h('span', 'bskyx-muted', '·'),
      time,
      h('span', 'bskyx-badge', 'Bluesky'),
    );
    body.append(head);

    if (post.replyTo) body.append(h('div', 'bskyx-muted bskyx-reply', `Replying to @${post.replyTo}`));
    if (post.text) {
      const text = h('div', 'bskyx-text');
      text.append(renderText(post.text, post.facets));
      body.append(text);
    }
    if (post.embed?.media) {
      const media = buildMedia(post.embed.media, post.url);
      if (media) body.append(media);
    }
    if (post.embed?.quote) body.append(buildQuote(post.embed.quote));

    body.append(buildActions(post, body));
    if (drafts.has(post.uri)) body.append(buildComposer(post));

    row.append(avatar, body);
    card.append(row);
    if (post.deleted) markDeleted(card);
    return card;
  }

  function isDarkTheme() {
    const rgb = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
    if (!rgb) return false;
    return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] < 128;
  }

  function buildGroup(anchorId, pos, uris, isExpanded) {
    const group = h('div', `bskyx-group ${isDarkTheme() ? 'bskyx-dark' : 'bskyx-light'}`);
    group.dataset.pos = pos;
    group.dataset.anchor = anchorId;
    // Keep clicks on Bluesky cards away from X's own handlers.
    // (and typing in the reply box away from X's keyboard shortcuts).
    for (const type of ['click', 'keydown', 'keypress', 'keyup']) {
      group.addEventListener(type, (e) => e.stopPropagation());
    }

    const shown = isExpanded ? uris : uris.slice(0, MAX_PER_ANCHOR);
    for (const uri of shown) group.append(buildCard(posts.get(uri)));

    const hidden = uris.length - shown.length;
    if (hidden > 0) {
      const more = h('button', 'bskyx-more', `Show ${hidden} more Bluesky post${hidden === 1 ? '' : 's'}`);
      more.type = 'button';
      more.addEventListener('click', () => {
        expanded.add(`${anchorId}|${pos}`);
        schedule();
      });
      group.append(more);
    }
    return group;
  }

  // ---- start ----

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Pick up new Bluesky posts at the top of the timeline.
  const headTimer = setInterval(() => {
    if (location.pathname === HOME_PATH && document.visibilityState === 'visible' && posts.size) fetchPage(true);
  }, HEAD_REFRESH_MS);

  schedule();
})();
