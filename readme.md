# Dual Scraper

## Instructions

1. `node --use_strict --harmony server.js`
1. Go to / to set authssid (token available from cookies of logged in browser)
1. Submit token and wait for scraping to finish. _Note: this may take up to 3 minutes. Browser will hang. JSON data will be displayed when scraping is complete_
1. /orgs & /users contain the json data and output it to stdout & request response
1. `/api/user/:user` will respond with user createdDate, pledgeStatus and a list of organizations. Detailed organization information only available after scraping. 
1. `/user/:user` has user-friendly HTML response with organization links

## Getting authssid Token from Google Chrome

1. Open Developer Tools - Win/Linux: F12, macOS: Cmd+option+J
1. Copy authssid token value and paste into textbox at /
![dev_tools_screenshot](http://i.imgur.com/lcqRsZe.png)

#### Please star/watch repo or donate if you like Dual Scraper!
<img src="http://i.imgur.com/wWTknRB.png" height="70" />  
BTC: 1DJK3yVNNpqCyA5vssUwWKp4HEEWarY2m5
