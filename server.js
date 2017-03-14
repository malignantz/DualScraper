var express = require('express');
var bodyParser = require('body-parser');
var http = require('http');
var request = require('request');
var axios = require('axios');
var cheerio = require('cheerio');

let app = express();
app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
// objects with info
// { name: , joinDate: , organizations: [], memberships: []}
const USERS = {};
const ORGANIZATIONS = {};
var totalUsers;

// helper fns

function addOrgToUser(user,org,joinDate,status) {
	if(USERS[user] === undefined){
		USERS[user] = { user: user, organizations: {} };
	}
	USERS[user].organizations[org] = {joinDate, status};
}

function addOrgWithDateAndMembers(org,date,membersArray){
	if(ORGANIZATIONS[org] === undefined) {
		ORGANIZATIONS[org] = { date, members: {} };
	}
	membersArray.forEach(member => {
		ORGANIZATIONS[org].members[member.name] = { joinDate: member.joinDate, status: member.status };
	});
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
		var csrfToken = "D1DpcQo4zpKT29BRpr3d6PCjhJIhw8fu";
		var cookieHeader = `authsessid=0dpmxl0p0y61r5pu8ea5swv0vl97vi6k; cookieconsent_dismissed=yes; csrftoken=D1DpcQo4zpKT29BRpr3d6PCjhJIhw8fu;`;
		axios.defaults.headers.common['Cookie'] = cookieHeader;
		axios.defaults.headers.common['X-CSRFToken'] = csrfToken;
		axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';
		axios.defaults.headers.common['Host'] = 'community.dualthegame.com';
		axios.defaults.headers.common['Referer'] = 'https://community.dualthegame.com/organizations';
		axios.defaults.headers.common['Origin'] = 'https://community.dualthegame.com';
		return csrfToken;
	}).catch(err => console.log('*****\n********\n'));
}

function buildOrgList(res){
		var dataStringBuilder = dataStringFnGenerator();
		var promArray = [];

			let count = 0;
			while(count < 1353 && (totalUsers === undefined || count < totalUsers)) {
				let c = count;
				promArray.push(getPartialOrgList(res,dataStringBuilder(c)));

				count+=10;
			}
			return Promise.all(promArray);
}

function getPartialOrgList(res,data) {
	return axios.post('https://community.dualthegame.com/organizations/list_ajax', data ).then(resp => {
		totalUsers = resp.data.recordsTotal;
		var orgs = resp.data.data.map(org => {
			var name = org.name.slice(10,org.name.lastIndexOf('"'));
			name = name.slice(name.indexOf('/')+1);
			return name;
		});
		return orgs;
	}).catch((x) => {console.error(x); res.end('fail')});
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
		var usersArray = $('#all_members td > a').map( (index,el) => {
				var href = el.attribs.href;
				var username = href.slice(href.lastIndexOf('/')+1);
				addOrgToUser(username,name,joinDates[index],statuses[index]);
				return { name: username, organization: name, joinDate: joinDates[index], status: statuses[index] };
		}).get();

		// get organization created date
		// update "organizations" db
		var created = $('div.text-center > p > small').text();
		var ind = created.indexOf('d:')+2;
		created = created.slice(ind,ind+11);
		addOrgWithDateAndMembers(name,created,usersArray);

		return usersArray;
	}).catch(err => console.log('URL FAIL: ',URL,'\n',err.response.statusText));
}

function getUserInfo(name){
	return axios.get('https://community.dualthegame.com/accounts/profile/' + name).then(resp => {
		let $ = cheerio.load(resp.data);
		//let user = { name: name, pledgeStatus: null };
		// get pledgeStatus
		var pledgeStatus = null;
		if($('div.pledge_badge_anchor').length > 0) {
			var src = $('div.pledge_badge_anchor > img.pledge_badge').get(0).attribs.src;
			src = src.slice(src.lastIndexOf('/')+1,src.lastIndexOf('.'));
			//res.end(src);
			pledgeStatus = src;
		}

		// get join date
		var joinDate = $(`small:contains('Joined:')`).text().slice('Joined:'.length);

		// get clans and membership
		var clans = $('div.col-md-8 ul > li > a').map((i,el) => {
			return $(el).text();
		}).get();

		var fullClanNames = $('div.col-md-8 ul > li').map( (i,el) => {
			return $(el).text();
		}).get();

		var memberships = fullClanNames.map( clanName => {

			if(clanName.includes('(')){
				return clanName.slice(clanName.indexOf('(')+1,clanName.indexOf(')'));
			} else {
				return 'member';
			}
		});

		return { name, joinDate, pledgeStatus, memberships, clans };
	});
}

// ======================================
// Begin ExpressJS Server / Endpoints
// ======================================

// use '/scrape' to scrape all orgs/users and fill database
// takes about 90s -- once completed, /stats will show summary

// /orgs & /users work only after /scrape

app.get('/', (req,res) => {
	if(axios.defaults.headers.common['Cookie'] && axios.defaults.headers.common['Cookie'].includes && axios.defaults.headers.common['Cookie'].includes('authsessid')){
		res.end('cookie already set.');
	} else {
		res.end('<html>Set Cookie for script to work: <form action="/sessid" method="post"><input type="text" name="sessid" placeholder="Sessid cookie"/><button type="submit">Submit</button></form></html>');
	}
});

app.get('/stats', (req,res) => {
	var stats = '';
	stats += 'Number of users: ' + Object.keys(USERS).length;
	stats += '\nNumber of Orgs: ' + Object.keys(ORGANIZATIONS).length;
	res.end(stats);
});

app.get('/scrape', (req,res) => {
	setupHeaders().then(x => {
		return buildOrgList(res).then(orgs => {
				orgs = flatMap(orgs);
				Promise.all(orgs.map(getUsersFromOrgName)).then( orgNames => {
					res.end('Users in db: ' + Object.keys(USERS).length + JSON.stringify(USERS));
				});
		});
	})
});

app.get('/orgs', (req,res) => {
	var resp = "//"+Object.keys(ORGANIZATIONS).length + '\n'+ JSON.stringify(ORGANIZATIONS);
	console.log('\n\n****************\n\n',resp);
	res.end(resp);
});

app.get('/users/:org', (req,res) => {
	getUsersFromOrgName(req.params.org).then(resp=>{
		res.end(JSON.stringify(resp));
	});
});

app.post('/sessid', (req,res) => {
	axios.defaults.headers.common['Cookie'] = axios.defaults.headers.common['Cookie'] + '; authsessid=' + req.body.sessid;
	res.end();
});

app.get('/user/:user', (req,res) => {
	getUserInfo(req.params.user).then(resp=>{
		res.end(JSON.stringify(resp));
	});
});

app.get('/users', (req,res) => {
	var usersText = ""+Object.keys(USERS).length+JSON.stringify(USERS);
	console.log('**********\n\n' + usersText)
	res.end(usersText);
});

app.get('/axios', (req,res) => {
	res.end(JSON.stringify(axios.defaults.headers.common));
});

app.get('/sessid/:id', (req,res) => {
	axios.defaults.headers.common['Cookie'] = axios.defaults.headers.common['Cookie'] + '; authsessid=' + req.params.id;
	res.end('cookie set!');
});

app.listen(3000, () => {
	console.log('Listening on port 3000...');
});
