# Setting up cloud accounts (Firebase)

This turns on real sign-in, so CVs follow a user across devices and survive a cleared
browser. It takes about ten minutes and costs nothing at this scale.

**Until you do this, nothing is broken.** With `js/firebase-config.js` left blank the app
runs local-only, never contacts Firebase, and offers the local PIN profiles instead.

---

## 1. Create the Firebase project

1. Go to **<https://console.firebase.google.com>** and sign in with a Google account.
2. Click **Create a project** (or **Add project**).
3. Name it something like `nene-cv-platform`. The project ID it generates is what goes in
   your config later.
4. **Google Analytics: turn it off.** You don't need it, and it adds a second consent
   surface you'd have to disclose to users.
5. Click **Create project**, wait, then **Continue**.

## 2. Register the web app

1. On the project overview page, click the **`</>`** (Web) icon.
2. App nickname: `Nene's CV Platform`. **Do not** tick "Firebase Hosting" — you're on
   GitHub Pages.
3. Click **Register app**.
4. You'll see a `firebaseConfig` block. **Copy it.** If you navigate away, it's under
   ⚙️ **Project settings → General → Your apps → SDK setup and configuration**.

## 3. Paste the config

Open **`js/firebase-config.js`** and fill in the six values:

```js
RB.firebaseConfig = {
    apiKey: 'AIzaSy…',
    authDomain: 'nene-cv-platform.firebaseapp.com',
    projectId: 'nene-cv-platform',
    storageBucket: 'nene-cv-platform.appspot.com',
    messagingSenderId: '123456789012',
    appId: '1:123456789012:web:abc123def456'
};
```

Keep the quotes and commas exactly as they are.

> **This is not a secret, and committing it is correct.** Google designs the web config to
> ship in public client code — the `apiKey` identifies your project, it does not
> authenticate anyone. Your data is protected by the security rules in step 6. Do not waste
> effort trying to hide it; do not skip step 6.

## 4. Enable sign-in methods

1. Left sidebar → **Build → Authentication** → **Get started**.
2. **Sign-in method** tab → **Email/Password** → enable the first toggle → **Save**.
   (Leave "Email link / passwordless" off.)
3. Still on that tab → **Add new provider → Google** → enable it, pick a support email →
   **Save**.

If you skip this, sign-in fails with *"That sign-in method is not enabled."*

## 5. Create the database

1. Left sidebar → **Build → Firestore Database** → **Create database**.
2. Choose a location near your users. For South Africa, `europe-west1` is usually the
   lowest latency available. **This cannot be changed later.**
3. Start in **production mode** (locked). You're replacing the rules in the next step
   anyway, and test mode would leave your database world-readable for 30 days.
4. Click **Create**.

## 6. Deploy the security rules — do not skip this

This is the step that actually protects people's CVs.

**The easy way:**

1. Firestore Database → **Rules** tab.
2. Delete everything in the editor.
3. Paste the entire contents of **`firestore.rules`** from this repo.
4. Click **Publish**.

**Or with the CLI**, if you have it:

```bash
firebase deploy --only firestore:rules
```

The rules restrict every document to the account that owns it. Without them, anyone who
reads your config out of the page source could read every CV in your database.

## 7. Authorise your domains

Firebase only allows sign-in from domains you list.

1. **Authentication → Settings → Authorized domains**.
2. `localhost` is already there.
3. Click **Add domain** and add **`kagisogotech.github.io`**.

Miss this and sign-in fails on the live site with *"This domain is not authorised."*

## 8. Test it

1. Hard-refresh the app (**Ctrl+Shift+R**).
2. The header should now show a **Sign in** button instead of the profile icon.
3. Create an account with a real email address.
4. It should offer to copy your local CVs into the account — say yes.
5. Sign in on your phone with the same account. Your CVs should be there.

---

## Costs

The free **Spark** plan covers this comfortably. No card required, and it cannot
accidentally bill you — Firebase stops serving rather than charging when you're on Spark.

| | Free each day | What that means here |
|---|---|---|
| Document reads | 50,000 | Opening the app reads one doc per saved CV |
| Document writes | 20,000 | One per autosave, debounced to ~1 per 700ms of typing |
| Storage | 1 GiB total | A CV is roughly 5 KB — about 200,000 of them |
| Authentication | Unlimited | Email and Google sign-in are free |

Realistically you'd need thousands of daily users to approach these limits.

Unlike Supabase, **Firebase does not pause inactive free projects** — which is why it's the
right pick for a portfolio app that gets visited in bursts.

---

## Troubleshooting

The app translates Firebase's error codes into plain messages. The common ones:

| Message | Fix |
|---|---|
| *"That Firebase API key is not valid"* | A typo in `apiKey`, or you pasted a different project's config. Re-copy from Project settings. |
| *"Firebase Authentication is not set up on this project yet"* | You skipped step 4. Authentication → Get started. |
| *"That sign-in method is not enabled"* | Enable Email/Password or Google in step 4. |
| *"This domain is not authorised for sign-in"* | Add your GitHub Pages domain in step 7. |
| *"The database refused that request"* | The rules aren't deployed. Do step 6. |
| *"Firestore is not ready"* | You created the project but not the database. Do step 5. |
| *"Your browser blocked the sign-in window"* | Allow pop-ups, or use email and password. |

Still stuck? Open the browser console (**F12**) — the underlying code is appended to any
message that isn't specifically recognised.

---

## Turning it off again

Blank out the values in `js/firebase-config.js`. The app reverts to local-only mode
immediately. Existing cloud data stays in Firestore until you delete the project.

---

## What this does not do

- **No email address verification is enforced.** A verification email is sent on sign-up,
  but the app never blocks anyone over an unread email. Locking someone out of their own CV
  is worse than an unverified address.
- **No admin panel.** To see or remove user data, use the Firebase console.
- **No paid features.** Nothing here needs the Blaze plan.
