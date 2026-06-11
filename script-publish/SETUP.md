# Publish Pipeline — Setup Checklist

One-time setup. Do these steps in order.

---

## 1. Create the Apps Script project

```bash
cd "script-publish"
clasp login    # if not already logged in as the committee account
clasp create --type standalone --title "GOTO Publish Pipeline"
# This writes the scriptId into .clasp.json automatically
clasp push
```

---

## 2. Set Script Properties

In the Apps Script editor: **Project Settings → Script Properties → Add property**

| Property        | Value                                                         |
|-----------------|---------------------------------------------------------------|
| `GITHUB_TOKEN`  | Fine-grained PAT: Contents **Read and Write** on the repo     |
| `GITHUB_OWNER`  | `rkenefeck` (or whatever the GitHub username is)              |
| `GITHUB_REPO`   | `gototoastmasters`                                            |
| `GITHUB_BRANCH` | `main`                                                        |

To create the fine-grained token: github.com → Settings → Developer settings →
Personal access tokens → Fine-grained tokens → New token.
Permissions: **Repository permissions → Contents → Read and Write**.
Scope: Only the `gototoastmasters` repo.

---

## 3. Add Doc IDs to the allowlist

Open `publish.js` and add entries to `PUBLISH_ALLOWLIST`:

```js
var PUBLISH_ALLOWLIST = {
  'ROLE_GUIDE_DOC_ID':   'docs/roles.md',
  'PITCH_DOC_ID':        'docs/pitch.md',
};
```

To find a Doc ID: open the Doc → the URL is
`https://docs.google.com/document/d/<THIS IS THE ID>/edit`

---

## 4. Prototype — validate the converter first

Before wiring up live publishing, test the converter output:

1. Add the Role Guide Doc ID to `protoConvertRoleGuide()` in `publish.js`
2. In the Apps Script editor, run `protoConvertRoleGuide()`
3. Check the execution log — compare the Markdown output against
   the live `docs/roles.md` in the repo
4. Key things to verify:
   - Headings render at the right level (`#`, `##`, `###`)
   - Bullet lists are indented correctly
   - `[image1]` etc. are stripped
   - Tables render as pipe tables
   - Bold / italic text is preserved
   - Links are preserved

If the output looks good, proceed to step 5.

---

## 5. Create the daily trigger

Run `createDailyTrigger()` once from the Apps Script editor.
This creates a 3am daily time trigger for `publishAll()`.

---

## 6. Test a live publish

Run `publishAll()` manually from the editor.
Check:
- The Markdown was committed to the repo (check GitHub commits)
- The committee email received a notification
- The site builds and deploys correctly (GitHub Actions)

---

## Notes

- The pipeline checks last-modified time before publishing — it will not
  re-commit a file if the Doc hasn't changed.
- To force a re-publish of one Doc: run `publishNow('DOC_ID')`.
- To add a new Doc to the pipeline later: add it to `PUBLISH_ALLOWLIST` and
  run `clasp push`. The daily trigger picks it up automatically.
- To remove a Doc from publishing: remove it from `PUBLISH_ALLOWLIST`.
  The file already in the repo is not deleted.
