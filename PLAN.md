# Bluesky-on-X Chrome Extension — Project Handoff

## Goal

Build a Chrome extension that works only on `x.com`, specifically on the main timeline/home flow.

The extension will combine Bluesky timeline posts with the X timeline so that Bluesky posts appear inline among X posts.

The intended behavior is:

```text
X post
X post
Bluesky post
X post
Bluesky post
X post
```

The Bluesky posts should be inserted into the X timeline according to the corresponding time range rather than by polling individual Bluesky accounts.

The extension should be inactive on unrelated websites.

---

## What has already been established

The Bluesky API can provide the authenticated user's home timeline directly.

There is no need to:

- inspect every followed Bluesky account individually
- poll every account for new posts
- reconstruct the user's following feed manually

The API endpoint being used is:

```text
app.bsky.feed.getTimeline
```

Authentication was tested successfully using:

```text
com.atproto.server.createSession
```

with a Bluesky App Password.

The authentication call successfully returned a session containing an `accessJwt`.

That `accessJwt` was then successfully used to call:

```text
https://bsky.social/xrpc/app.bsky.feed.getTimeline
```

The API successfully returned the Bluesky home timeline.

The returned timeline also includes pagination information such as:

```text
cursor
startCursor
```

Example observed values:

```text
cursor:      2026-10-04T12:04:51.759Z
startCursor: 2026-10-05T09:59:42.144Z
```

So reading and paginating the Bluesky timeline is already confirmed to work.

---

## Current Bluesky test flow

Current working concept:

```text
Bluesky account
    ↓
App Password
    ↓
POST com.atproto.server.createSession
    ↓
accessJwt
    ↓
GET app.bsky.feed.getTimeline
    ↓
Bluesky timeline JSON
```

PowerShell was also used successfully to inspect the returned JSON.

---

## Chrome extension direction

The next stage is creating the Chrome extension itself.

The basic extension structure will initially be:

```text
BskyOnX/
    manifest.json
    content.js
```

The extension will use Chrome Manifest V3.

`manifest.json` will restrict the extension's content script to:

```text
https://x.com/*
```

The first milestone is simply proving that `content.js` runs on X.

For example:

```javascript
console.log("Bluesky on X extension loaded");
```

The extension can then be loaded through:

```text
chrome://extensions
→ Developer mode
→ Load unpacked
```

Once that works, the extension can start interacting with X's main timeline DOM.

---

## Intended architecture

The eventual extension should roughly have:

```text
Chrome Extension
│
├── manifest.json
│
├── content.js
│
└── background.js
```

Responsibilities:

```text
content.js
    ↓
Runs on x.com
Reads X timeline
Determines currently visible / relevant timeline time range
Inserts Bluesky posts into the X timeline

background.js
    ↓
Handles Bluesky authentication/session
Calls Bluesky API
Retrieves Bluesky timeline pages
Returns Bluesky posts to content.js
```

The Bluesky credentials/session should not be embedded directly in the X page.

---

## Main timeline behavior

The core feature should work based on timeline timestamps.

Example:

```text
X timeline currently contains:

10:42
10:38
10:31
10:24
10:18
```

The extension should fetch/read the corresponding Bluesky timeline range and find Bluesky posts that fall into that time interval.

For example:

```text
Bluesky:

10:40
10:35
10:22
```

The resulting combined timeline should conceptually become:

```text
10:42 X
10:40 Bluesky
10:38 X
10:35 Bluesky
10:31 X
10:24 X
10:22 Bluesky
10:18 X
```

The main idea is therefore:

```text
X visible timeline time range
        ↓
Determine relevant Bluesky timeline range
        ↓
Read Bluesky timeline pages as needed
        ↓
Match posts chronologically
        ↓
Insert Bluesky posts into X timeline
```

The Bluesky timeline itself remains the source of truth. The extension should not independently watch each followed Bluesky account.

---

## Initial feature target

Version 1 should do only the following:

1. Run on `x.com`.
2. Detect the X main/home timeline.
3. Read timestamps/posts from the X timeline.
4. Retrieve the authenticated user's Bluesky home timeline.
5. Retrieve additional Bluesky timeline pages using the cursor when necessary.
6. Determine which Bluesky posts correspond to the currently loaded X timeline time range.
7. Insert those Bluesky posts into the X flow in chronological positions.
8. Avoid inserting the same Bluesky post more than once.

---

## Next interaction features

After basic timeline integration works, Bluesky posts inside X should support Bluesky-side actions such as:

```text
Like
Reply
Repost
```

These actions should operate against Bluesky, even though the post is displayed inside the X interface.

---

## Future feature: repost Bluesky content to X

A later feature should allow a Bluesky post to be posted onto X.

Conceptually:

```text
Bluesky post
    ↓
"Post on X"
    ↓
Create X post representing/reposting that Bluesky post
```

The intended user experience is similar to reposting or quoting content onto X, even though the source content originally comes from Bluesky.

This is a future feature and is not part of the initial implementation.

---

## Immediate next steps

The next development steps are:

1. Create the minimum Chrome Manifest V3 extension.
2. Restrict it to `https://x.com/*`.
3. Confirm `content.js` runs successfully on X.
4. Identify the X main timeline container and individual timeline post elements.
5. Extract timestamps from the currently loaded X timeline.
6. Add `background.js`.
7. Move the already-tested Bluesky authentication and `getTimeline` logic into the extension.
8. Pass Bluesky timeline data from `background.js` to `content.js`.
9. Implement chronological matching between X and Bluesky posts.
10. Insert Bluesky posts into the X timeline.
11. Handle X infinite scrolling and Bluesky cursor pagination.
12. Add Bluesky interactions later: like, reply, repost.
13. Add the future "Post Bluesky post on X" feature.

## Current project status

Completed:

```text
✓ Bluesky account authentication tested
✓ App Password authentication works
✓ createSession works
✓ accessJwt retrieval works
✓ app.bsky.feed.getTimeline works
✓ Bluesky home timeline retrieval confirmed
✓ Timeline cursor/pagination confirmed
✓ PowerShell JSON inspection confirmed
```

Next:

```text
→ Build the minimum Chrome extension
→ Run it only on x.com
→ Detect X's main timeline
→ Connect the working Bluesky timeline API
→ Merge both timelines chronologically
```
