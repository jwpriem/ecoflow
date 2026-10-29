# Connect your EcoFlow STREAM

WattsWise reads the charge level, battery power and solar power of your STREAM batteries through EcoFlow's official developer API. If you let WattsWise steer, it also sets when the batteries charge and discharge. For that you create an **access key** and a **secret key** on EcoFlow's developer site.

**Plan ahead:** EcoFlow approves new developer accounts by hand. That usually takes **a few days**. You can set up Tibber in the meantime.

## Which batteries work

STREAM Ultra, Ultra X, Pro, AC Pro, AC and Max. Several units in one system are fine. The STREAM 5000 and STREAM AC 5000 aren't available through EcoFlow's API yet.

## 1. Apply for a developer account

1. Go to [developer-eu.ecoflow.com](https://developer-eu.ecoflow.com) and sign in with your **EcoFlow app** account (the same email and password).
2. Choose **Become a developer** and fill in the form. As the purpose you can write: *"Using my own STREAM batteries with WattsWise, a home energy app."* You don't need a company.
3. Wait for EcoFlow's email that your account has been approved.

> Screenshot: the developer application form on developer-eu.ecoflow.com.

## 2. Create the keys

1. Once approved, sign in again at [developer-eu.ecoflow.com](https://developer-eu.ecoflow.com).
2. Open **Security** (in some versions under *Personal centre*).
3. Tap **Create** to make an **Access Key** and a **Secret Key**. Copy both right away: the secret key may only be shown once.

> Screenshot: the Security page with the access key and secret key.

## 3. Paste them into WattsWise

1. In WattsWise, open the **EcoFlow** step (or *Settings → Connections → EcoFlow developer API*).
2. Paste the access key and the secret key, then tap **Save & test**.
3. WattsWise lists every STREAM unit on your EcoFlow account, with its capacity and power filled in. Check them; you can change them later in Settings.

## What WattsWise does with the keys

The keys are stored encrypted and only used to talk to EcoFlow for your household. WattsWise starts in **monitor only**: it reads, it doesn't steer. It only sends settings to your batteries after you've chosen to let WattsWise steer and agreed to the terms for that. You can delete the keys on EcoFlow's developer site at any time; WattsWise then stops.

## Something not working?

- **"accessKey is invalid" or "no devices":** sometimes EcoFlow has to switch on API access for your device first. Mail EcoFlow developer support from the developer site, and mention the serial number of your STREAM.
- **Still waiting for approval?** Nothing to do but wait. Check your spam folder for EcoFlow's email.
- **A unit is missing:** check it's on the same EcoFlow account in the EcoFlow app, then tap *Save & test* again.
