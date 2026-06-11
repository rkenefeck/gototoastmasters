// ============================================================
// GOTO Toastmasters — Google Docs → Markdown → GitHub Publish Pipeline
//
// Standalone Apps Script project. One-time setup:
//   1. clasp create --type standalone --title "GOTO Publish Pipeline"
//   2. Set Script Properties (Project Settings → Script Properties):
//        GITHUB_TOKEN  — fine-grained PAT with contents:write on the repo
//        GITHUB_OWNER  — e.g. "rkenefeck"
//        GITHUB_REPO   — e.g. "gototoastmasters"
//        GITHUB_BRANCH — e.g. "main"  (defaults to "main" if omitted)
//   3. Add the Role Guide Doc ID (and others) to PUBLISH_ALLOWLIST below.
//   4. Run createDailyTrigger() once to start the scheduled poll.
//
// Safe to re-run publishAll() manually at any time.
// ============================================================

// ── Allowlist: Doc ID → repo path ─────────────────────────────────────────────
// Only Docs explicitly listed here can ever be published.
// This is the security guardrail: sensitive Docs (handover runbooks, etc.)
// are never listed and therefore can never reach the public site.
// Adding a Doc here is a deliberate, code-reviewed act.

var PUBLISH_ALLOWLIST = {
  // Paste each Doc ID from the Doc's URL (the long ID between /d/ and /edit).
  // Example URL: https://docs.google.com/document/d/XXXXXXXXXX/edit
  //
  // 'PASTE_ROLE_GUIDE_DOC_ID':           'docs/roles.md',
  // 'PASTE_PITCH_DOC_ID':                'docs/pitch.md',
  // 'PASTE_TOASTMASTER_CHECKLIST_DOC_ID':'docs/checklist.md',
  // 'PASTE_COMMITTEE_ROLES_DOC_ID':      'docs/committee-roles.md',
};

// Committee notification email (receives a summary on every publish run that
// produces changes — the audit safeguard per ADR 0002).
var NOTIFY_EMAIL = 'goto.toastmasters.committee@gmail.com';

// ── Entry points ──────────────────────────────────────────────────────────────

/**
 * Main publish loop — run daily via time trigger or manually.
 * Checks each allowlisted Doc for changes since last publish; only re-publishes
 * if the Doc has been modified since the last successful publish.
 */
function publishAll() {
  Logger.log('=== publishAll starting ===');
  var props   = PropertiesService.getScriptProperties();
  var changed = 0;
  var errors  = [];

  var docIds = Object.keys(PUBLISH_ALLOWLIST);
  if (docIds.length === 0) {
    Logger.log('Allowlist is empty — nothing to publish. Add Doc IDs to PUBLISH_ALLOWLIST.');
    return;
  }

  docIds.forEach(function(docId) {
    var repoPath = PUBLISH_ALLOWLIST[docId];
    try {
      var file        = DriveApp.getFileById(docId);
      var modifiedKey = 'last_published_' + docId;
      var lastMs      = props.getProperty(modifiedKey);
      var currentMs   = file.getLastUpdated().getTime().toString();

      if (lastMs === currentMs) {
        Logger.log('  No changes: ' + file.getName());
        return;
      }

      Logger.log('  Publishing: ' + file.getName() + ' → ' + repoPath);
      var doc      = DocumentApp.openById(docId);
      var markdown = docToMarkdown_(doc);
      var url      = commitToGitHub_(repoPath, markdown, 'Auto-publish: ' + doc.getName());
      props.setProperty(modifiedKey, currentMs);
      changed++;
      Logger.log('  Done: ' + (url || 'committed'));
    } catch (err) {
      Logger.log('  ERROR for ' + docId + ': ' + err.message);
      errors.push(docId + ': ' + err.message);
    }
  });

  Logger.log('=== publishAll complete. ' + changed + ' published, ' + errors.length + ' error(s) ===');

  if (changed > 0 || errors.length > 0) {
    notifyCommittee_(changed, errors);
  }
}

/**
 * "Publish now" — force-publishes one Doc from the allowlist, regardless of
 * last-modified time. Call from a custom menu or manually.
 *
 * @param {string} docId  The Google Doc ID to publish.
 */
function publishNow(docId) {
  var repoPath = PUBLISH_ALLOWLIST[docId];
  if (!repoPath) {
    throw new Error('Doc ID not in allowlist — cannot publish: ' + docId);
  }
  var doc      = DocumentApp.openById(docId);
  var markdown = docToMarkdown_(doc);
  var url      = commitToGitHub_(repoPath, markdown, 'Manual publish: ' + doc.getName());
  PropertiesService.getScriptProperties().setProperty(
    'last_published_' + docId,
    DriveApp.getFileById(docId).getLastUpdated().getTime().toString()
  );
  Logger.log('Published ' + doc.getName() + ' → ' + repoPath);
  Logger.log('Commit: ' + (url || 'OK'));
}

// ── PROTOTYPE — run this first to validate the converter ─────────────────────
/**
 * Convert the Role Guide Doc and log the Markdown output.
 * Run this in the Apps Script editor to validate converter output before
 * wiring up the full pipeline.
 *
 * Steps:
 *   1. Open the Role Guide Doc in Google Docs.
 *   2. Copy the Doc ID from the URL: docs.google.com/document/d/<THIS_PART>/edit
 *   3. Paste it below and run this function.
 *   4. Check the execution log output against the live roles.md.
 */
function protoConvertRoleGuide() {
  var DOC_ID = 'PASTE_ROLE_GUIDE_DOC_ID_HERE';

  Logger.log('Opening doc...');
  var doc = DocumentApp.openById(DOC_ID);
  Logger.log('Converting: ' + doc.getName());

  var md = docToMarkdown_(doc);
  Logger.log('Output length: ' + md.length + ' chars');

  // Log in 3000-char chunks (Apps Script logger truncates long strings)
  for (var i = 0; i < md.length; i += 3000) {
    Logger.log(md.substring(i, i + 3000));
  }
}

// ── Converter: Google Doc body → Markdown ─────────────────────────────────────
/**
 * Convert a Google Docs Document to a Markdown string.
 *
 * Supported elements:
 *   - Headings H1–H6
 *   - Normal paragraphs (with inline bold, italic, bold-italic, strikethrough,
 *     monospace/code, hyperlinks)
 *   - Unordered and ordered lists (with nesting)
 *   - Tables (GitHub-flavoured Markdown pipe tables)
 *   - Horizontal rules
 *   - Table of contents (skipped — MkDocs generates its own)
 *   - Inline images (skipped — no meaningful Markdown equivalent)
 *   - [imageN] placeholder strings stripped
 *
 * @param {GoogleAppsScript.Document.Document} doc
 * @returns {string} Markdown text.
 */
function docToMarkdown_(doc) {
  var body        = doc.getBody();
  var numChildren = body.getNumChildren();
  var lines       = [];
  var prevBlank   = false;
  var listCounters = {}; // nestingLevel → ordered list counter

  for (var i = 0; i < numChildren; i++) {
    var child = body.getChild(i);
    var type  = child.getType();

    if (type === DocumentApp.ElementType.PARAGRAPH) {
      var para    = child.asParagraph();
      var heading = para.getHeading();

      // ── List items ────────────────────────────────────────
      var listId = null;
      try { listId = para.getListId(); } catch (e) {}

      if (listId) {
        var nestLevel  = para.getNestingLevel(); // 0-based
        var glyphType  = para.getGlyphType();
        var isOrdered  = (
          glyphType === DocumentApp.GlyphType.NUMBER        ||
          glyphType === DocumentApp.GlyphType.LATIN_UPPER   ||
          glyphType === DocumentApp.GlyphType.LATIN_LOWER   ||
          glyphType === DocumentApp.GlyphType.ROMAN_UPPER   ||
          glyphType === DocumentApp.GlyphType.ROMAN_LOWER
        );
        var indent     = repeatStr('  ', nestLevel);
        var inlineText = paraInlineToMd_(para);

        if (isOrdered) {
          // Reset counters for deeper nesting levels when stepping back out
          Object.keys(listCounters).forEach(function(k) {
            if (parseInt(k, 10) > nestLevel) delete listCounters[k];
          });
          listCounters[nestLevel] = (listCounters[nestLevel] || 0) + 1;
          lines.push(indent + listCounters[nestLevel] + '. ' + inlineText);
        } else {
          lines.push(indent + '- ' + inlineText);
        }
        prevBlank = false;
        continue;
      }

      // Leaving a list — reset ordered counters
      listCounters = {};

      // ── Headings ──────────────────────────────────────────
      var hashes = headingPrefix_(heading);
      var inlineText = paraInlineToMd_(para);

      if (!inlineText.trim()) {
        // Empty paragraph = blank separator line
        if (!prevBlank) { lines.push(''); prevBlank = true; }
        continue;
      }

      if (hashes) {
        // Ensure a blank line before headings (except at start of document)
        if (lines.length > 0 && !prevBlank) { lines.push(''); }
        lines.push(hashes + inlineText);
        lines.push('');
        prevBlank = true;
      } else {
        lines.push(inlineText);
        prevBlank = false;
      }

    } else if (type === DocumentApp.ElementType.TABLE) {
      listCounters = {};
      if (!prevBlank) lines.push('');
      tableToMd_(child.asTable()).forEach(function(l) { lines.push(l); });
      lines.push('');
      prevBlank = true;

    } else if (type === DocumentApp.ElementType.HORIZONTAL_RULE) {
      listCounters = {};
      if (!prevBlank) lines.push('');
      lines.push('---');
      lines.push('');
      prevBlank = true;

    } else if (type === DocumentApp.ElementType.TABLE_OF_CONTENTS) {
      // Skip — MkDocs generates its own TOC from headings
      continue;
    }
    // All other types (inline images at block level, page breaks, etc.) skipped
  }

  var md = lines.join('\n');

  // ── Post-processing ────────────────────────────────────────────────────────
  // 1. Strip [imageN] placeholders (e.g. [image1], [image12])
  md = md.replace(/\[image\d+\]/gi, '');

  // 2. Collapse 3+ consecutive blank lines → 2 (one blank line between blocks)
  md = md.replace(/\n{3,}/g, '\n\n');

  // 3. Remove trailing whitespace on each line
  md = md.split('\n').map(function(l) { return l.replace(/\s+$/, ''); }).join('\n');

  return md.trim() + '\n';
}

/**
 * Return the Markdown heading prefix (e.g. "## ") for a ParagraphHeading enum,
 * or empty string for normal body text.
 */
function headingPrefix_(heading) {
  var H = DocumentApp.ParagraphHeading;
  if (heading === H.HEADING1) return '# ';
  if (heading === H.HEADING2) return '## ';
  if (heading === H.HEADING3) return '### ';
  if (heading === H.HEADING4) return '#### ';
  if (heading === H.HEADING5) return '##### ';
  if (heading === H.HEADING6) return '###### ';
  return '';
}

/**
 * Convert a Paragraph's inline children to Markdown.
 * Handles Text elements (with formatting) and skips InlineImages.
 */
function paraInlineToMd_(para) {
  var result = '';
  var numCh  = para.getNumChildren();
  for (var i = 0; i < numCh; i++) {
    var child = para.getChild(i);
    if (child.getType() === DocumentApp.ElementType.TEXT) {
      result += textElToMd_(child.asText());
    }
    // InlineImage, Equation, etc. — skipped
  }
  return result;
}

/**
 * Convert a Text element (which can have mixed inline formatting across
 * character ranges) to a Markdown string.
 *
 * Uses getTextAttributeIndices() to get run-change boundaries efficiently,
 * avoiding a character-by-character scan on long paragraphs.
 */
function textElToMd_(textEl) {
  var full = textEl.getText();
  if (!full) return '';

  // getTextAttributeIndices() returns the start positions of each distinct
  // formatting run. We append `full.length` as the end sentinel.
  var indices    = textEl.getTextAttributeIndices();
  var boundaries = indices.concat([full.length]);
  var md         = '';

  for (var i = 0; i < boundaries.length - 1; i++) {
    var start = boundaries[i];
    var end   = boundaries[i + 1];
    var t     = full.substring(start, end);
    if (!t) continue;

    var bold    = !!textEl.isBold(start);
    var italic  = !!textEl.isItalic(start);
    var strike  = !!textEl.isStrikethrough(start);
    var font    = textEl.getFontFamily(start) || '';
    var mono    = (font === 'Courier New' || font === 'Roboto Mono' ||
                   font === 'Consolas'    || font === 'Source Code Pro');
    var link    = textEl.getLinkUrl(start);

    // Escape Markdown special chars in plain text runs only
    if (!mono) {
      t = t.replace(/\\/g, '\\\\')
            .replace(/\[/g,  '\\[')
            .replace(/\]/g,  '\\]');
    }

    if (mono) {
      // Inline code — use backticks; double-backtick if content contains backtick
      var tick = t.indexOf('`') >= 0 ? '``' : '`';
      t = tick + t + tick;
    } else {
      if (strike)             t = '~~' + t + '~~';
      if (bold && italic)     t = '***' + t + '***';
      else if (bold)          t = '**' + t + '**';
      else if (italic)        t = '*' + t + '*';
    }

    if (link) t = '[' + t + '](' + link + ')';
    md += t;
  }

  return md;
}

/**
 * Convert a Table element to a GitHub-flavoured Markdown pipe table.
 * First row is treated as the header row.
 * Inline formatting in cells is not currently preserved (plain text only).
 *
 * @returns {string[]} Array of Markdown lines.
 */
function tableToMd_(table) {
  var numRows = table.getNumRows();
  if (numRows === 0) return [];

  // Collect cell text, escaping pipes
  var rows = [];
  for (var r = 0; r < numRows; r++) {
    var row   = table.getRow(r);
    var cells = [];
    for (var c = 0; c < row.getNumCells(); c++) {
      var text = row.getCell(c).getText()
                    .replace(/\n/g, ' ')   // collapse multi-line cells to one line
                    .replace(/\|/g, '\\|') // escape any literal pipes
                    .trim();
      cells.push(text);
    }
    rows.push(cells);
  }

  var numCols = rows[0].length;
  var lines   = [];

  // Header row
  lines.push('| ' + rows[0].join(' | ') + ' |');
  // Separator row
  lines.push('| ' + rows[0].map(function() { return '---'; }).join(' | ') + ' |');
  // Body rows
  for (var r = 1; r < rows.length; r++) {
    var cells = rows[r].slice(0, numCols);
    while (cells.length < numCols) cells.push('');
    lines.push('| ' + cells.join(' | ') + ' |');
  }

  return lines;
}

// ── GitHub REST API — commit a file ───────────────────────────────────────────
/**
 * Create or update a file in the GitHub repo via the Contents API.
 * Fetches the current file SHA first (required for updates).
 *
 * Requires Script Properties:
 *   GITHUB_TOKEN  — fine-grained PAT with "Contents: Read and Write" on the repo.
 *   GITHUB_OWNER  — GitHub username or org (e.g. "rkenefeck").
 *   GITHUB_REPO   — Repository name (e.g. "gototoastmasters").
 *   GITHUB_BRANCH — Branch to commit to (defaults to "main").
 *
 * @param {string} repoPath  File path in the repo (e.g. "docs/roles.md").
 * @param {string} content   UTF-8 file content.
 * @param {string} message   Commit message.
 * @returns {string|null}    HTML URL of the commit, or null.
 */
function commitToGitHub_(repoPath, content, message) {
  var props  = PropertiesService.getScriptProperties();
  var token  = props.getProperty('GITHUB_TOKEN');
  var owner  = props.getProperty('GITHUB_OWNER');
  var repo   = props.getProperty('GITHUB_REPO');
  var branch = props.getProperty('GITHUB_BRANCH') || 'main';

  if (!token || !owner || !repo) {
    throw new Error(
      'GitHub Script Properties not configured. ' +
      'Set GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO in Project Settings → Script Properties.'
    );
  }

  var apiUrl  = 'https://api.github.com/repos/' + owner + '/' + repo +
                '/contents/' + repoPath;
  var headers = {
    'Authorization': 'Bearer ' + token,
    'Accept':        'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // GET the current file to retrieve its SHA (required for updates)
  var currentSha = null;
  var getResp = UrlFetchApp.fetch(apiUrl + '?ref=' + branch, {
    method:            'get',
    headers:           headers,
    muteHttpExceptions: true,
  });
  if (getResp.getResponseCode() === 200) {
    currentSha = JSON.parse(getResp.getContentText()).sha;
  }

  // PUT (create or update)
  var payload = {
    message: message,
    content: Utilities.base64Encode(content, Utilities.Charset.UTF_8),
    branch:  branch,
  };
  if (currentSha) payload.sha = currentSha;

  var putResp = UrlFetchApp.fetch(apiUrl, {
    method:            'put',
    headers:           Object.assign({}, headers, { 'Content-Type': 'application/json' }),
    payload:           JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  var code    = putResp.getResponseCode();
  var respObj = JSON.parse(putResp.getContentText());
  if (code !== 200 && code !== 201) {
    throw new Error('GitHub API ' + code + ': ' +
                    (respObj.message || JSON.stringify(respObj)));
  }

  return respObj.commit ? respObj.commit.html_url : null;
}

// ── Committee notification ────────────────────────────────────────────────────
/**
 * Email the committee account with a publish summary.
 * This is the audit safeguard — an unexpected publish is noticed immediately.
 */
function notifyCommittee_(numChanged, errors) {
  var props  = PropertiesService.getScriptProperties();
  var owner  = props.getProperty('GITHUB_OWNER') || '';
  var repo   = props.getProperty('GITHUB_REPO')  || '';
  var repoUrl = owner && repo
    ? 'https://github.com/' + owner + '/' + repo + '/commits/main'
    : '(repo not configured)';

  var subject = '[GOTO site] ' + numChanged + ' page(s) auto-published';
  var body    = numChanged + ' page(s) were automatically published to gototoastmasters.com.au.\n\n' +
                'Review commits: ' + repoUrl + '\n';

  if (errors && errors.length > 0) {
    body += '\nErrors (' + errors.length + '):\n' +
            errors.map(function(e) { return '  - ' + e; }).join('\n') + '\n';
  }

  body += '\n— GOTO Publish Pipeline (Apps Script)';

  try {
    GmailApp.sendEmail(NOTIFY_EMAIL, subject, body);
  } catch (e) {
    Logger.log('Failed to send notification email: ' + e.message);
  }
}

// ── Trigger setup (run once) ──────────────────────────────────────────────────
/**
 * Create the daily time-based trigger for publishAll().
 * Run this function once from the Apps Script editor after deploying.
 * Safe to re-run — won't create a duplicate trigger.
 */
function createDailyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'publishAll') {
      Logger.log('Daily trigger already exists — skipping.');
      return;
    }
  }
  ScriptApp.newTrigger('publishAll')
    .timeBased()
    .everyDays(1)
    .atHour(3) // 3am Melbourne time
    .create();
  Logger.log('Daily trigger created (runs at 3am Melbourne time).');
}

/**
 * Remove the daily trigger (for maintenance / debugging).
 */
function removeDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'publishAll') {
      ScriptApp.deleteTrigger(t);
      Logger.log('Daily trigger removed.');
    }
  });
}

// ── Helper ────────────────────────────────────────────────────────────────────
function repeatStr(s, n) {
  var r = '';
  for (var i = 0; i < n; i++) r += s;
  return r;
}
