const admin = require("firebase-admin");
const fetch = require("node-fetch");

const express = require("express");
const app = express();
const PORT = process.env.PORT || 3030;

// --------------------------------------------------------
// Set FIFA Results URL
// --------------------------------------------------------
const date = new Date();
const currentDate = `${date.getFullYear()}-${
  date.getMonth() + 1
}-${date.getDate()}`;
const competition = "17"; // Worlcup 2022
const dataUrl = `https://api.fifa.com/api/v3/calendar/matches?count=500&from=2022-11-20T00:00:00Z&to=2022-11-30T10:00:00Z&idCompetition=${competition}`;

// --------------------------------------------------------
// Init firebase
// --------------------------------------------------------
const config = require("./configzt.json");
console.log(config);
const serviceAccount = require(config.service_acount_file);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: config.database_url,
});

const db = admin.database();

// --------------------------------------------------------
//  Utility functions to calculate points
// --------------------------------------------------------
const getWinner = (home, visitor) => {
  let winner = "";
  if (home > visitor) {
    winner = "home";
  } else {
    if (home < visitor) {
      winner = "visitor";
    } else {
      winner = "tied";
    }
  }
  return winner;
};

const getScore = (home, visitor, homePrediction, visitorPrediction) => {
  let points = 0;
  if (home >= 0 && homePrediction != null && visitorPrediction != null) {
    if (home == homePrediction && visitor == visitorPrediction) {
      points = 15;
    } else {
      if (
        getWinner(home, visitor) == getWinner(homePrediction, visitorPrediction)
      ) {
        points =
          10 -
          Math.abs(homePrediction - home) -
          Math.abs(visitorPrediction - visitor);
        if (points < 0) {
          points = 0;
        }
      }
    }
  }
  return points;
};

// --------------------------------------------------------
// Get results and update match & user scores on DB
// --------------------------------------------------------
console.log("Updating scores...");
let points = 0;
let beforePoints = 0;
let afterPoints = 0;

async function process_tasks() {
  const matches = await db.ref("matches").once("value");
  console.log("Got matches from firebase...");
  console.log("Update match scores...");
  console.log(dataUrl);
  const response = await fetch(dataUrl);
  const fifa = await response.json();
  for await (const item of fifa.Results) {
    let c = 0;
    let matchChanged = false;
    let homeScore = -1;
    let awayScore = -1;
    let homePrevScore = -1;
    let awayPrevScore = -1;
    c++;
    console.log("-------------------------------------");
    console.log(
      `${c}. ${item.Home.Abbreviation} ${item.Home.Score} vs. ${item.Away.Score} ${item.Away.Abbreviation}`
    );
    for await (const match of matches.val()) {
      matchChanged = false;
      if (match?.fifaId === item.IdMatch) {
        homeScore = match.homeScore;
        awayScore = match.awayScore;
        homePrevScore = match.homeScore;
        awayPrevScore = match.awayScore;
        if (
          parseInt(item.Home.Score) >= 0 &&
          match.homeScore !== item.Home.Score
        ) {
          db.ref(`matches/${match.game}/homeScore`).set(item.Home.Score);
          matchChanged = true;
          console.log("Update Home Score: " + item.Home.Score);
          homeScore = item.Home.Score;
        }
        if (
          parseInt(item.Away.Score) >= 0 &&
          match.awayScore !== item.Away.Score
        ) {
          db.ref(`matches/${match.game}/awayScore`).set(item.Away.Score);
          matchChanged = true;
          console.log("Update Away Score: " + item.Away.Score);
          awayScore = item.Away.Score;
        }
        if (matchChanged) {
          if ((item.Home.Score !== null) & (item.Away.Score !== null)) {
            const users = db.ref().child("users");
            const snapshot = await users?.once("value");
            const usersDetails = await snapshot.val();
            for (const [key, value] of Object.entries(usersDetails)) {
              const predictions = db
                .ref()
                .child(`predictions/${key}/${match.game}`);
              const predSnapshot = await predictions.once("value");
              const pred = predSnapshot.val();
              if (pred) {
                beforePoints = getScore(
                  homePrevScore,
                  awayPrevScore,
                  pred.homePrediction,
                  pred.awayPrediction
                );
                points = getScore(
                  homeScore,
                  awayScore,
                  pred.homePrediction,
                  pred.awayPrediction
                );
                afterPoints = points;
                db.ref(`predictions/${key}/${match.game}/points`).set(points);
                if (beforePoints !== afterPoints) {
                  await db
                    .ref(`predictions/${key}/${match.game}/points`)
                    .set(points);
                  const ztbee = db.ref().child(`users/${key}/score`);
                  const scoreSnapshot = await ztbee.once("value");
                  if (scoreSnapshot.exists()) {
                    const points2 =
                      scoreSnapshot.val() - beforePoints + afterPoints;
                    db.ref(`users/${key}/score`).set(points2);
                    console.log(
                      "name:",
                      value.userName,
                      "points:",
                      points,
                      "totalPoint: ",
                      points2
                    );
                  } else {
                    db.ref(`users/${key}/score`).set(afterPoints);
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
try {
  app.listen(PORT, () => {
    console.log(`server started on port ${PORT}`);
  });

  setInterval(function () {
    process_tasks();
  }, 120000);

  //   process_tasks();
  //   setTimeout(() => {
  //     process_tasks();
  //   }, 10000);
  //   // setTimeout(() => {
  //   //   process.exit(1);
  //   // }, 10000);
  //   setInterval;
} catch (err) {
  console.log("Error getting documents", err);
}
