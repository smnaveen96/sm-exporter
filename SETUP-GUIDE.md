# SM exporter — Setup guide

Downloading files works right away. To upload to Google Drive, SM exporter needs a Google “client” (a Client ID and a Client secret). You create it once, for free, in Google Cloud Console. Then you either use it yourself or share it with your team.

## Part 1 — Create your Google client (about 5 minutes, once)

1. Go to **console.cloud.google.com** and sign in with your Google account. Click **New project**, name it “SM exporter” and click **Create**.
2. **Enable the Drive API:** open **APIs & Services → Library**, search for **Google Drive API** and click **Enable**.
3. **Set up the consent screen:** open **Google Auth Platform → Get started**. Enter the app name “SM exporter” and your email. Choose **External** (choose **Internal** instead if your company uses Google Workspace and it is offered), then **Create**.
4. **Add the Drive permission:** go to **Data Access → Add or remove scopes**, add `https://www.googleapis.com/auth/drive`, then **Update** and **Save**. This lets the plugin save files into any Drive folder you paste.
5. **Publish the app:** go to **Audience → Publish app → Confirm**. If you skip this, Google signs you out every 7 days. (Not needed for Internal.)
6. **Create the client:** go to **Clients → Create client**, choose Application type **Desktop app**, and click **Create**. Copy the **Client ID** and the **Client secret**.

## Part 2 — Connect the plugin and upload (each person)

1. In Figma, open SM exporter and click the **⚙** icon.
2. Paste the **Client ID** and **Client secret** and click **Save**. They are stored only on that computer, inside Figma.
3. Paste a Google Drive **folder link** next to the upload icon and click the icon.
4. **First upload only:** pick your Google account. If you see “Google hasn’t verified this app”, click **Advanced → Go to SM exporter**, then **Allow**. You will land on a page that says “This site can’t be reached”. That is expected. Copy the **full address** from the browser’s address bar, paste it into the plugin and click **Continue**.

## Part 3 — Sharing with your team (pick one)

### Option A — Send the IDs privately

1. One person does Part 1 once.
2. They send the **Client ID** and **Client secret** to each teammate in a private message.
3. Each teammate does Part 2 (steps 1–4) with those values and signs in with their own Google account.

### Option B — Bake the IDs into the file, then share the file privately

1. One person does Part 1 once.
2. Open `ui.html` in a text editor and find these two lines near the top of the last `<script>`:
   `const DEFAULT_GOOGLE_CLIENT_ID = ''` and `const DEFAULT_GOOGLE_CLIENT_SECRET = ''`.
3. Paste your values between the quotes, for example `const DEFAULT_GOOGLE_CLIENT_ID = '1234-abc.apps.googleusercontent.com'`, and save the file.
4. Share the whole plugin folder with that edited `ui.html` inside your team only, for example a private team Drive folder.
5. Teammates import `manifest.json` in Figma (**Plugins → Development → Import plugin from manifest…**). They never see the settings fields, and only click upload and sign in with their own Google account (Part 2, steps 3–4).

## Good to know

- Anyone who has the baked-in file can read the Client secret inside it. Keep that copy private and never post it publicly (GitHub, social media, Figma Community).
- For a public copy, keep both lines empty. Each person then pastes their own Client ID and secret in ⚙ (Part 2).
- Values pasted in ⚙ override the ones baked into the file on that computer. Clearing the Client ID in ⚙ returns to the baked-in values.
- Everyone signs in with **their own** Google account. Files go to the Drive folder they paste, and only people with access to that folder can see them.
- Google’s menu names can change slightly, but the steps stay the same. An unpublished (Testing) app signs out every 7 days; publishing the app fixes that.
