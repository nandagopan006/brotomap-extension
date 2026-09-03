# Brotomap

A Chrome extension for Brototype students.

Open your module's technical task on the portal, click one button, and get a
prioritised list of everything you actually need to learn for it — including the
prerequisites the task never mentions — laid out as a 5-day study roadmap you can
send straight to Notion.

---

## What it does

1. Reads the **technical task** on your Brototype portal page (only the technical
   one — Personal Development and Communication tasks are ignored)
2. Opens every topic and reads the full content, not just the titles
3. Works out what you really need to know, including the gaps the task assumes
   you already have
4. Sorts it by priority — **P0** you cannot skip, down to **P3** optional depth
5. Builds a 5-day roadmap: Learn → Understand → Practice → Build → Revise
6. Sends it to Notion as a page with checkboxes

It only reads. It never clicks submit, never deletes anything, and never touches
your portal data.

---

## Setup (once)

### 1. Install

```bash
npm install
npm run build
```

### 2. Add your keys

Copy `server/.env.example` to `server/.env` and fill in:

| Key | Where to get it |
|---|---|
| `AI_API_KEY` | [console.groq.com](https://console.groq.com) → API Keys → Create |
| `NOTION_TOKEN` | [notion.so/my-integrations](https://notion.so/my-integrations) → New integration → copy the secret |
| `NOTION_PARENT_PAGE_ID` | The 32 characters in your Notion page's URL |

Notion is optional — leave both blank and the export is simply not offered.

**Important for Notion:** open the page you want roadmaps saved to, click `...` →
**Connections** → **Connect to** → your integration. Without this Notion replies
"Could not find page", because an integration can only see pages it's been given.

### 3. Load the extension in Chrome

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** → select the `extension/dist` folder
4. Pin Brotomap to your toolbar

### 4. Make the server start on its own

```bash
npm run autostart
```

The extension needs a small local server, because your API key must never live
inside a browser extension. This makes it start with Windows, hidden — no
terminal, no window, nothing to remember.

To undo it: `npm run autostart:remove`

---

## Using it

1. Open your module page on **student.brototype.com**
2. Click the **Brotomap** icon
3. Click **Generate Roadmap**
4. Wait — it reads the task, then thinks. This takes a few minutes.
5. Read the topics and the 5 days in the popup
6. Click **Save to Notion**

That's it.

If a non-technical task is the one that's open, it tells you so rather than
quietly building a roadmap for the wrong thing.

---

## After changing code

```bash
npm run build
```

Then press the **reload** icon on the Brotomap card in `chrome://extensions`.

---

## If something goes wrong

**"Cannot connect to server"**
The server isn't running. Start it with `npm run server`, or set up autostart
above. To check it's alive, open <http://localhost:8787/api/health> — you should
see `{"ok":true,...}`.

**"Could not find page" from Notion**
You skipped the Connections step. See Setup → 2.

**Model errors about tokens or a decommissioned model**
Free-tier limits change and model names get retired. Run `npm run models` to see
what your key can use, and `npm run limits` to see your token budget.

**It found fewer topics than the page shows**
The portal was still loading. Close the popup and try again.

---

## Commands

```bash
npm run build      # build the extension
npm run server     # start the server in this terminal
npm run autostart  # start the server with Windows instead
npm run models     # list models your key can use
npm run limits     # show your token limits
npm run notion     # check your Notion setup
npm test           # run the tests
```
