var express = require('express');
var bodyParser = require('body-parser');
var http = require('http');
var request = require('request');
var axios = require('axios');
var cheerio = require('cheerio');
var sleep = require('sleep');
var fs = require('fs');
var config = require('config');

let app = express();
app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

const USERS = {};
const ORGANIZATIONS = {};
var totalUsers;
var sessid = config.get('sessid')
var configured = false

if (sessid.toString() === "REPLACEME") {
	console.log("You have not configured your sessid yet!")
	console.log("Quitting...")
	process.exit()
}
// helper fns

function orgNameToURL(name) {
	if(name.split(' ').length > 1){
		name = urlizeName(name);
	}
	return 'https://community.dualthegame.com/organization/' + name;
}

function writeLog(output) {
	fs.appendFile('log.txt', output+'\n', function (err) {
  		if (err) 
  			return console.log(err);
	});
}

function addOrgToUser(user,org,joinDate,status) {
	if(USERS[user] === undefined){
		USERS[user] = { user: user, organizations: { } };
	}
	USERS[user].organizations[org] = {joinDate, status};
}

function addOrgWithDateAndMembers(org,date,membersArray){
	if(ORGANIZATIONS[org] === undefined) {
		ORGANIZATIONS[org] = { date, members: {} };
	}
	membersArray.forEach(member => {
		ORGANIZATIONS[org].members[member.name] = { joinDate: member.joinDate, status: member.status, createdDate: member.createdDate };
	});
}

function addCreateDateMembershipsAndPledgeStatus(username,createdDate, pledgeStatus) {
	if(USERS[username]===undefined){
		USERS[username] = {};
	}
		USERS[username].createdDate = createdDate;
		USERS[username].pledgeStatus = pledgeStatus;
}

const BASE_URL = 'https://community.dualthegame.com';

function flatMap(arr){
	return arr.reduce( (flatArr, item) => flatArr.concat(item),[]);
}



function urlizeName(name){
	if(name === undefined){
		console.error('Sad face');
	} else {
			return name.toLowerCase().split(' ').join('-');
	}
}

function dataStringFnGenerator() {
	var count = 0;
	return function(start) {
		count = 1;
		return `draw=${count}&order%5B0%5D%5Bcolumn%5D=4&order%5B0%5D%5Bdir%5D=desc&start=${start}&length=10`;
	}
}

function setupHeaders() {
	return axios.get('https://community.dualthegame.com/organizations').then(resp => {
		var setCookie = String(resp.headers['set-cookie']);

		var startIndex = setCookie.indexOf('=')+1;
		var endIndex = setCookie.indexOf(';');
		var csrfToken = setCookie.slice(startIndex,endIndex);
		//csrfToken = 'voJiPFqDfsWoEdPPHi9hpnXj5Kao0HmB';
		//console.log('csrf token: ',csrfToken);
		var cookieHeader = `cookieconsent_dismissed=yes; csrftoken=${csrfToken};`;
		if(sessid !== undefined){
			cookieHeader += 'authsessid=' + sessid + ';';
		} else {
			writeLog('No authsessid. Functionality limited to organization related data only.');
		}

		axios.defaults.headers.common['Cookie'] = cookieHeader;
		axios.defaults.headers.common['X-CSRFToken'] = csrfToken;
		axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';
		axios.defaults.headers.common['Host'] = 'community.dualthegame.com';
		axios.defaults.headers.common['Referer'] = 'https://community.dualthegame.com/organizations';
		axios.defaults.headers.common['Origin'] = 'https://community.dualthegame.com';
		configured = true;
		return csrfToken;
	}).catch(err => writeLog('*****\n********\n'));
}

function buildOrgList(res){
		var dataStringBuilder = dataStringFnGenerator();
		var promArray = [];

			let count = 0;

			// this is very hacky. shouldn't matter if 1400 is bigger than total users....
			while(count < 1400 && (totalUsers === undefined || count < totalUsers)) {
				let c = count;
				promArray.push(getPartialOrgList(res,dataStringBuilder(c)));
				count+=10;
				//sleep(5)
			}
			return Promise.all(promArray);
}

function getPartialOrgList(res,data) {
	//console.log('Data: ',data);
	return axios.post('https://community.dualthegame.com/organizations/list_ajax', data ).then(resp => {
		totalUsers = resp.data.recordsTotal;
		var orgs = resp.data.data.map(org => {
			var name = org.name.slice(10,org.name.lastIndexOf('"'));
			name = name.slice(name.indexOf('/')+1);
			return name;
		});
		return orgs;
	}).catch((x) => {writeLog(x); res.end('fail')});
}

function getUsersFromOrgName(name){
	name = urlizeName(name);
	var URL = BASE_URL + '/organization/' + name;
	return axios.get(URL, { timeout: 90000 }).then(resp => {
		let $ = cheerio.load(resp.data);

		var joinDates = $('#all_members').find('td:contains("-")').map( (i,el) => {
			return $(el).text();
		}).get();

		var statuses = $('#all_members').find('tr > td + td').map( (i,el) => {
			return $(el).text();
		}).get().map(x=>x.trim()).filter( val => val.includes('Member') || val.includes('Legate'));
		var uniqueUsers = {};
		var usersArray = $('#all_members td > a').map( (index,el) => {
				var href = el.attribs.href;
				var username = href.slice(href.lastIndexOf('/')+1);
				if(username !== undefined && username.length && username.length > 0) uniqueUsers[username] = true;
				addOrgToUser(username,name,joinDates[index],statuses[index]);
				return { name: username, organization: name, joinDate: joinDates[index], status: statuses[index] };
		}).get();

		// get organization created date
		// update "organizations" db
		let created = $('div.text-center > p > small').text();
		let ind = created.indexOf('d:')+2;
		created = created.slice(ind,ind+11);
		addOrgWithDateAndMembers(name,created,usersArray);

		return Object.keys(uniqueUsers);
	}).catch(err => writeLog('URL FAIL: ',URL,'\n',err.response.statusText));
}

function getUserInfo(name){
	//sleep.msleep(100)
	if(name === undefined){
		writeLog('getUserInfo fail. name undefined');
		return;
	}
	return axios.get('https://community.dualthegame.com/accounts/profile/' + name).then(resp => {
		let $ = cheerio.load(resp.data);

		// get pledgeStatus
		let pledgeStatus = 'none';
		if($('div.pledge_badge_anchor').length > 0) {
			var src = $('div.pledge_badge_anchor > img.pledge_badge').get(0).attribs.src;
			src = src.slice(src.lastIndexOf('/')+1,src.lastIndexOf('.'));
			pledgeStatus = src;
		}

		// get join date
		let createdDate = $(`small:contains('Joined:')`).text().slice('Joined:'.length);

		// only used for individual userInfo requests - /user/:username

		// get organizations and membership
		let organizations = $('div.col-md-8 ul > li > a').map((i,el) => {
			return $(el).text();
		}).get();

		let fullClanNames = $('div.col-md-8 ul > li').map( (i,el) => {
			return $(el).text();
		}).get();

		let memberships = fullClanNames.map( clanName => {
			if(clanName.includes('(')){
				return clanName.slice(clanName.indexOf('(')+1,clanName.indexOf(')'));
			} else {
				return 'member';
			}
		});

		addCreateDateMembershipsAndPledgeStatus(name, createdDate, pledgeStatus);

		return { name, createdDate, pledgeStatus, organizations };
	}).catch(err => writeLog('Problem getting user info.'));
}

// ======================================
// Begin ExpressJS Server / Endpoints
// ======================================

// use '/scrape' to scrape all orgs/users and fill database
// takes about 90s -- once completed, /stats will show summary

// /orgs & /users work only after /scrape

app.get('/', (req,res) => {
	setupHeaders();
	/*
	if(axios.defaults.headers.common['Cookie'] && axios.defaults.headers.common['Cookie'].includes && axios.defaults.headers.common['Cookie'].includes('authsessid')){
		res.end(`<html>cookie already set.<button onclick="document.location.href='/scrape';">Start scraping...</button></html>`);
	} else {
		res.end('<html>Input authssid token. Browser will hang while scraping. <form action="/sessid" method="post"><input type="text" name="sessid" placeholder="Sessid cookie"/><button type="submit">Submit</button></form></html>');
	}
	*/
});

app.get('/stats', (req,res) => {
	var stats = '';
	stats += 'Number of users: ' + Object.keys(USERS).length;
	stats += '\nNumber of Orgs: ' + Object.keys(ORGANIZATIONS).length;
	res.end(stats);
});

app.get('/scrape', (req,res) => {
	if(!configured)
		setupHeaders();

	if(sessid==="REPLACEME" || sessid===undefined){
		res.redirect('/');
	} else {
		writeLog('Getting CSRF token...');
		setupHeaders().then(x => {
			writeLog('Complete!\nBuilding list of organizations...');
			buildOrgList(res).then(orgs => {
					writeLog('Complete!\nBuilding master user list...')
					orgs = flatMap(orgs);

					Promise.all(orgs.map(getUsersFromOrgName)).then( usersArray => {
						writeLog('Complete!\nScraping user data...');
						usersArray = flatMap(usersArray);
						var uniqueUsers = Object.keys(usersArray.reduce( (uniqueObj,item) => {
							uniqueObj[item] = true;
							return uniqueObj;
						},{}));

						Promise.all(uniqueUsers.map(userObj => getUserInfo(userObj))).then(userInfoObjArray => {
							writeLog('Complete!','\n***\n',Object.keys(USERS).length + ' users added.');
							res.end('Scraping complete. ' + Object.keys(USERS).length + ' users added.' );
						}).catch(err => writeLog('Problem loading user data.'));
					}).catch(err=> writeLog('Problem loading organization data.'));
			});
		})
	}

	writeLog('Complete!');

	if(config.get('headless') == "true"){
			getFormattedOrgs();
			getFormattedUsers();
	}

});

function getFormattedOrgs() {
    var betterORGANIZATIONS = [];
    Object.keys(ORGANIZATIONS).forEach(function(key) {
        var org = ORGANIZATIONS[key];
        
        var newOrg = {
            name: key,
            createdDate: org.date
        };
        var members = [];
        if(org.members){
            Object.keys(org.members).forEach(function(key) {
                var member = {
                    name: key,
                    joinDate: org.members[key].joinDate,
                    status: org.members[key].status
                };
                members.push(member);
            });
        }
        
        newOrg.members = members;
        betterORGANIZATIONS.push(newOrg);
    });

    fs.writeFile("./orgs.json", JSON.stringify(betterORGANIZATIONS), function(err) {
    	if(err) {
        	return writeLog(err);
    	}
	});
    
    return betterORGANIZATIONS;
}

app.get('/orgs', (req,res) => {
	//var resp = "// Orgs: "+Object.keys(ORGANIZATIONS).length + '\n'+ JSON.stringify(ORGANIZATIONS);
	//console.log(resp);
	if(!configured)
		setupHeaders();
    var formattedORGS = getFormattedOrgs();
    var orgsText = "// Orgs: "+Object.keys(formattedORGS).length + '\n'+ JSON.stringify(formattedORGS);

	res.end(orgsText);
});

function getFormattedUsers() {
    var betterUSERS = [];
    Object.keys(USERS).forEach(function(key) {
        var user = USERS[key];
        
        var newUser = {
            user: user.user,
            createdDate: user.createdDate,
            pledgeStatus: user.pledgeStatus
        };
        var orgs = [];
        if(user.organizations){
            Object.keys(user.organizations).forEach(function(key) {
                var org = {
                    orgname: key,
                    joinDate: user.organizations[key].joinDate,
                    status: user.organizations[key].status
                };
                orgs.push(org);
            });
        }
        
        newUser.organizations = orgs;
        betterUSERS.push(newUser);
    });

    fs.writeFile("./users.json", JSON.stringify(betterUSERS), function(err) {
    	if(err) {
        	return writeLog(err);
    	}
	});
    
    return betterUSERS;
}

app.get('/users', (req,res) => {
	//var usersText = "// Users: "+Object.keys(USERS).length+"\n"+JSON.stringify(USERS);
	if(!configured)
		setupHeaders();
    var formattedUSERS = getFormattedUsers();
	var usersText = "// Users: "+Object.keys(formattedUSERS).length+"\n"+JSON.stringify(formattedUSERS);
	res.end(usersText);
});

//app.post('/sessid', (req,res) => {
	//sessid = req.body.sessid;
	//res.end('<a href="/scrape">Start scraping...</a><small>browser will hang</small>');
//});

app.get('/user/:user',(req,res) => {

	if(!configured)
		setupHeaders();

	var userInDb = USERS[req.params.user];
	res.write('<html>');
	var displayUser = (user) => {
		for(var key in user) {
			if(key === 'organizations' && Array.isArray(user[key])) {
				var orgArray = user[key];
				var liLinks = orgArray.reduce( (total, name) => {
					return `${total}<li><a href="${orgNameToURL(name)}">${name}</a></li>`;
				},'');
				res.write(`<ul>${liLinks}</ul>`);
			} else {
				res.write(key + ': ' + user[key] + '<br />');
			}
		}
	};

	if(userInDb===undefined || userInDb.organizations === undefined ){
		console.log('Sending getUserInfo request...');
		setupHeaders().then(x=>{
			getUserInfo(req.params.user).then(userObj => {
				writeLog('Complete!')
				displayUser(userObj);
				res.end('</html>');
			});
		});
	} else {
		displayUser(USERS[req.params.user]);
		res.end('</html>');
	}
});

app.get('/api/user/:user',(req,res) => {

	if(!configured)
		setupHeaders();

	var userInDb = USERS[req.params.user];
	if(userInDb===undefined || userInDb.organizations === undefined ){
		writeLog('Sending getUserInfo request...');
		setupHeaders().then(x=>{
			getUserInfo(req.params.user).then(userObj => {
				console.log('Complete!')
				res.end(JSON.stringify(userObj));
			});
		})
	} else {
	res.end(userInDb);
}
});


app.listen(3000, () => {
	if(!configured)
		setupHeaders();
	writeLog('Listening on port 3000...');
});
