# Connect Tibber

WattsWise gets the 15-minute electricity prices and the live meter readings of your **Tibber Pulse** from Tibber. You need two things: a Tibber electricity contract and a Pulse that is active. It takes about two minutes.

## 1. Check that your Pulse is active

Open the Tibber app. On the home screen you should see your **live power use** going up and down every few seconds. If you see it, the Pulse works.

> Screenshot: the Tibber app home screen with the live power figure.

No live figure? Then the Pulse isn't connected yet. Follow Tibber's own steps in the app (*Power-ups → Pulse*). WattsWise needs the Pulse: without it we can't tell solar from grid power, so we can't work out what your batteries save.

## 2. Create a personal access token

1. Go to [developer.tibber.com](https://developer.tibber.com) and tap **Sign in**. Use the same email and password as in the Tibber app.
2. Open **Access token** (under your name at the top right).
3. Tap **Create token** (or *Generate token*), give it a name like "WattsWise", and copy it.

> Screenshot: the access-token page on developer.tibber.com.

The token is a long string of letters and numbers. Treat it like a password: it gives read access to your Tibber data.

## 3. Paste it into WattsWise

1. In WattsWise, open the **Tibber** step (or *Settings → Connections → Tibber*).
2. Paste the token and tap **Save & test**.
3. Do you have more than one home with Tibber? Choose the right one.

WattsWise checks the token, finds your home and starts the Pulse stream. Within a minute you see your live use on the home screen.

## Something not working?

- **"Unauthorized" or "invalid token":** the token was copied incompletely, or deleted on developer.tibber.com. Create a new one.
- **"No Pulse":** the Pulse isn't active on this home yet (step 1).
- WattsWise only **reads** from Tibber. It never changes your contract or your Tibber settings. You can delete the token on developer.tibber.com at any time; WattsWise then stops reading.
