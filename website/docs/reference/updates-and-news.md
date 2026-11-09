---
spec: ['24', '18']
description: How Actuality tells you about new versions, release notes and announcements, and how to turn that off.
---

# Updates and news

Actuality lets you know when a new version is out, and shows the release notes and announcements posted on the [Actuality blog](https://actualitydesktop.org/blog). Both are optional, and you can turn each one off in [Preferences](preferences.md).

## When a new version is available

When a newer version of Actuality has been released, a message appears at the bottom right of the window: "A new version of Actuality is available". **View release notes** opens the release's post on the blog, which links to the download page. Download and install the new version yourself: Actuality doesn't update itself.

Close the message with **✕** (or **Esc** while it has focus). It won't appear again for that version on this computer, whichever budget you open, but it comes back when a newer version is released.

**Help ▸ About Actuality** also shows, under the version number, either "New version available: …", which opens that release's post, or "You're up to date!". Its **Release notes** link lists the notes for every version.

Actuality checks for a new version when it starts, and again once a day while it's running. Being offline doesn't matter: it simply checks again next time.

## Release notes and announcements

The bell at the bottom left of the sidebar opens **Notifications**, a list of the latest release notes and announcements. You can also open it from **Help ▸ Notifications…**, even before you open a budget.

- A number on the bell counts the posts you haven't seen yet ("9+" for ten or more).
- Each post shows whether it's a **Release** or a **Post**, its title and date, and its text. A dot marks the ones that are new since you last looked.
- For a release, **Show all changes** lists everything that changed in that version.
- **Read on the blog** opens the post in your web browser. **All release notes** and **Blog** at the top open the blog.

Opening Notifications marks everything as seen, so the number on the bell goes away. The dots stay until you close it.

The first time you run a new version, a message "What's new in Actuality …" appears at the bottom right. **See what's new** opens Notifications. Closing the message marks only that release as seen, so other new posts keep their place on the bell.

When you first start Actuality, posts from before that aren't counted as new.

If Actuality can't reach the blog, usually because you're offline, the bell shows no number and Notifications says the news isn't available right now. Everything else keeps working.

## Messages and the keyboard

The messages at the bottom right never take focus away from what you're doing, and they stay until you close them. Screen readers announce them when they appear.

To reach them from the keyboard, press **F6** until focus moves into them (they come last), then **Tab** between the message's button and **✕**. **Esc** closes the message and takes you back to where you were.

## Turning them off

In **Preferences ▸ Updates and News**:

| Setting | What it does |
| --- | --- |
| **Display a notification when updates are available** | Checks api.github.com for a new version. Turn it off, and Actuality never contacts GitHub. |
| **Show in-app notifications (release notes and announcements)** | Downloads the latest posts from actualitydesktop.org. Turn it off, and Actuality never downloads them, and the bell and **Help ▸ Notifications…** disappear. |

Both are on until you turn them off, and changes apply straight away.

## Privacy

Both checks download public files and send nothing about you or your budgets: no account, no budget data, and no identifier for you or this computer. Apart from your own Actual server, actualitydesktop.org and api.github.com are the only places Actuality connects to. What you've seen and closed is remembered on this computer only.

The posts are written in English.
