// Service worker: owns the Bluesky session and talks to the Bluesky API.
// The X page (content.js) only ever receives simplified post data, never tokens.

const SERVICE = 'https://bsky.social';
const IMAGE_HOSTS = new Set(['cdn.bsky.app', 'video.bsky.app']);
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const PAGE_SIZE = 50;

// Keep the stored session out of reach of content scripts.
chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });

function coded(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

async function call(nsid, { method = 'GET', params, body, token } = {}) {
  const url = new URL(`${SERVICE}/xrpc/${nsid}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = coded(data.error || `HTTP_${res.status}`, data.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---- session ----

async function loadSession() {
  const { session } = await chrome.storage.local.get('session');
  return session || null;
}

async function saveSession(data) {
  const session = {
    did: data.did,
    handle: data.handle,
    accessJwt: data.accessJwt,
    refreshJwt: data.refreshJwt,
  };
  await chrome.storage.local.set({ session });
  return session;
}

// A bare username means a bsky.social handle; full handles, emails and DIDs pass through.
function normalizeIdentifier(raw) {
  const id = String(raw || '').trim().replace(/^@/, '');
  if (id && !id.includes('.') && !id.includes('@') && !id.startsWith('did:')) return `${id}.bsky.social`;
  return id;
}

// The app password is used once to create a session and is never stored.
async function login(identifier, password) {
  // Refuse anything that is not an App Password, so the main account password
  // is never sent from here.
  if (!/^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/i.test(password)) {
    throw coded('NOT_APP_PASSWORD', 'That is not an App Password (xxxx-xxxx-xxxx-xxxx). Do not enter your Bluesky password here.');
  }
  const data = await call('com.atproto.server.createSession', {
    method: 'POST',
    body: { identifier: normalizeIdentifier(identifier), password },
  });
  return saveSession(data);
}

let refreshing = null;
function refreshSession(stale) {
  // Refresh tokens are single-use, so concurrent callers share one refresh.
  refreshing ??= (async () => {
    try {
      const data = await call('com.atproto.server.refreshSession', {
        method: 'POST',
        token: stale.refreshJwt,
      });
      return await saveSession(data);
    } catch (err) {
      if (err.status === 400 || err.status === 401) {
        await chrome.storage.local.remove('session');
        throw coded('NOT_LOGGED_IN', 'Bluesky session expired. Log in again from the extension popup.');
      }
      throw err;
    }
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function authed(nsid, opts = {}) {
  let session = await loadSession();
  if (!session) throw coded('NOT_LOGGED_IN', 'Not logged in to Bluesky. Open the extension popup to log in.');
  try {
    return await call(nsid, { ...opts, token: session.accessJwt });
  } catch (err) {
    if (err.code !== 'ExpiredToken' && err.status !== 401) throw err;
    session = await refreshSession(session);
    return call(nsid, { ...opts, token: session.accessJwt });
  }
}

// ---- timeline ----

function simplifyAuthor(a = {}) {
  return {
    did: a.did,
    handle: a.handle,
    displayName: a.displayName || a.handle,
    avatar: a.avatar || null,
  };
}

function postUrl(author, uri) {
  const actor = author.handle && author.handle !== 'handle.invalid' ? author.handle : author.did;
  return `https://bsky.app/profile/${actor}/post/${uri.split('/').pop()}`;
}

function simplifyMedia(embed) {
  switch (embed?.$type) {
    case 'app.bsky.embed.images#view':
      return {
        type: 'images',
        images: (embed.images || []).map((i) => ({ thumb: i.thumb, alt: i.alt || '', aspectRatio: i.aspectRatio || null })),
      };
    case 'app.bsky.embed.video#view':
      return { type: 'video', thumb: embed.thumbnail || null, aspectRatio: embed.aspectRatio || null };
    case 'app.bsky.embed.external#view': {
      const e = embed.external || {};
      return { type: 'external', uri: e.uri, title: e.title || '', description: e.description || '', thumb: e.thumb || null };
    }
    default:
      return null;
  }
}

function simplifyQuote(view) {
  if (view?.$type !== 'app.bsky.embed.record#viewRecord') return null;
  const author = simplifyAuthor(view.author);
  return { author, text: view.value?.text || '', url: postUrl(author, view.uri) };
}

function simplifyEmbed(embed) {
  switch (embed?.$type) {
    case 'app.bsky.embed.record#view':
      return { media: null, quote: simplifyQuote(embed.record) };
    case 'app.bsky.embed.recordWithMedia#view':
      return { media: simplifyMedia(embed.media), quote: simplifyQuote(embed.record?.record) };
    default:
      return { media: simplifyMedia(embed), quote: null };
  }
}

function simplifyFeedItem(item) {
  const post = item.post;
  const record = post.record || {};
  const isRepost = item.reason?.$type === 'app.bsky.feed.defs#reasonRepost';
  // Position in the timeline: repost time for reposts, otherwise the post's own
  // time (createdAt is client-supplied, so never trust it beyond indexedAt).
  const times = (isRepost ? [item.reason.indexedAt] : [record.createdAt, post.indexedAt])
    .map((t) => Date.parse(t))
    .filter(Number.isFinite);
  if (!times.length) return null;
  const author = simplifyAuthor(post.author);
  return {
    uri: post.uri,
    cid: post.cid,
    sortAt: Math.min(...times),
    url: postUrl(author, post.uri),
    author,
    text: record.text || '',
    facets: record.facets || [],
    replyTo: item.reply?.parent?.author?.handle || null,
    replyRoot: record.reply?.root ? { uri: record.reply.root.uri, cid: record.reply.root.cid } : null,
    viewer: { like: post.viewer?.like || null, repost: post.viewer?.repost || null },
    repostedBy: isRepost ? simplifyAuthor(item.reason.by) : null,
    embed: simplifyEmbed(post.embed),
    counts: { reply: post.replyCount || 0, repost: post.repostCount || 0, like: post.likeCount || 0 },
  };
}

async function getTimeline(cursor) {
  const data = await authed('app.bsky.feed.getTimeline', { params: { limit: PAGE_SIZE, cursor } });
  return {
    posts: (data.feed || []).map(simplifyFeedItem).filter(Boolean),
    cursor: data.cursor || null,
  };
}

// ---- interactions ----

const LIKE = 'app.bsky.feed.like';
const REPOST = 'app.bsky.feed.repost';
const POST = 'app.bsky.feed.post';
const MAX_POST_GRAPHEMES = 300;

async function requireSession() {
  const session = await loadSession();
  if (!session) throw coded('NOT_LOGGED_IN', 'Not logged in to Bluesky. Open the extension popup to log in.');
  return session;
}

function strongRef(ref) {
  if (typeof ref?.uri !== 'string' || !ref.uri.startsWith('at://') || typeof ref?.cid !== 'string') {
    throw coded('BAD_POST_REF');
  }
  return { uri: ref.uri, cid: ref.cid };
}

async function createRecord(collection, record) {
  const { did } = await requireSession();
  const data = await authed('com.atproto.repo.createRecord', {
    method: 'POST',
    body: {
      repo: did,
      collection,
      record: { $type: collection, ...record, createdAt: new Date().toISOString() },
    },
  });
  return { uri: data.uri, cid: data.cid };
}

// Only deletes the user's own record of the expected kind (a like or a repost).
async function deleteRecord(collection, recordUri) {
  const { did } = await requireSession();
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(recordUri || '');
  if (!m || m[1] !== did || m[2] !== collection) throw coded('BAD_RECORD_URI');
  await authed('com.atproto.repo.deleteRecord', {
    method: 'POST',
    body: { repo: did, collection, rkey: m[3] },
  });
  return {};
}

// Bluesky accepts likes, reposts and replies that point at a deleted post, so
// check that the target still exists before writing.
async function ensurePostExists(uri) {
  const data = await authed('app.bsky.feed.getPosts', { params: { uris: uri } });
  if (!data.posts?.length) throw coded('POST_NOT_FOUND', 'This post no longer exists on Bluesky.');
}

async function interact(collection, msg) {
  const subject = strongRef(msg);
  await ensurePostExists(subject.uri);
  return createRecord(collection, { subject });
}

// Makes URLs in a reply clickable (facet ranges are UTF-8 byte offsets).
function linkFacets(text) {
  const encoder = new TextEncoder();
  const facets = [];
  for (const m of text.matchAll(/https?:\/\/[^\s]+/g)) {
    const uri = m[0].replace(/[.,;:!?)\]]+$/, '');
    const byteStart = encoder.encode(text.slice(0, m.index)).length;
    facets.push({
      index: { byteStart, byteEnd: byteStart + encoder.encode(uri).length },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
    });
  }
  return facets;
}

async function reply(msg) {
  const text = String(msg.text || '').trim();
  const length = [...new Intl.Segmenter().segment(text)].length;
  if (!text) throw coded('EMPTY_REPLY', 'Reply is empty.');
  if (length > MAX_POST_GRAPHEMES) throw coded('REPLY_TOO_LONG', `Reply is longer than ${MAX_POST_GRAPHEMES} characters.`);
  const record = { text, reply: { root: strongRef(msg.root), parent: strongRef(msg.parent) } };
  await ensurePostExists(record.reply.parent.uri);
  const facets = linkFacets(text);
  if (facets.length) record.facets = facets;
  return createRecord(POST, record);
}

// ---- images ----
// x.com's CSP blocks images from Bluesky's CDN, so they are fetched here and
// handed to the page as data: URLs.

async function fetchImage(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || !IMAGE_HOSTS.has(url.hostname)) throw coded('BAD_IMAGE_URL');
  const res = await fetch(url);
  if (!res.ok) throw coded(`HTTP_${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw coded('IMAGE_TOO_LARGE');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
  return `data:${type};base64,${btoa(binary)}`;
}

// ---- messages ----

const handlers = {
  'bskyx:getTimeline': (msg) => getTimeline(msg.cursor || undefined),
  'bskyx:image': async (msg) => ({ dataUrl: await fetchImage(msg.url) }),
  'bskyx:like': (msg) => interact(LIKE, msg),
  'bskyx:unlike': (msg) => deleteRecord(LIKE, msg.recordUri),
  'bskyx:repost': (msg) => interact(REPOST, msg),
  'bskyx:unrepost': (msg) => deleteRecord(REPOST, msg.recordUri),
  'bskyx:reply': reply,
  'bskyx:status': async () => {
    const session = await loadSession();
    return { loggedIn: !!session, handle: session?.handle || null };
  },
  'bskyx:login': async (msg) => {
    const session = await login(msg.identifier, String(msg.password || '').trim());
    return { handle: session.handle };
  },
  'bskyx:logout': async () => {
    await chrome.storage.local.remove('session');
    return {};
  },
};

// Only extension pages (the popup) may change the session.
const PRIVILEGED = new Set(['bskyx:login', 'bskyx:logout']);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler || sender.id !== chrome.runtime.id) return;
  if (PRIVILEGED.has(msg.type) && sender.tab) return;
  Promise.resolve().then(() => handler(msg)).then(
    (result) => sendResponse({ ok: true, ...result }),
    (err) => sendResponse({ ok: false, error: err.code || 'ERROR', message: err.message }),
  );
  return true;
});
