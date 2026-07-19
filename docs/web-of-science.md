# Web of Science Starter API Guide

This guide covers Zotero Agent's Web of Science Starter API integration, individual eligibility, API Key setup, plan limits, and the plugin's quota safeguards.

## Can people outside universities apply?

Yes. Clarivate states that the **Free Trial Plan is available to anyone, even when their organization does not subscribe to Web of Science**. Independent researchers and individual developers can therefore apply for the trial.

Important qualifications:

- Free Trial is intended for personal use and evaluation, permits 50 requests per day, and does not return times-cited data.
- Clarivate's FAQ strongly encourages an institutional, workplace, or custom-domain email address. Requests from generic addresses such as Gmail or Yahoo may be rejected. This is an approval risk, not a university-only rule.
- Free Institutional Member requires membership in an organization that subscribes to Web of Science.
- Free Institutional Integration is intended for internal institutional systems and approval is limited to administrative staff of the organization.
- Approval can take several days and final eligibility is determined by Clarivate.

Official sources: [Web of Science Starter API](https://developer.clarivate.com/apis/wos-starter) and [Developer Portal FAQ](https://developer.clarivate.com/content/developer-portal-faq).

## Plan comparison

| Plan | Eligibility | Official rate | Official daily limit | Times cited | Plugin per-call safety cap |
| --- | --- | ---: | ---: | --- | ---: |
| Free Trial | Anyone; no organizational WoS subscription required | 1 request/s | 50 | Not returned | 50 records |
| Free Institutional Member | Members of a WoS-subscribing organization | 5 requests/s | 5,000 | Returned | 500 records |
| Free Institutional Integration | Institutional administrative staff; approval required | 5 requests/s | 20,000 | Returned | 1,000 records |

The plugin safety cap protects a daily quota from a single large call; it is not an additional Clarivate limit. Starter returns at most 50 records per page, so these caps require at most 1, 10, or 20 requests respectively.

## Obtain an API Key

### Choose a Client Type when registering the application

For the current Zotero Agent integration, select **`Public: Native/Mobile Application (Android/iOS app)`**. Although the label uses Android/iOS as examples, Clarivate's documentation explicitly includes applications installed on a user's PC, phone, or tablet. Zotero Agent is installed with Zotero on the user's computer, where its code and local configuration can be inspected, so it cannot keep a shared application `client secret` confidential and is a public native client.

| Client Type | Use it for | Deciding factor | Select for this project? |
| --- | --- | --- | --- |
| `Public: Single Page Application (browser based app)` | Browser-only frontends such as React or Vue SPAs | Browser JavaScript makes the API calls; users can inspect the code and credentials; no trusted backend stores a secret | No; Zotero Agent is not a browser SPA |
| `Public: Native/Mobile Application (Android/iOS app)` | Desktop, native, or mobile software installed on a user's PC, phone, or tablet | Software is delivered to the user's device and cannot reliably protect a shared `client secret` | **Yes; select this option** |
| `Confidential: Server side application, can keep secrets confidential` | A developer-controlled backend, daemon, or server-side web application | Every request carrying the secret originates on a controlled server, and the secret is never delivered to a browser, plugin, or user computer | No; the current plugin calls Clarivate directly from the user's computer |

**Leave `This application will use OAuth2.0 Flows (other than the Client Credentials flow, i.e. using redirects)` unchecked.** That option is only for OAuth2 applications that redirect a user to an Authorization Server and receive an authorization code or access token through a callback/redirect URI. This integration has no login redirect, redirect URI, authorization code, PKCE, access token, or refresh token; it calls Starter API directly with `X-ApiKey`.

Do not select `Confidential` merely because the API Key field uses a password-style input. That control prevents casual display in the UI; it does not turn software installed on a user's computer into a server environment that can protect an application-level secret. A future architecture in which the plugin calls only a developer-operated backend, and that backend stores the Clarivate credentials and makes every Clarivate request, could register the backend as `Confidential`.

Starter API uses `X-ApiKey`, not OAuth Client Credentials. The Portal's Client Type classifies the application's execution environment; it does not change the plugin's request header or require an OAuth `client secret` in Zotero. Official references: [Clarivate Client Types](https://developer.clarivate.com/help/client_types) and [Accessing using an API Key](https://developer.clarivate.com/help/api-access).

### Recommended application fields

Application page: [Register and View Your Applications](https://developer.clarivate.com/applications). After signing in, register a new application with these values:

| Field | Recommended value | Notes |
| --- | --- | --- |
| Application ID | `zotero-agent-<your-unique-identifier>`; the repository maintainer can use `zotero-agent-psiqaq` | The ID must be lowercase and unique across the Portal. The current form accepts `a-z`, `0-9`, `-`, and `_`; prefer hyphens and append your username or digits if the ID is taken. It cannot be changed after creation |
| Application Name | `Zotero Agent Web of Science Integration` | Human-readable only; it does not affect API calls |
| Application Description | Use the English template below | An accurate use case, request model, and project URL can help approval. Never include an API Key or other credential |

Copy and adjust this description to match the actual use case:

```text
Open-source Zotero desktop integration for personal literature discovery using the Web of Science Starter API. It performs user-initiated, read-only literature searches and returns bibliographic metadata through a local MCP server. Each user provides their own API key. Requests are rate-limited according to the selected plan; the application does not share credentials, perform background harvesting, or redistribute Web of Science data. Source code: https://github.com/psiQAQ/zotero-agent
```

Keep `personal literature discovery` only when it is accurate. An institutional applicant should replace it with the specific, truthful internal use case.

1. Open [Clarivate Developer Portal Applications](https://developer.clarivate.com/applications) and create or sign in to an account. Existing Clarivate product credentials may already work.
2. Register an application using the table above, select `Public: Native/Mobile Application` as its Client Type, and **leave OAuth2.0 Flows unchecked**. Register a distinct application for your Zotero integration; do not use another person's or a publicly shared Key.
3. Open the [Web of Science Starter API](https://developer.clarivate.com/apis/wos-starter), choose an eligible plan, and subscribe the application.
4. Wait for credentials or administrative approval. Some credentials may be issued quickly; other requests can take several days.
5. In Zotero, open `Settings → Zotero Agent → Web of Science`, select the exact plan, enter the Key in the password field, and click **Test connection**.
6. Enable the Web of Science tool after the test succeeds. The connection test consumes one API request.

Never paste a Key into chat, an issue, logs, or screenshots, and never commit it. The plugin stores it in Zotero Preferences for local use; this is convenient but is not an operating-system credential vault.

## Why is the plan selected manually?

Clarivate's public documentation, OpenAPI definition, and generated clients do not expose a dependable plan-inspection endpoint or promise a standard remaining-daily-quota field. The plugin therefore cannot reliably infer the Key's plan.

The selected plan controls:

- minimum request spacing: 1100 ms for Trial and 220 ms for institutional plans;
- local daily request cap: 50, 5,000, or 20,000;
- per-call record safety cap;
- UI guidance about times-cited availability.

Select the actual plan. Selecting an institutional plan for a Trial Key risks requests that are too fast; selecting Trial for an institutional Key is merely more conservative.

## Limits of local quota tracking

The plugin records requests it sends by UTC date and stops at the selected plan's daily limit. A request is counted before it is sent because failed requests may still count remotely. Concurrent MCP calls share a serial request gate so their aggregate rate stays within the configured plan.

This counter is not Clarivate's authoritative remaining quota:

- it cannot observe the same Key being used by another application;
- public Starter documentation does not promise a reset timezone or remaining-quota header;
- an HTTP 429 response stops the call immediately and is never retried automatically.

## What this update adds

| Component | Capability | Limitation |
| --- | --- | --- |
| `search_web_of_science` | Runs advanced WoS queries and returns basic metadata, identifiers, authors, source, keywords, links, and available times-cited data | Read-only; constrained by Key access, plan, database, and quota |
| Plan-aware safeguards | Serial throttling, local UTC daily counting, per-call safety caps, and stop-on-429 behavior | Cannot observe other clients or authoritative remote quota remaining |
| Preferences UI | Configures Key, plan, database, result cap, timeout, and connection test | Users obtain and protect their own Key |
| Import handoff | Sends a result DOI, PMID, or ISBN to `import_by_identifier` | No WoS UID-specific importer; records without supported identifiers are not directly imported |

This update does not include Expanded API, XLSX/CSV export, citation-network harvesting, or background synchronization.

## MCP example

```json
{
  "query": "TS=(\"graph neural network\") AND PY=(2020-2026)",
  "maxResults": 20,
  "sort": "relevance"
}
```

Prefer `identifiers.doi`, then PMID or ISBN, as input to `import_by_identifier`. A result `uid` can be used in a later `UT=(...)` exact query but is not currently a Zotero import identifier.

## Development and verification status

| Item | Status |
| --- | --- |
| Official eligibility and plan research | Complete |
| Design and implementation plan | Updated |
| Service, MCP tool, and preferences UI | Implemented locally |
| Unit tests and build | Passed (100/100; build Passed) |
| XPI deployment and Zotero selfTest | Passed (29 passed, 0 failed, 3 skipped) |
| Live Starter API | Pending user Key configuration in the panel |

Repository-wide `npm run lint:check` is currently blocked by an existing Prettier baseline affecting 86 files, including unrelated historical documents and source files. The feature-specific unit tests, TypeScript build, XPI deployment, runtime preferences DOM inspection, and protocol selfTest pass independently.
