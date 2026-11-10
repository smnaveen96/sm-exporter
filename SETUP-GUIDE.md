# SM exporter — Setup guide

Downloading files works right away. To upload to Google Drive, paste a Drive folder link and connect a Google account when prompted.

## Connect Google Drive

1. In Figma, open SM exporter and click the account avatar in the header, or start an upload.
2. Choose **Connect Google** and complete sign-in in the browser. SM exporter connects the account automatically when Google sign-in finishes.
3. Paste a Google Drive folder link next to the upload button and upload your selected frames.

To add another account, open the avatar menu and choose **Add account**. Use the same menu to switch between connected accounts or remove one. Removing an account only disconnects it from this plugin; it does not delete files from Google Drive.

Google sign-in and token refresh are handled by the SM exporter OAuth service. You do not need to create or enter OAuth client credentials, copy an authorization code, or paste a redirect URL.

## Sharing with your team

Each person signs in with their own Google account. Files are uploaded to the Drive folder they choose, and only people with access to that folder can see them.
