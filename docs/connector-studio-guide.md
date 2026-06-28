# Connector Studio — User Guide

Connector Studio lets you connect any app or service (like Zoho, a vendor tool, or an
internal portal) to the AI assistant — **without any coding**. Once you connect a
service, the assistant can use it to answer questions and take actions for your team.

**Where to find it:** Control Hub → **Connector Studio**.

> Connector Studio is available to **Super Admins**, because connecting a service means
> handling its passwords/keys and giving the assistant the ability to act on it. Once a
> connector is published, **everyone** (or the people you choose) can use it just by
> chatting with the assistant — they don't need Connector Studio.

---

## What you'll need before you start

1. **An "API description" file** for the service (called an *OpenAPI spec* — a
   `.json` or `.yaml` file). This is the menu of things the service can do. See
   *How to get the API description file* below.
2. **The website address** of the service (e.g. `https://people.zoho.com`).
3. **A login credential** for the service (an API key, token, or username/password)
   — unless the service is public.

### How to get the API description file

You almost never have to write this yourself — most services already provide it:

- **Ask the service directly.** Many tools publish it at an address like
  `https://theservice.com/openapi.json` or `https://theservice.com/swagger.json`.
  Try opening that in a browser and saving the file.
- **Look on the service's documentation page.** Search their docs/developer site for
  "OpenAPI", "Swagger", or "API specification" — there's usually a download link.
- **Export from Postman.** If your team already has the API in Postman, use
  *Export → OpenAPI 3.0*.
- **Ask the vendor or your IT team.** If you can't find it, the people who own the
  service can usually send it to you.

If you truly can't get one, your IT/dev team can hand-write a small file for just the
few actions you need.

---

## Step by step: connect a service

1. **Create the connector.** Click ＋ in the sidebar and fill in:
   - **Name** — a friendly label (e.g. "Zoho People").
   - **Slug** — a short machine name, lowercase (e.g. `zoho_people`).
   - **Base URL** — the service's web address.
   - **Description** — a sentence on what it's for.

2. **Import the API description.** Click **Import Spec** and upload the `.json`/`.yaml`
   file. The studio automatically reads it and lists all the actions ("operations")
   the service offers.

3. **Add the login (Auth).** Click **Auth**, choose the credential type, and paste the
   key/token/username as prompted.
   - Your secrets are **encrypted and hidden** — once saved, they're never shown again.

4. **Tidy up the actions** (optional but recommended). Click the pencil on any action to:
   - Improve its **description** — this is how the assistant decides when to use it, so
     clear wording helps.
   - Turn on **Requires confirmation** for anything that changes data, so users are
     asked before it runs.
   - Set **Minutes saved** — used for the value/ROI reporting.
   - Turn an action **off** if you don't want to expose it.

5. **Test it.** Click the play button on an action, enter sample values, and check the
   response is correct — *before* anyone else can use it.

6. **Choose who can use it (Access).** Click **Access** and pick one:
   - **Everyone** — all users can use it (this is the default).
   - **Restricted** — only the roles, departments, or specific people you select.
   (More detail in the next section.)

7. **Publish.** Click **Publish**. Within about half a minute, the assistant can start
   using these actions in conversations.

8. **Watch usage.** The **Usage & ROI** tab shows how often each action is used, how
   fast it responds, its success rate, and total time saved.

---

## Choosing who can use a connector (Access)

When you click **Access**, you decide who can use the connector through the assistant:

| Choice | What it means |
|---|---|
| **Everyone** | Any user in the company can use it. This is the default. |
| **Restricted → Roles** | Only people with the roles you pick (e.g. HR, Manager, IT). |
| **Restricted → Departments** | Only people in the departments you list (e.g. Engineering). |
| **Restricted → Specific users** | Only the named people you add — search by name or email. |

You can combine roles, departments, and specific users. A person gets access if they
match **any** one of your selections (for example: "HR" role **or** "Finance" department
**or** listed by name).

This only controls who can *use* the connector in chat. Editing the connector here in
Connector Studio always stays Super-Admin only.

---

## If something isn't working

| What you see | What to check |
|---|---|
| Import found 0 actions | The file may not be a valid OpenAPI/Swagger file. Re-download it or ask the vendor. |
| Test shows "401 / 403" | The login isn't set or is wrong. Re-open **Auth** and re-enter it. |
| Assistant never uses the action | Make sure the connector is **published**, the action is **enabled**, and the description clearly says what it does. |
| Changes don't show up | Click **Re-publish** to apply changes immediately. |
| The right people can't use it | Check **Access** — they may not match the selected role/department, or aren't in the specific-users list. |

---

## A quick example

To let HR ask the assistant about leave balances from Zoho:

1. Create a connector named "Zoho People", base URL `https://people.zoho.com`.
2. Import Zoho's API description file.
3. Add the Zoho API token under **Auth**.
4. Test the "get leave balance" action with a sample employee.
5. Set **Access → Restricted → Role: HR**.
6. **Publish.**

Now anyone in HR can ask the assistant "what's the leave balance for …?" and it will
pull the answer from Zoho — no one had to write any code.
