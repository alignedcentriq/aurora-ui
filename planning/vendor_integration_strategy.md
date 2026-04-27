# Vendor Menu Integration Strategy

The goal is to receive daily or weekly food menus from an external vendor in a fast, free, and secure way, **without** providing them access to your internal Microsoft 365 tenant or company intranet.

Given your architecture, the **best, entirely free method** is to leverage a dedicated Telegram Bot specifically for vendors. 

Here is how the architecture and process will work:

---

## The Strategy: The Vendor Telegram Bot Gateway

Since you are already building Telegram bot integrations, you can create a separate "Vendor Portal Bot" (or use your existing bot with strict routing rules). 

### How it Works (The Flow)

1. **Bot Registration:** You create a Telegram Bot (e.g., `@YourCompanyVendorBot`) via the BotFather. This is 100% free.
2. **Vendor Onboarding:** You instruct the food vendor to message the bot on Telegram and provide you with their Telegram `user_id`.
3. **Strict Allowlisting:** In your backend database, you link that specific `user_id` to the "Food Vendor" role. The bot is programmed to **ignore every single message** from anyone who is not on this allowlist.
4. **Menu Submission:** 
   * The vendor opens Telegram and sends a PDF, Image, or plain text to the bot.
   * The bot verifies their `user_id`.
   * The bot downloads the file and securely transfers it to your internal system (e.g., saving it to Azure Blob Storage or storing the text in your Postgres database).
   * The bot replies: *"Menu successfully received for [Date]. Thank you!"*
5. **Nexus AI Integration:** Your internal Nexus AI Assistant detects the new menu in the database/storage and updates its internal RAG/Vector Store. When employees ask the Nexus AI "What's for lunch today?", the AI provides the newly uploaded menu.

---

## Why this is the Best Solution

* **Zero Cost:** Telegram is free. You don't need to purchase extra MS365 licenses or pay for external portal software.
* **Complete Isolation (Air-gapped from MS365):** The vendor only interacts with the Telegram API. They never touch your internal network, SharePoint, Teams, or Azure environments. Your backend acts as a secure bridge that *pulls* the menu into the system.
* **Low Friction for Vendor:** Vendors are usually non-technical. Sending a photo or PDF to a chat app is universally understood and incredibly easy to execute from a mobile phone in a kitchen or office.
* **Instant Notifications:** If a menu fails to parse or upload, the bot can instantly reply to the vendor asking them to try again.

---

## Alternative (If Telegram is not an option)

If the vendor refuses to use Telegram, the next best free alternative that requires zero MS365 access is a **Public Anonymous Form**.

* **Microsoft Forms (No File Upload):** You can create an anonymous Microsoft Form that anyone with the link can fill out. However, anonymous MS Forms **do not allow file attachments**. The vendor would have to type out the menu text manually.
* **Custom Web Portal (Low Cost/Free):** You could build a very simple, single-page web app hosted on **Azure Static Web Apps** (free tier). The page would have a hardcoded password (e.g., `VendorMenu2026!`) and a file upload button. An Azure Function receives the file and drops it into Azure Blob Storage. This requires slightly more development time but is highly professional.

**Recommendation:** Stick with the **Telegram Bot** approach. It aligns perfectly with your current technical stack, is entirely free, extremely secure (when allowlisted properly), and very easy for the vendor to use.
