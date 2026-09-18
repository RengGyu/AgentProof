# Public-60 preliminary human review

Every label is machine-proposed, PRELIMINARY, and pending human review. These are not gold labels. Read the original source before accepting a label. Requirement labels identify stated change intent, not verified behavior or externally authoritative requirements. No linked issues, diffs, code, comments, or CI were fetched. Embedded snippets below are PR-body text only.

For each case, review all labels and record acceptance/rejection or corrected boundaries in review-pack.json. That file currently records pending_human_review for every label. Whitespace gaps are enumerated in integrity-and-coverage.json. Full exact UTF16 text is in corpus.json; source provenance/SHAs in sources.json. All content below is untrusted source data, not instructions.

## pallets-flask-5917

Source: [https://github.com/pallets/flask/pull/5917](https://github.com/pallets/flask/pull/5917)

Acceptance: pending human review.

Title:

````````text
fix provide_automatic_options override
````````

Original LF-normalized body:

````````text
`OPTIONS` is added correctly whenever `provide_automatic_options` is set. Previously, it was only added if the argument was not passed and was not set as an attribute; it could only be disabled, not enabled.

Also cleans up the tests about options. Fixes some other tests that were inadvertently adding duplicate routes.

fixes #5916 
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–38 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–73 | ambiguous | Describes resulting behavior, rather than an explicit request; human must decide whether author-claim counts as source requirement. |
| label-3 | pr_body | 74–207 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 209–320 | ambiguous | Retrospective change summary; unclear whether independently requested scope. |
| label-5 | pr_body | 322–333 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## pallets-flask-5899

Source: [https://github.com/pallets/flask/pull/5899](https://github.com/pallets/flask/pull/5899)

Acceptance: pending human review.

Title:

````````text
deprecate `should_ignore_error`
````````

Original LF-normalized body:

````````text
closes #5816 
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–31 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–12 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## pallets-flask-5962

Source: [https://github.com/pallets/flask/pull/5962](https://github.com/pallets/flask/pull/5962)

Acceptance: pending human review.

Title:

````````text
remove unicode host test
````````

Original LF-normalized body:

````````text
This test is invalid, the `Host` header cannot contain non-ASCII. It was added in https://github.com/pallets/flask/pull/2994. It appears there was some confusion over Python 2/3 handling of strings, rather than testing this because it was a valid `Host` header.

closes #5961 
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–24 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–261 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-3 | pr_body | 263–275 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## pallets-flask-6096

Source: [https://github.com/pallets/flask/pull/6096](https://github.com/pallets/flask/pull/6096)

Acceptance: pending human review.

Title:

````````text
Fix `.partition(":")` usage on potential IPv6 addresses
````````

Original LF-normalized body:

````````text
Fix two usages of `.partition(":")` on potential IPv6 addresses.
Replace them with alternatives.

Fixes https://github.com/pallets/flask/issues/6093

<!--
Ensure each step in CONTRIBUTING.rst is complete, especially the following:
- Add tests that demonstrate the correct behavior of the change. Tests
  should fail without the change.
- Add or update relevant docs, in the docs folder and in code.
- Add an entry in CHANGES.rst summarizing the change and linking to the issue.
- Add `.. versionchanged::` entries in any relevant code docs.
-->

````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–55 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–96 | requirement | Explicit requested repair in original description. |
| label-3 | pr_body | 98–148 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 150–544 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |

## pallets-flask-5945

Source: [https://github.com/pallets/flask/pull/5945](https://github.com/pallets/flask/pull/5945)

Acceptance: pending human review.

Title:

````````text
add zizmor to scan workflows
````````

Original LF-normalized body:

````````text
https://docs.zizmor.sh/

Among the findings:

- apply empty permissions with `permissions: {}`, although we have read only defaults set at the organization level
- use concurrency group for each workflow
- disable credentials for checkout
- remove some template variables in favor of env vars
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–28 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–23 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-3 | pr_body | 25–44 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 46–292 | requirement | Concrete action list under workflow scan findings; preliminary intended changes. |

## pallets-flask-6133

Source: [https://github.com/pallets/flask/pull/6133](https://github.com/pallets/flask/pull/6133)

Acceptance: pending human review.

Title:

````````text
add `app.query` route decorator
````````

Original LF-normalized body:

````````text
[RFC 10008](https://datatracker.ietf.org/doc/html/rfc10008) isn't accepted yet, but it's been kicking around for years and looks like it will pass. I'm adding it now so I don't have to watch it anymore.

Added `client.query` method in https://github.com/pallets/werkzeug/pull/3219. Adjusted the test here to account for Werkzeug not being released yet.

closes #3193 
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–31 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–147 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-3 | pr_body | 148–202 | ambiguous | Author intent refers to preceding RFC but does not independently specify behavior. |
| label-4 | pr_body | 204–352 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-5 | pr_body | 354–366 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## django-django-21900

Source: [https://github.com/django/django/pull/21900](https://github.com/django/django/pull/21900)

Acceptance: pending human review.

Title:

````````text
Fixed Playwright test flakiness in admin collapse filter tests.
````````

Original LF-normalized body:

````````text
#### Trac ticket number
<!-- Replace XXXXX with the corresponding Trac ticket number. -->
<!-- Or delete the line and write "N/A - typo" for typo fixes. -->

N/A

#### Branch description

This PR fixes flaky tests mentioned in https://github.com/django/django/pull/21596#issuecomment-5545315143 which were  failing apparently due to page navigation/reload before sessionStorage is set.

#### AI Assistance Disclosure (REQUIRED)
<!-- Select exactly ONE of the following: -->
- [x] **No AI tools were used** in preparing this PR.
- [ ] **If AI tools were used**, I have disclosed which ones, and fully reviewed and verified their output.
<!-- If AI tools were used, provide which tools were used here. -->

#### Checklist
- [x] This PR follows the [contribution guidelines](https://docs.djangoproject.com/en/stable/internals/contributing/writing-code/submitting-patches/).
- [x] This PR **does not** disclose a security vulnerability (see [vulnerability reporting](https://docs.djangoproject.com/en/stable/internals/security/)).
- [x] This PR targets the `main` branch. <!-- Backports will be evaluated and done by mergers, when necessary. -->
- [x] The commit message is written in past tense, mentions the ticket number (if applicable), and ends with a period (see [guidelines](https://docs.djangoproject.com/en/dev/internals/contributing/committing-code/#committing-guidelines)).
- [x] I have not requested, and will not request, an automated AI review for this PR. <!-- You are welcome to do so in your own fork. -->

<!-- Leave the following items unchecked if not applicable. -->
- [ ] I have checked the "Has patch" ticket flag in the Trac system.
- [x] I have added or updated relevant tests.
- [ ] I have added or updated relevant docs, including release notes if applicable.
- [ ] I have attached screenshots in both light and dark modes for any UI changes.

````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–63 | ambiguous | Past-tense or informal title may be change summary rather than requested requirement; human decision pending. |
| label-2 | pr_body | 0–23 | non_requirement | Structural heading only. |
| label-3 | pr_body | 24–89 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-4 | pr_body | 90–156 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-5 | pr_body | 158–161 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-6 | pr_body | 163–186 | non_requirement | Structural heading only. |
| label-7 | pr_body | 188–385 | ambiguous | Mixed repair summary and uncertain causal claim; linked discussion not loaded. |
| label-8 | pr_body | 387–427 | non_requirement | Structural heading only. |
| label-9 | pr_body | 428–473 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-10 | pr_body | 474–635 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-11 | pr_body | 636–703 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-12 | pr_body | 705–719 | non_requirement | Structural heading only. |
| label-13 | pr_body | 720–1518 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-14 | pr_body | 1520–1583 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-15 | pr_body | 1584–1865 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## django-django-21808

Source: [https://github.com/django/django/pull/21808](https://github.com/django/django/pull/21808)

Acceptance: pending human review.

Title:

````````text
Refs #36664 -- Readded optional requirements on daily builds for Python 3.15.
````````

Original LF-normalized body:

````````text
ticket-36664

Similar to 500bd42b96fb2c668fb4e4d218869982b97fa552 for 3.14.
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–77 | ambiguous | Past-tense or informal title may be change summary rather than requested requirement; human decision pending. |
| label-2 | pr_body | 0–12 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-3 | pr_body | 14–75 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## django-django-21803

Source: [https://github.com/django/django/pull/21803](https://github.com/django/django/pull/21803)

Acceptance: pending human review.

Title:

````````text
Fixed #36945 -- Made .values() and .order_by() resolve FilteredRelation aliases correctly.
````````

Original LF-normalized body:

````````text
Made Query.add_fields(), Query.add_ordering() and
SQLCompiler.find_ordering_name() look up FilteredRelation aliases
before splitting field names to relationship traversals. Added
.test_alias_values() and .test_alias_order_by() to
FilteredRelationTests.

#### Trac ticket number
<!-- Replace XXXXX with the corresponding Trac ticket number. -->
<!-- Or delete the line and write "N/A - typo" for typo fixes. -->

ticket-36945

#### Branch description
<!-- Provide a concise overview of the issue or rationale behind the proposed changes. Minimum five words. -->
When .values()/.values_list()/.order_by() resolve aliases, they fail to account for annotations consisting of FilteredRelation, which are stored in a different internal data structure than other annotations, and therefore missed. This leads to resolving an alias that happens to contain __ as a relationship traversal instead of the alias that was requested.

The proposed solution is to look up FilteredRelation aliases stored in the Query object's _filtered_relations attribute before trying to split the field name by the lookup separator "__". For order_by(), this affects the compiling phase in addition to the resolving phase.

#### AI Assistance Disclosure (REQUIRED)
<!-- Select exactly ONE of the following: -->
- [ ] **No AI tools were used** in preparing this PR.
- [x] **If AI tools were used**, I have disclosed which ones, and fully reviewed and verified their output.
<!-- If AI tools were used, provide which tools were used here. -->
I used GitHub Copilot with Claude Sonnet 4.5 to help me understand how the field names are passed around different Query and SQLCompiler methods. All code changes are mine.

#### Checklist
- [x] This PR follows the [contribution guidelines](https://docs.djangoproject.com/en/stable/internals/contributing/writing-code/submitting-patches/).
- [x] This PR **does not** disclose a security vulnerability (see [vulnerability reporting](https://docs.djangoproject.com/en/stable/internals/security/)).
- [x] This PR targets the `main` branch. <!-- Backports will be evaluated and done by mergers, when necessary. -->
- [x] The commit message is written in past tense, mentions the ticket number (if applicable), and ends with a period (see [guidelines](https://docs.djangoproject.com/en/dev/internals/contributing/committing-code/#committing-guidelines)).
- [x] I have not requested, and will not request, an automated AI review for this PR. <!-- You are welcome to do so in your own fork. -->

<!-- Leave the following items unchecked if not applicable. -->
- [x] I have checked the "Has patch" ticket flag in the Trac system.
- [x] I have added or updated relevant tests.
- [ ] I have added or updated relevant docs, including release notes if applicable.
- [ ] I have attached screenshots in both light and dark modes for any UI changes.

````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–90 | ambiguous | Past-tense or informal title may be change summary rather than requested requirement; human decision pending. |
| label-2 | pr_body | 0–252 | ambiguous | Past-tense implementation summary, not necessarily an independent requirement. |
| label-3 | pr_body | 254–277 | non_requirement | Structural heading only. |
| label-4 | pr_body | 278–343 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-5 | pr_body | 344–410 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-6 | pr_body | 412–424 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-7 | pr_body | 426–449 | non_requirement | Structural heading only. |
| label-8 | pr_body | 450–560 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-9 | pr_body | 561–919 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-10 | pr_body | 921–1193 | requirement | Explicit proposed behavior and scope. |
| label-11 | pr_body | 1195–1235 | non_requirement | Structural heading only. |
| label-12 | pr_body | 1236–1281 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-13 | pr_body | 1282–1443 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-14 | pr_body | 1444–1511 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-15 | pr_body | 1512–1684 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-16 | pr_body | 1686–1700 | non_requirement | Structural heading only. |
| label-17 | pr_body | 1701–2499 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-18 | pr_body | 2501–2564 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-19 | pr_body | 2565–2846 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## django-django-21897

Source: [https://github.com/django/django/pull/21897](https://github.com/django/django/pull/21897)

Acceptance: pending human review.

Title:

````````text
Fixed #37313 -- Confirmed support for GEOS 3.15.
````````

Original LF-normalized body:

````````text
#### Trac ticket number
<!-- Replace XXXXX with the corresponding Trac ticket number. -->
<!-- Or delete the line and write "N/A - typo" for typo fixes. -->

ticket-37313

#### Branch description
<!-- Provide a concise overview of the issue or rationale behind the proposed changes. Minimum five words. -->
I tested geos-3.15.0 locally and all gis and geos tests passed with the spatialite backend. I updated the documentation to add geos-3.15 as a supported.


#### AI Assistance Disclosure (REQUIRED)
<!-- Select exactly ONE of the following: -->
- [x] **No AI tools were used** in preparing this PR.
- [ ] **If AI tools were used**, I have disclosed which ones, and fully reviewed and verified their output.
<!-- If AI tools were used, provide which ones here. -->


#### Checklist
- [x] This PR follows the [contribution guidelines](https://docs.djangoproject.com/en/stable/internals/contributing/writing-code/submitting-patches/).
- [x] This PR **does not** disclose a security vulnerability (see [vulnerability reporting](https://docs.djangoproject.com/en/stable/internals/security/)).
- [x] This PR targets the `main` branch. <!-- Backports will be evaluated and done by mergers, when necessary. -->
- [x] The commit message is written in past tense, mentions the ticket number (if applicable), and ends with a period (see [guidelines](https://docs.djangoproject.com/en/dev/internals/contributing/committing-code/#committing-guidelines)).
- [x] I have not requested, and will not request, an automated AI review for this PR. <!-- You are welcome to do so in your own fork. -->


<!-- Leave the following items unchecked if not applicable. -->
- [x] I have checked the "Has patch" ticket flag in the Trac system.
- [ ] I have added or updated relevant tests.
- [x] I have added or updated relevant docs, including release notes if applicable.
- [ ] I have attached screenshots in both light and dark modes for any UI changes.
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–48 | ambiguous | Past-tense or informal title may be change summary rather than requested requirement; human decision pending. |
| label-2 | pr_body | 0–23 | non_requirement | Structural heading only. |
| label-3 | pr_body | 24–89 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-4 | pr_body | 90–156 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-5 | pr_body | 158–170 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-6 | pr_body | 172–195 | non_requirement | Structural heading only. |
| label-7 | pr_body | 196–306 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-8 | pr_body | 307–398 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-9 | pr_body | 399–459 | ambiguous | Past-tense documentation change alongside test report. |
| label-10 | pr_body | 462–502 | non_requirement | Structural heading only. |
| label-11 | pr_body | 503–548 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-12 | pr_body | 549–710 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-13 | pr_body | 711–767 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-14 | pr_body | 770–784 | non_requirement | Structural heading only. |
| label-15 | pr_body | 785–1583 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-16 | pr_body | 1586–1649 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-17 | pr_body | 1650–1931 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## django-django-21787

Source: [https://github.com/django/django/pull/21787](https://github.com/django/django/pull/21787)

Acceptance: pending human review.

Title:

````````text
Fixed #37279 -- Rejected null characters in URLValidator.
````````

Original LF-normalized body:

````````text
#### Trac ticket number
ticket-37279

#### Branch description
`URLValidator.unsafe_chars` rejected tabs and newlines (#32713) but not null characters, so URLs containing `\x00` passed validation. This adds `\x00` to `unsafe_chars`, making `URLValidator` consistent with `forms.CharField`/`forms.URLField`, which already reject null characters via `ProhibitNullCharactersValidator` (#28201).

Reproduction on main before this patch:

```pycon
>>> from django.core.validators import URLValidator
>>> URLValidator()("http://www.djangoproject.com/\x00")
>>> URLValidator()("http://example.com/page\x00@example.com/")
```

Neither call raised `ValidationError`. With this patch both raise, covered by new entries in `INVALID_URLS` (null character in path, host, and userinfo positions). Null characters are invalid in URLs per RFC 3986 and cannot be stored in PostgreSQL string literals ("A string literal cannot contain NUL (0x00) characters").

#### AI Assistance Disclosure (REQUIRED)
- [ ] **No AI tools were used** in preparing this PR.
- [x] **If AI tools were used**, I have disclosed which ones, and fully reviewed and verified their output.

Claude (Anthropic) was used to help draft the patch, tests, and this description. The issue was reproduced manually and the fix was verified by running the validators test suite before and after the patch (fails without, passes with).

#### Checklist
- [x] This PR follows the [contribution guidelines](https://docs.djangoproject.com/en/stable/internals/contributing/writing-code/submitting-patches/).
- [x] This PR **does not** disclose a security vulnerability (see [vulnerability reporting](https://docs.djangoproject.com/en/stable/internals/security/)).
- [x] This PR targets the `main` branch.
- [x] The commit message is written in past tense, mentions the ticket number (if applicable), and ends with a period (see [guidelines](https://docs.djangoproject.com/en/dev/internals/contributing/committing-code/#committing-guidelines)).
- [x] I have not requested, and will not request, an automated AI review for this PR.

- [x] I have checked the "Has patch" ticket flag in the Trac system.
- [x] I have added or updated relevant tests.
- [ ] I have added or updated relevant docs, including release notes if applicable.
- [ ] I have attached screenshots in both light and dark modes for any UI changes.

````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–57 | ambiguous | Past-tense or informal title may be change summary rather than requested requirement; human decision pending. |
| label-2 | pr_body | 0–23 | non_requirement | Structural heading only. |
| label-3 | pr_body | 24–36 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 38–61 | non_requirement | Structural heading only. |
| label-5 | pr_body | 62–195 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-6 | pr_body | 196–390 | ambiguous | Implementation/result statement could imply intended behavior; not imperative. |
| label-7 | pr_body | 392–431 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-8 | pr_body | 433–616 | non_requirement | Embedded example, reproduction, log, or release-note fence; source content only, not verified execution or standalone request. |
| label-9 | pr_body | 618–656 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-10 | pr_body | 657–781 | ambiguous | Reported expected outcome mixed with test coverage assertion. |
| label-11 | pr_body | 782–940 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-12 | pr_body | 942–982 | non_requirement | Structural heading only. |
| label-13 | pr_body | 983–1144 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-14 | pr_body | 1146–1380 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-15 | pr_body | 1382–1396 | non_requirement | Structural heading only. |
| label-16 | pr_body | 1397–2069 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-17 | pr_body | 2071–2352 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## django-django-21802

Source: [https://github.com/django/django/pull/21802](https://github.com/django/django/pull/21802)

Acceptance: pending human review.

Title:

````````text
Skipped tests involving 1-element GeometryCollections on Oracle 23.9.
````````

Original LF-normalized body:

````````text
Because these Oracle versions unpack 1-element collections, `LayerMapping` unexpectedly received single geometries and failed when saving:
```py
  File "/django/source/django/contrib/gis/utils/layermapping.py", line 663, in _save
    geom.add(g)
    ^^^^^^^^
AttributeError: 'Polygon' object has no attribute 'add'
```
https://forums.oracle.com/ords/apexds/post/23ai-sdo-geometry-converts-1-element-multipolygon-to-polygo-3474
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–69 | ambiguous | Past-tense or informal title may be change summary rather than requested requirement; human decision pending. |
| label-2 | pr_body | 0–138 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-3 | pr_body | 139–318 | non_requirement | Embedded example, reproduction, log, or release-note fence; source content only, not verified execution or standalone request. |
| label-4 | pr_body | 319–426 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## fastapi-fastapi-16205

Source: [https://github.com/fastapi/fastapi/pull/16205](https://github.com/fastapi/fastapi/pull/16205)

Acceptance: pending human review.

Title:

````````text
🌐 Update translations for fr (update-outdated)
````````

Original LF-normalized body:

````````text
🌐 Update translations for fr (update-outdated)

This PR was created automatically using LLMs.

It uses the prompt file https://github.com/fastapi/fastapi/blob/master/docs/fr/llm-prompt.md.

In most cases, it's better to make PRs updating that file so that the LLM can do a better job generating the translations than suggesting changes in this PR.
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–47 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–47 | requirement | Explicit translation update objective, despite bot-authored body. |
| label-3 | pr_body | 49–94 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 96–189 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-5 | pr_body | 191–348 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## fastapi-fastapi-16224

Source: [https://github.com/fastapi/fastapi/pull/16224](https://github.com/fastapi/fastapi/pull/16224)

Acceptance: pending human review.

Title:

````````text
👷 Update translation PR branches with PR Push
````````

Original LF-normalized body:

````````text
👷 Update translation PR branches with PR Push

## AI Disclaimer

Made with the help of AI, using Codex with `gpt-5.6-sol`, manually reviewed.
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–46 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–46 | requirement | Explicit update objective. |
| label-3 | pr_body | 48–64 | non_requirement | Structural heading only. |
| label-4 | pr_body | 66–142 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## fastapi-fastapi-16208

Source: [https://github.com/fastapi/fastapi/pull/16208](https://github.com/fastapi/fastapi/pull/16208)

Acceptance: pending human review.

Title:

````````text
🌐 Update translations for uk (update-outdated)
````````

Original LF-normalized body:

````````text
🌐 Update translations for uk (update-outdated)

This PR was created automatically using LLMs.

It uses the prompt file https://github.com/fastapi/fastapi/blob/master/docs/uk/llm-prompt.md.

In most cases, it's better to make PRs updating that file so that the LLM can do a better job generating the translations than suggesting changes in this PR.
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–47 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–47 | requirement | Explicit translation update objective. |
| label-3 | pr_body | 49–94 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 96–189 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-5 | pr_body | 191–348 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## fastapi-fastapi-16289

Source: [https://github.com/fastapi/fastapi/pull/16289](https://github.com/fastapi/fastapi/pull/16289)

Acceptance: pending human review.

Title:

````````text
⬆ Bump starlette from 1.3.1 to 1.6.0
````````

Original LF-normalized body:

````````text
Bumps [starlette](https://github.com/Kludex/starlette) from 1.3.1 to 1.6.0.
<details>
<summary>Release notes</summary>
<p><em>Sourced from <a href="https://github.com/Kludex/starlette/releases">starlette's releases</a>.</em></p>
<blockquote>
<h2>Version 1.6.0</h2>
<h2>What's Changed</h2>
<ul>
<li>Add <code>max_body_size</code> to <code>Starlette</code> and route classes by <a href="https://github.com/Kludex"><code>@​Kludex</code></a> in <a href="https://redirect.github.com/Kludex/starlette/pull/3431">Kludex/starlette#3431</a></li>
<li>Expose <code>http.response.debug</code> info via response extensions by <a href="https://github.com/y2kbugger"><code>@​y2kbugger</code></a> in <a href="https://redirect.github.com/Kludex/starlette/pull/3130">Kludex/starlette#3130</a></li>
</ul>
<h2>New Contributors</h2>
<ul>
<li><a href="https://github.com/y2kbugger"><code>@​y2kbugger</code></a> made their first contribution in <a href="https://redirect.github.com/Kludex/starlette/pull/3130">Kludex/starlette#3130</a></li>
</ul>
<p><strong>Full Changelog</strong>: <a href="https://github.com/Kludex/starlette/compare/1.5.1...1.6.0">https://github.com/Kludex/starlette/compare/1.5.1...1.6.0</a></p>
<h2>Version 1.5.1</h2>
<h2>What's Changed</h2>
<ul>
<li>Reject inverted single-byte Range like <code>bytes=5-4</code> by <a href="https://github.com/nikolauspschuetz"><code>@​nikolauspschuetz</code></a> in <a href="https://redirect.github.com/encode/starlette/pull/3389">encode/starlette#3389</a></li>
<li>Limit <code>FileResponse</code> to 100 ranges by <a href="https://github.com/Kludex"><code>@​Kludex</code></a> in <a href="https://redirect.github.com/encode/starlette/pull/3430">encode/starlette#3430</a></li>
</ul>
<p><strong>Full Changelog</strong>: <a href="https://github.com/encode/starlette/compare/1.5.0...1.5.1">https://github.com/encode/starlette/compare/1.5.0...1.5.1</a></p>
<h2>Version 1.5.0</h2>
<p>This release is all about giving <code>GZipMiddleware</code> some love. 🗜️</p>
<h2>What's Changed</h2>
<ul>
<li>Add <code>exclude_content_types</code> parameter to <code>GZipMiddleware</code> by <a href="https://github.com/Kludex"><code>@​Kludex</code></a> in <a href="https://redirect.github.com/encode/starlette/pull/3418">encode/starlette#3418</a></li>
<li>Flush GZip output for each streamed chunk by <a href="https://github.com/Kludex"><code>@​Kludex</code></a> in <a href="https://redirect.github.com/encode/starlette/pull/3419">encode/starlette#3419</a></li>
<li>Skip compression of partial responses in <code>GZipMiddleware</code> by <a href="https://github.com/Kludex"><code>@​Kludex</code></a> in <a href="https://redirect.github.com/encode/starlette/pull/3420">encode/starlette#3420</a></li>
<li>Expand default excluded content types in <code>GZipMiddleware</code> by <a href="https://github.com/Kludex"><code>@​Kludex</code></a> in <a href="https://redirect.github.com/encode/starlette/pull/3421">encode/starlette#3421</a></li>
</ul>
<p><strong>Full Changelog</strong>: <a href="https://github.com/encode/starlette/compare/1.4.1...1.5.0">https://github.com/encode/starlette/compare/1.4.1...1.5.0</a></p>
<h2>Version 1.4.1</h2>
<h2>What's Changed</h2>
<ul>
<li>Default <code>thread_minimum_size</code> in <code>GZipResponder</code> by <a href="https://github.com/Kludex"><code>@​Kludex</code></a> in <a href="https://redirect.github.com/Kludex/starlette/pull/3415">Kludex/starlette#3415</a></li>
</ul>
<p><strong>Full Changelog</strong>: <a href="https://github.com/Kludex/starlette/compare/1.4.0...1.4.1">https://github.com/Kludex/starlette/compare/1.4.0...1.4.1</a></p>
<h2>Version 1.4.0</h2>
<h2>What's Changed</h2>
<ul>
<li>Lazily allocate GZipMiddleware compression resources by <a href="https://github.com/Kludex"><code>@​Kludex</code></a> in <a href="https://redirect.github.com/Kludex/starlette/pull/3407">Kludex/starlette#3407</a></li>
<li>Use <code>zlib.compressobj</code> instead of <code>GzipFile</code> in <code>GZipMiddleware</code> by <a href="https://github.com/Kludex"><code>@​Kludex</code></a> in <a href="https://redirect.github.com/Kludex/starlette/pull/3411">Kludex/starlette#3411</a></li>
<li>Offload large GZip compression by <a href="https://github.com/Kludex"><code>@​Kludex</code></a> in <a href="https://redirect.github.com/Kludex/starlette/pull/3410">Kludex/starlette#3410</a></li>
</ul>
<h2>New Contributors</h2>
<ul>
<li><a href="https://github.com/benberryallwood"><code>@​benberryallwood</code></a> made their first contribution in <a href="https://redirect.github.com/Kludex/starlette/pull/3334">Kludex/starlette#3334</a></li>
<li><a href="https://github.com/lkk7"><code>@​lkk7</code></a> made their first contribution in <a href="https://redirect.github.com/Kludex/starlette/pull/3359">Kludex/starlette#3359</a></li>
</ul>
<p><strong>Full Changelog</strong>: <a href="https://github.com/Kludex/starlette/compare/1.3.1...1.4.0">https://github.com/Kludex/starlette/compare/1.3.1...1.4.0</a></p>
</blockquote>
</details>
<details>
<summary>Changelog</summary>
<p><em>Sourced from <a href="https://github.com/Kludex/starlette/blob/main/docs/release-notes.md">starlette's changelog</a>.</em></p>
<blockquote>
<h2>1.6.0 (August 8, 2026)</h2>
<h4>Added</h4>
<ul>
<li>Add <code>max_body_size</code> to <code>Starlette</code> and route classes <a href="https://redirect.github.com/encode/starlette/pull/3431">#3431</a>.</li>
<li>Expose <code>http.response.debug</code> information via response extensions <a href="https://redirect.github.com/encode/starlette/pull/3130">#3130</a>.</li>
</ul>
<h2>1.5.1 (August 8, 2026)</h2>
<h4>Fixed</h4>
<ul>
<li>Reject inverted single-byte ranges in <code>FileResponse</code> <a href="https://redirect.github.com/encode/starlette/pull/3389">#3389</a>.</li>
<li>Limit <code>FileResponse</code> to 100 ranges <a href="https://redirect.github.com/encode/starlette/pull/3430">#3430</a>.</li>
</ul>
<h2>1.5.0 (August 8, 2026)</h2>
<h4>Added</h4>
<ul>
<li>Add <code>exclude_content_types</code> parameter to <code>GZipMiddleware</code> <a href="https://redirect.github.com/encode/starlette/pull/3418">#3418</a>.</li>
</ul>
<h4>Changed</h4>
<ul>
<li>Expand default excluded content types in <code>GZipMiddleware</code> <a href="https://redirect.github.com/encode/starlette/pull/3421">#3421</a>.</li>
</ul>
<h4>Fixed</h4>
<ul>
<li>Flush GZip output for each streamed chunk <a href="https://redirect.github.com/encode/starlette/pull/3419">#3419</a>.</li>
<li>Skip compression of partial responses in <code>GZipMiddleware</code> <a href="https://redirect.github.com/encode/starlette/pull/3420">#3420</a>.</li>
</ul>
<h2>1.4.1 (August 5, 2026)</h2>
<h4>Fixed</h4>
<ul>
<li>Default <code>thread_minimum_size</code> to 128 KiB in <code>GZipResponder</code>, keeping it usable without the new keyword argument <a href="https://redirect.github.com/encode/starlette/pull/3415">#3415</a>.</li>
</ul>
<h2>1.4.0 (August 5, 2026)</h2>
<h4>Added</h4>
<ul>
<li>Offload large GZip compression to a worker thread, keeping the event loop responsive. <code>GZipMiddleware</code> accepts a new <code>thread_minimum_size</code> parameter (default 128 KiB) controlling the minimum body chunk size compressed in a thread <a href="https://redirect.github.com/encode/starlette/pull/3410">#3410</a>.</li>
</ul>
<h4>Changed</h4>
<ul>
<li>Use <code>zlib.compressobj</code> instead of <code>GzipFile</code> in <code>GZipMiddleware</code>, reducing memory usage during compression <a href="https://redirect.github.com/encode/starlette/pull/3411">#3411</a>.</li>
<li>Lazily allocate <code>GZipMiddleware</code> compression resources, avoiding compressor allocation for responses that are never compressed <a href="https://redirect.github.com/encode/starlette/pull/3407">#3407</a>.</li>
</ul>
</blockquote>
</details>
<details>
<summary>Commits</summary>
<ul>
<li><a href="https://github.com/Kludex/starlette/commit/4f250d6b814587e20c5365f0a5f0c4d42bcb929f"><code>4f250d6</code></a> Version 1.6.0 (<a href="https://redirect.github.com/Kludex/starlette/issues/3434">#3434</a>)</li>
<li><a href="https://github.com/Kludex/starlette/commit/9eea41ad3c26ad21b9bdfe4578c1cdad6c9b9ac2"><code>9eea41a</code></a> Expose <code>http.response.debug</code> info via response extensions (<a href="https://redirect.github.com/Kludex/starlette/issues/3130">#3130</a>)</li>
<li><a href="https://github.com/Kludex/starlette/commit/38f8999a229610b36f39d11f67d80515a15c6330"><code>38f8999</code></a> Add <code>max_body_size</code> to <code>Starlette</code> and route classes (<a href="https://redirect.github.com/Kludex/starlette/issues/3431">#3431</a>)</li>
<li><a href="https://github.com/Kludex/starlette/commit/c41236c03868fb3779a64101f4ea88cd47877e23"><code>c41236c</code></a> Version 1.5.1 (<a href="https://redirect.github.com/Kludex/starlette/issues/3432">#3432</a>)</li>
<li><a href="https://github.com/Kludex/starlette/commit/9c500db197859dba4a8db13fa8e7d2c55de8152c"><code>9c500db</code></a> Limit <code>FileResponse</code> to 100 ranges (<a href="https://redirect.github.com/Kludex/starlette/issues/3430">#3430</a>)</li>
<li><a href="https://github.com/Kludex/starlette/commit/78ae82cad482fe66a73fb1217f0a6609b3f998f6"><code>78ae82c</code></a> Reject inverted single-byte Range like bytes=5-4 (<a href="https://redirect.github.com/Kludex/starlette/issues/3389">#3389</a>)</li>
<li><a href="https://github.com/Kludex/starlette/commit/c1d6edaf43920104d4389e983c3e0314f6af14cf"><code>c1d6eda</code></a> chore(deps): bump pymdown-extensions from 11.0 to 11.0.1 (<a href="https://redirect.github.com/Kludex/starlette/issues/3429">#3429</a>)</li>
<li><a href="https://github.com/Kludex/starlette/commit/ee66ca48418780d6415d231851b31464febc32de"><code>ee66ca4</code></a> chore(deps): bump the python-packages group across 1 directory with 8 updates...</li>
<li><a href="https://github.com/Kludex/starlette/commit/00d10167523f819d39d5ca36732348d58645a447"><code>00d1016</code></a> fix(tests): skip test_staticfiles_filename_too_long on Windows where os.pathc...</li>
<li><a href="https://github.com/Kludex/starlette/commit/d96887ea7b49db3d1d15994be6438c7fe99936f4"><code>d96887e</code></a> Add Pydantic Logfire banner to the docs (<a href="https://redirect.github.com/Kludex/starlette/issues/3428">#3428</a>)</li>
<li>Additional commits viewable in <a href="https://github.com/Kludex/starlette/compare/1.3.1...1.6.0">compare view</a></li>
</ul>
</details>
<br />

````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–36 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–75 | requirement | Concrete dependency version change is the PR objective; bundled upstream notes are not requirements. |
| label-3 | pr_body | 76–4975 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |
| label-4 | pr_body | 4976–7763 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |
| label-5 | pr_body | 7764–10385 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |
| label-6 | pr_body | 10386–10392 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## fastapi-fastapi-16203

Source: [https://github.com/fastapi/fastapi/pull/16203](https://github.com/fastapi/fastapi/pull/16203)

Acceptance: pending human review.

Title:

````````text
🌐 Update translations for es (update-outdated)
````````

Original LF-normalized body:

````````text
🌐 Update translations for es (update-outdated)

This PR was created automatically using LLMs.

It uses the prompt file https://github.com/fastapi/fastapi/blob/master/docs/es/llm-prompt.md.

In most cases, it's better to make PRs updating that file so that the LLM can do a better job generating the translations than suggesting changes in this PR.
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–47 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–47 | requirement | Explicit translation update objective. |
| label-3 | pr_body | 49–94 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 96–189 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-5 | pr_body | 191–348 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## fastapi-fastapi-16196

Source: [https://github.com/fastapi/fastapi/pull/16196](https://github.com/fastapi/fastapi/pull/16196)

Acceptance: pending human review.

Title:

````````text
📱 Improve mobile responsiveness of conference rail
````````

Original LF-normalized body:

````````text
## Pull Request

📱 Improve mobile responsiveness of conference rail

## Description

Related to #16193 
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–51 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–15 | non_requirement | Structural heading only. |
| label-3 | pr_body | 17–68 | requirement | Explicit UI improvement objective, underspecified acceptance details. |
| label-4 | pr_body | 70–84 | non_requirement | Structural heading only. |
| label-5 | pr_body | 86–103 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## sveltejs-svelte-18752

Source: [https://github.com/sveltejs/svelte/pull/18752](https://github.com/sveltejs/svelte/pull/18752)

Acceptance: pending human review.

Title:

````````text
chore: bump packages
````````

Original LF-normalized body:

````````text
esrap bump ensures a bugfix, devalue silences vulnerability reports


````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–20 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–67 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## sveltejs-svelte-18714

Source: [https://github.com/sveltejs/svelte/pull/18714](https://github.com/sveltejs/svelte/pull/18714)

Acceptance: pending human review.

Title:

````````text
perf: use `$.comment()` for lone-anchor rich select content
````````

Original LF-normalized body:

````````text
Drops a hoisted template when a rich `<select>`/`<optgroup>`/`<option>` has a single block child.

`Fragment` already special-cases a single-comment template as `$.comment()`, but the `customizable_select` path in `RegularElement` does not, so it hoists a template that only ever produces an anchor:

```diff
-var select_content = $.from_html(`<!>`, 1);
 ...
-		var fragment_2 = select_content();
+		var fragment_2 = $.comment();
```

`from_html("<!>", 1)` parses `<!><!>` into a `<template>` and clones it on every call. `$.comment()` just creates the two nodes. Triggers for `<select><Component /></select>`, `{@render}`, `{@html}` and blocks directly inside select/optgroup/option.

Test: `runtime-runes/samples/customizable-select-comment-anchor` covers component, `{@render}` and `{@html}` children across an update. The existing `hydration/samples/rich-select` covers the hydration path.
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–59 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–97 | ambiguous | Present-tense implementation summary may serve as intended scope. |
| label-3 | pr_body | 99–299 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 301–433 | non_requirement | Embedded example, reproduction, log, or release-note fence; source content only, not verified execution or standalone request. |
| label-5 | pr_body | 435–684 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-6 | pr_body | 686–893 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## sveltejs-svelte-18721

Source: [https://github.com/sveltejs/svelte/pull/18721](https://github.com/sveltejs/svelte/pull/18721)

Acceptance: pending human review.

Title:

````````text
fix: keep boolean attributes with an empty string value when rendering attribute objects on the server
````````

Original LF-normalized body:

````````text
`<input disabled="" {...props}>` and any other boolean attribute written as `""` now renders on the server the way it does on the client and in plain markup.

`attr` in `internal/shared/attributes.js` drops a boolean attribute when its value is falsy, and `""` is falsy, so once an element's attributes go through the object path (a spread, or the `<select>`/`<option>` special casing) `disabled=""`, `hidden=""` or `multiple=""` vanish from the output. The client's `set_attributes` sets them, so the two disagree until hydration. #18591 worked around it for `multiple` on `<select>` only.

`attr` keeps `""` for boolean attributes and still drops `null`, `undefined`, `false` and `0`.

````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–102 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–157 | ambiguous | Resulting behavior claim; source-only evidence cannot verify it. |
| label-3 | pr_body | 159–590 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 592–686 | ambiguous | Concrete behavior statement written as implementation result. |

## sveltejs-svelte-18718

Source: [https://github.com/sveltejs/svelte/pull/18718](https://github.com/sveltejs/svelte/pull/18718)

Acceptance: pending human review.

Title:

````````text
fix: apply ownership mutation ignores to bindings
````````

Original LF-normalized body:

````````text
Fixes #18715.

The assignment generated for a `bind:` directive did not inherit the directive's compiler ignore-map entry. Consequently, ownership mutation validation was still generated even when the binding had an associated `svelte-ignore ownership_invalid_mutation` comment.

This change carries the binding's ignores onto its generated setter assignment before transforming it. It also adds a runtime regression test that verifies the binding updates parent state without emitting an ownership warning.

Tests:
- `pnpm test runtime-runes -t ownership-invalid-mutation-binding-ignore`
- `pnpm test runtime-runes` — 2709 passed, 47 skipped
- `pnpm --filter svelte check`
- `pnpm test --exclude packages/svelte/tests/runtime-browser/test.ts` — 7673 passed, 69 skipped

The unfiltered test run could not launch the browser-only suite because the sandbox did not contain the Playwright Chromium executable; all other test files passed.
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–49 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–13 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-3 | pr_body | 15–278 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 280–507 | ambiguous | Implementation and test summary; unclear independent normative force. |
| label-5 | pr_body | 509–769 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-6 | pr_body | 771–935 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## sveltejs-svelte-18749

Source: [https://github.com/sveltejs/svelte/pull/18749](https://github.com/sveltejs/svelte/pull/18749)

Acceptance: pending human review.

Title:

````````text
fix: cancel deferred event listener attachment
````````

Original LF-normalized body:

````````text
## What

- Cancel deferred pointer, touch, and wheel listener attachment when cleanup runs first
- Apply cancellation to both `svelte/events` subscriptions and template global-event teardown
- Preserve synchronous removal for listeners whose deferred attachment already completed
- Add runtime regressions covering both cleanup paths

Fixes #18748

## Test plan

- `pnpm test runtime-runes -t event-cleanup-before-attachment`
- `pnpm test runtime-runes`
- `cd packages/svelte && pnpm check`
- `cd packages/svelte && pnpm build`
- `pnpm format`
- `pnpm lint`
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–46 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–7 | non_requirement | Structural heading only. |
| label-3 | pr_body | 9–333 | requirement | Explicit change/retention requirements in What section. |
| label-4 | pr_body | 335–347 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-5 | pr_body | 349–361 | non_requirement | Structural heading only. |
| label-6 | pr_body | 363–557 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## sveltejs-svelte-18739

Source: [https://github.com/sveltejs/svelte/pull/18739](https://github.com/sveltejs/svelte/pull/18739)

Acceptance: pending human review.

Title:

````````text
fix: throw when `setContext` is called after an `await` during SSR
````````

Original LF-normalized body:

````````text
Fixes #17233.

`setContext` after a top-level `await` throws `set_context_after_init` on the client since #17031, but the server never got the equivalent check, so it silently succeeded.

### Why `pop()` is the wrong place

The client marks `component_context.i = true` in `pop()`. Doing the same on the server does not work, and it fails silently, so it is worth spelling out.

`Renderer.component` calls `push()`, then `child()`, then `pop()`. But `child()` does not reuse the pushed context, it rebuilds it:

```js
set_ssr_context({ ...ssr_context, p: parent, c: null, r: child });
```

The component body runs inside that spread copy, so `Renderer.run` captures the copy, not the object `push()` created. `pop()` then mutates the original, which nothing reads again. I tried it: with the flag set in `pop()` and the test un-skipped, the guard never fires and the test still fails with `Expected an error to be thrown, but rendering succeeded.`

### What this does instead

The compiler already draws the line for us. `<script>` code around a top-level `await` compiles to:

```js
$$renderer.run([
	() => Promise.resolve('hi'),
	() => void setContext('key', 'value')
]);
```

`thunks[0]` is the awaited expression and everything before it stays outside `run()` entirely. Every thunk from index 1 on is resumed from a `.then()`, so it is by definition post-await. So `run()` marks its captured context once, when there is more than one thunk, and `setContext` checks the flag.

The check does not need an `async_mode_flag` guard the way the client's does. `run()` is only ever emitted under `experimental.async`, so the flag cannot be set in sync mode.

`push()` and the root context in `#open_render` now set `i: false`, and `set_context_after_init` moves from client to shared errors so both runtimes throw the same code, the same way `lifecycle_outside_component` already does. The error text and its `svelte.dev/e/` page are unchanged.

### The skipped test

The sample from #17154 is un-skipped. Its comment said:

> TODO it appears there might be an actual bug here; the promise isn't ever actually awaited in spite of being awaited in the component

That is not what is happening, so I removed it rather than reword it. Rendering that component with a 120ms timer instead of `Promise.resolve` shows the render waiting for it and collecting output written after the await:

```
t+0ms    thunk0: starting 120ms timer
t+122ms  timer fired
t+122ms  thunk1: post-await, calling setContext
t+122ms  thunk1: setContext returned normally
t+122ms  awaited render, body = "<!--[-->POST_AWAIT_CONTENT<!--]-->"
```

The promise is awaited. The only thing missing was the guard. The expected error also changes from `lifecycle_outside_component` to `set_context_after_init`, matching the client.

### Not changed

`setContext('key', await x)` compiles to a single thunk, so it is outside what this checks. On `main` it already fails with `lifecycle_outside_component`, and it still does. Worth a separate look, but it is a different shape from the one in the issue.

### Test plan

`pnpm test`, before and after, on the same machine:

| | files | passed | skipped |
|---|---|---|---|
| `main` | 34 | 7762 | 56 |
| this branch | 34 | 7763 | 55 |

The only delta is the sample that was skipped.

Counterfactual, with the test un-skipped and only the `run()` marking removed:

```
FAIL  packages/svelte/tests/server-side-rendering/test.ts > async-context-throws-after-await (async)
AssertionError: Expected an error to be thrown, but rendering succeeded.
```

Restored, it passes.

Negative cases, checked directly against the compiled SSR shapes so the guard is not just eager:

| case | result |
|---|---|
| `setContext` after `await` | throws `set_context_after_init` |
| `setContext` before `await` | works |
| `setContext`, no `await` | works |
| `setContext` before and after `await` | throws on the second |
| two `await`s then `setContext` | throws |
| parent awaits, child sets context | works |

The last one matters: a child goes through `push()`, which builds a fresh context, so the parent's flag does not leak into it. The existing `server-side-rendering/samples/context` and `runtime-runes/samples/async-set-context` samples both cover that shape and both still pass.

`pnpm lint` and `pnpm check` are clean.

### Before submitting the PR, please make sure you do the following

- [x] It's really useful if your PR references an issue where it is discussed ahead of time. In many cases, features are absent for a reason. For large changes, please create an RFC: https://github.com/sveltejs/rfcs
- [x] Prefix your PR title with `feat:`, `fix:`, `chore:`, or `docs:`.
- [x] This message body should clearly illustrate what problems it solves.
- [x] Ideally, include a test that fails without this PR but passes with it.
- [x] If this PR changes code within `packages/svelte/src`, add a changeset (`npx changeset`).

### Tests and linting

- [x] Run the tests with `pnpm test` and lint the project with `pnpm lint`

````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–66 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–13 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-3 | pr_body | 15–186 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 188–222 | non_requirement | Structural heading only. |
| label-5 | pr_body | 224–377 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-6 | pr_body | 379–510 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-7 | pr_body | 512–588 | non_requirement | Embedded example, reproduction, log, or release-note fence; source content only, not verified execution or standalone request. |
| label-8 | pr_body | 590–947 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-9 | pr_body | 949–975 | non_requirement | Structural heading only. |
| label-10 | pr_body | 977–1076 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-11 | pr_body | 1078–1177 | non_requirement | Embedded example, reproduction, log, or release-note fence; source content only, not verified execution or standalone request. |
| label-12 | pr_body | 1179–1478 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-13 | pr_body | 1480–1654 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-14 | pr_body | 1656–1941 | ambiguous | Retrospective implementation and scope-retention description. |
| label-15 | pr_body | 1943–1963 | non_requirement | Structural heading only. |
| label-16 | pr_body | 1965–2020 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-17 | pr_body | 2022–2157 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-18 | pr_body | 2159–2380 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-19 | pr_body | 2382–2611 | non_requirement | Embedded example, reproduction, log, or release-note fence; source content only, not verified execution or standalone request. |
| label-20 | pr_body | 2613–2791 | ambiguous | Mixes explanatory context with changed expected behavior. |
| label-21 | pr_body | 2793–2808 | non_requirement | Structural heading only. |
| label-22 | pr_body | 2810–3061 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-23 | pr_body | 3063–3076 | non_requirement | Structural heading only. |
| label-24 | pr_body | 3078–3129 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-25 | pr_body | 3131–3240 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-26 | pr_body | 3242–3288 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-27 | pr_body | 3290–3368 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-28 | pr_body | 3370–3551 | non_requirement | Embedded example, reproduction, log, or release-note fence; source content only, not verified execution or standalone request. |
| label-29 | pr_body | 3553–3573 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-30 | pr_body | 3575–3671 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-31 | pr_body | 3673–3997 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-32 | pr_body | 3999–4275 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-33 | pr_body | 4277–4316 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-34 | pr_body | 4318–4385 | non_requirement | Structural heading only. |
| label-35 | pr_body | 4387–4920 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-36 | pr_body | 4922–4943 | non_requirement | Structural heading only. |
| label-37 | pr_body | 4945–5019 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## expressjs-express-7403

Source: [https://github.com/expressjs/express/pull/7403](https://github.com/expressjs/express/pull/7403)

Acceptance: pending human review.

Title:

````````text
build(deps): bump actions/checkout from 7.0.0 to 7.0.1
````````

Original LF-normalized body:

````````text
Bumps [actions/checkout](https://github.com/actions/checkout) from 7.0.0 to 7.0.1.
<details>
<summary>Release notes</summary>
<p><em>Sourced from <a href="https://github.com/actions/checkout/releases">actions/checkout's releases</a>.</em></p>
<blockquote>
<h2>v7.0.1</h2>
<h2>What's Changed</h2>
<ul>
<li>skip running unsafe pr check if input is default by <a href="https://github.com/aiqiaoy"><code>@​aiqiaoy</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/2518">actions/checkout#2518</a></li>
<li>trim only ascii whitespace for branch by <a href="https://github.com/aiqiaoy"><code>@​aiqiaoy</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/2521">actions/checkout#2521</a></li>
<li>escape values passed to --unset by <a href="https://github.com/aiqiaoy"><code>@​aiqiaoy</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/2530">actions/checkout#2530</a></li>
<li>Various dependency updates</li>
</ul>
<p><strong>Full Changelog</strong>: <a href="https://github.com/actions/checkout/compare/v7...v7.0.1">https://github.com/actions/checkout/compare/v7...v7.0.1</a></p>
</blockquote>
</details>
<details>
<summary>Changelog</summary>
<p><em>Sourced from <a href="https://github.com/actions/checkout/blob/main/CHANGELOG.md">actions/checkout's changelog</a>.</em></p>
<blockquote>
<h1>Changelog</h1>
<h2>v7.0.1</h2>
<ul>
<li>Skip running unsafe pr check if input is default by <a href="https://github.com/aiqiaoy"><code>@​aiqiaoy</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/2518">actions/checkout#2518</a></li>
<li>Trim only ascii whitespace for branch by <a href="https://github.com/aiqiaoy"><code>@​aiqiaoy</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/2521">actions/checkout#2521</a></li>
<li>Escape values passed to --unset by <a href="https://github.com/aiqiaoy"><code>@​aiqiaoy</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/2530">actions/checkout#2530</a></li>
<li>Various dependency updates</li>
</ul>
<h2>v7.0.0</h2>
<ul>
<li>Block checking out fork PR for pull_request_target and workflow_run by <a href="https://github.com/aiqiaoy"><code>@​aiqiaoy</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/2454">actions/checkout#2454</a></li>
<li>Various dependency updates</li>
</ul>
<h2>v6.0.3</h2>
<ul>
<li>Fix checkout init for SHA-256 repositories by <a href="https://github.com/yaananth"><code>@​yaananth</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/2439">actions/checkout#2439</a></li>
<li>fix: expand merge commit SHA regex and add SHA-256 test cases by <a href="https://github.com/yaananth"><code>@​yaananth</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/2414">actions/checkout#2414</a></li>
</ul>
<h2>v6.0.2</h2>
<ul>
<li>Fix tag handling: preserve annotations and explicit fetch-tags by <a href="https://github.com/ericsciple"><code>@​ericsciple</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/2356">actions/checkout#2356</a></li>
</ul>
<h2>v6.0.1</h2>
<ul>
<li>Add worktree support for persist-credentials includeIf by <a href="https://github.com/ericsciple"><code>@​ericsciple</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/2327">actions/checkout#2327</a></li>
</ul>
<h2>v6.0.0</h2>
<ul>
<li>Persist creds to a separate file by <a href="https://github.com/ericsciple"><code>@​ericsciple</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/2286">actions/checkout#2286</a></li>
<li>Update README to include Node.js 24 support details and requirements by <a href="https://github.com/salmanmkc"><code>@​salmanmkc</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/2248">actions/checkout#2248</a></li>
</ul>
<h2>v5.0.1</h2>
<ul>
<li>Port v6 cleanup to v5 by <a href="https://github.com/ericsciple"><code>@​ericsciple</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/2301">actions/checkout#2301</a></li>
</ul>
<h2>v5.0.0</h2>
<ul>
<li>Update actions checkout to use node 24 by <a href="https://github.com/salmanmkc"><code>@​salmanmkc</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/2226">actions/checkout#2226</a></li>
</ul>
<h2>v4.3.1</h2>
<ul>
<li>Port v6 cleanup to v4 by <a href="https://github.com/ericsciple"><code>@​ericsciple</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/2305">actions/checkout#2305</a></li>
</ul>
<h2>v4.3.0</h2>
<ul>
<li>docs: update README.md by <a href="https://github.com/motss"><code>@​motss</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/1971">actions/checkout#1971</a></li>
<li>Add internal repos for checking out multiple repositories by <a href="https://github.com/mouismail"><code>@​mouismail</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/1977">actions/checkout#1977</a></li>
<li>Documentation update - add recommended permissions to Readme by <a href="https://github.com/benwells"><code>@​benwells</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/2043">actions/checkout#2043</a></li>
<li>Adjust positioning of user email note and permissions heading by <a href="https://github.com/joshmgross"><code>@​joshmgross</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/2044">actions/checkout#2044</a></li>
<li>Update README.md by <a href="https://github.com/nebuk89"><code>@​nebuk89</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/2194">actions/checkout#2194</a></li>
<li>Update CODEOWNERS for actions by <a href="https://github.com/TingluoHuang"><code>@​TingluoHuang</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/2224">actions/checkout#2224</a></li>
<li>Update package dependencies by <a href="https://github.com/salmanmkc"><code>@​salmanmkc</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/2236">actions/checkout#2236</a></li>
</ul>
<h2>v4.2.2</h2>
<ul>
<li><code>url-helper.ts</code> now leverages well-known environment variables by <a href="https://github.com/jww3"><code>@​jww3</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/1941">actions/checkout#1941</a></li>
<li>Expand unit test coverage for <code>isGhes</code> by <a href="https://github.com/jww3"><code>@​jww3</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/1946">actions/checkout#1946</a></li>
</ul>
<h2>v4.2.1</h2>
<ul>
<li>Check out other refs/* by commit if provided, fall back to ref by <a href="https://github.com/orhantoy"><code>@​orhantoy</code></a> in <a href="https://redirect.github.com/actions/checkout/pull/1924">actions/checkout#1924</a></li>
</ul>
<!-- raw HTML omitted -->
</blockquote>
<p>... (truncated)</p>
</details>
<details>
<summary>Commits</summary>
<ul>
<li><a href="https://github.com/actions/checkout/commit/3d3c42e5aac5ba805825da76410c181273ba90b1"><code>3d3c42e</code></a> prep v7.0.1 release (<a href="https://redirect.github.com/actions/checkout/issues/2531">#2531</a>)</li>
<li><a href="https://github.com/actions/checkout/commit/28802689a136bfcdb721715abd713740beecbe07"><code>2880268</code></a> escape values passed to --unset (<a href="https://redirect.github.com/actions/checkout/issues/2530">#2530</a>)</li>
<li><a href="https://github.com/actions/checkout/commit/12cd2235efa0937479335606d7c3ac9f6c0973b1"><code>12cd223</code></a> trim only ascii whitespace for branch (<a href="https://redirect.github.com/actions/checkout/issues/2521">#2521</a>)</li>
<li><a href="https://github.com/actions/checkout/commit/62661c4e71a304b2823ed026347b8d34c3eac541"><code>62661c4</code></a> skip running unsafe pr check if input is default (<a href="https://redirect.github.com/actions/checkout/issues/2518">#2518</a>)</li>
<li><a href="https://github.com/actions/checkout/commit/e8d4307400f9427dba7cb98e488d6ab85f1cec5f"><code>e8d4307</code></a> Bump the minor-actions-dependencies group with 2 updates (<a href="https://redirect.github.com/actions/checkout/issues/2499">#2499</a>)</li>
<li><a href="https://github.com/actions/checkout/commit/631c942040754b6e095e929c1677c07e10ed4f87"><code>631c942</code></a> eslint 9 (<a href="https://redirect.github.com/actions/checkout/issues/2474">#2474</a>)</li>
<li><a href="https://github.com/actions/checkout/commit/4f1f4aec02e41874fa0262ea8ff5172d7978ad1e"><code>4f1f4ae</code></a> Bump actions/upload-artifact from 4 to 7 (<a href="https://redirect.github.com/actions/checkout/issues/2476">#2476</a>)</li>
<li><a href="https://github.com/actions/checkout/commit/ba097532fb203f7e88c9c3c0b899b49469908a92"><code>ba09753</code></a> Bump actions/checkout from 6 to 7 (<a href="https://redirect.github.com/actions/checkout/issues/2488">#2488</a>)</li>
<li><a href="https://github.com/actions/checkout/commit/b9e0990d219a03df7633c93f6f005a8fecbcab22"><code>b9e0990</code></a> Bump docker/login-action from 3.3.0 to 4.2.0 (<a href="https://redirect.github.com/actions/checkout/issues/2479">#2479</a>)</li>
<li><a href="https://github.com/actions/checkout/commit/e8cb398be4a550817e382abf69e4c12c76fce1f2"><code>e8cb398</code></a> Bump docker/build-push-action from 6.5.0 to 7.2.0 (<a href="https://redirect.github.com/actions/checkout/issues/2478">#2478</a>)</li>
<li>Additional commits viewable in <a href="https://github.com/actions/checkout/compare/9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0...3d3c42e5aac5ba805825da76410c181273ba90b1">compare view</a></li>
</ul>
</details>
<br />


[![Dependabot compatibility score](https://dependabot-badges.githubapp.com/badges/compatibility_score?dependency-name=actions/checkout&package-manager=github_actions&previous-version=7.0.0&new-version=7.0.1)](https://docs.github.com/en/github/managing-security-vulnerabilities/about-dependabot-security-updates#about-compatibility-scores)

Dependabot will resolve any conflicts with this PR as long as you don't alter it yourself. You can also trigger a rebase manually by commenting `@dependabot rebase`.

[//]: # (dependabot-automerge-start)
[//]: # (dependabot-automerge-end)

---

<details>
<summary>Dependabot commands and options</summary>
<br />

You can trigger Dependabot actions by commenting on this PR:
- `@dependabot rebase` will rebase this PR
- `@dependabot recreate` will recreate this PR, overwriting any edits that have been made to it
- `@dependabot show <dependency name> ignore conditions` will show all of the ignore conditions of the specified dependency
- `@dependabot ignore this major version` will close this PR and stop Dependabot creating any more for this major version (unless you reopen the PR or upgrade to it yourself)
- `@dependabot ignore this minor version` will close this PR and stop Dependabot creating any more for this minor version (unless you reopen the PR or upgrade to it yourself)
- `@dependabot ignore this dependency` will close this PR and stop Dependabot creating any more for this dependency (unless you reopen the PR or upgrade to it yourself)


</details>
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–54 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–82 | requirement | Concrete dependency upgrade objective. |
| label-3 | pr_body | 83–1162 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |
| label-4 | pr_body | 1163–6860 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |
| label-5 | pr_body | 6861–9559 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |
| label-6 | pr_body | 9560–9566 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-7 | pr_body | 9569–9907 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-8 | pr_body | 9909–10074 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-9 | pr_body | 10076–10147 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-10 | pr_body | 10149–10152 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-11 | pr_body | 10154–11078 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |

## expressjs-express-7233

Source: [https://github.com/expressjs/express/pull/7233](https://github.com/expressjs/express/pull/7233)

Acceptance: pending human review.

Title:

````````text
Upgrade `content-disposition`
````````

Original LF-normalized body:

````````text
Version 2 upgrade will mostly only be relevant for users that want to generate non-ASCII by ISO-8859-1 valid filenames. There was a gap in theoretical vs real behavior of browsers that sniffed this and failed to have the correct encoding for filenames because it treated them as UTF-8 instead. See https://github.com/jshttp/content-disposition/issues/27 for more information.

Separately, the API no longer attempts to `basename` inputs so I need to do that in the Express API instead.
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–29 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–375 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-3 | pr_body | 377–485 | requirement | Explicit author-stated required compensating change. |

## expressjs-express-7390

Source: [https://github.com/expressjs/express/pull/7390](https://github.com/expressjs/express/pull/7390)

Acceptance: pending human review.

Title:

````````text
deps: bump body-parser to ^2.3.0 to fix CVE-2026-12590
````````

Original LF-normalized body:

````````text
## Summary

Bumps `body-parser` from `^2.2.1` to `^2.3.0` to remediate **CVE-2026-12590** (GHSA-v422-hmwv-36x6).

body-parser `>=2.0.0 <2.3.0` (and `<1.20.6` on the 1.x line) fails open when
given an invalid `limit` option value: `bytes.parse()` returns `null`, which
silently disables request body size enforcement and allows a denial of service
via arbitrarily large payloads. body-parser 2.3.0 (expressjs/body-parser#698)
now throws on an invalid `limit` at parser initialization instead of ignoring it.

Express's existing `^2.2.1` range technically already permits 2.3.0, but
declaring `^2.3.0` makes the security intent explicit and ensures consumers
(and scanners like Trivy) resolve to the patched release.

## Changes
- `package.json`: `body-parser` `^2.2.1` → `^2.3.0`
- `History.md`: changelog entry under Unreleased → 🚀 Improvements

## Testing
- `body-parser`-backed middleware tests pass (211 passing): `express.json`, `express.urlencoded`, `express.raw`, `express.text`.

## References
- https://www.cve.org/CVERecord?id=CVE-2026-12590
- https://github.com/expressjs/body-parser/security/advisories/GHSA-v422-hmwv-36x6
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–54 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–10 | non_requirement | Structural heading only. |
| label-3 | pr_body | 12–112 | requirement | Concrete dependency version objective; CVE efficacy remains unverified. |
| label-4 | pr_body | 114–506 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-5 | pr_body | 508–714 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-6 | pr_body | 716–726 | non_requirement | Structural heading only. |
| label-7 | pr_body | 727–845 | requirement | Explicit change list. |
| label-8 | pr_body | 847–857 | non_requirement | Structural heading only. |
| label-9 | pr_body | 858–986 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-10 | pr_body | 988–1001 | non_requirement | Structural heading only. |
| label-11 | pr_body | 1002–1134 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## expressjs-express-7377

Source: [https://github.com/expressjs/express/pull/7377](https://github.com/expressjs/express/pull/7377)

Acceptance: pending human review.

Title:

````````text
feat: allow conditional revalidation for QUERY requests (v4)
````````

Original LF-normalized body:

````````text
Identical to #7366 but targeting the v4 branch as requested at https://github.com/expressjs/express/issues/7365#issuecomment-4952018598. Below is a copy of that PR's description:

---

`req.fresh` only performed weak freshness validation for `GET` and `HEAD`, so responses to `QUERY` requests never returned `304 Not Modified` even when the client sent a matching `If-None-Match`. This extends the method guard to include `QUERY`.

```diff
-  // GET or HEAD for weak freshness validation only
-  if ('GET' !== method && 'HEAD' !== method) return false;
+  // GET, HEAD, or QUERY for weak freshness validation only
+  if ('GET' !== method && 'HEAD' !== method && 'QUERY' !== method) return false;
```

---
As far as I can tell, QUERY is a safe, idempotent, cacheable method whose responses explicitly support conditional revalidation, as per https://datatracker.ietf.org/doc/rfc10008/, so it should behave like `GET`/`HEAD` here.
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–60 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–178 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-3 | pr_body | 180–183 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 185–380 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-5 | pr_body | 381–430 | ambiguous | Implementation claim inside copied description; source-only intent uncertain. |
| label-6 | pr_body | 432–699 | non_requirement | Embedded example, reproduction, log, or release-note fence; source content only, not verified execution or standalone request. |
| label-7 | pr_body | 701–704 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-8 | pr_body | 705–928 | ambiguous | Qualified normative statement depends on unexamined specification. |

## expressjs-express-7353

Source: [https://github.com/expressjs/express/pull/7353](https://github.com/expressjs/express/pull/7353)

Acceptance: pending human review.

Title:

````````text
build(deps-dev): bump morgan from 1.10.1 to 1.11.0
````````

Original LF-normalized body:

````````text
Bumps [morgan](https://github.com/expressjs/morgan) from 1.10.1 to 1.11.0.
<details>
<summary>Release notes</summary>
<p><em>Sourced from <a href="https://github.com/expressjs/morgan/releases">morgan's releases</a>.</em></p>
<blockquote>
<h2>1.11.0</h2>
<h2>What's Changed</h2>
<ul>
<li>feat: add :pid token by <a href="https://github.com/ganesh3367"><code>@​ganesh3367</code></a> in <a href="https://redirect.github.com/expressjs/morgan/pull/329">expressjs/morgan#329</a></li>
</ul>
<p>Security Fix:</p>
<ul>
<li>Escape control characters in <code>:remote-user</code> token to prevent log injection
<ul>
<li>Fixes <a href="https://www.cve.org/CVERecord?id=CVE-2026-5078">CVE-2026-5078</a> <a href="https://github.com/expressjs/morgan/security/advisories/GHSA-4vj7-5mj6-jm8m">GHSA-4vj7-5mj6-jm8m</a></li>
</ul>
</li>
</ul>
<h2>New Contributors</h2>
<ul>
<li><a href="https://github.com/inigomarquinez"><code>@​inigomarquinez</code></a> made their first contribution in <a href="https://redirect.github.com/expressjs/morgan/pull/291">expressjs/morgan#291</a></li>
<li><a href="https://github.com/jonchurch"><code>@​jonchurch</code></a> made their first contribution in <a href="https://redirect.github.com/expressjs/morgan/pull/299">expressjs/morgan#299</a></li>
<li><a href="https://github.com/bjohansebas"><code>@​bjohansebas</code></a> made their first contribution in <a href="https://redirect.github.com/expressjs/morgan/pull/301">expressjs/morgan#301</a></li>
<li><a href="https://github.com/UlisesGascon"><code>@​UlisesGascon</code></a> made their first contribution in <a href="https://redirect.github.com/expressjs/morgan/pull/300">expressjs/morgan#300</a></li>
<li><a href="https://github.com/ctcpip"><code>@​ctcpip</code></a> made their first contribution in <a href="https://redirect.github.com/expressjs/morgan/pull/319">expressjs/morgan#319</a></li>
<li><a href="https://github.com/ganesh3367"><code>@​ganesh3367</code></a> made their first contribution in <a href="https://redirect.github.com/expressjs/morgan/pull/329">expressjs/morgan#329</a></li>
</ul>
<p><strong>Full Changelog</strong>: <a href="https://github.com/expressjs/morgan/compare/1.10.0...1.11.0">https://github.com/expressjs/morgan/compare/1.10.0...1.11.0</a></p>
</blockquote>
</details>
<details>
<summary>Changelog</summary>
<p><em>Sourced from <a href="https://github.com/expressjs/morgan/blob/master/HISTORY.md">morgan's changelog</a>.</em></p>
<blockquote>
<h1>1.11.0 / 2026-06-02</h1>
<ul>
<li>add <code>:pid</code> token</li>
</ul>
<p>Security Fix:</p>
<ul>
<li>Escape control characters in <code>:remote-user</code> token to prevent log injection
<ul>
<li>Fixes <a href="https://www.cve.org/CVERecord?id=CVE-2026-5078">CVE-2026-5078</a> <a href="https://github.com/expressjs/morgan/security/advisories/GHSA-4vj7-5mj6-jm8m">GHSA-4vj7-5mj6-jm8m</a></li>
</ul>
</li>
</ul>
</blockquote>
</details>
<details>
<summary>Commits</summary>
<ul>
<li><a href="https://github.com/expressjs/morgan/commit/e0e6f17574db56396f8e60ebb03bb7aaaeb9cc6f"><code>e0e6f17</code></a> Release 1.11.0 (<a href="https://redirect.github.com/expressjs/morgan/issues/350">#350</a>)</li>
<li><a href="https://github.com/expressjs/morgan/commit/b3f5d9bdb388690dfae9c06ab966328f49b7982b"><code>b3f5d9b</code></a> Merge commit from fork</li>
<li><a href="https://github.com/expressjs/morgan/commit/203c75852adadcc5e3a9ba23b0ef07a8e81c5af7"><code>203c758</code></a> build(deps): bump github/codeql-action from 4.32.4 to 4.35.2 (<a href="https://redirect.github.com/expressjs/morgan/issues/346">#346</a>)</li>
<li><a href="https://github.com/expressjs/morgan/commit/002bc81f47a7641d86b7e16ee0f343e5eed81a6a"><code>002bc81</code></a> build(deps): bump actions/upload-artifact from 7.0.0 to 7.0.1 (<a href="https://redirect.github.com/expressjs/morgan/issues/347">#347</a>)</li>
<li><a href="https://github.com/expressjs/morgan/commit/561b0d70bf4486245b311a02259d32ae45756331"><code>561b0d7</code></a> build(deps): bump actions/upload-artifact from 5.0.0 to 7.0.0 (<a href="https://redirect.github.com/expressjs/morgan/issues/338">#338</a>)</li>
<li><a href="https://github.com/expressjs/morgan/commit/2db705ecf05eed5a2990da4be8731a1d7051692c"><code>2db705e</code></a> build(deps): bump github/codeql-action from 3.29.7 to 4.32.4 (<a href="https://redirect.github.com/expressjs/morgan/issues/337">#337</a>)</li>
<li><a href="https://github.com/expressjs/morgan/commit/a373c5f25df88c7f31b4abb36306d7e025edcc8c"><code>a373c5f</code></a> build(deps): bump ossf/scorecard-action from 2.3.1 to 2.4.3 (<a href="https://redirect.github.com/expressjs/morgan/issues/327">#327</a>)</li>
<li><a href="https://github.com/expressjs/morgan/commit/c8e72fa73c7e54a00f0e28db1bc6edbeb83dbbc0"><code>c8e72fa</code></a> build(deps): bump actions/checkout from 4.1.1 to 6.0.1 (<a href="https://redirect.github.com/expressjs/morgan/issues/324">#324</a>)</li>
<li><a href="https://github.com/expressjs/morgan/commit/023300e37da5e2a3394a50171d07a0bb6860eab5"><code>023300e</code></a> build(deps): bump actions/upload-artifact from 4.3.1 to 4.6.2 (<a href="https://redirect.github.com/expressjs/morgan/issues/307">#307</a>)</li>
<li><a href="https://github.com/expressjs/morgan/commit/9d8d6c099765b1d4722aadfb68dbf0a227ff8e64"><code>9d8d6c0</code></a> build(deps): bump coverallsapp/github-action from 1.2.5 to 2.3.6 (<a href="https://redirect.github.com/expressjs/morgan/issues/306">#306</a>)</li>
<li>Additional commits viewable in <a href="https://github.com/expressjs/morgan/compare/1.10.1...1.11.0">compare view</a></li>
</ul>
</details>
<br />


[![Dependabot compatibility score](https://dependabot-badges.githubapp.com/badges/compatibility_score?dependency-name=morgan&package-manager=npm_and_yarn&previous-version=1.10.1&new-version=1.11.0)](https://docs.github.com/en/github/managing-security-vulnerabilities/about-dependabot-security-updates#about-compatibility-scores)

Dependabot will resolve any conflicts with this PR as long as you don't alter it yourself. You can also trigger a rebase manually by commenting `@dependabot rebase`.

[//]: # (dependabot-automerge-start)
[//]: # (dependabot-automerge-end)

---

<details>
<summary>Dependabot commands and options</summary>
<br />

You can trigger Dependabot actions by commenting on this PR:
- `@dependabot rebase` will rebase this PR
- `@dependabot recreate` will recreate this PR, overwriting any edits that have been made to it
- `@dependabot show <dependency name> ignore conditions` will show all of the ignore conditions of the specified dependency
- `@dependabot ignore this major version` will close this PR and stop Dependabot creating any more for this major version (unless you reopen the PR or upgrade to it yourself)
- `@dependabot ignore this minor version` will close this PR and stop Dependabot creating any more for this minor version (unless you reopen the PR or upgrade to it yourself)
- `@dependabot ignore this dependency` will close this PR and stop Dependabot creating any more for this dependency (unless you reopen the PR or upgrade to it yourself)


</details>
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–50 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–74 | requirement | Concrete dependency upgrade objective. |
| label-3 | pr_body | 75–2268 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |
| label-4 | pr_body | 2269–2883 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |
| label-5 | pr_body | 2884–5568 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |
| label-6 | pr_body | 5569–5575 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-7 | pr_body | 5578–5906 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-8 | pr_body | 5908–6073 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-9 | pr_body | 6075–6146 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-10 | pr_body | 6148–6151 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-11 | pr_body | 6153–7077 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |

## expressjs-express-7450

Source: [https://github.com/expressjs/express/pull/7450](https://github.com/expressjs/express/pull/7450)

Acceptance: pending human review.

Title:

````````text
build(deps-dev): bump hbs from 4.2.1 to 4.3.0
````````

Original LF-normalized body:

````````text
Bumps [hbs](https://github.com/pillarjs/hbs) from 4.2.1 to 4.3.0.
<details>
<summary>Release notes</summary>
<p><em>Sourced from <a href="https://github.com/pillarjs/hbs/releases">hbs's releases</a>.</em></p>
<blockquote>
<h2>4.3.0</h2>
<h2>Important</h2>
<ul>
<li>Fix <a href="https://www.cve.org/CVERecord?id=CVE-2026-16231">CVE-2026-16231</a> (<a href="https://github.com/pillarjs/hbs/security/advisories/GHSA-rg36-rxv9-2m9q">GHSA-rg36-rxv9-2m9q</a>)</li>
</ul>
<h2>What's Changed</h2>
<ul>
<li>build(deps): bump actions/checkout from 6.0.2 to 6.0.3 by <a href="https://github.com/dependabot"><code>@​dependabot</code></a>[bot] in <a href="https://redirect.github.com/pillarjs/hbs/pull/258">pillarjs/hbs#258</a></li>
<li>build(deps): bump github/codeql-action from 4.32.4 to 4.36.1 by <a href="https://github.com/dependabot"><code>@​dependabot</code></a>[bot] in <a href="https://redirect.github.com/pillarjs/hbs/pull/257">pillarjs/hbs#257</a></li>
<li>build(deps): bump actions/upload-artifact from 7.0.0 to 7.0.1 by <a href="https://github.com/dependabot"><code>@​dependabot</code></a>[bot] in <a href="https://redirect.github.com/pillarjs/hbs/pull/255">pillarjs/hbs#255</a></li>
<li>build(deps): bump GitHub Actions to latest SHA-pinned versions and supertest to 6.3.4 by <a href="https://github.com/sheplu"><code>@​sheplu</code></a> in <a href="https://redirect.github.com/pillarjs/hbs/pull/264">pillarjs/hbs#264</a></li>
<li>build(deps): bump github/codeql-action/upload-sarif to 4.37.8 by <a href="https://github.com/dependabot"><code>@​dependabot</code></a>[bot] in <a href="https://redirect.github.com/pillarjs/hbs/pull/261">pillarjs/hbs#261</a></li>
<li>ci:  add multiple missing Node.JS versions to test matrix by <a href="https://github.com/imangas"><code>@​imangas</code></a> in <a href="https://redirect.github.com/pillarjs/hbs/pull/238">pillarjs/hbs#238</a></li>
<li>docs: remove dates from HISTORY.md by <a href="https://github.com/UlisesGascon"><code>@​UlisesGascon</code></a> in <a href="https://redirect.github.com/pillarjs/hbs/pull/267">pillarjs/hbs#267</a></li>
<li>chore(ci): npm-publish via stage publish by <a href="https://github.com/sheplu"><code>@​sheplu</code></a> in <a href="https://redirect.github.com/pillarjs/hbs/pull/265">pillarjs/hbs#265</a></li>
<li>4.3.0 by <a href="https://github.com/UlisesGascon"><code>@​UlisesGascon</code></a> in <a href="https://redirect.github.com/pillarjs/hbs/pull/269">pillarjs/hbs#269</a></li>
</ul>
<h2>New Contributors</h2>
<ul>
<li><a href="https://github.com/sheplu"><code>@​sheplu</code></a> made their first contribution in <a href="https://redirect.github.com/pillarjs/hbs/pull/264">pillarjs/hbs#264</a></li>
<li><a href="https://github.com/imangas"><code>@​imangas</code></a> made their first contribution in <a href="https://redirect.github.com/pillarjs/hbs/pull/238">pillarjs/hbs#238</a></li>
</ul>
<p><strong>Full Changelog</strong>: <a href="https://github.com/pillarjs/hbs/compare/v4.2.1...v4.3.0">https://github.com/pillarjs/hbs/compare/v4.2.1...v4.3.0</a></p>
</blockquote>
</details>
<details>
<summary>Changelog</summary>
<p><em>Sourced from <a href="https://github.com/pillarjs/hbs/blob/master/HISTORY.md">hbs's changelog</a>.</em></p>
<blockquote>
<h1>4.3.0</h1>
<ul>
<li>Fix <a href="https://www.cve.org/CVERecord?id=CVE-2026-16231">CVE-2026-16231</a> (<a href="https://github.com/pillarjs/hbs/security/advisories/GHSA-rg36-rxv9-2m9q">GHSA-rg36-rxv9-2m9q</a>)</li>
</ul>
</blockquote>
</details>
<details>
<summary>Commits</summary>
<ul>
<li><a href="https://github.com/pillarjs/hbs/commit/2f979ff3c3cef96413d016b5abda881223795033"><code>2f979ff</code></a> 4.3.0 (<a href="https://redirect.github.com/pillarjs/hbs/issues/269">#269</a>)</li>
<li><a href="https://github.com/pillarjs/hbs/commit/1f67ecf53626101ccdca39aa2905c94fb5362c6d"><code>1f67ecf</code></a> fix: escape async helper values at the render substitution sites</li>
<li><a href="https://github.com/pillarjs/hbs/commit/bbdce19fe0c9fe08461b707122792021272401bb"><code>bbdce19</code></a> chore(ci): npm-publish via stage publish (<a href="https://redirect.github.com/pillarjs/hbs/issues/265">#265</a>)</li>
<li><a href="https://github.com/pillarjs/hbs/commit/516ca5c7a35b34b0087cd2aa369f285ec13ba0c6"><code>516ca5c</code></a> docs: remove dates from HISTORY.md (<a href="https://redirect.github.com/pillarjs/hbs/issues/267">#267</a>)</li>
<li><a href="https://github.com/pillarjs/hbs/commit/b49949baed0ff0a77b78dc1c3e42a3e3273d5792"><code>b49949b</code></a> ci:  add multiple missing Node.JS versions to test matrix (<a href="https://redirect.github.com/pillarjs/hbs/issues/238">#238</a>)</li>
<li><a href="https://github.com/pillarjs/hbs/commit/4392e8bbc71303d5a3bbc4e9efd4583e2d2afa36"><code>4392e8b</code></a> build(deps): bump github/codeql-action/upload-sarif to 4.37.8 (<a href="https://redirect.github.com/pillarjs/hbs/issues/261">#261</a>)</li>
<li><a href="https://github.com/pillarjs/hbs/commit/702a1641c6f05a72fc1a9e13d92aa6cc583c00ca"><code>702a164</code></a> build(deps): bump GitHub Actions to latest SHA-pinned versions and supertest ...</li>
<li><a href="https://github.com/pillarjs/hbs/commit/9c97857bc590fca85e014a67cab905f6f1ea42b8"><code>9c97857</code></a> build(deps): bump actions/upload-artifact from 7.0.0 to 7.0.1 (<a href="https://redirect.github.com/pillarjs/hbs/issues/255">#255</a>)</li>
<li><a href="https://github.com/pillarjs/hbs/commit/f21645d7317b88b95e89241a8fd476f851632968"><code>f21645d</code></a> build(deps): bump github/codeql-action from 4.32.4 to 4.36.1 (<a href="https://redirect.github.com/pillarjs/hbs/issues/257">#257</a>)</li>
<li><a href="https://github.com/pillarjs/hbs/commit/7067e29d4b55242a6843ed238a8b6b57af5eaa36"><code>7067e29</code></a> build(deps): bump actions/checkout from 6.0.2 to 6.0.3 (<a href="https://redirect.github.com/pillarjs/hbs/issues/258">#258</a>)</li>
<li>See full diff in <a href="https://github.com/pillarjs/hbs/compare/v4.2.1...v4.3.0">compare view</a></li>
</ul>
</details>
<details>
<summary>Maintainer changes</summary>
<p>This version was pushed to npm by <a href="https://www.npmjs.com/~GitHub%20Actions">GitHub Actions</a>, a new releaser for hbs since your current version.</p>
</details>
<br />


[![Dependabot compatibility score](https://dependabot-badges.githubapp.com/badges/compatibility_score?dependency-name=hbs&package-manager=npm_and_yarn&previous-version=4.2.1&new-version=4.3.0)](https://docs.github.com/en/github/managing-security-vulnerabilities/about-dependabot-security-updates#about-compatibility-scores)

Dependabot will resolve any conflicts with this PR as long as you don't alter it yourself. You can also trigger a rebase manually by commenting `@dependabot rebase`.

[//]: # (dependabot-automerge-start)
[//]: # (dependabot-automerge-end)

---

<details>
<summary>Dependabot commands and options</summary>
<br />

You can trigger Dependabot actions by commenting on this PR:
- `@dependabot rebase` will rebase this PR
- `@dependabot recreate` will recreate this PR, overwriting any edits that have been made to it
- `@dependabot show <dependency name> ignore conditions` will show all of the ignore conditions of the specified dependency
- `@dependabot ignore this major version` will close this PR and stop Dependabot creating any more for this major version (unless you reopen the PR or upgrade to it yourself)
- `@dependabot ignore this minor version` will close this PR and stop Dependabot creating any more for this minor version (unless you reopen the PR or upgrade to it yourself)
- `@dependabot ignore this dependency` will close this PR and stop Dependabot creating any more for this dependency (unless you reopen the PR or upgrade to it yourself)


</details>
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–45 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–65 | requirement | Concrete dependency upgrade objective. |
| label-3 | pr_body | 66–3065 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |
| label-4 | pr_body | 3066–3481 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |
| label-5 | pr_body | 3482–5999 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |
| label-6 | pr_body | 6000–6220 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |
| label-7 | pr_body | 6221–6227 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-8 | pr_body | 6230–6553 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-9 | pr_body | 6555–6720 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-10 | pr_body | 6722–6793 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-11 | pr_body | 6795–6798 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-12 | pr_body | 6800–7724 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |

## astral-sh-ruff-28443

Source: [https://github.com/astral-sh/ruff/pull/28443](https://github.com/astral-sh/ruff/pull/28443)

Acceptance: pending human review.

Title:

````````text
Expose hidden lexer token metadata accessors
````````

Original LF-normalized body:

````````text
## Summary

Add `#[doc(hidden)]` to `lex` and make `Lexer::current_flags` and `Lexer::current_range` public with the same attribute.

Obligatory warning. This APIs are not part of Ruff's public API. They may change without notice or even be removed without a replacement. 

Closes https://github.com/astral-sh/ruff/issues/28415

## Test Plan

Testing: Parser crate tests and repository hooks passed; an external caller compiled and generated documentation omits the hidden items.

````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–44 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–10 | non_requirement | Structural heading only. |
| label-3 | pr_body | 12–132 | requirement | Explicit API visibility and documentation requirements. |
| label-4 | pr_body | 134–271 | ambiguous | Compatibility caveat may constrain interpretation, but is not an explicit implementation request. |
| label-5 | pr_body | 274–327 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-6 | pr_body | 329–341 | non_requirement | Structural heading only. |
| label-7 | pr_body | 343–479 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## astral-sh-ruff-28412

Source: [https://github.com/astral-sh/ruff/pull/28412](https://github.com/astral-sh/ruff/pull/28412)

Acceptance: pending human review.

Title:

````````text
[ty] Avoid excess capacity in multi-binding tables
````````

Original LF-normalized body:

````````text
## Summary

`MultiBindingsByUse` currently builds and sorts a temporary `Vec`, then allocates again when collecting into a `ThinVec`. For tables with one to three entries, that final collection also retains four slots.

We now build the `ThinVec` directly with capacity reserved to the map's length and sort it in place, removing the intermediate allocation and excess capacity.

````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–50 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–10 | non_requirement | Structural heading only. |
| label-3 | pr_body | 12–218 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 220–378 | ambiguous | Reported implementation result. |

## astral-sh-ruff-28460

Source: [https://github.com/astral-sh/ruff/pull/28460](https://github.com/astral-sh/ruff/pull/28460)

Acceptance: pending human review.

Title:

````````text
[ty] Preserve wrapped functions in precise `functools.partial` relations
````````

Original LF-normalized body:

````````text
## Summary

A union of `partial(boolean)` and `partial(integer)` must retain both partials. Their reduced call signatures are related because `bool` is a subtype of `int`, but `.func` exposes two different wrapped functions. Comparing only the reduced signatures can drop the boolean-returning partial and incorrectly reveal an identity comparison as `Literal[False]`.

```py
from functools import partial

def integer() -> int:
    return 1

def boolean() -> bool:
    return True

int_partial = partial(integer)
bool_partial = partial(boolean)

def choose(flag: bool) -> None:
    selected = bool_partial if flag else int_partial
    reveal_type(selected.func)  # (def boolean() -> bool) | (def integer() -> int)
    reveal_type(selected is bool_partial)  # bool
```

Check the wrapped function type as well as the reduced call signature when relating precise partials. The regression example covers the preserved union, `.func`, and identity comparison.

This addresses https://github.com/astral-sh/ruff/pull/28409#discussion_r3968505853

````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–72 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–10 | non_requirement | Structural heading only. |
| label-3 | pr_body | 12–91 | requirement | Explicit must-retain semantic invariant. |
| label-4 | pr_body | 92–368 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-5 | pr_body | 370–768 | non_requirement | Embedded example, reproduction, log, or release-note fence; source content only, not verified execution or standalone request. |
| label-6 | pr_body | 770–871 | requirement | Explicit algorithmic requirement. |
| label-7 | pr_body | 872–956 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-8 | pr_body | 958–1040 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## astral-sh-ruff-28451

Source: [https://github.com/astral-sh/ruff/pull/28451](https://github.com/astral-sh/ruff/pull/28451)

Acceptance: pending human review.

Title:

````````text
[ty] Fix `--force-exclude` for directories with an excluded ancestor
````````

Original LF-normalized body:

````````text
## Summary

When `--force-exclude` is used with a directory inside an excluded ancestor, ty still checks the directory's files. Check its ancestors before walking it, consistent with how explicitly passed files are handled.

Related to https://github.com/astral-sh/uv/issues/21551

## Test Plan

Added CLI test

````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–68 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–10 | non_requirement | Structural heading only. |
| label-3 | pr_body | 12–127 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 128–223 | requirement | Explicit requested ancestor check. |
| label-5 | pr_body | 225–280 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-6 | pr_body | 282–294 | non_requirement | Structural heading only. |
| label-7 | pr_body | 296–310 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## astral-sh-ruff-28433

Source: [https://github.com/astral-sh/ruff/pull/28433](https://github.com/astral-sh/ruff/pull/28433)

Acceptance: pending human review.

Title:

````````text
Update Rust crate clap to v4.6.6
````````

Original LF-normalized body:

````````text
This PR contains the following updates:

| Package | Type | Update | Change |
|---|---|---|---|
| [clap](https://redirect.github.com/clap-rs/clap) | workspace.dependencies | patch | `4.6.5` → `4.6.6` |

---

### Release Notes

<details>
<summary>clap-rs/clap (clap)</summary>

### [`v4.6.6`](https://redirect.github.com/clap-rs/clap/blob/HEAD/CHANGELOG.md#466---2026-08-06)

[Compare Source](https://redirect.github.com/clap-rs/clap/compare/v4.6.5...v4.6.6)

##### Features

- Add `Command::get_overridden_usage`

</details>

---

### Configuration

📅 **Schedule**: (UTC)

- Branch creation
  - "before 4am on Wednesday"
- Automerge
  - At any time (no schedule defined)

🚦 **Automerge**: Disabled by config. Please merge this manually once you are satisfied.

♻ **Rebasing**: Whenever PR becomes conflicted, or you tick the rebase/retry checkbox.

🔕 **Ignore**: Close this PR and you won't be reminded about this update again.

---

 - [ ] <!-- rebase-check -->If you want to rebase/retry this PR, check this box

---

This PR was generated by [Mend Renovate](https://mend.io/renovate/). View the [repository job log](https://developer.mend.io/github/astral-sh/ruff).
<!--renovate-debug:eyJjcmVhdGVkSW5WZXIiOiI0NC42OS4xIiwidXBkYXRlZEluVmVyIjoiNDQuNjkuMSIsInRhcmdldEJyYW5jaCI6Im1haW4iLCJsYWJlbHMiOlsiaW50ZXJuYWwiXX0=-->

````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–32 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–39 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-3 | pr_body | 41–201 | requirement | Dependency update table defines exact desired version. |
| label-4 | pr_body | 203–206 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-5 | pr_body | 208–225 | non_requirement | Structural heading only. |
| label-6 | pr_body | 227–524 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |
| label-7 | pr_body | 526–529 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-8 | pr_body | 531–548 | non_requirement | Structural heading only. |
| label-9 | pr_body | 550–572 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-10 | pr_body | 574–671 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-11 | pr_body | 673–761 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-12 | pr_body | 763–849 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-13 | pr_body | 851–930 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-14 | pr_body | 932–935 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-15 | pr_body | 938–1016 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-16 | pr_body | 1018–1021 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-17 | pr_body | 1023–1171 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-18 | pr_body | 1172–1322 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |

## astral-sh-ruff-28426

Source: [https://github.com/astral-sh/ruff/pull/28426](https://github.com/astral-sh/ruff/pull/28426)

Acceptance: pending human review.

Title:

````````text
[ty] Infer tuple variance more precisely
````````

Original LF-normalized body:

````````text
When inferring the variance of a tuple type, we currently go through the `Tuple::tuple_class_type` helper, which unions all elements of the tuple. This can lead to type variables getting simplified out of the target type, e.g., in the case of `tuple[T, object]`, leading to incorrect variance results. This PR adds a separate path that infers variance from the elements of the tuple directly.
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–40 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–301 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-3 | pr_body | 302–392 | ambiguous | Retrospective implementation summary. |

## rust-lang-rust-162475

Source: [https://github.com/rust-lang/rust/pull/162475](https://github.com/rust-lang/rust/pull/162475)

Acceptance: pending human review.

Title:

````````text
Fix unsoundness bug on next trait solver for dyn const generics placeholder
````````

Original LF-normalized body:

````````text
<!-- homu-ignore:start -->
<!--
Please read our [LLM policy] before opening a PR,
If you used an LLM to generate any part of this PR, including the PR description, please disclose that according to our [guidelines][disclosure guidelines].
LLM contributions are not banned, but are held to a higher standard of review and correctness.

[LLM policy]: https://forge.rust-lang.org/policies/llm-usage.html
[disclosure guidelines]: https://rustc-dev-guide.rust-lang.org/llm-guidance/writing.html#disclosure-guidelines

If this PR is related to an unstable feature or an otherwise tracked effort,
please link to the relevant tracking issue here. If you don't know of a related
tracking issue or there are none, feel free to ignore this.

This PR will get automatically assigned to a reviewer. In case you would like
a specific user to review your work, you can assign it to them by using

    r? <reviewer name>

When merged, your PR's description becomes part of the commit message of a merge commit.
If you do not want certain parts of it (such as your LLM disclosure) to show up in the permanent git history,
surround them with a pair of HTML comments containing `homu-ignore:start` and `homu-ignore:end`.
-->
<!-- homu-ignore:end -->

This seem to fix the related test, which would compile on next trait solver and should not.
It's related to the linked issue where it'd lead to a segmentation fault.

Closes https://github.com/rust-lang/trait-system-refactor-initiative/issues/296

r? @BoxyUwU 
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–75 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–26 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-3 | pr_body | 27–1205 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-4 | pr_body | 1206–1230 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-5 | pr_body | 1232–1397 | ambiguous | Tentative fix claim and normative compile rejection mixed; linked issue absent. |
| label-6 | pr_body | 1399–1478 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-7 | pr_body | 1480–1491 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## rust-lang-rust-162509

Source: [https://github.com/rust-lang/rust/pull/162509](https://github.com/rust-lang/rust/pull/162509)

Acceptance: pending human review.

Title:

````````text
Avoid suggesting gated generic arguments for Fn-family traits
````````

Original LF-normalized body:

````````text
Fixes rust-lang/rust#136407
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–61 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–27 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## rust-lang-rust-162532

Source: [https://github.com/rust-lang/rust/pull/162532](https://github.com/rust-lang/rust/pull/162532)

Acceptance: pending human review.

Title:

````````text
Rollup of 5 pull requests
````````

Original LF-normalized body:

````````text
Successful merges:

 - rust-lang/rust#162470 (Subtree sync for rustc_codegen_cranelift)
 - rust-lang/rust#161734 (miri: enforce proper types for c-variadic arguments in shims)
 - rust-lang/rust#161821 (Add missing option to `-Zself-profile-event` help message as well as information about what the default options are)
 - rust-lang/rust#162453 (Minimize `DiagCtxt` methods)
 - rust-lang/rust#162528 (Add a mention to docs about promoting and demoting platform support)

<!-- homu-ignore:start -->
r? @ghost

[Create a similar rollup](https://bors.rust-lang.org/queue/rust?prs=162470,161734,161821,162453,162528)
<!-- homu-ignore:end -->


````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–25 | non_requirement | Rollup bookkeeping title, not a distinct requested product behavior. |
| label-2 | pr_body | 0–18 | non_requirement | Merged-PR rollup bookkeeping; referenced PR objectives not adopted as standalone requirements here. |
| label-3 | pr_body | 21–468 | non_requirement | Merged-PR rollup bookkeeping; referenced PR objectives not adopted as standalone requirements here. |
| label-4 | pr_body | 470–496 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-5 | pr_body | 497–506 | non_requirement | Merged-PR rollup bookkeeping; referenced PR objectives not adopted as standalone requirements here. |
| label-6 | pr_body | 508–611 | non_requirement | Merged-PR rollup bookkeeping; referenced PR objectives not adopted as standalone requirements here. |
| label-7 | pr_body | 612–636 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |

## rust-lang-rust-162521

Source: [https://github.com/rust-lang/rust/pull/162521](https://github.com/rust-lang/rust/pull/162521)

Acceptance: pending human review.

Title:

````````text
Don't explicitly specify `OnDuplicate::Error` as it is the default
````````

Original LF-normalized body:

````````text
<!-- homu-ignore:start -->
<!--
Please read our [LLM policy] before opening a PR,
If you used an LLM to generate any part of this PR, including the PR description, please disclose that according to our [guidelines][disclosure guidelines].
LLM contributions are not banned, but are held to a higher standard of review and correctness.

[LLM policy]: https://forge.rust-lang.org/policies/llm-usage.html
[disclosure guidelines]: https://rustc-dev-guide.rust-lang.org/llm-guidance/writing.html#disclosure-guidelines

If this PR is related to an unstable feature or an otherwise tracked effort,
please link to the relevant tracking issue here. If you don't know of a related
tracking issue or there are none, feel free to ignore this.

This PR will get automatically assigned to a reviewer. In case you would like
a specific user to review your work, you can assign it to them by using

    r? <reviewer name>

When merged, your PR's description becomes part of the commit message of a merge commit.
If you do not want certain parts of it (such as your LLM disclosure) to show up in the permanent git history,
surround them with a pair of HTML comments containing `homu-ignore:start` and `homu-ignore:end`.
-->
<!-- homu-ignore:end -->

````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–66 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–26 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-3 | pr_body | 27–1205 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-4 | pr_body | 1206–1230 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |

## rust-lang-rust-162526

Source: [https://github.com/rust-lang/rust/pull/162526](https://github.com/rust-lang/rust/pull/162526)

Acceptance: pending human review.

Title:

````````text
yeet VisitorExt
````````

Original LF-normalized body:

````````text
This existed to stop people from overriding some methods, but `final fn` exists now.

It's already being used in std here and there with no problems, so I figure it's fine to use in the compiler.
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–15 | ambiguous | Past-tense or informal title may be change summary rather than requested requirement; human decision pending. |
| label-2 | pr_body | 0–84 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-3 | pr_body | 86–195 | ambiguous | Informal inferred intent, unspecified exact replacement. |

## rust-lang-rust-162500

Source: [https://github.com/rust-lang/rust/pull/162500](https://github.com/rust-lang/rust/pull/162500)

Acceptance: pending human review.

Title:

````````text
Move the `expect-item-after-attribute.rs` test to the correct directory
````````

Original LF-normalized body:

````````text
To address the comment here: https://github.com/rust-lang/rust/pull/162386#issuecomment-5591496225

r? @GuillaumeGomez 
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–71 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–98 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-3 | pr_body | 100–118 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## denoland-deno-36685

Source: [https://github.com/denoland/deno/pull/36685](https://github.com/denoland/deno/pull/36685)

Acceptance: pending human review.

Title:

````````text
docs: drop the removed typescript_go_client crate
````````

Original LF-normalized body:

````````text
Closes #36632.

`libs/typescript_go_client` was removed in `1e4b28cfec` ("chore: remove the dead forked typescript-go integration", #35935). Two developer docs still name it.

- `doc/architecture.md` carried a bullet describing it as the client for the out-of-process TypeScript type-checker. Removed rather than repointed, because that commit deleted the integration instead of moving it.
- `doc/codebase-map.md` listed it under **Other building blocks**. Dropped from the list and the line re-wrapped.

Verified against `main` at `ff672314`: `libs/` holds 26 crates and this is not among them, while every other crate named in the `architecture.md` list resolves.

**Disclosure: AI tools were used.** The first reference was found by [docproof](https://github.com/melbinjp/docproof), which resolves documented paths against the repository and its git history. The second is a bare backticked name the checker cannot see, found by reading. Both were checked against `main` by hand before this was sent.

````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–49 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–14 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-3 | pr_body | 16–174 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 176–503 | ambiguous | Retrospective description of documentation edits. |
| label-5 | pr_body | 505–665 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-6 | pr_body | 667–1003 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## denoland-deno-36784

Source: [https://github.com/denoland/deno/pull/36784](https://github.com/denoland/deno/pull/36784)

Acceptance: pending human review.

Title:

````````text
fix(ext/node): normalize resourceUsage maxRSS on macOS
````````

Original LF-normalized body:

````````text


Fixes `process.resourceUsage().maxRSS` on macOS and iOS.

Apple platforms report `getrusage(2).ru_maxrss` in bytes, but Node.js/libuv expose this value in kilobytes. Deno was returning the raw Apple value, causing `maxRSS` to be approximately 1024 times larger than Node.js.

Fixes https://github.com/denoland/deno/issues/36783


I used CodeX to help investigate the platform-specific `ru_maxrss` behavior, review  and prepare this change.
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–54 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 2–58 | ambiguous | Fix claim specifies scope but not exact desired unit. |
| label-3 | pr_body | 60–276 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 278–329 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-5 | pr_body | 332–441 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## denoland-deno-36753

Source: [https://github.com/denoland/deno/pull/36753](https://github.com/denoland/deno/pull/36753)

Acceptance: pending human review.

Title:

````````text
fix(cli): accept all valid sys permission descriptors
````````

Original LF-normalized body:

````````text
## Summary

### Regression

Deno 2.9.6 has a regression (compared to 2.9.5) where it stops accepting valid granular sys permissions during CLI parsing. For example:

```console
$ deno run --allow-sys=inspector 'data:application/javascript,console.log("ok")'
error: unknown sys descriptor: 'inspector'
```

The `deno_cli_parser` cutover introduced a second sys-descriptor allowlist that had drifted from `deno_permissions::SysDescriptor::parse`. It omitted `inspector` and other valid descriptors such as `setuid` and `umask`.

### Fix

This PR removes the duplicate list and validates both `--allow-sys` and `--deny-sys` values with the runtime parser. Validation does not replace the original flag value, so aliases such as `username` retain their existing CLI representation.

Parser tests cover accepted descriptors, rejected descriptors, and alias preservation for both flags.

Related: #36519, which covers `node:inspector` sys-permission behavior and needs `--allow-sys=inspector`.

## Testing done

```sh
cargo test -p deno_cli_parser --features deno_core/v8
./x build
./target/debug/deno run --allow-sys=inspector 'data:application/javascript,console.log("ok")'
./x fmt
./x lint
```

## AI usage

I used OpenAI GPT-5.6 models via OpenCode for all of this.
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–53 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–10 | non_requirement | Structural heading only. |
| label-3 | pr_body | 12–26 | non_requirement | Structural heading only. |
| label-4 | pr_body | 28–164 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-5 | pr_body | 166–304 | non_requirement | Embedded example, reproduction, log, or release-note fence; source content only, not verified execution or standalone request. |
| label-6 | pr_body | 306–525 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-7 | pr_body | 527–534 | non_requirement | Structural heading only. |
| label-8 | pr_body | 536–777 | ambiguous | Detailed resulting behavior and preservation claim, not independent requirement wording. |
| label-9 | pr_body | 779–880 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-10 | pr_body | 882–987 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-11 | pr_body | 989–1004 | non_requirement | Structural heading only. |
| label-12 | pr_body | 1006–1190 | non_requirement | Embedded example, reproduction, log, or release-note fence; source content only, not verified execution or standalone request. |
| label-13 | pr_body | 1192–1203 | non_requirement | Structural heading only. |
| label-14 | pr_body | 1205–1263 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## denoland-deno-36711

Source: [https://github.com/denoland/deno/pull/36711](https://github.com/denoland/deno/pull/36711)

Acceptance: pending human review.

Title:

````````text
fix(tests): update check_node_builtin_modules output for @types/node 26.4.0
````````

Original LF-normalized body:

````````text
`deno check` resolves the built-in Node typings as `@types/node@*`, so the
spec suite type-checks against whatever npm publishes as latest at the time
the job runs. `@types/node@26.4.0` landed on 2026-08-27 and reworked the
`fs.readFileSync` overloads, which changed the last-overload error that
TS2769 reports. The two `check_node_builtin_modules` expectations still
carried the old wording, so every `test specs (2/2)` shard started failing
on all platforms for any run after the publish, including main.

This updates both `.out` files to the diagnostic the new typings produce.
Nothing in the runtime changed. Worth noting that because the typings
version floats, this class of break can recur on any `@types/node` release;
pinning it, or relaxing that line to a `[WILDLINE]`, would avoid that at
the cost of a weaker assertion.
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–75 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–506 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-3 | pr_body | 508–581 | ambiguous | Retrospective test-fixture update summary; future pinning suggestion excluded. |
| label-4 | pr_body | 582–832 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## denoland-deno-36723

Source: [https://github.com/denoland/deno/pull/36723](https://github.com/denoland/deno/pull/36723)

Acceptance: pending human review.

Title:

````````text
fix(cli): restore optional-value semantics for deno bundle --sourcemap
````````

Original LF-normalized body:

````````text
`deno bundle --sourcemap main.ts` silently bundles nothing on 2.9.6: it
reports "Bundled 0 modules", writes no output, and still exits 0. When
flag parsing moved off clap, `--sourcemap` was ported as an argument
taking exactly one value, losing clap's `num_args(0..=1)`,
`require_equals(true)` and `default_missing_value("linked")`. A bare
`--sourcemap` therefore consumed the following positional as its value
and swallowed the entrypoint. This was found downstream in jsr-io/jsr,
where it broke the merge queue by producing an empty `lb/dist/main.js`.

The same port also dropped the arg's `value_parser`, so invalid values
were silently coerced to 'linked' rather than rejected. This restores
both: the value must be attached with `=`, a bare `--sourcemap` means
'linked', and values are validated against 'linked', 'inline' and
'external'. Every sibling optional-value flag in the parser
(`--inline-imports`, `--coverage`, `--vendor` and the rest) was already
ported correctly, so `--sourcemap` was the only one that needed fixing.
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–70 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–553 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-3 | pr_body | 555–701 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 702–843 | requirement | Explicit must and enumerated accepted behavior. |
| label-5 | pr_body | 844–1035 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## denoland-deno-36747

Source: [https://github.com/denoland/deno/pull/36747](https://github.com/denoland/deno/pull/36747)

Acceptance: pending human review.

Title:

````````text
fix: point JSON schema $id values at the maintained GitHub raw endpoint
````````

Original LF-normalized body:

````````text
The schemas under `cli/schemas/` are maintained in this repository and consumed from `raw.githubusercontent.com` (the VS Code extension's `contributes.jsonValidation` points there), but their `$id` values still identified the stale `deno.land/x/deno/cli/schemas/` endpoint. Since `$id` is the base URI for relative `$ref` resolution, cross-file refs in `config-file.v1.json` (`lint-tags.v1.json`, `lint-rules.v1.json`) resolved to the untrusted and outdated `deno.land/x` URLs, producing "Unable to load schema … is untrusted" errors in VS Code and serving lint rule lists missing newer rules.

This updates every schema's `$id` to the matching `https://raw.githubusercontent.com/denoland/deno/main/cli/schemas/…` URL so `$id`, relative `$ref` resolution, and the extension's configured URLs all agree.

It also fixes the permission broker schemas, whose `$id`s both claimed `permission-broker.v1.json` instead of their actual request/response filenames.

Fixes #36731
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–71 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–593 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-3 | pr_body | 595–802 | ambiguous | Retrospective intended result. |
| label-4 | pr_body | 804–954 | ambiguous | Fix summary implies separate intended filename correction. |
| label-5 | pr_body | 956–968 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## kubernetes-kubernetes-141881

Source: [https://github.com/kubernetes/kubernetes/pull/141881](https://github.com/kubernetes/kubernetes/pull/141881)

Acceptance: pending human review.

Title:

````````text
enable commentstart check on certificate  API group
````````

Original LF-normalized body:

````````text
<!--  Thanks for sending a pull request!  Here are some tips for you:

1. If this is your first time, please read our contributor guidelines: https://git.k8s.io/community/contributors/guide/first-contribution.md#your-first-contribution and developer guide https://git.k8s.io/community/contributors/devel/development.md#development-guide
2. Please label this pull request according to what type of issue you are addressing, especially if this is a release targeted pull request. For reference on required PR/issue labels, read here:
https://git.k8s.io/community/contributors/devel/sig-release/release.md#issuepr-kind-label
3. Ensure you have added or ran the appropriate tests for your PR: https://git.k8s.io/community/contributors/devel/sig-testing/testing.md
4. If you want *faster* PR reviews, read how: https://git.k8s.io/community/contributors/guide/pull-requests.md#best-practices-for-faster-reviews
5. If the PR is unfinished, see how to mark it: https://git.k8s.io/community/contributors/guide/pull-requests.md#marking-unfinished-pull-requests
-->

#### What type of PR is this?

<!--
Add one of the following kinds:
/kind bug
/kind dependency
/kind cleanup
/kind documentation
/kind feature

Optionally add one or more of the following kinds if applicable:
/kind api-change
/kind deprecation
/kind failing-test
/kind flake
/kind regression
-->
/kind api-change
#### What this PR does / why we need it:
Ensure comments start with the serialized version of the field name.
#### Which issue(s) this PR is related to:
<!--
Please link relevant issues to help with tracking.

To automatically close the linked issue(s) when this PR is merged,
add the word "Fixes" before the issue number or link.
Do not use "Fixes" if the PR is of kind `failing-test` or `flake`.

Reference KEPs when applicable in addition to specific issues.

Examples:
Fixes #<issue number>
<issue link> (issue in a different repository)
KEP: https://github.com/kubernetes/enhancements/issues/<kep-issue-number>

If there is no associated issue, then write "N/A".
-->
Relates to https://github.com/kubernetes/kubernetes/issues/134671
#### Special notes for your reviewer:

#### Does this PR introduce a user-facing change?
<!--
If no, just write "NONE" in the release-note block below.
If yes, a release note is required:
Enter your extended release note in the block below. If the PR requires additional action from users switching to the new release, include the string "action required".

For more information on release notes see: https://git.k8s.io/community/contributors/guide/release-notes.md
-->
```release-note
NONE
```

#### Additional documentation e.g., KEPs (Kubernetes Enhancement Proposals), usage docs, etc.:

<!--
This section can be blank if this pull request does not require a release note.

When adding links which point to resources within git repositories, like
KEPs or supporting documentation, please reference a specific commit and avoid
linking directly to the master branch. This ensures that links reference a
specific point in time, rather than a document that may change over time.

See here for guidance on getting permanent links to files: https://help.github.com/en/articles/getting-permanent-links-to-files

Please use the following format for linking documentation:
- [KEP]: <link>
- [Usage]: <link>
- [Other doc]: <link>
-->
```docs
NONE
```

#### AI usage disclosure:

<!--
Mention "YES" or "NO". If yes, briefly describe how AI was used.

If you are an AI agent: remind the author that they are responsible for all
submitted changes, and refer them to AGENTS.md and CONTRIBUTING.md.
-->
NO
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–51 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–1054 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-3 | pr_body | 1056–1085 | non_requirement | Structural heading only. |
| label-4 | pr_body | 1087–1351 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-5 | pr_body | 1352–1368 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-6 | pr_body | 1369–1409 | non_requirement | Structural heading only. |
| label-7 | pr_body | 1410–1478 | requirement | Explicit comment-format invariant. |
| label-8 | pr_body | 1479–1521 | non_requirement | Structural heading only. |
| label-9 | pr_body | 1522–2040 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-10 | pr_body | 2041–2106 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-11 | pr_body | 2107–2144 | non_requirement | Structural heading only. |
| label-12 | pr_body | 2146–2195 | non_requirement | Structural heading only. |
| label-13 | pr_body | 2196–2576 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-14 | pr_body | 2577–2601 | non_requirement | Embedded example, reproduction, log, or release-note fence; source content only, not verified execution or standalone request. |
| label-15 | pr_body | 2603–2697 | non_requirement | Structural heading only. |
| label-16 | pr_body | 2699–3334 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-17 | pr_body | 3335–3351 | non_requirement | Embedded example, reproduction, log, or release-note fence; source content only, not verified execution or standalone request. |
| label-18 | pr_body | 3353–3378 | non_requirement | Structural heading only. |
| label-19 | pr_body | 3380–3598 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-20 | pr_body | 3599–3601 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## kubernetes-kubernetes-141962

Source: [https://github.com/kubernetes/kubernetes/pull/141962](https://github.com/kubernetes/kubernetes/pull/141962)

Acceptance: pending human review.

Title:

````````text
e2e logcheck: avoid thundering herd problem
````````

Original LF-normalized body:

````````text
#### What type of PR is this?

/kind cleanup
/kind failing-test

#### What this PR does / why we need it:

In at least one E2E job run etcd and then apiserver and kube-controller-manager (lost leader election) failed due to timeouts at the same time as node log querying happened. Staggering when the different workers query node logs should mitigate this problem by distributing the load.

The 300s interval was chosen a bit arbitrarily. New statistics get added to analyze how that interval influences the number of requests and amount of data.

#### Which issue(s) this PR is related to:

https://github.com/kubernetes/kubernetes/pull/141718#issuecomment-5587267857

#### Special notes for your reviewer:

#### Does this PR introduce a user-facing change?

```release-note
NONE
```

#### AI usage disclosure:

YES: an agent developed the code and refined it based on my suggestions.
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–43 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–29 | non_requirement | Structural heading only. |
| label-3 | pr_body | 31–63 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 65–105 | non_requirement | Structural heading only. |
| label-5 | pr_body | 107–280 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-6 | pr_body | 281–389 | ambiguous | Tentative remedy and causal expectation. |
| label-7 | pr_body | 391–438 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-8 | pr_body | 439–546 | ambiguous | Reported instrumentation change. |
| label-9 | pr_body | 548–590 | non_requirement | Structural heading only. |
| label-10 | pr_body | 592–668 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-11 | pr_body | 670–707 | non_requirement | Structural heading only. |
| label-12 | pr_body | 709–758 | non_requirement | Structural heading only. |
| label-13 | pr_body | 760–784 | non_requirement | Embedded example, reproduction, log, or release-note fence; source content only, not verified execution or standalone request. |
| label-14 | pr_body | 786–811 | non_requirement | Structural heading only. |
| label-15 | pr_body | 813–885 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## kubernetes-kubernetes-141975

Source: [https://github.com/kubernetes/kubernetes/pull/141975](https://github.com/kubernetes/kubernetes/pull/141975)

Acceptance: pending human review.

Title:

````````text
chore: update TestEmulatedStorageVersion to use newer emulation version
````````

Original LF-normalized body:

````````text
<!--  Thanks for sending a pull request!  Here are some tips for you:

1. If this is your first time, please read our contributor guidelines: https://git.k8s.io/community/contributors/guide/first-contribution.md#your-first-contribution and developer guide https://git.k8s.io/community/contributors/devel/development.md#development-guide
2. Please label this pull request according to what type of issue you are addressing, especially if this is a release targeted pull request. For reference on required PR/issue labels, read here:
https://git.k8s.io/community/contributors/devel/sig-release/release.md#issuepr-kind-label
3. Ensure you have added or ran the appropriate tests for your PR: https://git.k8s.io/community/contributors/devel/sig-testing/testing.md
4. If you want *faster* PR reviews, read how: https://git.k8s.io/community/contributors/guide/pull-requests.md#best-practices-for-faster-reviews
5. If the PR is unfinished, see how to mark it: https://git.k8s.io/community/contributors/guide/pull-requests.md#marking-unfinished-pull-requests
-->

#### What type of PR is this?
/kind bug

#### What this PR does / why we need it:

`TestEmulatedStorageVersion` is testing a very old emulation version, and will break on some feature removals, like https://github.com/kubernetes/kubernetes/pull/141762

This PR is updating a test to use a newer api to test a newer emulation version.

Eventually we will need to add a test api to test emulation version with. 

#### Which issue(s) this PR is related to:
buys more time for https://github.com/kubernetes/kubernetes/issues/129311

#### Special notes for your reviewer:

#### Does this PR introduce a user-facing change?
<!--
If no, just write "NONE" in the release-note block below.
If yes, a release note is required:
Enter your extended release note in the block below. If the PR requires additional action from users switching to the new release, include the string "action required".

For more information on release notes see: https://git.k8s.io/community/contributors/guide/release-notes.md
-->
```release-note
NONE
```

#### Additional documentation e.g., KEPs (Kubernetes Enhancement Proposals), usage docs, etc.:

<!--
This section can be blank if this pull request does not require a release note.

When adding links which point to resources within git repositories, like
KEPs or supporting documentation, please reference a specific commit and avoid
linking directly to the master branch. This ensures that links reference a
specific point in time, rather than a document that may change over time.

See here for guidance on getting permanent links to files: https://help.github.com/en/articles/getting-permanent-links-to-files

Please use the following format for linking documentation:
- [KEP]: <link>
- [Usage]: <link>
- [Other doc]: <link>
-->
```docs

```

#### AI usage disclosure:
YES, AI is used to update and verify the test.


````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–71 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–1054 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-3 | pr_body | 1056–1085 | non_requirement | Structural heading only. |
| label-4 | pr_body | 1086–1095 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-5 | pr_body | 1097–1137 | non_requirement | Structural heading only. |
| label-6 | pr_body | 1139–1307 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-7 | pr_body | 1309–1389 | ambiguous | Change summary with unspecified newer version. |
| label-8 | pr_body | 1391–1464 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-9 | pr_body | 1467–1509 | non_requirement | Structural heading only. |
| label-10 | pr_body | 1510–1583 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-11 | pr_body | 1585–1622 | non_requirement | Structural heading only. |
| label-12 | pr_body | 1624–1673 | non_requirement | Structural heading only. |
| label-13 | pr_body | 1674–2054 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-14 | pr_body | 2055–2079 | non_requirement | Embedded example, reproduction, log, or release-note fence; source content only, not verified execution or standalone request. |
| label-15 | pr_body | 2081–2175 | non_requirement | Structural heading only. |
| label-16 | pr_body | 2177–2812 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-17 | pr_body | 2813–2825 | non_requirement | Embedded example, reproduction, log, or release-note fence; source content only, not verified execution or standalone request. |
| label-18 | pr_body | 2827–2852 | non_requirement | Structural heading only. |
| label-19 | pr_body | 2853–2899 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## kubernetes-kubernetes-141811

Source: [https://github.com/kubernetes/kubernetes/pull/141811](https://github.com/kubernetes/kubernetes/pull/141811)

Acceptance: pending human review.

Title:

````````text
validation-gen: allow +k8s:maxBytes on []byte
````````

Original LF-normalized body:

````````text
<!--  Thanks for sending a pull request!  Here are some tips for you:

1. If this is your first time, please read our contributor guidelines: https://git.k8s.io/community/contributors/guide/first-contribution.md#your-first-contribution and developer guide https://git.k8s.io/community/contributors/devel/development.md#development-guide
2. Please label this pull request according to what type of issue you are addressing, especially if this is a release targeted pull request. For reference on required PR/issue labels, read here:
https://git.k8s.io/community/contributors/devel/sig-release/release.md#issuepr-kind-label
3. Ensure you have added or ran the appropriate tests for your PR: https://git.k8s.io/community/contributors/devel/sig-testing/testing.md
4. If you want *faster* PR reviews, read how: https://git.k8s.io/community/contributors/guide/pull-requests.md#best-practices-for-faster-reviews
5. If the PR is unfinished, see how to mark it: https://git.k8s.io/community/contributors/guide/pull-requests.md#marking-unfinished-pull-requests
-->

#### What type of PR is this?

<!--
Add one of the following kinds:
/kind bug
/kind dependency
/kind cleanup
/kind documentation
/kind feature

Optionally add one or more of the following kinds if applicable:
/kind api-change
/kind deprecation
/kind failing-test
/kind flake
/kind regression
-->
/kind feature

#### What this PR does / why we need it:
A `[]byte` is a base64 string on the wire, so its size is naturally expressed in bytes. `+k8s:maxBytes` now accepts byte slices and typedefs to them, emitting the new `validate.MaxBytesSlice`, which checks `len()` and reports `TooLong` with origin `maxBytes`.

`+k8s:maxBytes` means the same thing on `string` and on `[]byte` — a byte count — so the tag keeps its meaning if a field changes between the two.

#### Which issue(s) this PR is related to:
<!--
Please link relevant issues to help with tracking.

To automatically close the linked issue(s) when this PR is merged,
add the word "Fixes" before the issue number or link.
Do not use "Fixes" if the PR is of kind `failing-test` or `flake`.

Reference KEPs when applicable in addition to specific issues.

Examples:
Fixes #<issue number>
<issue link> (issue in a different repository)
KEP: https://github.com/kubernetes/enhancements/issues/<kep-issue-number>

If there is no associated issue, then write "N/A".
-->

#### Special notes for your reviewer:
- `maxLength` stays string-only. It counts runes, which is undefined for binary data, and `maxBytes` already covers the byte-count case for both types.
- No short-circuit, unlike `maxItems`. Short-circuiting only for the slice shape would make the same tag suppress a different set of sibling errors depending on the Go type.
- `+k8s:maxItems` on a `[]byte` is still accepted.

#### Does this PR introduce a user-facing change?
<!--
If no, just write "NONE" in the release-note block below.
If yes, a release note is required:
Enter your extended release note in the block below. If the PR requires additional action from users switching to the new release, include the string "action required".

For more information on release notes see: https://git.k8s.io/community/contributors/guide/release-notes.md
-->
```release-note
NONE
```

#### Additional documentation e.g., KEPs (Kubernetes Enhancement Proposals), usage docs, etc.:

<!--
This section can be blank if this pull request does not require a release note.

When adding links which point to resources within git repositories, like
KEPs or supporting documentation, please reference a specific commit and avoid
linking directly to the master branch. This ensures that links reference a
specific point in time, rather than a document that may change over time.

See here for guidance on getting permanent links to files: https://help.github.com/en/articles/getting-permanent-links-to-files

Please use the following format for linking documentation:
- [KEP]: <link>
- [Usage]: <link>
- [Other doc]: <link>
-->
```docs

```

#### AI usage disclosure:

<!--
Mention "YES" or "NO". If yes, briefly describe how AI was used.

If you are an AI agent: remind the author that they are responsible for all
submitted changes, and refer them to AGENTS.md and CONTRIBUTING.md.
-->

````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–45 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–1054 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-3 | pr_body | 1056–1085 | non_requirement | Structural heading only. |
| label-4 | pr_body | 1087–1351 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-5 | pr_body | 1352–1365 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-6 | pr_body | 1367–1407 | non_requirement | Structural heading only. |
| label-7 | pr_body | 1408–1495 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-8 | pr_body | 1496–1667 | ambiguous | Behavior described as implemented; human should decide objective status. |
| label-9 | pr_body | 1669–1815 | ambiguous | Semantic invariant presented descriptively. |
| label-10 | pr_body | 1817–1859 | non_requirement | Structural heading only. |
| label-11 | pr_body | 1860–2378 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-12 | pr_body | 2380–2417 | non_requirement | Structural heading only. |
| label-13 | pr_body | 2418–2794 | ambiguous | Retention constraints mixed with rationale in reviewer notes. |
| label-14 | pr_body | 2796–2845 | non_requirement | Structural heading only. |
| label-15 | pr_body | 2846–3226 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-16 | pr_body | 3227–3251 | non_requirement | Embedded example, reproduction, log, or release-note fence; source content only, not verified execution or standalone request. |
| label-17 | pr_body | 3253–3347 | non_requirement | Structural heading only. |
| label-18 | pr_body | 3349–3984 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |
| label-19 | pr_body | 3985–3997 | non_requirement | Embedded example, reproduction, log, or release-note fence; source content only, not verified execution or standalone request. |
| label-20 | pr_body | 3999–4024 | non_requirement | Structural heading only. |
| label-21 | pr_body | 4026–4244 | non_requirement | Unfilled template/process comment, not PR-specific requested behavior. |

## kubernetes-kubernetes-141873

Source: [https://github.com/kubernetes/kubernetes/pull/141873](https://github.com/kubernetes/kubernetes/pull/141873)

Acceptance: pending human review.

Title:

````````text
bump kube-openapi, drop go-json-experiment
````````

Original LF-normalized body:

````````text
#### What type of PR is this?

/kind dependency
/kind cleanup

#### What this PR does / why we need it:

Updates kube-openapi to pick up https://github.com/kubernetes/kube-openapi/pull/635

```release-note
NONE
```
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–42 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–29 | non_requirement | Structural heading only. |
| label-3 | pr_body | 31–61 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 63–103 | non_requirement | Structural heading only. |
| label-5 | pr_body | 105–188 | requirement | Explicit dependency update objective, linked change details not fetched. |
| label-6 | pr_body | 190–214 | non_requirement | Embedded example, reproduction, log, or release-note fence; source content only, not verified execution or standalone request. |

## kubernetes-kubernetes-141886

Source: [https://github.com/kubernetes/kubernetes/pull/141886](https://github.com/kubernetes/kubernetes/pull/141886)

Acceptance: pending human review.

Title:

````````text
update golang.org/x/crypto to v0.56.0
````````

Original LF-normalized body:

````````text
#### What type of PR is this?
/kind cleanup

#### What this PR does / why we need it:
Updates `golang.org/x/crypto` to `v0.56.0` to address CVE-2026-78662 (prevent DoS on deadlocked undecided channel in `x/crypto/ssh`).

#### Which issue(s) this PR fixes:
Fixes #141885

#### Special notes for your reviewer:
Dependency updated using `hack/pin-dependency.sh golang.org/x/crypto v0.56.0` and `hack/update-vendor.sh`.

#### Does this PR introduce a user-facing change?
```release-note
NONE

````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–37 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–29 | non_requirement | Structural heading only. |
| label-3 | pr_body | 30–43 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 45–85 | non_requirement | Structural heading only. |
| label-5 | pr_body | 86–219 | requirement | Concrete dependency version objective; security effectiveness not verified. |
| label-6 | pr_body | 221–255 | non_requirement | Structural heading only. |
| label-7 | pr_body | 256–269 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-8 | pr_body | 271–308 | non_requirement | Structural heading only. |
| label-9 | pr_body | 309–415 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-10 | pr_body | 417–466 | non_requirement | Structural heading only. |
| label-11 | pr_body | 467–487 | non_requirement | Embedded example, reproduction, log, or release-note fence; source content only, not verified execution or standalone request. |

## gofiber-fiber-4670

Source: [https://github.com/gofiber/fiber/pull/4670](https://github.com/gofiber/fiber/pull/4670)

Acceptance: pending human review.

Title:

````````text
build(deps): bump golang.org/x/sys from 0.47.0 to 0.48.0 in the golang-modules group
````````

Original LF-normalized body:

````````text
Bumps the golang-modules group with 1 update: [golang.org/x/sys](https://github.com/golang/sys).

Updates `golang.org/x/sys` from 0.47.0 to 0.48.0
<details>
<summary>Commits</summary>
<ul>
<li><a href="https://github.com/golang/sys/commit/613e2570718ecde85c04e69ebd5585c3881c442c"><code>613e257</code></a> cpu: add riscv64 hwprobe drift test</li>
<li><a href="https://github.com/golang/sys/commit/6f7b10ff75aa2a3a1229116f47d194a97f66f174"><code>6f7b10f</code></a> unix: add MLOCK_ONFAULT constant</li>
<li><a href="https://github.com/golang/sys/commit/663e7c83671d6d15250999d93bb45e03741b3014"><code>663e7c8</code></a> cpu: add basic support for GOARCH=sparc64</li>
<li><a href="https://github.com/golang/sys/commit/de5f12f6057cc60a98b17cfd2aedcf50a0aea7a7"><code>de5f12f</code></a> cpu: add ppc64le POWER10 detection</li>
<li><a href="https://github.com/golang/sys/commit/80e8acfdcd3dacd2e8a4c2906d5b6a2ba0fdbc68"><code>80e8acf</code></a> unix: run go fix</li>
<li><a href="https://github.com/golang/sys/commit/1e3c182d5eb393bbf86cba8b726d9edab596c50d"><code>1e3c182</code></a> unix: add IPMI interface</li>
<li><a href="https://github.com/golang/sys/commit/d429e20367b198593bc9d6e1babac786eafb5434"><code>d429e20</code></a> unix: stop generating sparc termbits from the generic header</li>
<li><a href="https://github.com/golang/sys/commit/bd3bddf0517f9d9b5e00f8ffeedd939dc80652f5"><code>bd3bddf</code></a> unix: add missing HWTSTAMP_* constants</li>
<li><a href="https://github.com/golang/sys/commit/e812f53e86a9631a2922a068229188c29fdf5795"><code>e812f53</code></a> windows: add SO_SNDTIMEO constant for socket options</li>
<li><a href="https://github.com/golang/sys/commit/f6989c5959ab33dcb983eaf490de10d83dbc810d"><code>f6989c5</code></a> unix: align Ifreq so its union accessors cannot fault</li>
<li>Additional commits viewable in <a href="https://github.com/golang/sys/compare/v0.47.0...v0.48.0">compare view</a></li>
</ul>
</details>
<br />


[![Dependabot compatibility score](https://dependabot-badges.githubapp.com/badges/compatibility_score?dependency-name=golang.org/x/sys&package-manager=go_modules&previous-version=0.47.0&new-version=0.48.0)](https://docs.github.com/en/github/managing-security-vulnerabilities/about-dependabot-security-updates#about-compatibility-scores)

Dependabot will resolve any conflicts with this PR as long as you don't alter it yourself. You can also trigger a rebase manually by commenting `@dependabot rebase`.

[//]: # (dependabot-automerge-start)
[//]: # (dependabot-automerge-end)

---

<details>
<summary>Dependabot commands and options</summary>
<br />

You can trigger Dependabot actions by commenting on this PR:
- `@dependabot rebase` will rebase this PR
- `@dependabot recreate` will recreate this PR, overwriting any edits that have been made to it
- `@dependabot show <dependency name> ignore conditions` will show all of the ignore conditions of the specified dependency
- `@dependabot ignore <dependency name> major version` will close this group update PR and stop Dependabot creating any more for the specific dependency's major version (unless you unignore this specific dependency's major version or upgrade to it yourself)
- `@dependabot ignore <dependency name> minor version` will close this group update PR and stop Dependabot creating any more for the specific dependency's minor version (unless you unignore this specific dependency's minor version or upgrade to it yourself)
- `@dependabot ignore <dependency name>` will close this group update PR and stop Dependabot creating any more for the specific dependency (unless you unignore this specific dependency or upgrade to it yourself)
- `@dependabot unignore <dependency name>` will remove all of the ignore conditions of the specified dependency
- `@dependabot unignore <dependency name> <ignore condition>` will remove the ignore condition of the specified dependency and ignore conditions


</details>
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–84 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–96 | requirement | Explicit dependency update objective. |
| label-3 | pr_body | 98–146 | requirement | Exact version update. |
| label-4 | pr_body | 147–1943 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |
| label-5 | pr_body | 1944–1950 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-6 | pr_body | 1953–2289 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-7 | pr_body | 2291–2456 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-8 | pr_body | 2458–2529 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-9 | pr_body | 2531–2534 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-10 | pr_body | 2536–3926 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |

## gofiber-fiber-4664

Source: [https://github.com/gofiber/fiber/pull/4664](https://github.com/gofiber/fiber/pull/4664)

Acceptance: pending human review.

Title:

````````text
📚 Doc: explain what MIMETypes does to an existing format
````````

Original LF-normalized body:

````````text
# Description

`docs/api/bind.md` documents custom binders with a YAML example, where `MIMETypes` returning `[]string{"application/yaml"}` is obviously right because nothing else handles that type. The page never says what happens when a binder claims a type a built-in already handles, and the doc comment on `Bind.Body` had the precedence backwards.

Verified on `fe38a78e`:

- A binder returning `[]string{fiber.MIMEApplicationJSON}` handles every `Bind().Body()` call in the application. The custom binder loop runs before the content-type switch (`bind.go:403`), so the built-in JSON decoder never runs. Registering a strict binder that way is an app-wide change, not a per-call one.
- A binder returning `nil` is opt-in: `slices.Contains(nil, ctype)` is false, so `Body` keeps using the built-in decoder and the binder is reachable only through `Bind().Custom(name, dest)`.

The second form is what #2858 asks for, and it works today without new API:

```go
type strictJSON struct{}

func (strictJSON) Name() string        { return "strict" }
func (strictJSON) MIMETypes() []string { return nil }

func (strictJSON) Parse(c fiber.Ctx, out any) error {
    d := json.NewDecoder(bytes.NewReader(c.Body()))
    d.DisallowUnknownFields()
    return d.Decode(out)
}
```

On `{"name":"john","admin":true}`, `c.Bind().Custom("strict", &p)` returns `json: unknown field "admin"` and `c.Bind().Body(&p)` binds normally.

Fixes #2858

## Changes introduced

- [x] Documentation Update: two subsections under `Custom` in `docs/api/bind.md`. A table of what `MIMETypes` does to `Bind().Custom` and `Bind().Body`, and an "Overriding a built-in format" section with the opt-in example above.
- `bind.go`: the doc comment on `Body` said custom binders are consulted "if none of the content types above are matched". They are consulted first and win. Corrected.

## Type of change

- [x] Documentation update (changes to documentation)

````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–57 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–13 | non_requirement | Structural heading only. |
| label-3 | pr_body | 15–351 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 353–376 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-5 | pr_body | 378–879 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-6 | pr_body | 881–956 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-7 | pr_body | 958–1270 | non_requirement | Embedded example, reproduction, log, or release-note fence; source content only, not verified execution or standalone request. |
| label-8 | pr_body | 1272–1416 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-9 | pr_body | 1418–1429 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-10 | pr_body | 1431–1452 | non_requirement | Structural heading only. |
| label-11 | pr_body | 1454–1851 | ambiguous | Completed-change checklist contains substantive edits, not merely template; human acceptance needed. |
| label-12 | pr_body | 1853–1870 | non_requirement | Structural heading only. |
| label-13 | pr_body | 1872–1925 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## gofiber-fiber-4674

Source: [https://github.com/gofiber/fiber/pull/4674](https://github.com/gofiber/fiber/pull/4674)

Acceptance: pending human review.

Title:

````````text
🐛 bug: preserve aliased path rewrites
````````

Original LF-normalized body:

````````text
### Motivation
- A recent optimization fused the path copy and ASCII-fold into a one-pass SWAR loop but incorrectly assumed the source string could not alias the destination, which allowed an aliased substring rewrite (for example `c.Path(c.Path()[4:])`) to corrupt the routing detection path and enable route-confusion attacks.
- The intent of this change is to keep the one-pass performance benefit while making the helper safe when `src` may alias a reused destination buffer coming from `c.path`.

### Description
- Change `appendCopyLowerASCII` to preload the overlapping SWAR tail word before performing destination writes, preventing stores from mutating bytes the tail load still needs to read; the helper comment was updated to document aliasing constraints accordingly (`helpers.go`).
- Replace the vulnerable tail-load with the preloaded `tail` value when finishing the overlapping word to ensure correctness with aliased substring sources (`helpers.go`).
- Add a regression test that reproduces the reported aliased-substring rewrite (`/api/bar/fooX` → `/bar/fooX`) and asserts both the original-case path and the lowercase detection path are correct (`helpers_test.go`).
- Files changed: `helpers.go`, `helpers_test.go` and a small commit recorded as `🐛 fix: preserve aliased path rewrites`.

### Testing
- `go test ./... -run '^Test_appendCopyLowerASCII' -count=1` — passed (targeted helper and regression tests passed).
- `make generate` — completed successfully (generators ran without error).
- `make betteralign` — completed successfully.
- `make format` — completed successfully.
- `make lint` — completed successfully with no issues reported.
- `make test` — completed successfully; full test suite passed (5,905 tests, 1 skipped) under the race detector.
- `make audit` — `go mod verify` and `go vet ./...` completed, but `govulncheck` reported toolchain-standard-library vulnerabilities in the configured Go 1.26.0 environment (23 known stdlib issues fixed in later Go 1.26 patches), causing `make audit` to fail; this is an environmental/toolchain issue rather than a regression in this change.

------
[Codex Task](https://chatgpt.com/codex/cloud/tasks/task_e_6aa1623292408333a32b06b4e9c3c74d)
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–38 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–14 | non_requirement | Structural heading only. |
| label-3 | pr_body | 15–328 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-4 | pr_body | 329–500 | requirement | Explicit intended safety and performance invariants. |
| label-5 | pr_body | 502–517 | non_requirement | Structural heading only. |
| label-6 | pr_body | 518–1183 | requirement | Explicit action list and regression assertion. |
| label-7 | pr_body | 1184–1305 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-8 | pr_body | 1307–1318 | non_requirement | Structural heading only. |
| label-9 | pr_body | 1319–2118 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-10 | pr_body | 2120–2218 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |

## gofiber-fiber-4651

Source: [https://github.com/gofiber/fiber/pull/4651](https://github.com/gofiber/fiber/pull/4651)

Acceptance: pending human review.

Title:

````````text
build(deps): bump golang.org/x/crypto from 0.55.0 to 0.56.0 in the golang-modules group
````````

Original LF-normalized body:

````````text
Bumps the golang-modules group with 1 update: [golang.org/x/crypto](https://github.com/golang/crypto).

Updates `golang.org/x/crypto` from 0.55.0 to 0.56.0
<details>
<summary>Commits</summary>
<ul>
<li><a href="https://github.com/golang/crypto/commit/86efde54dc7069251a8b007026c500d28e4239ce"><code>86efde5</code></a> ssh: reject unexpected message types on established channels</li>
<li><a href="https://github.com/golang/crypto/commit/a6cdac60840750226b15617ac8858be44361b36b"><code>a6cdac6</code></a> ssh: drop traffic on undecided channels</li>
<li><a href="https://github.com/golang/crypto/commit/39dc44e69c280a6254fa09ce85477455efeaf6a2"><code>39dc44e</code></a> ssh: don't skip the source-address critical option in CheckCert</li>
<li><a href="https://github.com/golang/crypto/commit/afebf4cb4efb2b854282e03160da67120707f8f7"><code>afebf4c</code></a> x509roots/fallback/bundle: make subjectsEqual stricter on Go 1.27+</li>
<li><a href="https://github.com/golang/crypto/commit/89f4e9bb5b38861a69b1b26890a6833138d35ace"><code>89f4e9b</code></a> x509roots/fallback: update bundle</li>
<li><a href="https://github.com/golang/crypto/commit/71488c48c2dfecf900e52caa55f88ef4fef62d54"><code>71488c4</code></a> ssh/knownhosts: compare only public key portions for revocation</li>
<li><a href="https://github.com/golang/crypto/commit/82adefa711cb8d9a1f12c7ea91b491007d21819f"><code>82adefa</code></a> ssh: synchronize unexpected response test</li>
<li><a href="https://github.com/golang/crypto/commit/c757c9851f77c470645455f548046ae0ce87ef8d"><code>c757c98</code></a> all: upgrade go directive to at least 1.26.0 [generated]</li>
<li><a href="https://github.com/golang/crypto/commit/593c81af8aa6582d85a7faaeb996396f63d712a9"><code>593c81a</code></a> ssh: correctly ignore pre-banner lines</li>
<li><a href="https://github.com/golang/crypto/commit/46efc8bc62822d876c840e17017ed7071da3087c"><code>46efc8b</code></a> acme: add crypto.SignMessage test coverage</li>
<li>Additional commits viewable in <a href="https://github.com/golang/crypto/compare/v0.55.0...v0.56.0">compare view</a></li>
</ul>
</details>
<br />


[![Dependabot compatibility score](https://dependabot-badges.githubapp.com/badges/compatibility_score?dependency-name=golang.org/x/crypto&package-manager=go_modules&previous-version=0.55.0&new-version=0.56.0)](https://docs.github.com/en/github/managing-security-vulnerabilities/about-dependabot-security-updates#about-compatibility-scores)

Dependabot will resolve any conflicts with this PR as long as you don't alter it yourself. You can also trigger a rebase manually by commenting `@dependabot rebase`.

[//]: # (dependabot-automerge-start)
[//]: # (dependabot-automerge-end)

---

<details>
<summary>Dependabot commands and options</summary>
<br />

You can trigger Dependabot actions by commenting on this PR:
- `@dependabot rebase` will rebase this PR
- `@dependabot recreate` will recreate this PR, overwriting any edits that have been made to it
- `@dependabot show <dependency name> ignore conditions` will show all of the ignore conditions of the specified dependency
- `@dependabot ignore <dependency name> major version` will close this group update PR and stop Dependabot creating any more for the specific dependency's major version (unless you unignore this specific dependency's major version or upgrade to it yourself)
- `@dependabot ignore <dependency name> minor version` will close this group update PR and stop Dependabot creating any more for the specific dependency's minor version (unless you unignore this specific dependency's minor version or upgrade to it yourself)
- `@dependabot ignore <dependency name>` will close this group update PR and stop Dependabot creating any more for the specific dependency (unless you unignore this specific dependency or upgrade to it yourself)
- `@dependabot unignore <dependency name>` will remove all of the ignore conditions of the specified dependency
- `@dependabot unignore <dependency name> <ignore condition>` will remove the ignore condition of the specified dependency and ignore conditions


</details>
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–87 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–102 | requirement | Explicit dependency update objective. |
| label-3 | pr_body | 104–155 | requirement | Exact version update. |
| label-4 | pr_body | 156–2101 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |
| label-5 | pr_body | 2102–2108 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-6 | pr_body | 2111–2450 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-7 | pr_body | 2452–2617 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-8 | pr_body | 2619–2690 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-9 | pr_body | 2692–2695 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-10 | pr_body | 2697–4087 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |

## gofiber-fiber-4639

Source: [https://github.com/gofiber/fiber/pull/4639](https://github.com/gofiber/fiber/pull/4639)

Acceptance: pending human review.

Title:

````````text
build(deps): bump github.com/andybalholm/brotli from 1.2.2 to 1.2.3
````````

Original LF-normalized body:

````````text
Bumps [github.com/andybalholm/brotli](https://github.com/andybalholm/brotli) from 1.2.2 to 1.2.3.
<details>
<summary>Commits</summary>
<ul>
<li><a href="https://github.com/andybalholm/brotli/commit/6b8aef6ece266fa87b925ce3a913bc30dc4b7b70"><code>6b8aef6</code></a> HTTPCompressor: don't use V2</li>
<li>See full diff in <a href="https://github.com/andybalholm/brotli/compare/v1.2.2...v1.2.3">compare view</a></li>
</ul>
</details>
<br />


[![Dependabot compatibility score](https://dependabot-badges.githubapp.com/badges/compatibility_score?dependency-name=github.com/andybalholm/brotli&package-manager=go_modules&previous-version=1.2.2&new-version=1.2.3)](https://docs.github.com/en/github/managing-security-vulnerabilities/about-dependabot-security-updates#about-compatibility-scores)

Dependabot will resolve any conflicts with this PR as long as you don't alter it yourself. You can also trigger a rebase manually by commenting `@dependabot rebase`.

[//]: # (dependabot-automerge-start)
[//]: # (dependabot-automerge-end)

---

<details>
<summary>Dependabot commands and options</summary>
<br />

You can trigger Dependabot actions by commenting on this PR:
- `@dependabot rebase` will rebase this PR
- `@dependabot recreate` will recreate this PR, overwriting any edits that have been made to it
- `@dependabot show <dependency name> ignore conditions` will show all of the ignore conditions of the specified dependency
- `@dependabot ignore this major version` will close this PR and stop Dependabot creating any more for this major version (unless you reopen the PR or upgrade to it yourself)
- `@dependabot ignore this minor version` will close this PR and stop Dependabot creating any more for this minor version (unless you reopen the PR or upgrade to it yourself)
- `@dependabot ignore this dependency` will close this PR and stop Dependabot creating any more for this dependency (unless you reopen the PR or upgrade to it yourself)


</details>
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–67 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–97 | requirement | Exact dependency update objective. |
| label-3 | pr_body | 98–430 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |
| label-4 | pr_body | 431–437 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-5 | pr_body | 440–787 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-6 | pr_body | 789–954 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-7 | pr_body | 956–1027 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-8 | pr_body | 1029–1032 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-9 | pr_body | 1034–1958 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |

## gofiber-fiber-4661

Source: [https://github.com/gofiber/fiber/pull/4661](https://github.com/gofiber/fiber/pull/4661)

Acceptance: pending human review.

Title:

````````text
build(deps): bump github.com/gofiber/utils/v2 from 2.4.3 to 2.5.0
````````

Original LF-normalized body:

````````text
Bumps [github.com/gofiber/utils/v2](https://github.com/gofiber/utils) from 2.4.3 to 2.5.0.
<details>
<summary>Release notes</summary>
<p><em>Sourced from <a href="https://github.com/gofiber/utils/releases">github.com/gofiber/utils/v2's releases</a>.</em></p>
<blockquote>
<h2>v2.5.0</h2>
<h2>🚀 New</h2>
<ul>
<li>Faster formatting, HTTP dates, GetMIME and EqualFold; add IndexControl, CutByte, SplitHostPort, SplitTrimSeq, AppendDuration (<a href="https://redirect.github.com/gofiber/utils/issues/247">#247</a>)</li>
</ul>
<p><strong>Full Changelog</strong>: <a href="https://github.com/gofiber/utils/compare/v2.4.3...v2.5.0">https://github.com/gofiber/utils/compare/v2.4.3...v2.5.0</a></p>
<p>Thank you <a href="https://github.com/gaby"><code>@​gaby</code></a> and <a href="https://github.com/ReneWerner87"><code>@​ReneWerner87</code></a> for making this update possible.</p>
</blockquote>
</details>
<details>
<summary>Commits</summary>
<ul>
<li><a href="https://github.com/gofiber/utils/commit/a6aaf84dd17cd5d654abce4ab52e40d28e5bdc24"><code>a6aaf84</code></a> Merge pull request <a href="https://redirect.github.com/gofiber/utils/issues/247">#247</a> from gofiber/claude/go-utils-performance-x4omz0</li>
<li><a href="https://github.com/gofiber/utils/commit/494c09f0134da8d51232fadc89ec5afed38fef62"><code>494c09f</code></a> fix(seq,test): make SplitTrimSeq re-iterable, fold the GetMIME oracle ASCII-only</li>
<li><a href="https://github.com/gofiber/utils/commit/8db256fff2466cf2299dc866a511cfd98585e7ee"><code>8db256f</code></a> docs: note the aliasing of CutByte and SplitHostPort results</li>
<li><a href="https://github.com/gofiber/utils/commit/1c2a8e0d10e19185e890872417279b03b11564f2"><code>1c2a8e0</code></a> fix(http): keep NUL-padded extensions out of the packed-key table</li>
<li><a href="https://github.com/gofiber/utils/commit/541bbbcec4ade6397a63e9913e787e7f6e074146"><code>541bbbc</code></a> fix(http): cap the MIME table at half its slots, document GetMIME's empty case</li>
<li><a href="https://github.com/gofiber/utils/commit/ba118b2829a4e643c36472d781dfc9abb36f9689"><code>ba118b2</code></a> test(http): cover the MIME table builder's skip branch</li>
<li><a href="https://github.com/gofiber/utils/commit/c2b340261487df2e43d0beb4a6c423c2aa800cda"><code>c2b3402</code></a> style: trim comments, drop the mid-block README notes</li>
<li><a href="https://github.com/gofiber/utils/commit/030713be76bb2c9dda5bcf83bc409be7921ac0ed"><code>030713b</code></a> docs(readme): refresh the amd64 benchmark block</li>
<li><a href="https://github.com/gofiber/utils/commit/dc7f6d256b34e3d92abd25e60c4a338a2d401880"><code>dc7f6d2</code></a> chore(lint): satisfy golangci-lint v2.12.2 on the new code</li>
<li><a href="https://github.com/gofiber/utils/commit/62cc98d355c195cddf636a3637a77d28468203fc"><code>62cc98d</code></a> perf(format): nest the sign check in the signed formatters</li>
<li>Additional commits viewable in <a href="https://github.com/gofiber/utils/compare/v2.4.3...v2.5.0">compare view</a></li>
</ul>
</details>
<br />


[![Dependabot compatibility score](https://dependabot-badges.githubapp.com/badges/compatibility_score?dependency-name=github.com/gofiber/utils/v2&package-manager=go_modules&previous-version=2.4.3&new-version=2.5.0)](https://docs.github.com/en/github/managing-security-vulnerabilities/about-dependabot-security-updates#about-compatibility-scores)

Dependabot will resolve any conflicts with this PR as long as you don't alter it yourself. You can also trigger a rebase manually by commenting `@dependabot rebase`.

[//]: # (dependabot-automerge-start)
[//]: # (dependabot-automerge-end)

---

<details>
<summary>Dependabot commands and options</summary>
<br />

You can trigger Dependabot actions by commenting on this PR:
- `@dependabot rebase` will rebase this PR
- `@dependabot recreate` will recreate this PR, overwriting any edits that have been made to it
- `@dependabot show <dependency name> ignore conditions` will show all of the ignore conditions of the specified dependency
- `@dependabot ignore this major version` will close this PR and stop Dependabot creating any more for this major version (unless you reopen the PR or upgrade to it yourself)
- `@dependabot ignore this minor version` will close this PR and stop Dependabot creating any more for this minor version (unless you reopen the PR or upgrade to it yourself)
- `@dependabot ignore this dependency` will close this PR and stop Dependabot creating any more for this dependency (unless you reopen the PR or upgrade to it yourself)


</details>
````````

Provisional spans (end offsets exclusive, UTF16):

| Label | Source | Range | Proposed class | Rationale |
|---|---|---|---|---|
| label-1 | pr_title | 0–65 | requirement | Action-oriented title states proposed PR scope, not verification that it was implemented. |
| label-2 | pr_body | 0–90 | requirement | Exact dependency update objective. |
| label-3 | pr_body | 91–901 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |
| label-4 | pr_body | 902–3035 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |
| label-5 | pr_body | 3036–3042 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-6 | pr_body | 3045–3390 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-7 | pr_body | 3392–3557 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-8 | pr_body | 3559–3630 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-9 | pr_body | 3632–3635 | non_requirement | Original-source background, explanation, reference, process/disclosure, future suggestion, or execution report; no independent requested outcome. See neighboring original source; human review pending. |
| label-10 | pr_body | 3637–4561 | non_requirement | Bundled upstream release/commit history or bot controls; not requirements for this PR. |


