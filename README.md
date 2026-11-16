# ورقة على الويب — Waraqa Web

The browser version of [Waraqa](https://github.com/a7med-j/appforge-studio): sign in, open apps you
published or joined, and run them on their shared table. It uses the same Firebase project as the
Android app; access is controlled by Firebase Authentication and the Firestore security rules.

Open an app directly: `https://a7med-j.github.io/daftari-web/?code=ABCD-EF23`

Every push to `main` is published by `.github/workflows/pages.yml` to GitHub Pages.

- `app.js` – sign in, app lists, joining, and the shared table (Firestore)
- `render.js` – draws a screen from its saved design and runs its buttons (no Firebase inside)
- `config.js` – the Firebase web settings (public by design)
