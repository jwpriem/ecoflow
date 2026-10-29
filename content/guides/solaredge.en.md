# Connect SolarEdge (optional)

With SolarEdge connected, WattsWise knows how much your solar panels produce. It then also shows what your panels earn you (used at home, stored, fed back) and tunes the solar forecast for your own roof. Without SolarEdge, WattsWise still works: the batteries' savings come from the Pulse, and the forecast from the weather.

SolarEdge doesn't have a simple "sign in" for apps like WattsWise yet. You create your own small, free **app** on SolarEdge's developer site once, and then sign in with it. It takes about ten minutes.

## 1. Create a developer account

1. Go to [developer.solaredge.com](https://developer.solaredge.com) and create an account. You can use the same email as your SolarEdge monitoring account.
2. Choose the **Free** plan. It gives 2,000 requests a month. WattsWise uses at most 64 a day, so it always stays within it.

## 2. Create a Site Access application

1. In the developer console, create a new application of the type **Site Access** (OAuth).
2. Give it a name, e.g. "WattsWise".
3. As the **redirect URI**, paste the address that WattsWise shows under *Settings → Connections → SolarEdge* ("Redirect URI to register…"). It ends in `/api/integrations/solaredge/callback`. It must match exactly.
4. Choose the scopes for **site data** and **device data** (`SITE_DATA`, `DEVICE_DATA`) if asked.
5. Save. You now see a **client ID** and a **client secret**.

> Screenshot: a new Site Access application with the redirect URI filled in.

## 3. Connect it in WattsWise

1. In WattsWise, open the **SolarEdge** step (or *Settings → Connections → SolarEdge*).
2. Paste the client ID and the client secret, then tap **Save & test**.
3. Tap **Sign in with SolarEdge**. You go to SolarEdge, sign in with your **monitoring** account (the one that shows your panels) and approve access to your site.
4. You come back to WattsWise. The card shows your site and the requests used today.

## Something not working?

- **"redirect_uri mismatch":** the redirect URI in your SolarEdge app isn't exactly the one WattsWise shows. Copy it again, without spaces.
- **"No access" after signing in:** you signed in with an account that can't see the site. Use the account that owns the installation, or ask your installer to give it access.
- **"Monthly credits used up":** WattsWise stops reading until the next month starts and tells you on the card. Nothing breaks.
- You can remove WattsWise's access at any time in SolarEdge's account settings, or delete the app on the developer site.
