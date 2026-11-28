# SM exporter — Setup guide

Downloading files works right away. To upload to Google Drive, connect a Google account. There are two ways to do it. Pick one, or use both for different accounts.

| | **Sign in with Google** | **Use your own Client ID** |
|---|---|---|
| Setup | None | About 10 minutes, once |
| How it works | Sign-in runs through SM exporter’s own sign-in service | You create a free Google “client” in your own Google Cloud project; sign-in goes straight between the plugin and Google |
| Good to know | Google hasn’t verified SM exporter yet, so Google shows a warning first | Choose this if you’d rather not give SM exporter’s app access to your Drive |

## 1. Sign in with Google

1. In Figma, open SM exporter and click the **Google icon** at the top right. (Or just start an upload: the plugin asks you to connect first.)
2. Choose **Sign in with Google**. Google opens in your browser.
3. Pick your Google account. If Google says **“Google hasn’t verified this app”**, click **Advanced**, then **Go to … (unsafe)**.
4. Allow access to Google Drive and click **Continue**.
5. Go back to Figma. The plugin connects your account by itself; there’s nothing to copy or paste.

## 2. Use your own Client ID

Part A is done once, by one person. Part B is done by each person on their own computer.

### Part A — Create your Google client

1. **Create a project.** Open [Google Cloud: New project](https://console.cloud.google.com/projectcreate) and sign in. Name it “SM exporter” and click **Create**. Check that the new project is selected in the project picker at the top of the page.
2. **Turn on the Drive API.** Open [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com) and click **Enable**.
3. **Set up the sign-in screen.** Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) and click **Get started**:
   - **App information:** App name “SM exporter”, and your email as the **User support email**. Click **Next**.
   - **Audience:** choose **External**. (If you use Google Workspace and only people in your organisation need it, choose **Internal**.) Click **Next**.
   - **Contact information:** your email. Click **Next**.
   - **Finish:** tick **I agree to the Google API Services: User Data Policy**, then click **Continue** and **Create**.
4. **Add the Drive permission.** Open [Data Access](https://console.cloud.google.com/auth/scopes) and click **Add or remove scopes**. Find `https://www.googleapis.com/auth/drive` in the list and tick it, or paste it into **Manually add scopes** and click **Add to table**. Click **Update**, then **Save**. This lets the plugin upload to any Drive folder you choose.
5. **Choose who can sign in.** Open [Audience](https://console.cloud.google.com/auth/audience). (Internal apps can skip this step.)
   - **Only you, or a few people:** under **Test users**, click **Add users**, enter each Google account that will sign in, and click **Save**. While the app is in Testing, Google signs everyone out after 7 days, so you’ll need to sign in again each week.
   - **To stay signed in:** click **Publish app** and confirm. Google then shows its “unverified app” warning when you sign in, and an unverified app can be used by at most 100 people in total.
6. **Create the client.** Open [Clients](https://console.cloud.google.com/auth/clients) and click **Create client**. For **Application type**, choose **Desktop app**, give it a name, and click **Create**.
7. **Copy the Client ID and Client secret right away**, or click **Download JSON**. Google shows the full secret only this once. If you lose it, open the client and click **Add secret** to make a new one.

### Part B — Connect the plugin

1. In Figma, open SM exporter, click the **Google icon** at the top right and choose **Use your own Client ID**.
2. Paste the **Client ID** and **Client secret** and click **Save**. The plugin checks them with Google. They’re kept only on this computer, inside Figma.
3. Click **Continue with Google**. Google opens in your browser.
4. Pick your Google account. If Google says **“Google hasn’t verified this app”**, click **Advanced**, then **Go to SM exporter (unsafe)**. Allow access to Google Drive and click **Continue**.
5. The browser then shows a page that says **“This site can’t be reached”**, with an address starting `http://127.0.0.1:53682/`. That’s expected. Copy the **full address** from the address bar, paste it into the plugin and click **Continue**.

## 3. Upload to Drive

1. Select the frames in Figma and choose the formats.
2. Paste a Google Drive **folder link** next to the upload button and click it. Or open **Drive folders** to browse, pick a folder and click **Upload here**.
3. Files with the same name in that folder are replaced, so re-uploading updates them instead of making copies.

## 4. Managing accounts

- **Add another account:** click the account photo at the top right and choose **Add account** or **Add with your own Client ID**. You can mix both kinds.
- **Switch accounts:** click an account in the same menu.
- **Remove an account:** click the bin next to it. This only disconnects it from the plugin; your files in Drive aren’t touched.
- **Change or delete your Client ID:** open **Add with your own Client ID**. Saving a different client, or clicking **Delete**, signs out the accounts that were connected with the old one. Accounts connected with **Sign in with Google** stay connected.

## 5. Sharing with your team

- **Sign in with Google:** there’s nothing to share. Each person signs in with their own Google account.
- **Your own Client ID:** one person does Part A, then sends the Client ID and Client secret to each teammate in a private message. Each teammate does Part B and signs in with their own Google account. If the app is still in Testing, add each teammate under **Test users** first.
- Everyone uploads with their own account, into the folders they choose. Only people with access to a folder can see what’s in it.

> Keep the Client secret private: don’t post it publicly (GitHub, social media, Figma Community). Anyone who has it can use your client.

## 6. If something goes wrong

**“Access blocked: … has not completed the Google verification process”**
Your app is in Testing and this Google account isn’t a test user. Add it under [Audience → Test users](https://console.cloud.google.com/auth/audience), or publish the app.

**“Google doesn’t recognise this Client ID” or “Google rejected the Client ID or secret”**
Check both for typos and extra spaces, and that the secret belongs to this client. If you’ve lost the secret, add a new one in [Clients](https://console.cloud.google.com/auth/clients).

**“That address has no code in it” or “That’s the sign-in page”**
Approve access in Google first, then copy the address of the page that opens next (the one that says “This site can’t be reached”).

**“Google didn’t accept that code”**
Each code works once and only for a few minutes. In the plugin, click **Open the Google sign-in page again** and paste the new address.

**Signed out after about a week**
Your app is in Testing. Sign in again, or publish the app on the [Audience](https://console.cloud.google.com/auth/audience) page.

**You can’t find `…/auth/drive` in the scope list**
Turn on the [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com) first, or paste the scope into **Manually add scopes**.

---

Google sometimes renames menus slightly, but the steps stay the same. Google’s own help: [Configure the OAuth consent screen](https://developers.google.com/workspace/guides/configure-oauth-consent) and [Create access credentials](https://developers.google.com/workspace/guides/create-credentials).
