# How to put Book Scanner on your phone

This guide assumes nothing. Every step says what to do and what you should see before you
move on. If a step doesn't look right, jump to **Part 6 — When it goes wrong** at the end.

Book Scanner is a web app that installs to your home screen. Once installed it opens like
any other app, with its own icon and no browser bar, and it works with no internet.

It works on both Android and iPhone. The steps differ, so each has its own part below.

---

## Part 0 — Put the app somewhere your phone can open

> **Already done — skip straight to Part 1 or Part 2.**
>
> The app is published and live at:
>
> ### https://fdavchev.github.io/Book-Scanner/
>
> Open that address on your phone. It works from anywhere, on any network, with the
> laptop switched off. The rest of Part 0 is only needed if you want to publish your own
> copy or change the app and re-publish it.
>
> To re-publish after changing something: `npm run deploy`.

This is the only fiddly bit, and it only has to be done once. Your phone needs a web
address to open. There are two ways to give it one.

**Which should you pick?**

- Just want to try it in the next five minutes, with the laptop nearby → **Route A**.
- Want it properly installed, working anywhere, laptop switched off → **Route B**.

### Route A — Quick trial over Wi-Fi

1. Make sure the laptop and the phone are on **the same Wi-Fi network**. Not one on Wi-Fi
   and the other on mobile data — the same network.

2. On the laptop, open a terminal in the project folder and run:

   ```
   npm run dev:https -- --host
   ```

3. Wait a few seconds. It prints a list of addresses. Ignore the one that says
   `localhost` and find the one under **Network**, which looks like:

   ```
   https://192.168.1.24:5173/
   ```

   The four numbers will be different on your network. That is the address you want.
   **Leave this terminal running** — closing it switches the app off.

4. Type that address into the phone's browser, exactly as printed, including the
   `https://` at the front.

5. **You will see a scary security warning.** This is expected and it is not a problem.
   The laptop is using a certificate it made for itself rather than one bought from a
   company, and browsers always warn about that. Nothing is wrong and nothing is at risk —
   the "site" is a laptop three feet away from you.

   - **Android Chrome** says *"Your connection is not private"*. Tap **Advanced**, then
     tap **Proceed to 192.168.1.24 (unsafe)** at the bottom.
   - **iPhone Safari** says *"This Connection Is Not Private"*. Tap **Show Details**, then
     tap **visit this website**, then tap **Visit** in the box that appears.

6. Book Scanner loads. Continue to Part 1 (Android) or Part 2 (iPhone).

> Route A depends on the laptop staying on and staying on the same Wi-Fi. For an install
> that keeps working afterwards, use Route B.

### Route B — Permanent install (recommended)

This publishes the app to a free web host, giving it a normal `https://` address that
works from anywhere, on any network, with the laptop switched off.

1. Create a free account at [github.com](https://github.com) if you don't have one.

2. Log the GitHub command-line tool in. In a terminal on the laptop, run:

   ```
   gh auth login
   ```

   Choose **GitHub.com**, then **HTTPS**, then **Login with a web browser**. It shows an
   eight-character code — copy it, press Enter, and your browser opens. Paste the code and
   approve. This has to be done by hand once; it opens a browser window, so it cannot be
   automated.

3. Create the repository and push the code, in one command, from the project folder:

   ```
   gh repo create book-scanner --public --source=. --remote=origin --push
   ```

   **Public or private?** `--public` means anyone can read the source. Use it if you want
   GitHub Pages hosting for free and don't mind the code being visible — there are no
   passwords or personal data in it, and **your books are never in the repository**, only
   the app itself. If you'd rather keep it private, swap `--public` for `--private`; Pages
   on a private repository needs a paid plan, so in that case host the `dist/` folder
   somewhere else instead (Netlify Drop and Cloudflare Pages both take a drag-and-drop
   upload for free).

   <details>
   <summary>Doing it by hand instead, without the <code>gh</code> tool</summary>

   Create a new **empty** repository on github.com — no README, no licence. It shows you an
   address ending in `.git`. Then, in the project folder:

   ```
   git remote add origin https://github.com/YOUR-NAME/YOUR-REPO.git
   git push -u origin main
   ```
   </details>

4. Now publish the app itself:

   ```
   npm run deploy
   ```

   This builds it for you. (Don't run `npm run build` first and deploy that — a GitHub
   Pages site lives at a sub-address like `/book-scanner/`, and `npm run deploy` is what
   knows to build for it. Deploying a plain build gives a blank white page.)

   When it finishes it prints the address your app will live at, like
   `https://your-name.github.io/your-repo/`.

5. One switch has to be flipped by hand, once. On GitHub, open your repository, click
   **Settings**, then **Pages** in the left-hand list. Under *Branch*, choose
   **gh-pages**, then **Save**.

6. Wait about a minute, then open the printed address on your phone. You should see Book
   Scanner. There will be no security warning this time.

7. That address is permanent. Anyone you give it to can install the app too, and each
   person's books stay on their own phone.

---

## Part 1 — Android (Chrome)

1. Open the address from Part 0 in **Chrome** on your Android phone.

2. Wait for the app to finish loading — you should see the words **Book Scanner** and a
   large **Scan Books** button.

3. A bar usually slides up from the bottom offering to **Install app**. Tap it, then tap
   **Install** in the box that appears. Skip to step 5.

4. **If no bar appeared**, install it manually: tap the **⋮** three-dot menu at the top
   right, then look for **Add to Home screen** or **Install app** and tap it, then tap
   **Install**.

5. Find the app. Swipe up from the bottom of the home screen to open the app drawer and
   look for the **Book Scanner** icon — a white open book on a dark red square. You can
   press and hold it to drag it onto your home screen.

6. Tap the icon to open it. **Check this:** there should be **no address bar** at the top.
   If there's a bar showing a web address, the app opened in the browser instead of as an
   installed app — go back to step 3.

Now go to Part 3.

---

## Part 2 — iPhone and iPad (Safari)

**Use Safari.** This is the single most common reason this fails. Chrome, Firefox and
Edge on the iPhone are not allowed by Apple to install web apps, and the *Add to Home
Screen* option simply will not be there. Safari is the blue compass icon.

1. Open the address from Part 0 in **Safari**.

2. Wait for the app to load — you should see **Book Scanner** and a large **Scan Books**
   button.

3. Tap the **Share** button. It is a square with an arrow pointing up out of it.
   - On most iPhones it is in the bar at the **bottom** of the screen, in the middle.
   - On an iPad, or an older iPhone, it is at the **top right** instead.
   - If the bottom bar is hidden, scroll up slightly on the page and it reappears.

4. A panel slides up. **Scroll down inside that panel** — past the row of apps, past
   *Copy*, past *Add to Reading List*. You are looking for a row that says
   **Add to Home Screen**, with a plus-in-a-square icon. Tap it.

5. A box appears with the name **Books** in it. You can change the name if you like. Tap
   **Add** at the top right.

6. The panel closes and the icon appears on your home screen — a white open book on a
   dark red square.

7. Tap the icon. **Check this:** there should be **no address bar** at the top, and no
   Safari buttons at the bottom. If you see them, the icon is a bookmark rather than an
   installed app — repeat from step 3, making sure you tap *Add to Home Screen* and not
   *Add Bookmark*.

---

## Part 3 — Turn on offline scanning

The app reads book covers using a text recogniser that runs on your phone. That recogniser
has to be downloaded once. Until it is, the app needs the internet the first time you scan.
Doing it now, deliberately, is much nicer than discovering it on a train.

1. Open Book Scanner from your home screen, while you still have internet.

2. On the first screen there is a box saying **Set up offline scanning**. Tap the button
   with the same name.

3. Tick the languages your books are printed in. **English** is ticked already. Tick
   **Macedonian** too if you have Macedonian books. Ticking fewer means a smaller
   download.

4. It shows roughly how big the download is — about **7 MB** for English, or about **8 MB**
   for both. Tap **Download**.

5. A progress bar fills. It takes a few seconds on Wi-Fi. **Do not close the app** while
   it runs.

6. When it finishes, the box changes to a green dot and the words **Offline scanning is
   ready**. That is the confirmation you want.

This happens once. It stays ready unless you delete the app.

---

## Part 4 — Prove it actually works offline

Worth doing once, so you know.

1. Turn on **airplane mode** on your phone. Check that Wi-Fi is off too — airplane mode
   usually turns it off, but some phones leave it on.

2. Open Book Scanner from your home screen. It should open normally, not show an error
   page.

3. Tap **Scan**, then **Select Photos**, and pick a photo of a book cover from your
   gallery. (If you have none, take one first — the camera works offline too.)

4. Wait a moment. The book's title and author should appear on a review card, exactly as
   they would online.

5. Tap **Save all**. The book appears in **My Books**.

**What needs the internet, and what doesn't:**

| Feature | Works offline? |
|---|---|
| Taking photos, choosing photos | Yes |
| Reading the cover, finding title and author | Yes, once Part 3 is done |
| Saving, browsing, searching, editing, deleting | Yes |
| Checking the book against the Open Library catalogue | **No** — needs internet |

That last one is a bonus, not a requirement. Without it the app simply uses what it read
from the cover. You'll see the pill at the top of the Scan screen change to
**Lookup: Off · offline**, and it stays tappable — you can force it on if you think the
phone is wrong about being offline.

Turn airplane mode back off when you're done.

---

## Part 5 — Camera permission

The first time you tap **Open Camera**, the phone asks for permission.

- **Android** asks *"Allow Book Scanner to take pictures and record video?"* — tap
  **While using the app**.
- **iPhone** asks *"Would like to Access the Camera"* — tap **Allow**.

Say yes. The app cannot see the camera otherwise. Photos are processed on the phone and
never uploaded anywhere.

**If you tapped Don't Allow by accident:**

- **Android:** Settings → Apps → Book Scanner → Permissions → Camera → Allow.
- **iPhone:** Settings → scroll down to Book Scanner (or Safari → Camera) → set Camera to
  Allow. Then close the app fully and reopen it.

You can always use **Select Photos** instead — take pictures with the normal camera app,
then pick them. It needs no camera permission at all and works just as well.

---

## Part 6 — When it goes wrong

| What you see | Why | What to do |
|---|---|---|
| No *Install app* prompt on Android | Chrome only offers it after the page has fully loaded, and only once per address | Use the ⋮ menu → *Add to Home screen*. Wait for the page to finish loading first. |
| No *Add to Home Screen* row on iPhone | You are in Chrome, Firefox or Edge, which Apple does not allow to install web apps | Open the same address in **Safari** — the blue compass icon |
| The page won't load on the phone (Route A) | Phone and laptop are on different networks, the terminal was closed, or you typed `http://` instead of `https://` | Check both are on the same Wi-Fi, check the terminal is still running, and retype the address exactly as printed |
| *"Your connection is not private"* | Expected on Route A — the laptop's certificate is self-made | Tap *Advanced* → *Proceed* (Android) or *Show Details* → *visit this website* (iPhone). See Part 0, step 5 |
| The camera won't open | Permission was declined, or the page is not on `https://` | See Part 5. Or use *Select Photos* instead |
| Scanning fails with no internet | The offline setup in Part 3 hasn't been done | Reconnect, do Part 3, then try again |
| Scanning is slow | The recogniser is doing real work on your phone; a second or two per photo is normal | Photograph one cover filling the frame rather than a whole shelf |
| It reads the wrong title | Cover art is hard — a stylised or cluttered cover confuses it | Fix it on the review card before saving. The *Other lines it could be* dropdown usually has the right one |
| **All my books disappeared** | iPhones can clear a web app's storage if the phone is very short on space, and deleting the app deletes its books | Restore from a backup: **My Books** → **Import a backup** → pick your export file |

### Please make backups

Your books live only on your phone. Nothing is on a server, which is the point — but it
also means nothing is recovering them for you.

Every so often: open **My Books**, scroll to **Backup**, tap **Export to a file**, and keep
that file somewhere safe. Restoring is **Import a backup** and picking the file. Importing
never overwrites books that are already there.

---

## What was actually tested, and what wasn't

Honesty about which of these steps were run on real hardware:

- **Parts 0 (Route A and B), 3, 4, 5 and the app itself** — the flows behind them are
  covered by automated tests in Chromium and in WebKit, which is the same engine Safari
  uses. The offline cold start in Part 4 is an automated test: the app is installed, the
  network is switched off, the app is restarted, and it scans and saves a book.
- **Part 1 (Android install)** — written from Chrome's documented behaviour. Not run on a
  physical Android phone.
- **Part 2 (iPhone install)** — written from Apple's documented behaviour. **Not run on a
  physical iPhone**, because there isn't one in this environment. This is the one part
  that would benefit from you confirming it takes two minutes.
