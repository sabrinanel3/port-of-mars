import * as _ from "lodash";
import {
  getEventName,
  MarsEventState,
  MarsEventStateConstructor,
} from "./common";
import { GameState, ActionOrdering } from "@port-of-mars/server/rooms/game/state";
import {
  CURATOR, ENTREPRENEUR, PIONEER, POLITICIAN, RESEARCHER,
  Role, ROLES, Resource, InvestmentData, MarsLogCategory
} from "@port-of-mars/shared/types";


const _dispatch: { [id: string]: MarsEventStateConstructor } = {};

export function formatEventName(eventName: string): string {
  return eventName.replace(/([A-Z])/g, ' $1').trim();
  // eventName = eventName.replace(/([A-Z])/g, ' $1').trim();
  // return [category.event].concat(eventName);
}

export function assocEventId(constructor: MarsEventStateConstructor) {
  _dispatch[getEventName(constructor)] = constructor;
}

export function constructState(id: string, data?: any) {
  const constructor = _dispatch[id];
  if (constructor) {
    return new constructor(data);
  } else {
    throw Error(`${id} does not have a corresponding state class in dispatch ${JSON.stringify(_dispatch)}`)
  }
}

export interface MarsEventSerialized {
  id: string;
  data?: any;
}

export interface BaseEvent {
  initialize?(game: GameState): void;
  finalize(game: GameState): void;
  getData?(): object;
  toJSON(): MarsEventSerialized;
}

export abstract class BaseEvent implements MarsEventState {

  toJSON(): MarsEventSerialized {
    const json: MarsEventSerialized = {
      id: getEventName(this.constructor)
    };
    if (this.getData) {
      json.data = _.cloneDeep(this.getData());
    }
    return json;
  }

}

////////////////////////// Sandstorm //////////////////////////

@assocEventId
export class Sandstorm extends BaseEvent {
  finalize(game: GameState): void {
    game.decreaseSystemHealth(10);
    game.log('A sandstorm has decreased system health by 10.', `${MarsLogCategory.event}: ${formatEventName(Sandstorm.name)}`);
  }
}

////////////////////////// LifeAsUsual //////////////////////////

@assocEventId
export class LifeAsUsual extends BaseEvent {
  finalize(game: GameState): void {
    game.log(`As the first human outpost on Mars, having a "usual" day is pretty unusual.`, `${MarsLogCategory.event}: ${formatEventName(LifeAsUsual.name)}`)
  }
}

////////////////////////// BreakdownOfTrust //////////////////////////

export type BreakdownOfTrustData = { [role in Role]: number }

@assocEventId
export class BreakdownOfTrust extends BaseEvent {

  //converts the roles array into an object that looks like BreakdownOfTrustData
  private savedtimeBlockAllocations: BreakdownOfTrustData = ROLES.reduce((obj, role) => {
    //these are placeholder values, they will be overridden.
    obj[role] = 0;
    return obj;
  }, {} as BreakdownOfTrustData);

  initialize(game: GameState) {
    for (const player of game.players) {
      player.invertPendingInventory();
      //save the timeblock amount the player is allotted for the round
      this.savedtimeBlockAllocations[player.role] = player.currentTimeBlocksAmount;
      //set them to 2 for the event
      player.setTimeBlocks(2);
    }
  }

  updateSavedResources(player: Role, game: GameState, updatedInventory: InvestmentData) {
    game.players[player].pendingInvestments.add(updatedInventory);
  }

  finalize(game: GameState): void {
    for (const player of game.players) {
      player.mergePendingAndInventory();
      //set that value back to the preserved amount before the event
      player.timeBlocks = this.savedtimeBlockAllocations[player.role];
    }
    game.log(`Each player can choose to save up to 2 units of Influence that they already own. The rest will be lost.`,
      `${MarsLogCategory.event}: ${formatEventName(BreakdownOfTrust.name)}`
    );
  }
}

////////////////////////// PersonalGain //////////////////////////

export type PersonalGainData = { [role in Role]: boolean };

@assocEventId
export class PersonalGain extends BaseEvent {

  private static defaultResponse = true;

  private static defaultVotes: PersonalGainData = {
    [CURATOR]: PersonalGain.defaultResponse,
    [ENTREPRENEUR]: PersonalGain.defaultResponse,
    [PIONEER]: PersonalGain.defaultResponse,
    [POLITICIAN]: PersonalGain.defaultResponse,
    [RESEARCHER]: PersonalGain.defaultResponse
  };

  private votes: PersonalGainData;

  constructor(votes?: PersonalGainData) {
    // currently used when reconstructing from the DB
    super();
    this.votes = votes ?? _.cloneDeep(PersonalGain.defaultVotes);
  }

  updateVotes(player: Role, vote: boolean) {
    // invoked by a player request -> command -> game event
    this.votes[player] = vote;
  }

  playerVotingInfo(voteResults: PersonalGainData): string {
    let player = '';
    const playerYesVotes: Array<string> = [];

    for (const role of ROLES) {
      if (voteResults[role]) {
        player = role.toString();
        playerYesVotes.push(player);
      }
    }
    return playerYesVotes.toString();
  }

  finalize(game: GameState) {
    const playerVotingInfo = this.playerVotingInfo(this.votes);
    game.pendingMarsEventActions.push({ordering: ActionOrdering.FIRST, execute: (state) => {
      let systemHealthReduction = 0;
      for (const role of ROLES) {
        if (this.votes[role]) {
          state.players[role].timeBlocks += 6;
          systemHealthReduction += 6;
        }
      }
      state.decreaseSystemHealth(systemHealthReduction);
      const message = `System health decreased by ${systemHealthReduction}. The following players voted yes: ${playerVotingInfo}`;
      state.log(message, `${MarsLogCategory.event}: ${formatEventName(PersonalGain.name)}`);
    }});
  }

  getData() {
    return this.votes;
  }
}

////////////////////////// Compulsive Philanthropy //////////////////////////

type CompulsivePhilanthropyData = { [role in Role]: Role }

@assocEventId
export class CompulsivePhilanthropy extends BaseEvent {

  votes: CompulsivePhilanthropyData;
  order: Array<Role>;

  constructor(data?: { votes: CompulsivePhilanthropyData; order: Array<Role> }) {
    super();
    this.votes = data?.votes ?? {
      [CURATOR]: CURATOR,
      [ENTREPRENEUR]: ENTREPRENEUR,
      [PIONEER]: PIONEER,
      [POLITICIAN]: POLITICIAN,
      [RESEARCHER]: RESEARCHER
    };
    this.order = data?.order ?? _.shuffle(_.cloneDeep(ROLES));
  }

  voteForPlayer(voter: Role, philanthropist: Role) {
    this.votes[voter] = philanthropist;
  }

  finalize(game: GameState): void {
    const voteCounts: { [role in Role]: number } = {
      [CURATOR]: 0,
      [ENTREPRENEUR]: 0,
      [PIONEER]: 0,
      [POLITICIAN]: 0,
      [RESEARCHER]: 0
    };

    for (const philanthropist of Object.values(this.votes)) {
      voteCounts[philanthropist] += 1;
    }

    const winners: Array<Role> = []
    let count = 0;
    for (const potentialWinner of ROLES) {
      if (voteCounts[potentialWinner] > count) {
        winners.splice(0, winners.length, potentialWinner);
        count = voteCounts[potentialWinner];
      } else if (voteCounts[potentialWinner] === count) {
        winners.push(potentialWinner)
      }
    }
    const winner: Role = _.find(this.order, (w: Role) => winners.includes(w)) || this.order[0];
    game.log(
      `The ${winner} was voted to be Compulsive Philanthropist with ${count} votes. The ${winner} invested all of their timeblocks into System Health.`,
      `${MarsLogCategory.event}: ${formatEventName(CompulsivePhilanthropy.name)}`
    );
    game.pendingMarsEventActions.push({ordering: ActionOrdering.LAST, execute: (state) => {
      state.increaseSystemHealth(state.players[winner].timeBlocks);
      state.players[winner].timeBlocks = 0;
    }});
  }

  getData() {
    return { votes: this.votes, order: this.order };
  }
}

////////////////////////// Out of Commission //////////////////////////

type OutOfCommissionData = { [role in Role]: Role }

abstract class OutOfCommission extends BaseEvent {
  player: Role = CURATOR;
  roles: OutOfCommissionData;

  constructor(public data?: { roles: OutOfCommissionData }) {
    super();
    this.roles = data?.roles ?? {
      [CURATOR]: CURATOR,
      [ENTREPRENEUR]: ENTREPRENEUR,
      [PIONEER]: PIONEER,
      [POLITICIAN]: POLITICIAN,
      [RESEARCHER]: RESEARCHER
    };
  }


  playerOutOfCommission(outOfCommission: Role): Role {
    const player: Role = this.roles[outOfCommission];
    return player;
  }

  finalize(game: GameState): void {
    game.pendingMarsEventActions.push({ordering: ActionOrdering.MIDDLE, execute: (state) => {
      const role: Role = this.playerOutOfCommission(this.player);
      state.players[role].timeBlocks = 3;
      state.log(
        `${this.player} has 3 time blocks to invest during this round.`,
        `${MarsLogCategory.event}: ${formatEventName(OutOfCommission.name)}`
      );
    }});
  }

  getData() {
    return { roles: this.roles };
  }
}

// Curator
@assocEventId
export class OutOfCommissionCurator extends OutOfCommission {
  constructor() {
    super();
  }
  player: Role = this.roles.Curator;
}

// Politician
@assocEventId
export class OutOfCommissionPolitician extends OutOfCommission {
  constructor() {
    super();
  }
  player: Role = this.roles.Politician;
}

// Researcher
@assocEventId
export class OutOfCommissionResearcher extends OutOfCommission {
  constructor() {
    super();
  }
  player: Role = this.roles.Researcher;
}

// Pioneer
@assocEventId
export class OutOfCommissionPioneer extends OutOfCommission {
  constructor() {
    super();
  }

  player: Role = this.roles.Pioneer;
}

// Entrepreneur
@assocEventId
export class OutOfCommissionEntrepreneur extends OutOfCommission {
  constructor() {
    super();
  }
  player: Role = this.roles.Entrepreneur;
}

////////////////////////// Audit //////////////////////////

@assocEventId
export class Audit extends BaseEvent {
  finalize(game: GameState) {
    game.log(
      `You will be able to view other players' resources. Hover over each player tab on the right to reveal their inventory.`,
      `${MarsLogCategory.event}: ${formatEventName(Audit.name)}`
    );
  }
}

////////////////////////// Bonding Through Adversity //////////////////////////

type BondingThroughAdversityData = { [role in Role]: Resource }

@assocEventId
export class BondingThroughAdversity extends BaseEvent {
  // The Player's default Influence vote
  private static defaultInfluenceVote: Resource;

  // Default Influence votes associated with each Role
  private static defaultInfluenceVotes: BondingThroughAdversityData = {
    [CURATOR]: BondingThroughAdversity.defaultInfluenceVote,
    [ENTREPRENEUR]: BondingThroughAdversity.defaultInfluenceVote,
    [PIONEER]: BondingThroughAdversity.defaultInfluenceVote,
    [POLITICIAN]: BondingThroughAdversity.defaultInfluenceVote,
    [RESEARCHER]: BondingThroughAdversity.defaultInfluenceVote,
  };

  // Map Influence votes to Roles
  private votes: BondingThroughAdversityData;

  // Clone Default Influence votes
  constructor(votes?: BondingThroughAdversityData) {
    super();
    this.votes = votes ?? _.cloneDeep(BondingThroughAdversity.defaultInfluenceVotes);
  }

  /**
   * Change Influence votes associated with each Role after a Player votes.
   * @param player The Role
   * @param vote The Influence the Player voted for 
   * 
   */
  updateVotes(player: Role, vote: Resource): void {
    this.votes[player] = vote;
  }

  /**
   * Change each Player's resource inventory with their Influence vote via game state and
   * push a message to the mars log.
   * @param game The current Game State 
   * 
   */
  finalize(game: GameState): void {
    for (const role of ROLES) {
      game.players[role].inventory[this.votes[role]] += 1;

    }
    const message = `Players have gained one influence currency of their choice.`
    game.log(message, `${MarsLogCategory.event}: ${formatEventName(BondingThroughAdversity.name)}`);
  }

  /**
   * Retrieve Role and Influence vote associated with each Player.
   * @return Role and Influence votes associated with each Role.
   */
  getData(): BondingThroughAdversityData {
    return this.votes;
  }
}

@assocEventId
export class ChangingTides extends BaseEvent {
  finalize(game: GameState): void {
    for (const role of ROLES) {
      const player = game.players[role];
      player.accomplishments.discardAll();
      player.accomplishments.draw(1);
    }
    game.log(
      'Each player discards their current Accomplishments and draws one new Accomplishment.',
      `${MarsLogCategory.event}: ${formatEventName(ChangingTides.name)}`
    );
  }
}

@assocEventId
export class HullBreach extends BaseEvent {
  finalize(state: GameState): void {
    state.decreaseSystemHealth(7);
    state.log(`A hull breach has destroyed 7 System Health.`, `${MarsLogCategory.event}: Hull Breach`);
  }
}

@assocEventId
export class CropFailure extends BaseEvent {
  finalize(state: GameState): void {
    state.decreaseSystemHealth(20);
    state.log(`Crop failure has destroyed 20 system health.`, `${MarsLogCategory.event}: Crop Failure`);
  }
}

@assocEventId
export class Interdisciplinary extends BaseEvent {
  finalize(state: GameState): void {
    // FIXME: I think this needs a new clientViewHandler
    // to support additional investment options and costs
    // reset player ResourceCosts
    state.log(`In this round, each player can spend 3 time blocks to earn an influence in either of the 2 influences they normally can't create.`,
      `${MarsLogCategory.event}: Interdisciplinary`
    );
  }
}

@assocEventId
export class SolarFlare extends BaseEvent {
  finalize(state: GameState): void {
    state.decreaseSystemHealth(5);
    state.disableTrading();
    state.log(`A Solar Flare has destroyed 5 System Health. Chat and trade are not available in this round.`,
      `${MarsLogCategory.event}: Solar Flare`
    );
  }
}

@assocEventId
export class MarketsClosed extends BaseEvent {
  finalize(state: GameState): void {
    state.disableTrading();
    state.log(`Markets Closed: Players may not trade Influences this round.`,
      `${MarsLogCategory.event}: Markets Closed`
    );
  }
}

@assocEventId
export class EffortsWasted extends BaseEvent {
  finalize(state: GameState): void {
    // at the moment will need to iterate across all players and
    // decrement victoryPoints with the removed accomplishment (if any)
    // and remove the accomplishment from player.accomplishments.purchased
    state.log(`Each player must discard an Accomplishment card they have purchased.`,
      `${MarsLogCategory.event}: Efforts Wasted`
    )
  }
}

@assocEventId
export class Stymied extends BaseEvent {
  finalize(state: GameState): void {
    for (const player of state.players) {
      player.costs[player.specialty] = 1000;
    }
    state.log(`Players may not earn their specialty Influence this round.`, `${MarsLogCategory.event}: Stymied`)
  }
}

@assocEventId
export class DifficultConditions extends BaseEvent {
  finalize(state: GameState): void {
    for (const player of state.players) {
      player.costs.upkeep *= 2;
    }
  }
}
