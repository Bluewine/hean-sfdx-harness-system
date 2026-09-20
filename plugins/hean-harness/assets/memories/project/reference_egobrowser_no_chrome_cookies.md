---
name: reference_egobrowser_no_chrome_cookies
description: "Ego Lite task spaces do not inherit Google Chrome's cookies; for a site logged in only in Chrome, hand off for login or decrypt Chrome's cookie DB"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 95008e38-e35b-4d72-b871-451fad49e4a7
  modified: 2026-09-17T21:43:37.803Z
---

An Ego Lite (`ego-browser`) task space inherits login state from its own Ego profile, **not**
from Google Chrome. A site the user is signed into in Chrome — trailhead.salesforce.com, for
example — loads logged out in a task space.

Two ways through:

- **Ask the user to log in.** `handOffTaskSpace(id)` gives them control; resume with
  `takeOverTaskSpace(id)` only after they explicitly confirm. Fastest when the user is present.
- **Copy the cookies from Chrome.** On macOS the store is
  `~/Library/Application Support/Google/Chrome/<Profile>/Cookies` (SQLite). Copy the file
  before reading it, since Chrome holds a lock. Values are AES-128-CBC with
  `key = PBKDF2-HMAC-SHA1(keychain password, b"saltysalt", 1003, 16)` and `IV = 16 spaces`,
  prefixed `v10`. The keychain password comes from
  `security find-generic-password -wa Chrome -s "Chrome Safe Storage"`. Chrome 130+ prepends a
  32-byte SHA-256 domain hash to the decrypted plaintext — strip it. Inject with CDP
  `Network.setCookie`.

Two traps that cost real time:

- **The profile matters.** `Default` is often nearly empty; the real profile may be
  `Profile 1`. Check which one actually holds the host's cookies before decrypting anything.
- **The keychain read prompts, and the prompt is per-invocation.** A second call returns exit
  128 when the user only clicked "Allow". Capture the key once into a `0600` file and read it
  from there.

`cryptography` is available in this environment; `pycryptodome` is not.

Cookies are credentials: never print their values, and keep any dump under `0600` in a
scratch directory. Related: [[feedback_playwright_for_browser_testing]].
