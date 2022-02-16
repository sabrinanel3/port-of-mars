import { getRedis, getServices } from "@port-of-mars/server/services";
import {
  AccomplishmentSummarizer,
  GameEventSummarizer,
  GameReplayer, MarsEventSummarizer, MarsLogSummarizer,
  PlayerInvestmentSummarizer, PlayerSummarizer,
  VictoryPointSummarizer
} from "@port-of-mars/server/services/replay";
import { DBPersister } from "@port-of-mars/server/services/persistence";
import { EnteredDefeatPhase, EnteredVictoryPhase } from "@port-of-mars/server/rooms/game/events";
import { Phase } from "@port-of-mars/shared/types";
import { getLogger } from "@port-of-mars/server/settings";
import {
  Game,
  GameEvent,
  Player,
  Tournament,
  TournamentRound,
  TournamentRoundInvite,
  User
} from "@port-of-mars/server/entity";
import { DYNAMIC_SETTINGS_PATH, RedisSettings } from "@port-of-mars/server/services/settings";

import { program } from 'commander'
import { mkdir, readFile, writeFile } from 'fs/promises';
import { createConnection, EntityManager } from "typeorm";
/*
import { promisify } from "util";

const mkdir = promisify(fs.mkdir);
const readFile = promisify(fs.readFile);
*/
const logger = getLogger(__filename);

function getRandomInt(min: number, max: number) {
  min = Math.ceil(min);
  max = Math.ceil(max);
  return Math.floor(Math.random() * (max - min) + min);
}

async function withConnection<T>(f: (em: EntityManager) => Promise<T>): Promise<void> {
  const conn = await createConnection('default');
  const em = conn.createEntityManager();
  try {
    await f(em);
  } finally {
    await conn.close();
  }
}

async function exportData(em: EntityManager, ids?: Array<number>, dateCreatedMin?: Date): Promise<void> {
  // FIXME: it would be good to disable the pino logger for the duration of this call so we don't repeat
  // all the logging spam as we replay events
  logger.debug("=====EXPORTING DATA START=====");
  let eventQuery = await em.getRepository(GameEvent)
    .createQueryBuilder("ge")
    .leftJoinAndSelect("ge.game", "g")
    .orderBy('ge.id', 'ASC');
  if (ids && ids.length > 0) {
    // FIXME: double quotes needed until https://github.com/typeorm/typeorm/issues/2919 and related are resolved
    eventQuery = eventQuery.where('"gameId" in (:...ids)', { ids });
  }
  if (dateCreatedMin) {
    if (ids && ids.length > 0) {
      eventQuery = eventQuery.andWhere('g.dateCreated > (:dateCreatedMin)', { dateCreatedMin: dateCreatedMin });
    } else {
      eventQuery = eventQuery.where('g.dateCreated > (:dateCreatedMin)', { dateCreatedMin: dateCreatedMin });
    }
  }
  logger.debug(eventQuery.getSql());
  const playerQuery = em.getRepository(Player)
    .createQueryBuilder('player')
    .innerJoinAndSelect(User, 'user', 'user.id = player.userId')
    .innerJoin(Game, 'game', 'game.id = player.gameId')
    .innerJoin(TournamentRound, 'tournamentRound', 'tournamentRound.id = game.tournamentRoundId')
    .innerJoinAndSelect(TournamentRoundInvite, 'invitation', 'invitation.tournamentRoundId = tournamentRound.id')
    .where('player.userId = invitation.userId');
  if (ids && ids.length > 0) {
    playerQuery
      .andWhere('game.id in (:...ids)', { ids });
  }
  logger.debug(playerQuery.getSql());
  const playerRaw = await playerQuery.getRawMany();

  const events = await eventQuery.getMany();
  await mkdir('/dump/processed', { recursive: true });
  await mkdir('/dump/raw', { recursive: true });
  const marsLogSummarizer = new MarsLogSummarizer(events, '/dump/processed/marsLog.csv');
  const playerSummarizer = new PlayerSummarizer(playerRaw, '/dump/processed/player.csv');
  const gameEventSummarizer = new GameEventSummarizer(events, '/dump/processed/gameEvent.csv');
  const victoryPointSummarizer = new VictoryPointSummarizer(events, '/dump/processed/victoryPoint.csv');
  const playerInvestmentSummarizer = new PlayerInvestmentSummarizer(events, '/dump/raw/playerInvestment.csv');
  const marsEventSummarizer = new MarsEventSummarizer(events, '/dump/processed/marsEvent.csv');
  const accomplishmentSummarizer = new AccomplishmentSummarizer('/dump/processed/accomplishment.csv')
  await Promise.all([marsLogSummarizer, playerSummarizer, gameEventSummarizer, victoryPointSummarizer, playerInvestmentSummarizer, marsEventSummarizer, accomplishmentSummarizer].map(s => s.save()))
  logger.debug("=====EXPORTING DATA END=====");
}

async function finalize(em: EntityManager, gameId: number): Promise<void> {
  const s = getServices(em);
  const events = await s.game.findEventsByGameId(gameId);
  const replayer = new GameReplayer(events);
  const gameState = replayer.endState;
  const persister = new DBPersister();
  const gameEvents = [];
  logger.debug(`Phase: ${Phase[gameState.phase]}`);
  if (![Phase.defeat, Phase.victory].includes(gameState.phase)) {
    if (gameState.systemHealth <= 0) {
      logger.debug('game needs a entered defeat phase event. adding finalization event.')
      gameEvents.push(new EnteredDefeatPhase(gameState.playerScores));
    } else if (gameState.round >= gameState.maxRound) {
      logger.debug('game needs a entered victory phase event. adding finalization event.')
      gameEvents.push(new EnteredVictoryPhase(gameState.playerScores));
    } else {
      logger.debug('game was not completed. refusing to add finalize event.')
      process.exit(1);
    }
    await persister.persist(gameEvents, { gameId, dateCreated: new Date(), timeRemaining: gameState.timeRemaining })
    await persister.sync();
    await persister.finalize(gameId, true);
  }
}

async function createTournament(em: EntityManager, name: string, minRounds: number, maxRounds: number): Promise<Tournament> {
  const services = getServices(em);
  return await services.tournament.createTournament({ name, minNumberOfGameRounds: minRounds, maxNumberOfGameRounds: maxRounds, active: true });
}

/**
 * FIXME: these two are mostly defunct now.
 */
async function checkQuizCompletion(em: EntityManager, ids: Array<number>): Promise<void> {
  const services = getServices(em);
  if (ids.length === 0) {
    const users = await services.quiz.getIncompleteQuizUsers();
    ids = users.map(u => u.id);
    logger.debug("checking quiz completion for all verified users who haven't passed the quiz: %o", ids);
  }
  for (const userId of ids) {
    logger.debug("checking quiz completion for user id %d", userId);
    await services.quiz.checkQuizCompletion(userId);
  }
}

async function completeQuizCompletion(em: EntityManager, ids: Array<number>): Promise<void> {
  const services = getServices(em);
  for (const id of ids) {
    await services.quiz.setUserQuizCompletion(id, true)
  }
}

async function deactivateUsers(em: EntityManager, filename: string) {
  const services = getServices(em);
  const data = await readFile(filename);
  const emails = data.toString().split("\n");
  const numDeactivated = await services.account.deactivateUsers(emails);
  logger.debug(`deactivated ${numDeactivated} users`);
}

async function createRound(
  em: EntityManager,
  id?: number,
  introSurveyUrl?: string,
  exitSurveyUrl?: string,
  numberOfGameRounds?: number,
  announcement?: string,
): Promise<TournamentRound> {
  const s = getServices(em);
  let tournament = undefined;
  if (id) {
    tournament = await s.tournament.getTournament(id);
  }
  else {
    tournament = await s.tournament.getActiveTournament();
  }
  let currentRound: Pick<TournamentRound, 'roundNumber' | 'introSurveyUrl' | 'exitSurveyUrl'> | undefined =
    await s.tournament.getCurrentTournamentRound().catch(err => undefined);
  if (!currentRound) {
    currentRound = {
      roundNumber: 0,
      introSurveyUrl: '',
      exitSurveyUrl: '',
    }
  }
  if (!numberOfGameRounds) {
    numberOfGameRounds = getRandomInt(tournament.minNumberOfGameRounds, tournament.maxNumberOfGameRounds);
  }
  const round = await s.tournament.createRound({
    tournamentId: tournament.id,
    introSurveyUrl: introSurveyUrl ? introSurveyUrl : currentRound.introSurveyUrl,
    exitSurveyUrl: exitSurveyUrl ? exitSurveyUrl : currentRound.exitSurveyUrl,
    roundNumber: currentRound.roundNumber + 1,
    announcement,
    numberOfGameRounds
  })
  logger.info('created tournament round %d for tournament %s', round.roundNumber, tournament.name);
  return round;
}

async function createTournamentRoundInvites(em: EntityManager, tournamentRoundId: number, userIds: Array<number>, hasParticipated: boolean): Promise<number> {
  const sp = getServices(em);
  const invites = await sp.tournament.createInvites(userIds, tournamentRoundId, hasParticipated);
  logger.debug("created tournament round invites for %s", userIds);
  return invites.length;
}

async function exportActiveEmails(em: EntityManager, participated: boolean): Promise<void> {
  const sp = getServices(em);
  const users = await sp.account.getActiveUsers(participated);
  const emails = users.map(u => `${u.name}, ${u.email}`);
  try {
    await writeFile('active-emails.csv', emails.join('\n'));
    logger.debug("Exported all active users with emails to active-emails.csv");
  }
  catch (err) {
    logger.fatal("unable to export active emails: %s", err);
  }
}

async function exportTournamentRoundEmails(em: EntityManager, tournamentRoundId: number): Promise<void> {
  const sp = getServices(em);
  const emails = await sp.tournament.getEmails(tournamentRoundId);
  const outputFile = 'emails.txt';
  try {
    await writeFile(outputFile, emails.join('\n'));
    logger.debug(`exported round invitation emails to ${outputFile}`);
  }
  catch (err) {
    logger.fatal("Unable to export emails", err);
  }
}

async function createTournamentRoundDate(em: EntityManager, date: Date, tournamentRoundId?: number): Promise<void> {
  const sp = getServices(em);
  const scheduledDate = await sp.tournament.createScheduledRoundDate(date, tournamentRoundId);
  logger.debug("created scheduled date: %o", scheduledDate);
}

function toIntArray(value: string, previous: Array<number>): Array<number> {
  return previous.concat([parseInt(value)])
}

/**
 * Workaround for commander custom options processing, otherwise any default values specified get used as the second arg
 * to parseInt (e.g., as the radix). For number of game rounds this turns into something like parseInt(<incoming-value>, 12)
 * which is completely not what we want.
 * 
 * https://github.com/tj/commander.js/blob/master/examples/options-custom-processing.js
 * 
 * @param value 
 * @param ignored 
 */
function customParseInt(value: string, ignored: number): number {
  return parseInt(value);
}

program
  .addCommand(
    program.createCommand('tournament')
      .description('tournamament subcommands')
      .addCommand(
        program
          .createCommand('round')
          .description('round subcommands')
          .addCommand(
            program
              .createCommand('date')
              .requiredOption('--date <date>', 'UTC Datetime for an upcoming scheduled game', s => new Date(Date.parse(s)))
              .option('--tournamentRoundId <tournamentRoundId>', 'ID of the tournament round', parseInt)
              .description('add a TournamentRoundDate for the given date')
              .action(async (cmd) => {
                await withConnection(em => createTournamentRoundDate(em, cmd.date, cmd.tournamentRoundId));
              })
          )
          .addCommand(
            program
              .createCommand('emails')
              .requiredOption('--tournamentRoundId <tournamentRoundId>', 'ID of the tournament round', customParseInt)
              .description('report emails for all users in the given tournament round')
              .action(async (cmd) => {
                await withConnection(em => exportTournamentRoundEmails(em, cmd.tournamentRoundId));
              })
          )
          .addCommand(
            program
              .createCommand('invite')
              .requiredOption('--tournamentRoundId <tournamentRoundId>', 'ID of the tournament round', customParseInt)
              .requiredOption('--userIds <userIds...>',
                'space separated list of user ids to invite', toIntArray, [] as Array<number>)
              .option('-p, --participated', 'Set to mark these users as having already participated')
              .description('create invitations for the given users in the given tournament round')
              .action(async (cmd) => {
                await withConnection(em => createTournamentRoundInvites(em, cmd.tournamentRoundId, cmd.userIds, cmd.participated));
              })
          )
          .addCommand(
            program
              .createCommand('create')
              .option('--tournamentId <tournamentId>', 'id of an existing tournament', customParseInt)
              .option('--introSurveyUrl <introSurveyUrl>', 'introductory survey URL', '')
              .option('--exitSurveyUrl <exitSurveyUrl>', 'exit survey URL', '')
              .option('--numberOfGameRounds <numberOfGameRounds>', 'number of game rounds for this TournamentRound', customParseInt, 11)
              .option('--announcement <announcement>', 'Tournament Round announcement message', '')
              .description('create a tournament round')
              .action(async (cmd) => {
                await withConnection((em) => createRound(em, cmd.tournamentId, cmd.introSurveyUrl, cmd.exitSurveyUrl, cmd.numberOfGameRounds, cmd.announcement));
                logger.debug('tournament round create %s [intro: %s] [exit: %s] [numberOfGameRounds: %d',
                  cmd.tournamentId, cmd.introSurveyUrl, cmd.exitSurveyUrl, cmd.numberOfGameRounds)
              })))
      .addCommand(
        program
          .createCommand('create')
          .requiredOption('--tournamentName <tournamentName>', 'string name of the tournament')
          .option('--minRounds <minRounds>', 'Minimum number of game rounds', customParseInt, 8)
          .option('--maxRounds <maxRounds>', 'Maximum number of game rounds', customParseInt, 12)
          .description('create a tournament')
          .action(async (cmd) => {
            await withConnection((em) => createTournament(em, cmd.tournamentName, cmd.minRounds, cmd.maxRounds))
            logger.debug('tournament create...')
          })
      ))
  .addCommand(
    program.createCommand('game')
      .description('game subcommands')
      .addCommand(
        program
          .createCommand('finalize')
          .description('finalize a game that wasn\'t finalized properly')
          .requiredOption('--gameId <gameId>', 'id of game', parseInt)
          .action(async (cmd) => {
            await withConnection(em => finalize(em, cmd.gameId))
          })
      )
  )
  .addCommand(
    program.createCommand('dump')
      .description('dump db to csvs')
      .option('--ids <ids...>', 'game ids to extract, separate multiples with spaces e.g., 1 2 3', toIntArray, [] as Array<number>)
      .option('--dateCreatedMin <dateCreatedMin>', 'return games after this ISO formatted date', s => new Date(Date.parse(s)))
      .action(async (cmd) => {
        await withConnection((em) => exportData(em, cmd.ids, cmd.dateCreatedMin))
      })
  )
  .addCommand(
    program.createCommand('checkquiz')
      .description('commands for checking quiz completion')
      .option('--ids <ids...>', 'user ids to check, separate multiples with spaces, e.g., 1 2 3', toIntArray, [] as Array<number>)
      .action(async (cmd) => {
        await withConnection(em => checkQuizCompletion(em, cmd.ids))
      })
  )
  .addCommand(
    program.createCommand('completequiz')
      .description('mark quiz for user as complete')
      .option('--ids <ids...>', 'user ids to mark quiz completion for', toIntArray, [] as Array<number>)
      .action(async (cmd) => {
        await withConnection(em => completeQuizCompletion(em, cmd.ids))
      })
  )
  .addCommand(
    program
      .createCommand('emails')
      .option('-p, --participated', 'Set to filter only participants who have participated in a game.')
      .description('generate a CSV for mailchimp import of all active users with a valid email address')
      .action(async (cmd) => {
        await withConnection(em => exportActiveEmails(em, cmd.participated));
      })
  )
  .addCommand(
    program
      .createCommand('deactivate')
      .option('-f, --filename <emails>', 'A file with a list of emails to deactivate, one email per line.', "inactive.csv")
      .description('Deactivate users who have unsubscribed from emails (currently from mailchimp).')
      .action(async (cmd) => {
        await withConnection(em => deactivateUsers(em, cmd.filename));
      })
  )
  .addCommand(
    program.createCommand('settings')
      .description('subcommands for dynamic settings in redis')
      .addCommand(
        program.createCommand('reload')
          .description(`reload settings from the file system at ${DYNAMIC_SETTINGS_PATH}`)
          .action(async (cmd) => {
            try {
              const client = getRedis();
              logger.debug('reloading dynamic settings');
              const settings = new RedisSettings(client);
              const code = await settings.reload();
              logger.debug({ code });
              logger.debug('reloaded settings into redis');
            } catch (e) {
              console.error(`reloading settings failed: ${e}`);
              process.exit(1);
            } finally {
              getRedis().quit();
            }
          })
      )
      .addCommand(
        program.createCommand('report')
          .description('Report current redis settings')
          .action(async (cmd) => {
            try {
              const client = getRedis();
              const settings = new RedisSettings(client);
              await settings.loadIfNotExist();
              const report = await settings.report();
              logger.debug("Current Redis Settings: %s", report);
            } finally {
              getRedis().quit();
            }
          })
      )
  );

async function main(argv: Array<string>): Promise<void> {
  await program.parseAsync(argv);
}

main(process.argv);
