# BlueXky Privacy Policy

Last updated: 5 October 2026

BlueXky is a browser extension that shows your Bluesky home timeline inside the X (x.com) home timeline. It is an independent, unofficial project and is not affiliated with X Corp. or Bluesky Social PBC.

## Summary

BlueXky has no server. The developer does not receive, collect, store, sell or share any of your data. Everything the extension does happens in your browser, and the only service it talks to is Bluesky, using your own account.

## What the extension handles

**Your Bluesky login**

- You log in with your Bluesky username and an App Password. They are sent once, over HTTPS, to Bluesky (`bsky.social`) to create a session. The App Password is not stored after that.
- While you are typing in the login popup, what you typed is kept in the browser's memory so it is not lost if the popup closes. It is cleared when you log in or close the browser.
- Bluesky returns session tokens. These are stored in the browser's extension storage on your computer so you stay logged in. They are not sent anywhere except to Bluesky. Logging out in the popup deletes them.

**Your Bluesky content**

- The extension requests your home timeline from Bluesky and shows it on the X page. Images in those posts are downloaded from Bluesky's image servers (`cdn.bsky.app`, `video.bsky.app`).
- When you press like, repost or reply on a Bluesky post, that action is sent to Bluesky from your account.
- Timeline content is kept in memory only while the X tab is open.

**The X page**

- To place Bluesky posts in time order, the extension reads the time and ID of the X posts already loaded in your tab. This stays in your browser's memory. It is not stored and not sent anywhere, including to Bluesky.
- The extension does not use your X account, does not call X's API, and does not post, like, follow or send anything on X.

## What the extension does not do

- No analytics, tracking, advertising or telemetry.
- No data is sent to the developer or to any third party other than Bluesky, as described above.
- No browsing history is read. The extension runs only on `x.com`.

## Things you should know

- Bluesky posts are displayed inside the X page, so scripts on x.com can technically read the Bluesky content that is shown there. They cannot read your App Password or session tokens.
- Session tokens are stored unencrypted in your browser profile, as is normal for extensions. Someone with access to your computer account could copy them. Revoking the App Password in Bluesky settings ends the session.
- Your use of Bluesky and X is covered by their own privacy policies.

## Removing your data

Click **Log out** in the popup, or remove the extension; either deletes the stored session. You can also revoke the App Password in Bluesky under Settings → Privacy and security → App passwords.

## Changes

Changes to this policy are published in this file, with the date above updated.

## Contact

Questions or concerns: open an issue at https://github.com/yunusyurtturk/BlueXky/issues
