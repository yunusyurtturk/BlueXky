# BlueXky

A Chrome extension that shows your Bluesky home timeline inside the X (Twitter) home timeline. Bluesky posts appear between X posts, in chronological order, so you can read both in one place.

**Unofficial.** BlueXky is not affiliated with, endorsed by, or connected to X Corp. or Bluesky Social PBC.

## What it does

- Works only on `x.com`, on the home timeline. It does nothing on other sites.
- Inserts posts from your Bluesky home timeline between X posts, by time. Bluesky posts have a blue left border and a "Bluesky" badge.
- Like, repost and reply buttons on a Bluesky post act on **Bluesky only**. BlueXky never posts, likes or does anything else on X.
- Clicking a Bluesky post opens it on bsky.app in a new tab.

It works best on the **Following** tab, which is chronological. The "For you" tab is not in time order, so placement there is approximate.

## Install

BlueXky is not on the Chrome Web Store. You load it as an unpacked extension:

1. Download this repository: **Code → Download ZIP** (or `git clone`), and unzip it.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `extension` folder inside the unzipped folder.
5. Click the BlueXky icon in the toolbar and log in (see below).
6. Reload `x.com`.

Two things to know:

- **Developer mode has to stay on.** Since Chrome 134, an unpacked extension is disabled the moment you turn Developer mode off.
- Chrome shows a "developer mode extensions are active" notice. That is expected and does not mean the extension is broken.

To update, download the new version, replace the folder, and click the reload button on the BlueXky card in `chrome://extensions`.

## Log in

BlueXky logs in with a Bluesky **App Password**. This is not your Bluesky password.

1. In Bluesky, go to **Settings → Privacy and security → App passwords** and create one. It looks like `xxxx-xxxx-xxxx-xxxx`.
2. In the BlueXky popup, enter your username (`.bsky.social` is added automatically if you leave it out) and the App Password.

BlueXky refuses anything that is not in App Password format, so your main password cannot be entered by mistake. To disconnect, click **Log out** in the popup, or revoke the App Password in Bluesky.

## Privacy and security

- Your App Password is sent only to `bsky.social`, over HTTPS, once, to create a session. It is not stored.
- The Bluesky session tokens are stored in the browser's extension storage on your computer, unencrypted, like most extensions do. Anyone with access to your browser profile could copy them; revoking the App Password ends the session.
- The X page cannot read your password or session tokens. They are handled by the extension's background script.
- Bluesky posts are displayed inside the X page, so scripts on x.com can technically read the Bluesky content that is shown. They cannot get your credentials.
- BlueXky has no server and collects nothing. It talks only to `bsky.social` and Bluesky's image servers.

## Limitations

- BlueXky depends on the structure of the X web page. When X changes its site, the extension may stop working until it is updated.
- X's terms do not say anything explicit about extensions that change how the site looks. BlueXky does not automate X or scrape it, but you use it at your own risk.
- Chrome and Chromium-based browsers only (Manifest V3).

## How it works

- `extension/content.js` runs on x.com, reads the timestamps of the X posts that are loaded, and inserts Bluesky posts at the matching positions.
- `extension/background.js` holds the Bluesky session and makes all Bluesky API calls (`app.bsky.feed.getTimeline`, likes, reposts, replies).
- `extension/merge.js` is the chronological matching logic.
- `extension/popup.html` / `popup.js` are the login popup.

There is no build step; the folder is loaded as it is.

## License

[MIT](LICENSE). The action icons are from [Lucide](https://lucide.dev), used under the ISC License; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
