# Chrome Web Store listing

Copy-paste material for the store listing form.

## Name

BlueXky

## Summary (132 characters max)

Shows your Bluesky home timeline inside the X home timeline, merged in time order.

## Description

BlueXky shows the posts from your Bluesky home timeline inside the X (Twitter) home timeline, so you can read both in one place. Bluesky posts are placed between X posts in time order and are clearly marked with a blue line and a "Bluesky" badge.

What it does
• Shows your Bluesky home timeline inside the X home timeline, in time order.
• Like, repost and reply to Bluesky posts without leaving X. These actions go to Bluesky only.
• Click a Bluesky post to open it on bsky.app.
• Only adds to the page: X posts are not changed, hidden or reordered.
• Works best on X's "Following" tab, which is chronological.

What it does not do
• It never posts, likes, follows or does anything else on X, and never uses X's API.
• It has no server and collects no data. It talks only to Bluesky, using your own account.
• It runs only on x.com and does nothing on other sites.

Login
You log in with a Bluesky App Password, not your Bluesky password. An App Password is a separate, limited password you create in Bluesky (Settings → Privacy and security → App passwords) and can revoke at any time. It is used once to log in and is not stored.

Privacy
No analytics, tracking or telemetry. Nothing is sent to the developer. Full policy: https://github.com/yunusyurtturk/BlueXky/blob/main/PRIVACY.md

Unofficial
BlueXky is an independent, open-source project. It is not affiliated with, endorsed by, or connected to X Corp. or Bluesky Social PBC. Source code: https://github.com/yunusyurtturk/BlueXky

## Category

Social & Communication

## Language

English

## Images

- Icon: `extension/icons/icon128.png` (128×128)
- Screenshot: `store/screenshot-1280x800.png` (1280×800, 24-bit PNG, no alpha)
- Small promo tile: `store/promo-440x280.png` (440×280, 24-bit PNG, no alpha)

## Privacy tab

- Single purpose: Shows the user's Bluesky home timeline inside the X home timeline.
- Permission justifications:
  - storage: keeps the Bluesky session so the user stays logged in.
  - Host permission x.com (content script): the page where Bluesky posts are shown.
  - Host permissions bsky.social, cdn.bsky.app, video.bsky.app: Bluesky API and image servers.
- Remote code: No.
- Data usage: Authentication information (Bluesky App Password at login, session tokens), User-generated content (Bluesky posts displayed, replies the user writes). Not sold, not used for unrelated purposes, not used for creditworthiness.
- Privacy policy URL: https://github.com/yunusyurtturk/BlueXky/blob/main/PRIVACY.md
