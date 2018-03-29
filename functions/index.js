/*
  Author:             Taehoon Kim
  First Written:      07.20.2017
  Company:            Comfable
*/


// About Cron
// https://cloud.google.com/appengine/docs/standard/python/config/cronref

// Bigquery
// https://googlecloudplatform.github.io/google-cloud-node/#/docs/bigquery/0.9.6/bigquery

const functions = require('firebase-functions');
let keys = require('./keyFiles/keys.js');

const http = require('http');
const https = require("https");
const DarkSky = require('dark-sky');
const forecast = new DarkSky(keys.weatherAPIKey);

// Bigquery implementation
// Don't need key names because it's running within google cloud platform (firebase)
// Just added key name to use other project's bigquery
// https://googlecloudplatform.github.io/google-cloud-node/#/docs/bigquery/0.9.6/guides/authentication
const bigquery = require('@google-cloud/bigquery')({
  projectId: keys.googleProjectId,
  keyFilename: 'keyFiles/' + keys.keyFileName
});

// DataStore Implementation
// https://cloud.google.com/appengine/docs/flexible/nodejs/using-cloud-datastore
// Library references: 
// https://cloud.google.com/datastore/docs/reference/libraries#client-libraries-install-nodejs
// https://cloud.google.com/nodejs/docs/reference/datastore/1.4.x/
const datastore = require('@google-cloud/datastore')({
	projectId: keys.googleProjectId,
	keyFilename: 'keyFiles/' + keys.keyFileName
});

// Key is formed with [<kind>, <Name/ID>]
// for example, const key = datastore.key(['Company', 'Google']);
// Kind = datastore table name
// Name/ID = datastore specific element. Name = string, ID = Integer <-- important
const datastore_kind = keys.datastore_userProfile_kind;

const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

// https://github.com/voltrue2/in-app-purchase
// Where is public Key?
// https://developer.android.com/google/play/billing/billing_integrate.html
// Play console -> Services & APIs -> 'Your license key for this application'
var iap = require('in-app-purchase');	// Mar.28.2018 - Added:
iap.config({
	test: true,
	googlePublicKeyStrSandbox: keys.googlePlayPublicKeyStrSandbox,
  googlePublicKeyStrLive: keys.googlePlayPublicKeyStrLive
	//googleClientID: keys.googlePlayWebClientID,
	//googleClientSecret: keys.googlePlayWebClientSecret,
	//googleRefToken: '<Google Play refresh token>'
});

function queueNotificationJobs() {

}

// Jan.31.2018 - Already grouped by offset now.
// Feb.23.2018 - Fir the new Firebase criteria. make them all linear using promise (to make return happen in onPublish)
queueNotificationJobs.prototype = {

	start: function (offset, messageType) {  // messageType can be 'uvForecast', 'rainForecast'
		var t = this;
		var topicsArray = [];
  	var weatherDataArray = [];

  	var db = admin.database();
  	var refWeather = db.ref('activeLocationsByOffset/'+ offset);
  	var refPushQueue = db.ref('pushQueue');
    var refPushQueueTracker = db.ref('pushQueueTracker');

  	// filter by offset in weather data then 
  	// fire notification to all cities with topic ( = key)

  	return new Promise ((resolve, reject) => {

  		refWeather.once('value')
	  	.then((snapWeather) => {
				
	  		snapWeather.forEach((eachLocation) => {

	        // Aug.08.2017 - Cloudiness is added. Be sure that database has this data
	        // Sept.22.2017 - icon is added 
	        // Feb.05.2018 - tempMax, min is added 
	        // Mar.27.2018 - Daylight saving causes to fire notification twice. Compare offset.
	        // If offset is matching OR offset is not exactly matching but rounded offset is matching.
	        if(eachLocation.val() 
	          && eachLocation.val().hasOwnProperty('cloudiness')
	          && eachLocation.val().hasOwnProperty('icon') 
	          && eachLocation.val().hasOwnProperty('tempMax')
	          && eachLocation.val().hasOwnProperty('tempMin')
	          && eachLocation.val().hasOwnProperty('tzOffsetRound')
	          && (eachLocation.val().tzOffset == offset || (eachLocation.val().tzOffset !== offset && eachLocation.val().tzOffsetRound == offset))) {     

	          // Match with current time
	          var callUtil = new backendUtil();
	          var whichData = 0;
	          var curDate = new Date().getDate();

	          // UV forecast condition
	          // Sept.27.2017 - Cloudiness is now ignored
	          // eachLocation.val().cloudiness[whichData] < 0.5
	          if(messageType === 'uvForecast' && 
	            eachLocation.val().uviMax[whichData] > 5) {

	            var topic = callUtil.createTopicName(eachLocation.val().country, eachLocation.val().city);

	            var topicStringChecker = callUtil.checkTopicName(topic);

	            if(topicStringChecker) {    // Non English Cannot be here

	              topicsArray.push(topic);
	              weatherDataArray.push({
	                topic: topic,
	                messageType: messageType,
	                country: eachLocation.val().country,
	                city: eachLocation.val().city,
	                tz: eachLocation.val().tz,
	                tzOffset: eachLocation.val().tzOffset,
	                currentTime: eachLocation.val().currentTime,
	                uviTime: eachLocation.val().uviTime[whichData],
	                uviMax: eachLocation.val().uviMax[whichData],
	                forecastSummary: eachLocation.val().forecastSummary[whichData],
	                cloudiness: eachLocation.val().cloudiness[whichData],
	                icon: eachLocation.val().icon[whichData],
	                tempMax: eachLocation.val().tempMax[whichData],
	                tempMin: eachLocation.val().tempMin[whichData],
	                unitStr: ''
	              });

	            }

	          } else if(messageType === 'rainForecast' && 
	            (eachLocation.val().icon[whichData] === 'rain' || eachLocation.val().icon[whichData] === 'snow' || eachLocation.val().icon[whichData] === 'sleet')) {

	            // Same process as above
	            var topic = callUtil.createTopicName(eachLocation.val().country, eachLocation.val().city);
	            var topicStringChecker = new backendUtil().checkTopicName(topic);

	            // Spet.27.2017 - We want icon with first uppercase
	            var iconString = eachLocation.val().icon[whichData];
	            var modifiedIconString = iconString.charAt(0).toUpperCase() + iconString.slice(1).toLowerCase();

	            // FEb.05.2018 - Convert temperature values and unit
	            var tempMax = callUtil.convertTempByCountry(eachLocation.val().country, eachLocation.val().tempMax[whichData]);
	            var tempMin = callUtil.convertTempByCountry(eachLocation.val().country, eachLocation.val().tempMin[whichData]);
	            var unitStr = callUtil.convertUnitByCountry(eachLocation.val().country);

	            if(topicStringChecker) {    // Non English Cannot be here

	              topicsArray.push(topic);
	              weatherDataArray.push({
	                topic: topic,
	                messageType: messageType,
	                country: eachLocation.val().country,
	                city: eachLocation.val().city,
	                tz: eachLocation.val().tz,
	                tzOffset: eachLocation.val().tzOffset,
	                currentTime: eachLocation.val().currentTime,
	                uviTime: eachLocation.val().uviTime[whichData],
	                uviMax: eachLocation.val().uviMax[whichData],
	                forecastSummary: eachLocation.val().forecastSummary[whichData],
	                cloudiness: eachLocation.val().cloudiness[whichData],
	                icon: modifiedIconString,
	                tempMax: tempMax,
	                tempMin: tempMin,
	                unitStr: unitStr
	              });

	            }


	          } else {

	            if(messageType === 'rainForecast') {

	              var topic = callUtil.createTopicName(eachLocation.val().country, eachLocation.val().city);
	              var iconString = eachLocation.val().icon[whichData];
	              var modifiedIconString = iconString.charAt(0).toUpperCase() + iconString.slice(1).toLowerCase();

	              console.log('[RainForecast Not Pushed]: ' + topic + ', icon: ' + modifiedIconString + ' in ' + eachLocation.val().currentTime);
	            }
	            
	          }

	        }
	  			
	  		});

				// Pushing all done. Now send Notification for each topic
			  var promiseContainer = []; 
			  for(var i = 0; i < topicsArray.length - 1; i++) {	// topicsArray.length - 1
	        promiseContainer.push(t.createQueue(offset, weatherDataArray[i].messageType, topicsArray[i], weatherDataArray[i].uviMax, weatherDataArray[i].uviTime, weatherDataArray[i].country, weatherDataArray[i].city, weatherDataArray[i].forecastSummary ,weatherDataArray[i].icon, weatherDataArray[i].tempMax, weatherDataArray[i].tempMin, weatherDataArray[i].unitStr));
	      }

	      return Promise.all(promiseContainer);

			})
			.then((result) => {
			  
	      refPushQueueTracker.child(new Date().getTime()).set(weatherDataArray);
	      console.log('[Offset: '+ offset +'] Done Queuing ['+ messageType +'] Notification to ' + topicsArray.length + ' locations: ' + topicsArray);

	      resolve(true);

			})
			.catch((err) => {
				console.log('Calling Notification error: ' + err)
				reject(false);
			});

  	});
  		

	},

	createQueue: function (offset, messageTypeString, topic, uviMax, uviTime, country, city, forecastSummary, icon, tempMax, tempMin, unitStr) {

		var db = admin.database();
  	var refPushQueue = db.ref('pushQueue');

		return new Promise((resolve, reject) => {
			refPushQueue.child(topic).set({
        messageType: messageTypeString,
        country: country,
				city: city,
				uviMax: uviMax,
				uviTime: uviTime,
        offset: offset,
        forecastSummary: forecastSummary,
        icon: icon,
        tempMax: tempMax,
        tempMin: tempMin,
        unitStr: unitStr
			}, (err) => {
				if(err) reject(err);
				else {
					resolve(true);
				}
			});
		});

	}

}

function cronWeatherDataJobs() {

}

cronWeatherDataJobs.prototype = {

  start: function (offset) {
  	var t = this;
    var topicsArray = [];
    var topicsCoordArray = [];
    var locationNameArray = [];
    var decideWhetherToCallAPIOrNot = [];   // array of true or false
    var totalUserNumber = 0;
    var numberOfQueries = 50;

    var queryRef;

    var db = admin.database();
    var refLocation = db.ref('activeLocationsByOffset/'+ offset);
    var refWeatherPageToken = db.ref('weatherDataPageToken/'+ offset);

    var startToken, endToken;

    var refWeatherPageTokenNumber = 0;
    var refWeatherPageTokenName = '';

    var promiseContainer = [];
    var apiCalledLocations = [];    // just for testing / displaying
    // Just to clear unused database reference
    //var unused1 = db.ref('users');
    //var unused2 = db.ref('weatherData');
    //unused1.set(null); unused2.set(null);

    // This database is already a group of offset
    return new Promise((resolve, reject) => {

    	refLocation.once('value')
			.then((snapLocations) => {

				totalUserNumber = snapLocations.numChildren();    // get total number of cities in this offset

				return refWeatherPageToken.once("value");

			})
			.then((snapshotToken) => {

				// Used for just a counter for resetting token
	      startToken = (snapshotToken.val()) ? snapshotToken.val().num : 0;
	      endToken = startToken + numberOfQueries;
	      if(endToken > totalUserNumber) endToken = totalUserNumber;

	      console.log('[Offset: '+ offset +'] Starting Token '+ startToken +' out of ' + totalUserNumber + ', Last location: ' + ((snapshotToken.val()) ? snapshotToken.val().name : 'Not Available'));

	      // Filtering locations using token and last location loaded
	      if(!snapshotToken.val()) {
	        queryRef = refLocation.orderByKey().limitToFirst(numberOfQueries);
	      } else {
	        queryRef = refLocation.orderByKey().startAt(snapshotToken.val().name).limitToFirst(numberOfQueries);
	      }

	      return queryRef.once("value");

			})
			.then((snapshot) => {

				snapshot.forEach((res) => {
	        if(res.val().hasOwnProperty('lat') && res.val().hasOwnProperty('lng') 
	        	&& res.val().hasOwnProperty('country') && res.val().hasOwnProperty('city')) {

	          var topic = new backendUtil().createTopicName(res.val().country, res.val().city);

	          // Check for City name
	          var checkTopic = new backendUtil().checkTopicName(topic);

	          // check for last time updated. If the same day, don't call api
	          // For Testing purpose, disable it. Make it always call.
	          var checkLastTimeUpdated = true;
	          if(res.val().hasOwnProperty('currentTime')) {
	            checkLastTimeUpdated = new backendUtil().checkLastTimeForecastUpdated(res.val().currentTime);
	          }

	          // Mar.27.2018 - Check if it's really a valid offset. (Daylight saving issue: offset becomes different)
	          var checkOffsetMatching = true;
	          if(res.val().hasOwnProperty('tzOffset')) {
	          	checkOffsetMatching = (res.val().tzOffset == offset);
	          }

	          var finalDecision = (checkTopic && checkLastTimeUpdated && checkOffsetMatching) ? true : false;
	          
	          topicsArray.push(topic);
	          topicsCoordArray.push({
	            lat: res.val().lat,
	            lng: res.val().lng
	          });
	          locationNameArray.push({
	            country: res.val().country,
	            city: res.val().city
	          });
	          decideWhetherToCallAPIOrNot.push(finalDecision);

	        }
	      });

				// For each is done
	      for(var i = 0; i < topicsArray.length - 1; i++) {
	        promiseContainer.push(t.getWeatherData(offset, topicsCoordArray[i].lat, topicsCoordArray[i].lng, topicsArray[i], locationNameArray[i].country, locationNameArray[i].city, decideWhetherToCallAPIOrNot[i], i, (topicsArray.length - 1)));
	        
	        // Just for Testing / Displaying which location api is called
	        if(decideWhetherToCallAPIOrNot[i]) apiCalledLocations.push(topicsArray[i]);
	      }

	      return Promise.all(promiseContainer);

			})
			.then((result) => {

				// Update Token (last location that is loaded)
	      if(endToken == totalUserNumber) {
	        refWeatherPageToken.set(null);

	        console.log('[Offset: '+ offset +'] Done and resetting ['+ startToken +' ~ '+ endToken +'] , API called : ' + apiCalledLocations);

	      } else {

	        if(topicsArray.length > 0) {

	          refWeatherPageToken.child('name').set(topicsArray[topicsArray.length - 1]);
	          refWeatherPageToken.child('num').set(endToken);
	          refWeatherPageToken.child('total').set(totalUserNumber);

	          console.log('[Offset: '+ offset +'] Done ['+ startToken +' ~ '+ endToken +'], API called : ' + apiCalledLocations);

	        } 

	      }

	      resolve(true);

			})
			.catch((err) => {
				console.log('Error calling Weather API: ' + err);
				reject(false);
			});

    });	
		
  },

  getWeatherData: function (offset, lat, lng, topic, country, city, callOrNot, num, total) {

  	var db = admin.database();
    var refLocation = db.ref('activeLocationsByOffset/'+ offset);

  	return new Promise((resolve, reject) => {

      if(callOrNot) {

        //console.log('['+num+']['+total+'] Forecast updating... ' + topic + ': [' + lat +', '+ lng + ']');

        forecast.latitude(lat).longitude(lng).get()
        .then((weatherData) => {

          // Nov.08.2017 - Stuck in 850 / 1354 and not updating it. So make it to always update
          // was because 'uvIndex == 0' -> which is false
          // if data exists,
          if(weatherData && weatherData['daily']['data'][0]['uvIndex'] > -1 && weatherData['daily']['data'][0]['icon']) {

            // Save into Database
            refLocation.child(topic).update({
              country: country,
              city: city,
              tz: weatherData['timezone'],
              tzOffset: weatherData['offset'],
              tzOffsetRound: Math.round(weatherData['offset']),
              currentTime: weatherData['currently']['time'],
              uviTime: [
                weatherData['daily']['data'][0]['uvIndexTime'],     // today
                weatherData['daily']['data'][1]['uvIndexTime'],
                weatherData['daily']['data'][2]['uvIndexTime'],
                weatherData['daily']['data'][3]['uvIndexTime'],
                weatherData['daily']['data'][4]['uvIndexTime'],
              ],
              uviMax: [
                weatherData['daily']['data'][0]['uvIndex'],
                weatherData['daily']['data'][1]['uvIndex'],
                weatherData['daily']['data'][2]['uvIndex'],
                weatherData['daily']['data'][3]['uvIndex'],
                weatherData['daily']['data'][4]['uvIndex'],
              ],
              forecastSummary: [
                weatherData['daily']['data'][0]['summary'],
                weatherData['daily']['data'][1]['summary'],
                weatherData['daily']['data'][2]['summary'],
                weatherData['daily']['data'][3]['summary'],
                weatherData['daily']['data'][4]['summary'],
              ],
              cloudiness: [
                weatherData['daily']['data'][0]['cloudCover'],
                weatherData['daily']['data'][1]['cloudCover'],
                weatherData['daily']['data'][2]['cloudCover'],
                weatherData['daily']['data'][3]['cloudCover'],
                weatherData['daily']['data'][4]['cloudCover'],
              ],
              icon: [
                weatherData['daily']['data'][0]['icon'],
                weatherData['daily']['data'][1]['icon'],
                weatherData['daily']['data'][2]['icon'],
                weatherData['daily']['data'][3]['icon'],
                weatherData['daily']['data'][4]['icon']
              ],
              tempMax: [
                weatherData['daily']['data'][0]['temperatureHigh'],
                weatherData['daily']['data'][1]['temperatureHigh'],
                weatherData['daily']['data'][2]['temperatureHigh'],
                weatherData['daily']['data'][3]['temperatureHigh'],
                weatherData['daily']['data'][4]['temperatureHigh']
              ],
              tempMin: [
                weatherData['daily']['data'][0]['temperatureLow'],
                weatherData['daily']['data'][1]['temperatureLow'],
                weatherData['daily']['data'][2]['temperatureLow'],
                weatherData['daily']['data'][3]['temperatureLow'],
                weatherData['daily']['data'][4]['temperatureLow']
              ]
            }, (err) => {
              if(err) reject(err);
              else {
                resolve(true);
              }
            });

          }
          
        });

      } else {
        //console.log('Forecast update not needed: ' + topic);
        resolve(true);
      }
      
    });

  }
}


function backendUtil () {

}

backendUtil.prototype = {

  epochToTime: function (epochTime, offset) {

    var d = new Date(((epochTime * 1000) + (offset * 60 * 60 * 1000))); // Format: 'Fri May 19 2017 10:34:27 GMT-0400 (EDT)'
  
    var ampm = (d.getHours() >= 12) ? "PM" : "AM";
    var hours = (d.getHours() > 12) ? d.getHours()-12 : d.getHours();
    var minutes = (d.getMinutes() < 10) ? '0' + d.getMinutes() : d.getMinutes();

    // Aug.04.2017 - Minutes should not be accurate
    //minutes = Math.floor(minutes);

    var date = d.getDate();

    return [hours, minutes, ampm, date];

  },

  createTopicName: function (country, city) {
  	var topic;
    if(country && city) {
    	// Error says,
    	// Paths must be non-empty strings and can't contain ".", "#", "$", "[", or "]"
      topic = country + '_' + city;
      topic = topic.replace(/\s|\.|#|\$|\[|\]/g, '');
    } else {
    	topic = 'CA_Toronto';
    }

    return topic;
  },

  checkTopicName: function (topicName) {
  	// Check if topic doesn't contain languages other than English
  	var re = /^[A-Za-z0-9\_]+$/;
  	if(re.test(topicName)) return true;
  	else return false;
  },

  checkPathName: function (nameString) {	// check before create path name (ex, user data, location data)

  	var re = /\s|\.|#|\$|\[|\]/g;
  	if(re.test(nameString)) return false;
  	else return true;

  },

  checkLastTimeForecastUpdated: function (epochTime) {

  	// Epoch Time
  	var d = new Date(epochTime * 1000); // Format: 'Fri May 19 2017 10:34:27 GMT-0400 (EDT)'
  	
  	// Current Time
  	var now = new Date();

  	// if time is matching, don't update (false)
  	if(d.getMonth() == now.getMonth() && d.getDate() == now.getDate()) return false;
  	else return true;

  },

  // Feb.05.2018 - By default, Darksky brings F
  convertTempByCountry: function (country, value) {
    if(country !== 'US') {
      return ((value - 32) / 1.8).toFixed(0);   // to C
    } else return parseInt(value);    // remove decimals for F
  },

  convertUnitByCountry: function (country) {
    if(country !== 'US') return '˚' + 'C';
    else return '˚' + 'F';
  },

}

// ========================================================================
// Realtime database Checker for firing push
// Gets any changes in queue database and fire notification
// ========================================================================
exports.notificationQueue = functions.database.ref('pushQueue/{topic}')
  .onWrite(event => {

  	var snap = event.data;

    //console.log('[Queue] ' + JSON.stringify(snap));

    // Check if message contains the following
    if(snap && snap.val() && snap.val().hasOwnProperty('messageType') 
      && snap.val().hasOwnProperty('uviMax') 
      && snap.val().hasOwnProperty('icon')
      && snap.val().hasOwnProperty('tempMax')
      && snap.val().hasOwnProperty('tempMin')) {

      //console.log('Queue Event Happening');

      if(snap.val().messageType === 'uvForecast' && snap.val().uviMax && snap.val().city) {

        var timeFormatArray = new backendUtil().epochToTime(snap.val().uviTime, snap.val().offset);

        var options = {
          priority: "high",
          timeToLive: 60 * 60 * 24,
          restrictedPackageName: keys.appID
        };

        // Body Samples
        //body: "The UVI will reach " + snap.val().uviMax + ' around ' + timeFormatArray[0] + ':' + timeFormatArray[1] + ' ' + timeFormatArray[2] + ' in ' + snap.val().city + '. Find out how long you can safely stay outside with QSun.'
        var payload = {     
          notification: {
            title: "High Risk of Sunburn Today.",
            body: 'Take care starting at '+ timeFormatArray[0] + ':' + timeFormatArray[1] + ' ' + timeFormatArray[2] + ' in ' + snap.val().city + '. Find out how long you can safely stay outside. Expand for more.'
          }
        };

        //console.log('Sending: ' + snap.key + ', UVI ' + snap.val().uviMax);

        // Delete queue (because next time it must be triggered by (update or create))
        snap.ref.parent.child(snap.key).set(null);

        //console.log('[' + snap.val().messageType + ']: Sending notifiation to ' + snap.key);

        return admin.messaging().sendToTopic(snap.key, payload, options);

      }
      else if(snap.val().messageType === 'rainForecast' && snap.val().city && snap.val().icon) {

        // New notification added in Sept.22.2017
        var options = {
          priority: "high",
          timeToLive: 60 * 60 * 24,
          restrictedPackageName: keys.appID
        };

        // Feb.05.2018 - Message changed with new values
        //var bodyMsg = 'Stay dry today in '+ snap.val().city +'. '+ snap.val().icon +' is in the forecast. Expand for more.';
        var bodyMsg = 'Stay dry today in '+ snap.val().city +'. '+ snap.val().icon +' is in the forecast. ' +
                      'The temperature is between ' + snap.val().tempMin + snap.val().unitStr + ' and ' + snap.val().tempMax + snap.val().unitStr + '. ' +
                      'Expand for more.';

        var payload = {     
          notification: {
            title: '',
            body: bodyMsg
          }
        };

        //console.log('[' + snap.val().messageType + ']: Removing Child ');

        snap.ref.parent.child(snap.key).set(null);

        //console.log('[' + snap.val().messageType + ']: Sending notifiation to ' + snap.key);

        return admin.messaging().sendToTopic(snap.key, payload, options);

      } 
      else {

        console.log('Something wrong, remove topic and return null: ' + snap.key);

        return snap.ref.parent.child(snap.key).set(null);

      }

    } else {

      //console.log('Something is missing: ' + snap.key + ' Val: ' + ((snap.val()) ? JSON.stringify(snap.val()) : 'No Val()'));
      return snap.ref.parent.child(snap.key).set(null);
    };

  	

  });

// ========================================================================
// API for saving user data
// https://firebase.google.com/docs/functions/http-events
// https://expressjs.com/en/4x/api.html#res
// ========================================================================
exports.getUserData = functions.https.onRequest((req, res) => {

  // POST event with contentType: 'application/json'
  var userData = {
    id: req.query.id,
    name: req.body.name,
    email: req.body.email,
    account: req.body.accountType,
    country: req.body.country,
    city: req.body.city,
    tzOffset: req.body.tzOffset,
    topicLocation: req.body.topicLocation,
    lat: req.body.lat,
    lng: req.body.lng,
    appOpened: req.body.appOpened,
    appOpenedEpoch: req.body.appOpenedEpoch,
    appRated: ((req.body.appRated) ? req.body.appRated : 0),	// check if undefined
    skintype: req.body.skintype,
    gender: req.body.gender,
    birthday: req.body.birthday,
    height: req.body.height,
    weight: req.body.weight
  };
 
  var db = admin.database();

  var refUser = db.ref('activeUsers');
  //var queryRefUser = refUser.orderByChild('id').equalTo(userId);
  var pathNameChecker = new backendUtil().checkPathName();

  if(pathNameChecker) {

  	refUser.child(req.query.id).set(userData, (err) => {
	    if(err) {

	      console.log('Error saving user '+ req.query.id +': ' + err);

	      return res.status(404).send('Error in Saving into Firebase');
	    }
	    else {
	      // Success callback
	      // https://expressjs.com/en/api.html#res
	      console.log('User data updated / saved: ' + req.body.email);
	      return res.status(200).send('Saving to Firebase Success!');
	      //res.status(200).send('Request Success');
	      //res.redirect(303, snapUser.ref);
	    }
	  });

  } else {

  	return res.status(404).send('Path name contains invalid characters');

  }
  

});

// ========================================================================
// API for saving Location information 
// whenever user info is updated
// ========================================================================
exports.setLocationData = functions.database.ref('activeUsers/{userId}')
  .onWrite(event => {

    var snapUser = event.data;

    var db = admin.database();
    var refLocation = db.ref('activeLocations');
    var refLocationNew = db.ref('activeLocationsByOffset'); // Jan.31.2018 - Added new database 

    if(snapUser.val().country && snapUser.val().city) {

    	var locationData = {
	      country: snapUser.val().country,
	      city: snapUser.val().city,
	      topic: snapUser.val().topicLocation,
	      tzOffset: snapUser.val().tzOffset,
	      lat: snapUser.val().lat,
	      lng: snapUser.val().lng,
        lastUpdated: parseInt(new Date().getTime() / 1000)
	    }

      refLocationNew.child(snapUser.val().tzOffset).child(snapUser.val().topicLocation).once('value', (snapshot) => {

        // Feb.05.2018 - see 'lastupdated' and compare with now
        var currentTime = parseInt(new Date().getTime() / 1000);

        //if(snapshot.val() !== null && snapshot.val().hasOwnProperty('lastUpdated')) {
        if(snapshot.val() !== null) {
          /*
          // Update if it's been over a week
          var aWeek = 60 * 60 * 24 * 7;
          var timeDiff = currentTime - snapshot.val().lastUpdated;

          if(timeDiff > aWeek) {
            // Location doesn't exist
            console.log('Location ' + snapUser.val().topicLocation + ' updating...');

            var roundedOffset = Math.round(snapUser.val().tzOffset);   // Because as name, dot is not acceptable
            refLocationNew.child(roundedOffset).child(snapUser.val().topicLocation).set(locationData);
          } else {
            console.log('Location ' + snapUser.val().topicLocation + ' already exists. Not creating / updating...');
          }
          */
          console.log('Location ' + snapUser.val().topicLocation + ' already exists. Not creating / updating...');

        } else {
          // Location doesn't exist
          console.log('Location ' + snapUser.val().topicLocation + ' does not exist, creating one...');

          var roundedOffset = Math.round(snapUser.val().tzOffset);   // Because as name, dot is not acceptable
          refLocationNew.child(roundedOffset).child(snapUser.val().topicLocation).set(locationData);
        }
        /*
        if(snapshot.val() !== null) {
          console.log('Location ' + snapUser.val().topicLocation + ' already exists. Not creating...');
        } else {
          // Location doesn't exist
          console.log('Location ' + snapUser.val().topicLocation + ' does not exist, creating one...');

          var roundedOffset = Math.round(snapUser.val().tzOffset);   // Because as name, dot is not acceptable
          refLocationNew.child(roundedOffset).child(snapUser.val().topicLocation).set(locationData);
        }
        */
      });
      /*
	    // Check if this topic exists on database
	    refLocation.child(snapUser.val().topicLocation).once('value', (snapshot) => {

	      //console.log('snapshot: ' + JSON.stringify(snapshot.val()));

	      if(snapshot.val() !== null) {
	        
	        // Already Exists
	        console.log('Location ' + snapUser.val().topicLocation + ' already exists. Not creating...');

	      } else {

	        // Location doesn't exist
	        console.log('Location ' + snapUser.val().topicLocation + ' does not exist, creating one...');

	        refLocation.child(snapUser.val().topicLocation).set(locationData);

	      }

	    });
      */

    }

    return 0;

  });

// ========================================================================
// Organize locations by offset
// Written: Jan.31.2018
// ========================================================================
exports.organizeLocation_job =
  functions.pubsub.topic('organizeLocationByOffset').onPublish((event) => {

    var db = admin.database();
    var refLocation = db.ref('activeLocations');
    var refLocationNew = db.ref('activeLocationsByOffset');

    // Reset 
    //refLocationNew.set(null);
    /*
    var rawOffset = 12.75;
    var timeZoneOffset = Math.round(rawOffset);
    var refLocationFiltered = refLocation.orderByChild('tzOffset').equalTo(rawOffset)

    refLocationFiltered.once('value', (snapLocations) => {

      console.log('['+rawOffset+' -> '+ timeZoneOffset +'] Organize Locations Started: ' + snapLocations.numChildren());

      snapLocations.forEach((res) => {

        var checkTopic = new backendUtil().checkTopicName(res.val().topic);

        if(checkTopic) {
          var roundedOffset = Math.round(res.val().tzOffset);   // Because as name, dot is not acceptable
          refLocationNew.child(roundedOffset).child(res.val().topic).set(res.val());
        } else {
          
        }

      });

    });
    */

  });


exports.setForecastData_job =
  functions.pubsub.topic('setForecastData').onPublish((event) => {
    return 0;
  });

// ========================================================================
// Just to check internet connection
// ========================================================================
exports.checkInternetConnection = functions.https.onRequest((req, res) => {
  return res.status(200).send('Verified Internet connection');
});

// ========================================================================
// Bigquery - App Activity Tracker
// https://googlecloudplatform.github.io/google-cloud-node/#/docs/bigquery/0.9.6/bigquery
// ========================================================================
exports.insertAppActivityToBigquery = functions.https.onRequest((req, res) => {

  // req.body must be an object
  var dataset = bigquery.dataset('qsun_appActivity_dataset');
  var table = dataset.table('qsun_appActivity_table');

  var rows = {
    json: {
      activity_name: req.body.activity_name,
      activity_time: req.body.activity_time,
      activity_user_id: parseInt(req.body.activity_user_id),
      activity_user_email: req.body.activity_user_email,
      activity_user_country: req.body.activity_user_country,
      activity_user_city: req.body.activity_user_city,
      activity_user_account: req.body.activity_user_account,
      activity_user_device_type: req.body.activity_user_device_type,
      activity_user_device_version: req.body.activity_user_device_version,
      activity_user_app_version: req.body.activity_user_app_version,
      activity_user_profile_exists: req.body.activity_user_profile_exists
    }
  };

  var options = {
    raw: true
  };

  table.insert(rows, options, insertHandler);

  function insertHandler(err, apiResponse) {
    if (err) {
      // An API error or partial failure occurred.
      console.log('[Bigquery] Error: ' + JSON.stringify(err.errors));

      if (err.name === 'PartialFailureError') {
        // Some rows failed to insert, while others may have succeeded.

        // err.errors (object[]):
        // err.errors[].row (original row object passed to `insert`)
        // err.errors[].errors[].reason
        // err.errors[].errors[].message
      }

      return res.status(404).send('[Bigquery] app activity tracker insert Error: ' + err.name);
    } else 
      return res.status(200).send('[Bigquery] app activity tracker insert is done');
  }


});

// ========================================================================
// Bigquery - Sunscreen scanned result
// https://googlecloudplatform.github.io/google-cloud-node/#/docs/bigquery/0.9.6/bigquery
// ========================================================================
exports.insertSunscreenScannedToBigquery = functions.https.onRequest((req, res) => {

  // req.body must be an object
  var dataset = bigquery.dataset('qsun_sunscreen_dataset');
  var table = dataset.table('qsun_sunscreen_scanned_table');

  //console.log('[BigQuery] inserting Barcode: ' + req.body.barcode_number);

  var rows = {
    json: {
      scanned_barcode_number: req.body.barcode_number,
      scanned_barcode_type: req.body.barcode_type,
      scanned_time: req.body.scanned_time,
      scanned_user_id: parseInt(req.body.scanned_user_id),
      scanned_user_email: req.body.scanned_user_email,
      scanned_user_account: req.body.scanned_user_account,
      scanned_barcode_found: req.body.barcode_found
    }
  };

  var options = {
    raw: true
  };

  table.insert(rows, options, insertHandler);

  function insertHandler(err, apiResponse) {
    if (err) {
      // An API error or partial failure occurred.
      console.log('[Bigquery] Error: ' + JSON.stringify(err.errors));

      if (err.name === 'PartialFailureError') {
        // Some rows failed to insert, while others may have succeeded.

        // err.errors (object[]):
        // err.errors[].row (original row object passed to `insert`)
        // err.errors[].errors[].reason
        // err.errors[].errors[].message
      }

      return res.status(404).send('[Bigquery] sunscreen scanned data insert Error: ' + err.name);
    } else 
      return res.status(200).send('[Bigquery] sunscreen scanned data insert is done');
  }


});

// ========================================================================
// Bigquery - Search from sunscreen database
// https://googlecloudplatform.github.io/google-cloud-node/#/docs/bigquery/0.9.6/bigquery
// ========================================================================
exports.getSunscreenDataFromBigquery = functions.https.onRequest((req, res) => {

  // req.body must be an object
  var dataset = bigquery.dataset('qsun_sunscreen_dataset');
  var table = dataset.table('qsun_sunscreen_table');

  // req.body.barcode_number, req.body.barcode_type
  table.getRows((err, rows) => {
    if (!err) {

      // rows is an array of results.
      // {"Date":{"value":"2017-05-15"},"Match":true,"PS_Check":"Y","Barcode_Type":"UPC","Barcode_Number":"871760002296","Barcode_Number_wc":12,"Name":"Sun Bum Face Cream, SPF 50","Name_short":"Sun Bum Clear Formula Face Cream, SPF 50","Name_short_wc":40,"Manufacturer":null....
      //console.log('Result Rows 0: ' + JSON.stringify(rows[0]));

      // filter the result
      var filteredRow = rows.filter((element) => {
        return (element.Barcode_Number.indexOf(req.body.barcode_number) > -1 || 
                req.body.barcode_number.indexOf(element.Barcode_Number) > -1);
      });

      //console.log('Result Row: ' + JSON.stringify(filteredRow));

      // We expect there's only one matching sunscreen
      return res.status(200).send(JSON.stringify(filteredRow[0]));

    } else {
      return res.status(404).send('[Bigquery] get Sunscreen Data Error: ' + err.name);
    }
  });

});

// ========================================================================
// In App Purchase & Datastore
// Mar.28.2018 - For each user, check IAP receipt and check if its valid, 
// then if its not, modify profile
/*
  google receipt must be provided as an object. Data can be object or string.
  {
    "data": {
    	"packageName":"...",
    	"productId":"...",
    	"purchaseTime":1456139019030,
    	"purchaseState":0,
    	"purchaseToken":"...",
    	"autoRenewing":true
    },
    "signature": "signature from google"
  }
*/
// Library Ref:
// https://cloud.google.com/nodejs/docs/reference/datastore/1.4.x/Datastore
// ========================================================================
exports.iapValidation_proVersion =
	functions.pubsub.topic('iapValidation_proVersion').onPublish((event) => {
		
		function datastoreQuery (query) {
			return new Promise((resolve, reject) => {

				datastore.runQuery(query, function(err, entities) {
					if(err) reject('Error in Datastore Query: ' + err);
				  if(entities && entities.length > 0) {
				  	
					  resolve(entities);

				  } else reject('No entities exist!');
  
				});

			});
		}

		function datastoreSetData (key, userData) {
			return new Promise((resolve, reject) => {
				datastore.save({
        	key: key,
        	excludeFromIndexes: [		// This allows to store longer than 1500 bytes. See library reference for more.
				    'iapRecords'
				  ],
					data: userData
        }, (err) => {
				  if (!err) resolve(true);
				  else reject(err);
				});
			});
		}

		function iapValidationProcess (targetEntity) {
			return new Promise((resolve, reject) => {

				// this returns something like, '{"id":"5641263013429248","kind":"qtempProfile","path":["qtempProfile","5641263013429248"]}'
			  // we can use 'path' as 'key' later
				var targetEntityKey = targetEntity[datastore.KEY];

				// Create a form to attach at the front of all messages
				var targetUserText = '[' + targetEntity.email + '][' + targetEntity.accountBelonging + '][' + targetEntityKey.id + ']';

				//console.log(targetUserText + ' Target Entity Key from query: ' + JSON.stringify(targetEntityKey)); 

				if(targetEntity && targetEntity.hasOwnProperty('iapRecords') && targetEntity.iapRecords) {
					
			  	var receiptArray = JSON.parse(targetEntity.iapRecords);
			  	if(receiptArray.length > 0) {

			  		//console.log(targetUserText + ' Parsing IAP receipts success: Length [' + receiptArray.length + '] receipts exist');

			  		// filter to find matching product ID. Assume there's only one.(???)
			  		var filteredReceiptArray = receiptArray.filter((el) => { return el.productId === keys.iapProduct_proVersion; });

			  		if(filteredReceiptArray.length > 0) {
			
			  			var resultReceipt = {};

			  			// Form receipt based on what properties they have.
			  			if(filteredReceiptArray[0].hasOwnProperty('signature') && filteredReceiptArray[0].hasOwnProperty('receipt')) {
			  				resultReceipt = {
				  				'signature': filteredReceiptArray[0].signature,
				  				'data': filteredReceiptArray[0].receipt
				  			}
			  			}

			  			iap.setup((err) => {
						    if(err) reject(targetUserText + ' Error in IAP setup: ' + err);
						    
						    // iap is ready
						    iap.validate(resultReceipt, function (err, googleRes) {
					        if (err) reject(targetUserText + ' Error in IAP Validation: ' + err);
					        if (iap.isValidated(googleRes)) {

					        	console.log(targetUserText + ' IAP Valid!! ');
					        	resolve(true);
					          	
					        } else {

					        	console.log(targetUserText + ' IAP Invalid!! ');
					        	
					        	// If data is set to true, change to false
					          if(targetEntity.proActivated) {
					          
											let key = datastore.key([targetEntityKey.kind, Number(targetEntityKey.id)]);
											//let key = datastore.key({path: targetEntityKey.path});

											var userData = JSON.parse(JSON.stringify(targetEntity));
											userData.proActivated = false;		// boolean	
											userData.proActivatedMethod	 = 0;	// integer. 0 - unset, 1 - code typed, 2 - IAP

											datastoreSetData(key, userData)
											.then(() => {
												console.log(targetUserText + ' IAP Invalid but profile says Valid!! ' + JSON.stringify(googleRes));
											  resolve(true);
											})
											.catch((err) => {
												reject(targetUserText + ' Error in saving new profile data: ' + err);
											});
					          } else resolve(true);
					        	
					        }

						    });
							});

			  		} else reject(targetUserText + ' Product Not Exists!');
			  	} else reject(targetUserText + ' Parsing array failed for IAP receipt');
			  } else resolve(true);

			});
		}

		return new Promise((resolve, reject) => {

			var promiseArray = [];

			// Query
			const query = datastore.createQuery(datastore_kind);
			query.filter('proActivatedMethod	', 2);//.filter('accountBelonging', 'google');

			datastoreQuery(query)
			.then((entitiesArray) => {

				console.log('Result from query: ['+ entitiesArray.length +'] user profiles Found!');
				// When multiple entities are presented, use array of promise to handle it. 
			 	for(var i = 0; i < entitiesArray.length; i++) promiseArray.push(iapValidationProcess(entitiesArray[i]));

			 	return Promise.all(promiseArray);

			})
			.then(() => {
				console.log('Query Job all done!!!');
			})
			.catch((err) => {
				reject(err);
			});
			
		});

	});

exports.codeValidation_proVersion =
	functions.pubsub.topic('codeValidation_proVersion').onPublish((event) => {
		
	});


// ========================================================================
//  UV Forecast Functions
// ========================================================================
exports.notification_for_tz_plus13 =
  functions.pubsub.topic('utc_plus13').onPublish((event) => {
    return new queueNotificationJobs().start(13, 'uvForecast');
  });
/*
exports.notification_for_tz_plus12 =
  functions.pubsub.topic('utc_plus12').onPublish((event) => {
    var utcOffset = 12;
    new queueNotificationJobs().start(utcOffset, 'uvForecast');
  });
*/

exports.notification_for_tz_plus11 =
  functions.pubsub.topic('utc_plus11').onPublish((event) => {
    return new queueNotificationJobs().start(11, 'uvForecast');
  });

exports.notification_for_tz_plus10 =
  functions.pubsub.topic('utc_plus10').onPublish((event) => {
    return new queueNotificationJobs().start(10, 'uvForecast');
  });

exports.notification_for_tz_plus9 =
  functions.pubsub.topic('utc_plus09').onPublish((event) => {
    return new queueNotificationJobs().start(9, 'uvForecast');
  });

exports.notification_for_tz_plus8 =
  functions.pubsub.topic('utc_plus08').onPublish((event) => {
    return new queueNotificationJobs().start(8, 'uvForecast');
  });

exports.notification_for_tz_plus7 =
  functions.pubsub.topic('utc_plus07').onPublish((event) => {
    return new queueNotificationJobs().start(7, 'uvForecast');
  });

exports.notification_for_tz_plus6 =
  functions.pubsub.topic('utc_plus06').onPublish((event) => {
    return new queueNotificationJobs().start(6, 'uvForecast');
  });

exports.notification_for_tz_plus5 =
  functions.pubsub.topic('utc_plus05').onPublish((event) => {
    return new queueNotificationJobs().start(5, 'uvForecast');
  });
/*
exports.notification_for_tz_plus4 =
  functions.pubsub.topic('utc_plus04').onPublish((event) => {
    var utcOffset = 4;
    new queueNotificationJobs().start(utcOffset, 'uvForecast');
  });
*/
exports.notification_for_tz_plus3 =
  functions.pubsub.topic('utc_plus03').onPublish((event) => {
    return new queueNotificationJobs().start(3, 'uvForecast');
  });

exports.notification_for_tz_plus2 =
  functions.pubsub.topic('utc_plus02').onPublish((event) => {
    return new queueNotificationJobs().start(2, 'uvForecast');
  });

exports.notification_for_tz_plus1 =
  functions.pubsub.topic('utc_plus01').onPublish((event) => {
    return new queueNotificationJobs().start(1, 'uvForecast');
  });

exports.notification_for_tz_plus0 =
  functions.pubsub.topic('utc_plus0').onPublish((event) => {
    return new queueNotificationJobs().start(0, 'uvForecast');
  });
/*
exports.notification_for_tz_minus1 =
  functions.pubsub.topic('utc_minus01').onPublish((event) => {
    var utcOffset = -1;
    new queueNotificationJobs().start(utcOffset, 'uvForecast');
  });

exports.notification_for_tz_minus2 =
  functions.pubsub.topic('utc_minus02').onPublish((event) => {
    var utcOffset = -2;
    new queueNotificationJobs().start(utcOffset, 'uvForecast');
  });
*/
exports.notification_for_tz_minus3 =
  functions.pubsub.topic('utc_minus03').onPublish((event) => {
    return new queueNotificationJobs().start(-3, 'uvForecast');
  });

exports.notification_for_tz_minus4 =
  functions.pubsub.topic('utc_minus04').onPublish((event) => {
    return new queueNotificationJobs().start(-4, 'uvForecast');
  });

exports.notification_for_tz_minus5 =
  functions.pubsub.topic('utc_minus05').onPublish((event) => {
    return new queueNotificationJobs().start(-5, 'uvForecast');
  });

exports.notification_for_tz_minus6 =
  functions.pubsub.topic('utc_minus06').onPublish((event) => {
    return new queueNotificationJobs().start(-6, 'uvForecast');
  });

exports.notification_for_tz_minus7 =
  functions.pubsub.topic('utc_minus07').onPublish((event) => {
    return new queueNotificationJobs().start(-7, 'uvForecast');
  });

exports.notification_for_tz_minus8 =
  functions.pubsub.topic('utc_minus08').onPublish((event) => {
    return new queueNotificationJobs().start(-8, 'uvForecast');
  });
/*
exports.notification_for_tz_minus9 =
  functions.pubsub.topic('utc_minus09').onPublish((event) => {
    var utcOffset = -9;
    new queueNotificationJobs().start(utcOffset, 'uvForecast');
  });

exports.notification_for_tz_minus10 =
  functions.pubsub.topic('utc_minus10').onPublish((event) => {
    var utcOffset = -10;
    new queueNotificationJobs().start(utcOffset, 'uvForecast');
  });
*/
// ========================================================================
//  Rain Forecast Functions
// ========================================================================
exports.notification_for_tz_plus13_rain =
  functions.pubsub.topic('utc_plus13_rain').onPublish((event) => {
    return new queueNotificationJobs().start(13, 'rainForecast');
  });
/*
exports.notification_for_tz_plus12_rain =
  functions.pubsub.topic('utc_plus12_rain').onPublish((event) => {
    var utcOffset = 12;
    new queueNotificationJobs().start(utcOffset, 'rainForecast');
  });
*/
exports.notification_for_tz_plus11_rain =
  functions.pubsub.topic('utc_plus11_rain').onPublish((event) => {
    return new queueNotificationJobs().start(11, 'rainForecast');
  });

exports.notification_for_tz_plus10_rain =
  functions.pubsub.topic('utc_plus10_rain').onPublish((event) => {
    return new queueNotificationJobs().start(10, 'rainForecast');
  });

exports.notification_for_tz_plus9_rain =
  functions.pubsub.topic('utc_plus09_rain').onPublish((event) => {
    return new queueNotificationJobs().start(9, 'rainForecast');
  });

exports.notification_for_tz_plus8_rain =
  functions.pubsub.topic('utc_plus08_rain').onPublish((event) => {
    return new queueNotificationJobs().start(8, 'rainForecast');
  });

exports.notification_for_tz_plus7_rain =
  functions.pubsub.topic('utc_plus07_rain').onPublish((event) => {
    return new queueNotificationJobs().start(7, 'rainForecast');
  });

exports.notification_for_tz_plus6_rain =
  functions.pubsub.topic('utc_plus06_rain').onPublish((event) => {
    return new queueNotificationJobs().start(6, 'rainForecast');
  });

exports.notification_for_tz_plus5_rain =
  functions.pubsub.topic('utc_plus05_rain').onPublish((event) => {
    return new queueNotificationJobs().start(5, 'rainForecast');
  });
/*
exports.notification_for_tz_plus4_rain =
  functions.pubsub.topic('utc_plus04_rain').onPublish((event) => {
    var utcOffset = 4;
    new queueNotificationJobs().start(utcOffset, 'rainForecast');
  });
*/
exports.notification_for_tz_plus3_rain =
  functions.pubsub.topic('utc_plus03_rain').onPublish((event) => {
    return new queueNotificationJobs().start(3, 'rainForecast');
  });

exports.notification_for_tz_plus2_rain =
  functions.pubsub.topic('utc_plus02_rain').onPublish((event) => {
    return new queueNotificationJobs().start(2, 'rainForecast');
  });

exports.notification_for_tz_plus1_rain =
  functions.pubsub.topic('utc_plus01_rain').onPublish((event) => {
    return new queueNotificationJobs().start(1, 'rainForecast');
  });

exports.notification_for_tz_plus0_rain =
  functions.pubsub.topic('utc_plus0_rain').onPublish((event) => {
    return new queueNotificationJobs().start(0, 'rainForecast');
  });
/*
exports.notification_for_tz_minus1_rain =
  functions.pubsub.topic('utc_minus01_rain').onPublish((event) => {
    var utcOffset = -1;
    new queueNotificationJobs().start(utcOffset, 'rainForecast');
  });

exports.notification_for_tz_minus2_rain =
  functions.pubsub.topic('utc_minus02_rain').onPublish((event) => {
    var utcOffset = -2;
    new queueNotificationJobs().start(utcOffset, 'rainForecast');
  });
*/
exports.notification_for_tz_minus3_rain =
  functions.pubsub.topic('utc_minus03_rain').onPublish((event) => {
    return new queueNotificationJobs().start(-3, 'rainForecast');
  });

exports.notification_for_tz_minus4_rain =
  functions.pubsub.topic('utc_minus04_rain').onPublish((event) => {
    return new queueNotificationJobs().start(-4, 'rainForecast');
  });

exports.notification_for_tz_minus5_rain =
  functions.pubsub.topic('utc_minus05_rain').onPublish((event) => {
    return new queueNotificationJobs().start(-5, 'rainForecast');
  });

exports.notification_for_tz_minus6_rain =
  functions.pubsub.topic('utc_minus06_rain').onPublish((event) => {
    return new queueNotificationJobs().start(-6, 'rainForecast');
  });

exports.notification_for_tz_minus7_rain =
  functions.pubsub.topic('utc_minus07_rain').onPublish((event) => {
    return new queueNotificationJobs().start(-7, 'rainForecast');
  });

exports.notification_for_tz_minus8_rain =
  functions.pubsub.topic('utc_minus08_rain').onPublish((event) => {
    return new queueNotificationJobs().start(-8, 'rainForecast');
  });
/*
exports.notification_for_tz_minus9_rain =
  functions.pubsub.topic('utc_minus09_rain').onPublish((event) => {
    var utcOffset = -9;
    new queueNotificationJobs().start(utcOffset, 'rainForecast');
  });

exports.notification_for_tz_minus10_rain =
  functions.pubsub.topic('utc_minus10_rain').onPublish((event) => {
    var utcOffset = -10;
    new queueNotificationJobs().start(utcOffset, 'rainForecast');
  });
*/
// ========================================================================
// Getting weather Data 
// Written: Jan.31.2018
// ========================================================================
exports.getWeatherData_for_tz_plus13 =
  functions.pubsub.topic('utc_plus13_getWeather').onPublish((event) => {
    return new cronWeatherDataJobs().start(13);
  });
/*
exports.getWeatherData_for_tz_plus12 =
  functions.pubsub.topic('utc_plus12_getWeather').onPublish((event) => {
    var utcOffset = 12;
    new cronWeatherDataJobs().start(utcOffset);
  });
*/
exports.getWeatherData_for_tz_plus11 =
  functions.pubsub.topic('utc_plus11_getWeather').onPublish((event) => {
    return new cronWeatherDataJobs().start(11);
  });

exports.getWeatherData_for_tz_plus10 =
  functions.pubsub.topic('utc_plus10_getWeather').onPublish((event) => {
    return new cronWeatherDataJobs().start(10);
  });

exports.getWeatherData_for_tz_plus9 =
  functions.pubsub.topic('utc_plus09_getWeather').onPublish((event) => {
    return new cronWeatherDataJobs().start(9);
  });

exports.getWeatherData_for_tz_plus8 =
  functions.pubsub.topic('utc_plus08_getWeather').onPublish((event) => {
    return new cronWeatherDataJobs().start(8);
  });

exports.getWeatherData_for_tz_plus7 =
  functions.pubsub.topic('utc_plus07_getWeather').onPublish((event) => {
    return new cronWeatherDataJobs().start(7);
  });

exports.getWeatherData_for_tz_plus6 =
  functions.pubsub.topic('utc_plus06_getWeather').onPublish((event) => {
    return new cronWeatherDataJobs().start(6);
  });

exports.getWeatherData_for_tz_plus5 =
  functions.pubsub.topic('utc_plus05_getWeather').onPublish((event) => {
    return new cronWeatherDataJobs().start(5);
  });
/*
exports.getWeatherData_for_tz_plus4 =
  functions.pubsub.topic('utc_plus04_getWeather').onPublish((event) => {
    var utcOffset = 4;
    new cronWeatherDataJobs().start(utcOffset);
  });
*/
exports.getWeatherData_for_tz_plus3 =
  functions.pubsub.topic('utc_plus03_getWeather').onPublish((event) => {
    return new cronWeatherDataJobs().start(3);
  });

exports.getWeatherData_for_tz_plus2 =
  functions.pubsub.topic('utc_plus02_getWeather').onPublish((event) => {
    return new cronWeatherDataJobs().start(2);
  });

exports.getWeatherData_for_tz_plus1 =
  functions.pubsub.topic('utc_plus01_getWeather').onPublish((event) => {
    return new cronWeatherDataJobs().start(1);
  });

exports.getWeatherData_for_tz_plus0 =
  functions.pubsub.topic('utc_plus0_getWeather').onPublish((event) => {
    return new cronWeatherDataJobs().start(0);
  });
/*
exports.getWeatherData_for_tz_minus1 =
  functions.pubsub.topic('utc_minus01_getWeather').onPublish((event) => {
    var utcOffset = -1;
    new cronWeatherDataJobs().start(utcOffset);
  });

exports.getWeatherData_for_tz_minus2 =
  functions.pubsub.topic('utc_minus02_getWeather').onPublish((event) => {
    var utcOffset = -2;
    new cronWeatherDataJobs().start(utcOffset);
  });
*/
exports.getWeatherData_for_tz_minus3 =
  functions.pubsub.topic('utc_minus03_getWeather').onPublish((event) => {
    return new cronWeatherDataJobs().start(-3);
  });

exports.getWeatherData_for_tz_minus4 =
  functions.pubsub.topic('utc_minus04_getWeather').onPublish((event) => {
    return new cronWeatherDataJobs().start(-4);
  });

exports.getWeatherData_for_tz_minus5 =
  functions.pubsub.topic('utc_minus05_getWeather').onPublish((event) => {
    return new cronWeatherDataJobs().start(-5);
  });

exports.getWeatherData_for_tz_minus6 =
  functions.pubsub.topic('utc_minus06_getWeather').onPublish((event) => {
    return new cronWeatherDataJobs().start(-6);
  });

exports.getWeatherData_for_tz_minus7 =
  functions.pubsub.topic('utc_minus07_getWeather').onPublish((event) => {
    return new cronWeatherDataJobs().start(-7);
  });

exports.getWeatherData_for_tz_minus8 =
  functions.pubsub.topic('utc_minus08_getWeather').onPublish((event) => {
    return new cronWeatherDataJobs().start(-8);
  });
/*
exports.getWeatherData_for_tz_minus9 =
  functions.pubsub.topic('utc_minus09_getWeather').onPublish((event) => {
    var utcOffset = -9;
    new cronWeatherDataJobs().start(utcOffset);
  });

exports.getWeatherData_for_tz_minus10 =
  functions.pubsub.topic('utc_minus10_getWeather').onPublish((event) => {
    var utcOffset = -10;
    new cronWeatherDataJobs().start(utcOffset);
  });
*/