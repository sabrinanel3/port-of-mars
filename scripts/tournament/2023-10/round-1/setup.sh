#!/bin/bash

CLI_CMD="${1:-cli}" # in prod change to cli:prod e.g., `./setup.sh cli:prod`

## create Fall 2023 Mars Madness tournament + Round 1 structure

npm run ${CLI_CMD} -- tournament create --tournamentName="2023-11 Mars Madness" --description="The next Mars Madness tournament begins November 10, 2023! Top-scoring players on surviving teams will advance to the next round. Players who make it to the championship round will receive a tabletop game version of Port of Mars, and the winner of the championship will receive a top prize of \$1000 USD!"
# add variable life as usual card treatments to the tournament
npm run ${CLI_CMD} -- tournament treatment create -n "Less LAU" -d "50% less (6) Life as Usual cards" -o "[{\"eventId\": \"lifeAsUsual\", \"quantity\": 6}]"
npm run ${CLI_CMD} -- tournament treatment create -n "Normal LAU" -d "Default (12) Life as Usual cards" -o "[{\"eventId\": \"lifeAsUsual\", \"quantity\": 12}]"
npm run ${CLI_CMD} -- tournament treatment create -n "More LAU" -d "50% more (18) Life as Usual cards" -o "[{\"eventId\": \"lifeAsUsual\", \"quantity\": 18}]"
npm run ${CLI_CMD} -- tournament round create --introSurveyUrl=https://asu.co1.qualtrics.com/jfe/form/SV_0c8tCMZkAUh4V8x --exitSurveyUrl=https://asu.co1.qualtrics.com/jfe/form/SV_6FNhPbsBuybTjEN --announcement="REGISTRATION FOR ROUND 1 IS NOW OPEN. Register, complete the Port of Mars Mission Control onboarding, and sign in during a scheduled launch time to compete in the next Mars Madness tournament!"
# set up 3 launch dates per day from 2023-11-10 to 2023-11-16
for day in {10..26}; do
    npm run ${CLI_CMD} -- tournament round date --date="2023-11-${day}T12:00:00-07:00";
    npm run ${CLI_CMD} -- tournament round date --date="2023-11-${day}T15:00:00-07:00";
    npm run ${CLI_CMD} -- tournament round date --date="2023-11-${day}T19:00:00-07:00";
done
