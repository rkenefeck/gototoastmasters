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

## 3. Allowlist is already configured

`PUBLISH_ALLOWLIST` in `publish.js` already contains:

| Doc                    | Repo path            |
|------------------------|----------------------|
| Role Guide             | `docs/roles.md`      |
| Club Offering          | `docs/pitch.md`      |
| Toastmaster Checklist  | `docs/checklist.md`  |

To add the Committee Roles doc when it's authored: uncomment its line in
`PUBLISH_ALLOWLIST` and add the Doc ID.

---

## 4. Prototype — validate the converter first

Before wiring up live publishing, test the converter output:

1. In the Apps Script editor, run `protoConvertRoleGuide()`
   (the Role Guide Doc ID is already set)
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
