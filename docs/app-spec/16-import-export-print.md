# 16 — Import, Export & Print

## 1. Import (bank files)

### 1.1 Entry points

- File ▸ Import Transactions from Your Bank… (Ctrl+I): imports into the active account if one is selected (in All Accounts there's no default target).
- The register toolbar **Import** button (current account).
- Opening an `.ofx/.qfx/.qif/.csv` with the app (file association / command line), if enabled. If no budget is open, the last budget is opened first. If there's none, the "a budget is open" precondition message below is shown.

Preconditions: a budget is open ("Before importing, please load a budget file." / "Once you load or create a budget file, please try importing again."), at least one account exists ("Before importing, please add at least one account." / "Once you add an account, you can import files from your bank."), and `canEdit` (else the offline dialog).

### 1.2 Import Transactions window (skippable)

```text
 Import Transactions
 Import transactions
 To import transactions, choose a statement file downloaded from your bank in one of these formats:
   Recommended: OFX or QFX
   Also supported: QIF (use when OFX or QFX is unavailable)
   For advanced use: CSV
 [ ] Don't show this again        [Cancel] [Choose file to import...]
```

**Choose file to import...** is the default. The "Don't show this again" tooltip: "If you check this, next time you import, you can skip this dialog and go straight to choosing a file." (stored as `showPreImportDialog = false`, per budget/device). File dialog title "Choose a file to import", filter "All Importable Formats" (`ofx, qfx, qif, csv`). Read errors: TaskDialog "Importing Error" / "There was an error while importing:\n{message}" (or "File could not be found: {name}").

### 1.3 Parsing (host `parsers/`, pure functions with golden-file tests)

Actual's file parsers aren't part of the public API, so the app has its own.

| Format | Rules |
| --- | --- |
| OFX / QFX | Tolerant SGML/XML tag reader (handles unclosed SGML tags; skips `<?…?>` lines). Supports `<BANKMSGSRS>/<STMTRS>`, `<CREDITCARDMSGSRS>/<CCSTMTRS>` and `<INVSTMTMSGSRS>/<INVSTMTRS>` (only `<STMTTRN>` inside `<INVTRANLIST>`). Reads: FID (`<SIGNONMSGSRS>` FID overrides `<BANKID>`/`<BROKERID>`), `<ACCTID>`, `<ACCTTYPE>`; per `<STMTTRN>`: `<DTPOSTED>` (YYYYMMDD prefix; `<DTUSER>` ignored), `<TRNAMT>` (its last `.` or `,` is the decimal point, since OFX has no thousands separators and some currencies have 3 decimals), `<FITID>`, `<NAME>`/`<PAYEE>` (last wins), `<MEMO>`, `<CHECKNUM>` (else `<REFNUM>` when `<TRNTYPE>` is CHECK). Transactions whose date or amount can't be read are dropped, and counted in the results (§1.6). Accounts without transactions are dropped. Character sets: honor `CHARSET`/`encoding`, default windows-1252 → decode with `TextDecoder`. |
| QIF | Sections `!Type:Bank`, `CCard`/`CC`, `Cash`, `Oth A`, `Oth L` (no `!Type:` line ⇒ Bank). An `!Account` block's `N` gives the account number. Fields: `D` date, `T`/`U` amount (a trailing `-` = negative), `N` check #, `P` payee, `M` memo (imported as notes), `L` category; split lines `S` (category) / `E` (memo) / `$` (amount) become subtransactions; `C` and `A` ignored; `^` ends a record. Other `!Type:` sections are skipped. If no account remains: "No accounts were found to import. Please note that Actuality does not support importing stock transactions from investment accounts." |
| CSV | A header row is required. Columns are matched by exact, case-sensitive name: **Date**, **Payee**, **Category**, **Notes**, **Outflow**, **Inflow**; optional **Amount** (signed, used instead of Outflow/Inflow) and **Check**. Rows without a Date or an amount are skipped. RFC 4180 quoting. On any error, the app saves the sample CSV bundled with main (`src/main/dialogs.ts`) to a user-chosen location (save dialog, default the Desktop) and shows "This CSV file is not formatted correctly" / "CSV files are not formatted in a standard way, so your bank's file will likely need to be modified before it can be imported by Actuality. A sample CSV file called **{file}** shows the format Actuality can import." |

- **QIF/CSV text:** UTF-16 (little- or big-endian, found by its byte-order mark or, without one, by the zero bytes of ASCII text; Excel's "Unicode Text" export), else UTF-8 (with or without BOM) when the bytes are valid UTF-8, else windows-1252.
- **QIF/CSV dates:** try Day/Month/Year, Month/Day/Year and Year/Month/Day against every date in the file, and offer only the orders that parse all of them ("Could not parse the dates in this file" if none). The default is the budget's date order if it's valid, else the first valid one. The "Date Format:" combo is shown only when more than one order is valid.
- **Amounts** in QIF and CSV are parsed with an unknown decimal separator (`.` or `,`; the last separator followed by 1–2 digits is the decimal). In OFX the last separator is always the decimal.
- **QIF/CSV categories:** looked up as "Group: Category" (a name without `:` matches a category by name in any group; extra colons → `-`). If there's no match, the transaction is uncategorized and the original text is prepended to the notes as "{category} - " (the notes are just "{category}" when it was empty).
- **Import id per transaction:** `imported_id` = FITID when present. Otherwise the stable key `"AD:" + amount(minor units) + ":" + YYYY-MM-DD + ":" + payee + ":" + n`. Here `payee` is the bank payee text before any swap, trimmed and lower-cased, and n is the 1-based count of that amount + date + payee in the file. Re-importing the same file never duplicates. Including the payee keeps two different same-amount, same-day transactions in different files (overlapping statements) from being mistaken for one already imported.
- **Payee:** if it's `Transfer: X` and X is the target account itself or not an existing account → the plain payee `Transfer (X)`. `imported_payee` = the payee as read (after any swap).

### 1.4 Account mapping & preview (one dialog per account in the file)

```text
 Import Transactions
 12 transactions will be imported from CHECKING: ********1234 into:
 [ Checking                 ▾ ]   (open accounts by name + "<Skip this account>")
 ⓘ This file has transactions that are dated before this account's start date.
   Importing them will modify the account's starting balance.
   [ ] Include transactions dated before account start date (3)
 Import Preview
 ┌────────┬───────┬────────────────┬──────────┬─────────┐
 │ Date   │Check# │ Payee          │ Notes    │ Amount  │
 └────────┴───────┴────────────────┴──────────┴─────────┘
 Date Format: [ Month/Day/Year ▾ ]        (QIF/CSV only, when ambiguous)
 Notes: [x] Import  [ ] Swap with Payees              [Cancel] [Next | Import]
```

- Prompt: "{n} transaction(s) will be imported from **{account}** into:", where {account} = "{ACCTTYPE or QIF type}: ********{last 4 of account id}" (either part may be missing; "this file" if both are). Width `--dialog-w-lg`. Preview row height `--row-h`.
- The target, "Import notes", "Swap with Payees" and (QIF only) the chosen date order are remembered per bank account (`ad:import-mappings`, `04` §5.3) and saved on **Next/Import**. A remembered date order is the default next time if it still parses every date in the file. The key depends on the format:
  - OFX/QFX: `{FID}|{ACCTID}`;
  - QIF with an `!Account` number: `qif|{number}`;
  - QIF without one, and every CSV: no key, so nothing is remembered, and the target defaults as below. With no mapping, the target is the account the import started from, else the first account by name. For the 2nd+ account in a file, the previous dialog's swap/notes/include settings (and target, if it has no mapping) are copied.
- Swap is switched on automatically when no transaction has a payee but some have notes (unless there's a saved mapping).
- Tooltips: Import — "Include the notes column in the import"; Swap — "Causes notes to be imported into the payee field, and payees to be imported into the notes field."
- The start-date warning panel animates open (250 ms) only when transactions fall before the target's start date (the date of its starting-balance transaction, or its earliest transaction). Those transactions are excluded unless ticked (unticked by default). If included, the starting balance is adjusted by minus the sum of those Actual **added** (§1.5): rows it matched to existing transactions are already in the balance, so importing the same file again leaves the starting balance alone.
- The button reads **Next** until the last account, then **Import**. **Cancel** aborts the whole import (nothing is written).

### 1.5 Duplicate detection & matching (Actual) — X4

For each target account (one host job):

1. Build the Actual transactions:
   - `date`, `amount`, `payee_name`, `imported_payee`, `imported_id`. When the bank text matches a **disabled** payee (case-insensitive), `payee_name` is omitted and only `imported_payee` is sent (`14` §2);
   - `notes = encode(notes, checkNumber, 'none', needsReview=true)`;
   - category (QIF/CSV) or none;
   - `subtransactions` (QIF splits).
2. `importTransactions(accountId, txns, { defaultCleared: true, dryRun: false, reimportDeleted: false, payeeNameNormalization: 'original' })` → `{added, updated, errors}`. `'original'` is required. The default `'title-case'` rewrites the bank text and new payee names. There is no dry run: the dialog previews the file's own rows, and the results come from this call. Actual lists a split's lines among `added`, so the host counts transactions, not rows.
3. **Updated** (Actual matched them to existing transactions): add `#needs-review` to their notes, so the user reviews matches as in the classic workflow. Actual also merges the imported fields into the existing transaction.
   **Added rows linked to a schedule** by Actual's rules (`12` §2): restore the imported notes and check number, keep `#needs-review`, and keep the schedule's category only if the row had none.
   **Other added rows** whose notes a rule changed (`23` §5): put back the imported check number and `#needs-review` if the rule removed them, keeping the rest of the notes as the rule left them.
4. Starting-balance adjustment, if chosen (§1.4).

Actual's reconciliation does the dedup and matching: an identical `imported_id` is never added twice, and the same amount with a similar date and payee is matched.

### 1.6 Results dialog

After the "Importing..." overlay, the title is "Import successful" / "Import partially successful" (some accounts failed) / "Import failed". Per account (HTML list):

- "**Import from {bank account} into {account}:**" (+ " Failed: {error}") or "**Import from {bank}:** Skipped"
- "{n} transactions have been imported" / "1 transaction has been imported." (added + updated; always shown)
- "{n} new transactions were matched with existing transactions" / "1 new transaction was matched with an existing transaction" (updated; only if > 0)
- "{n} transactions had already been imported and were ignored" / "1 transaction had already been imported and was ignored" (input − added − updated; only if > 0)
- "{n} transactions couldn't be read and were skipped" / "1 transaction couldn't be read and was skipped" (OFX transactions whose date or amount couldn't be read, §1.3; only if > 0)
- "The starting balance has been modified to offset transactions imported before the account start date."

Other messages: "No transactions were found to import" / "This file contains no accounts with transactions to import." (followed by " {n} transactions in it couldn't be read." / " 1 transaction in it couldn't be read." when the OFX accounts it dropped had transactions whose date or amount couldn't be read, §1.3); "No accounts were found to import" / "This file appears to be empty or is malformed. Please try downloading it again.".

Afterwards the register navigates to All Accounts (several accounts) or to the last successfully imported open account, and re-sorts.

## 2. Export

### 2.1 File ▸ Export… (Ctrl+E)

TaskDialog "Export" — "Choose how you would like to export your data:" — command links:

- **Export to CSV** — "Transaction and budget data are exported. CSV files can be loaded by Excel and other spreadsheet programs."
- **Export to QIF** — "Transactions are exported, but budget data is not. QIF files can be imported by many other financial programs."
- **Export Budget to CSV** (only on the Budget screen) — "Only budget data is exported. CSV files can be loaded by Excel and other spreadsheet programs."
- Cancel.

On the Register screen, a footer checkbox **"Export current register view only"** limits the export to the current account/search/date filter.

Destination: a folder picker (default: last used, else Documents). The file names are below. Existing files → "Overwrite file(s)?" / "The following file(s) already exist:\n {name}\n…\nIs it okay to overwrite these file(s)?" (**Overwrite files** / Cancel). There's an "Exporting..." overlay. Errors: "There was an error during the export" (locked: "The export file is in use, and can't be written to.\nPlease close the file and try exporting again"). `{ts}` = "YYYY-MM-DD HHmm".

Export works offline (read-only).

### 2.2 CSV formats

UTF-8 with BOM, `\n` line ends. Separator `,`, or **Tab** when the decimal separator is `,`. Text fields (header names, Account, Payee, Category, Master/Sub Category, Notes, Month) are quoted with embedded quotes doubled. Numbers, dates, cleared and check number are bare. Amounts have no thousands separators.

Files: "{budget} as of {ts}-Register.csv" and "{budget} as of {ts}-Budget.csv" (**Export to CSV** writes both; **Export Budget to CSV** writes only the budget file). Success: "Two files were successfully exported:" / "Budget successfully exported" + names, with **Open Output Folder** / Close.

- **Register** columns: `Account, Check Number, Date, Payee, Category, Master Category, Sub Category, Notes, Outflow, Inflow, Cleared, Running Balance`. Dates use the long-year date format. Cleared = `U`/`C`/`R`. Category = "Group: Category". Tags remain in the Notes text. Without the "current view" option, all accounts are written account by account. Splits produce one line per subtransaction: Payee = "{parent payee} / {transfer account text}" for transfer lines; Notes = "(Split {i}/{n}) " + line notes + " / " + parent notes (separator only when both exist); cleared/check/running balance come from the parent.
- **Budget** columns: `Month, Category, Master Category, Sub Category, Budgeted, Outflows, Category Balance`. One line per category per month, from the first to the last month with data, with a blank line after each month. Month = "MMMM YYYY". Values are the envelope budget's `budgeted/activity/balance`.

### 2.3 QIF

One file per account: "{budget}-{account} as of {ts}.qif" (just the current view when "current register view only" is ticked). Success: "Each account was exported as a separate QIF file:" / "The account view was exported as a QIF file:" + names, with **Open Output Folder** / Close.

Each file starts with `!Type:Bank`, then per transaction:

- `D` date (`MM/DD/YYYY` if the date order starts with month, else `DD/MM/YYYY`);
- `T` amount (no symbol or separators, `.` decimal);
- `P` payee (transfers keep "Transfer: X");
- `M` memo (the notes);
- `N` check number;
- `Cc` (cleared) / `CR` (reconciled);
- `L` category ("Group: Category" or `Split Transaction`; omitted when uncategorized);
- split lines `S` / `E` / `$`;
- `^`.

### 2.4 Reports CSV

Reports offers CSV and Print only (`15` §7); Excel and PDF export formats are out of scope.
CSV exports the active report's normalized table data, including all rows represented by collapsed
groups and members of an aggregated Other row. It reflects the active page's effective filters and
options, not uncommitted picker drafts. Headers and labels use the UI language; amounts use the
budget's decimal format with no currency symbol or thousands separators, and date values use the
budget's date format. Use UTF-8 with BOM, the current CSV separator and quoting rules in §2.2, and
`\n` line endings. The file starts with the report's name, Timeframe (with the range it resolved
to), filters and options, one per line; then each table under its title, child rows indented by two
spaces in the label column. The suggested file name is `Actuality {Report} {range}.csv`. The
native save dialog asks before replacing a file; the host writes it (`export.reportCsv`, `03` §8). When privacy mode
is enabled, mask monetary values in the CSV using the same masking behavior as the visible report
(`15` §7). Canceling the native save dialog produces no success status. Overwrite and file-write
errors follow §2.1.

## 3. Print (File ▸ Print…, Ctrl+P)

Context-sensitive. The renderer builds a **print view** (an HTML document styled for A4/Letter portrait with `@page` margins 15 mm and alternating row shading). The print view always uses the **Light** palette, or **Light CVD** when `colorVision` is `cvd`, whatever the on-screen appearance (`05` §1.9). Main loads it in a hidden `BrowserWindow` and shows a preview window titled "Print Preview" with **Print…** (`webContents.print({})`, the OS dialog) and **Save as PDF…** (`printToPDF`). Only one preview at a time.

| Screen | Printout |
| --- | --- |
| Budget | Title "Budget For {Mon 'YY}" for the selected month. Summary block: "Not Budgeted in {prev}", "Overspent in {prev}", "Income for {month}", "Budgeted in {month}" (+ "Held for {next}" when ≠ 0) and "Available to Budget" (or "Warning: Over-Budgeted" when negative). Table columns **Category**, **Budgeted**, **Spent**, **Balance**: group rows with totals, then their category rows (negative balances flagged). Uncategorized first, Hidden last, both without children. A totals row. Spent is shown positive. |
| Register | The current account (or All Accounts) with the current search/date filter. Header: account name, "Showing:" {date filter}, "Search:" {search text}, "Search Total", and "Cleared Balance" + "Uncleared Transactions" = "Working Balance". Footer "Page N of M". Columns: Account, Check #, Date, Payee, Category, Notes, Outflow, Inflow, Balance, C. Hidden register columns are omitted. Tags are printed as `#name` text within Notes. Widths are proportional to the on-screen widths. Split lines print as extra indented rows. |
| Reports | The active report with its effective filters and options, including the same report values and table rows as the screen. Charts include a visible legend and labels; tables are printed in full, including collapsed groups and Other members. Print follows privacy mode and uses the Light or Light CVD palette (`05` §1.9, §1.11). |

Reports opens the existing print preview from its Export menu. The preview and system print dialog
are the print path; there is no separate PDF export option. Respect the active report's
privacy masking in the print document.

## 4. Acceptance criteria

1. Golden-file parser tests for OFX (SGML and XML variants), QFX, QIF (with splits, multiple accounts, every date order) and CSV (Amount vs Outflow/Inflow).
2. Importing the same OFX twice adds nothing the second time and reports "had already been imported".
3. CSV/QIF exports match golden files for the fixture budget.
4. Print preview renders Budget, Register, and Reports contexts, and the PDF output is non-empty.
