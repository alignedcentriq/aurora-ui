# Power Automate Integration Instructions

This document explains how to set up a Power Automate flow to automatically sync HR policies from a SharePoint folder directly to your backend.

## Backend Webhook Setup
The backend is already configured to receive webhooks from Power Automate.
- **Endpoint:** `POST /api/webhooks/sharepoint-sync`
- **Logic:** Calls `HRService.upsert_policy(title, content, category)` to update or create a policy in `policies.json`.

## How to set up your Power Automate Flow:

Go to Power Automate and create an **Automated Cloud Flow**.

1. **Trigger:** Search for SharePoint and choose **"When a file is created or modified (properties only)"**.
   - Set the *Site Address* and *Library Name* to your HR Policies folder.
   
2. **Action 1:** Add the SharePoint action **"Get file content"**.
   - Pass the *Identifier* from the trigger into this action so it fetches the actual document.
   
3. **Action 2:** Add a **"Text - HTML to Text"** action (or use an AI Builder action if you need to extract text from a PDF). 
   - If it's just raw text or markdown, you can pass it directly to the next step without parsing.
   
4. **Action 3:** Add the **"HTTP"** action (Premium) to push the data to the backend. Configure it like this:
   - **Method:** `POST`
   - **URI:** `https://your-backend-url.com/api/webhooks/sharepoint-sync` 
     *(Note: Since you are developing locally right now, you would need to use a tool like **ngrok** to expose your `localhost:8080` to the internet so Power Automate can reach it).*
   - **Headers:** 
     `Content-Type: application/json`
   - **Body:**
     ```json
     {
       "title": "@{triggerOutputs()?['body/{Name}']}",
       "content": "@{outputs('Get_file_content')?['body']}",
       "category": "SharePoint Sync"
     }
     ```

## How it Works
Every time HR uploads or edits a document in SharePoint, Power Automate will instantly fire that HTTP request. Your backend will parse the payload and update the local database. The LangGraph agent will immediately be able to search the new policy!
