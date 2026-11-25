# Declare online

A card game for 2 to 10 real players. One person creates a game and gets a 4-letter code. Everyone else opens the site, types the code and joins. Only people who join play: no computer players are ever added.

## What is in this folder

- `server.js` runs the game and keeps every player's hand private. It has no dependencies.
- `public/index.html` is the game page that everyone opens.
- `package.json` tells the host how to start it.

## Try it on your own computer (optional)

1. Install Node.js 18 or newer from nodejs.org.
2. In this folder run `node server.js`.
3. Open http://localhost:3000 in two browser tabs. Create a game in one and join with the code in the other.

## Put it online with Render (free)

1. Make a free account at github.com and create a new repository (Public or Private).
2. Upload everything in this folder to it, keeping `public/index.html` inside the `public` folder. On the GitHub website use Add file, then Upload files, and drag the contents in.
3. Make a free account at render.com and sign in with GitHub.
4. Click New, then Web Service, and pick your repository.
5. Use these settings, then click Create Web Service:
   - Language / Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: Free
6. After a few minutes Render shows your address, like `https://your-game.onrender.com`. Open it, create a game, and send the code or the invite link to your family and friends.

## Keeping it awake

Render's free plan puts a web service to sleep after 15 minutes with no requests, and waking it takes about a minute. Games are kept in the server's memory, so a sleeping or restarted server loses any game in progress.

- Free fix: make a free account on cron-job.org (or UptimeRobot) and set it to open `https://your-game.onrender.com/health` every 10 minutes.
- Reliable fix: switch the service to a paid instance type in Render, which stays on.

## Good to know

- 5 rounds are played, and the highest total wins.
- The deck depends on the number of players. 2 to 4 players: 52 cards plus 2 jokers. 5 players: two decks (104 cards) plus 2 jokers. 6 players: 104 cards plus 3 jokers. 7 to 10 players: 104 cards plus 4 jokers.
- If a player does nothing for 2 minutes, the game makes a simple move for them so nobody is stuck.
- Unanswered Double or Triple calls pass automatically after 25 seconds.
- A player who leaves the page for more than a few seconds, or refreshes it, lands on the start screen. They tap Rejoin, or join again with the same code and the exact same name, and they get their old seat and hand back. They can also create a new game instead.
- Finished or abandoned games are deleted after 6 hours without activity.

## Making it an Android app later

Once the site is live you can turn its address into an APK with the free PWABuilder website (pwabuilder.com), or wrap it with Capacitor in Android Studio. Players can also use Chrome's Add to Home screen.
