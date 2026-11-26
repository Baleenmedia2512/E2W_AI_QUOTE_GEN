# Empty Pages Router stub (Next.js)

Next.js treats `src/pages` as the Pages Router unless a root `pages/` directory exists.
Vite’s UI lives in `src/pages/*` (HomePage, LoginPage, …) and must **not** be compiled by Next.

This empty root `pages/` folder makes Next ignore `src/pages` and use root `app/` only.
Do not add Next routes here — use `app/` (App Router).
