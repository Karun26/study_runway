# Study runway

A personal study dashboard for UTS subjects 36106, 36100 and 36103. It runs entirely in
your browser. There is no server and no account: data is encrypted with your passcode and
stored on each device.

## Put it online (free)

The site is plain files, so any static host works. Two options:

**GitHub Pages**
1. Create a new repository on GitHub (it can be public: it contains code only, never your data).
2. Upload everything in this folder, keeping the `js` and `icons` folders.
3. Settings › Pages › Deploy from a branch › `main` / root › Save.
4. Open the address it shows, e.g. `https://yourname.github.io/study-runway/`.

**Netlify Drop**: drag this folder onto https://app.netlify.com/drop.

The site must be served over https; encryption is switched off on insecure pages.

## First use

1. **Laptop**: open the site, choose *Main device*, set a passcode, save the recovery code.
2. Settings › Canvas calendar: paste your Canvas feed link
   (Canvas › Calendar › Calendar Feed). If the browser can't read it, use *Import .ics file*.
3. **iPhone**: open the site in Safari, Share › *Add to Home Screen*, open it from the
   Home Screen, choose *View-only device*, set a passcode.
4. To update the phone: laptop › Settings › *Save update file*, AirDrop it, phone ›
   Settings › *Import update file*.

## How the calendar works

- It updates each time you open or unlock the dashboard, and when you return to it after
  30 minutes.
- If an update fails, your last saved calendar stays and a warning pops up.
- Canvas sends assignments due at 11:59 pm as date-only events, so they're shown as due at
  11:59 pm Sydney time.
- Your own data (submitted flags, tasks, marks) is stored separately, so updates never
  overwrite it. Changed due dates are flagged on the Today page.

## Security

- PBKDF2-SHA256 (600,000 rounds) and AES-256-GCM via the browser's Web Crypto API.
- Wrong passcodes: after 5 attempts, a delay that doubles each time (up to an hour).
- Auto-lock after inactivity (default 15 minutes).
- Forgot the passcode and lost the recovery code: the data can't be recovered.
- Update files are encrypted with a separate password you choose each time.

## Course data

See `COURSE-DATA-FORMAT.md`.
