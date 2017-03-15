# Dual Scraper

## Instructions

1. `npm start`
1. Go to / to set authssid (token available from cookies of logged in browser)
1. Go to localhost:3000/scrape to scrape all organizations and users. _Note: this may take up to 3 minutes. Errors will show in console.JSON data will be shown when scraping complete._
1. /orgs & /users contain the json data and output it to stdout & request response

## Getting authssid Token from Google Chrome

1. Open Developer Tools - Win/Linux: F12, macOS: Cmd+option+J
1. Copy authssid token value and paste into textbox at /
![dev_tools_screenshot](http://i.imgur.com/lcqRsZe.png)

## Creating JSON file from data
`node server.js | tee -a data.json` will copy stdout data to `data.json`
