// Pure chronological matching between X tweets and Bluesky posts.
// Loaded before content.js; no DOM or chrome.* access so it can run in Node too.
(() => {
  'use strict';

  // xTweets: [{ id, time }]   posts: [{ uri, sortAt }]   (times in ms)
  // Returns [{ uri, anchorId, pos }] for every post that can be placed now:
  //   - 'after' the oldest tweet that is newer than (or as old as) the post, or
  //   - 'before' the newest tweet when the post is newer than every tweet.
  // Posts older than the oldest loaded tweet are left out; they get placed once
  // X has loaded that far back.
  function computePlacements(xTweets, posts) {
    if (!xTweets.length) return [];
    const sorted = [...xTweets].sort((a, b) => a.time - b.time);
    const oldest = sorted[0].time;
    const out = [];
    for (const post of posts) {
      if (post.sortAt < oldest) continue;
      let lo = 0;
      let hi = sorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid].time >= post.sortAt) hi = mid;
        else lo = mid + 1;
      }
      if (lo < sorted.length) out.push({ uri: post.uri, anchorId: sorted[lo].id, pos: 'after' });
      else out.push({ uri: post.uri, anchorId: sorted[sorted.length - 1].id, pos: 'before' });
    }
    return out;
  }

  globalThis.BskyxMerge = { computePlacements };
})();
