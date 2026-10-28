export type SpaceType =
  | 'go' | 'prop' | 'rr' | 'util' | 'chance' | 'chest' | 'tax' | 'jail' | 'free' | 'gotojail';

export interface Space {
  t: SpaceType;
  name: string;
  group?: string;
  price?: number;
  rent?: number[];
  house?: number;
  mort?: number;
  amount?: number;
}

export interface Player {
  id: string;
  name: string;
  color: string;
  money: number;
  position: number;
  jail: boolean;
  jailTurns: number;
  jailCards: number;
  bankrupt: boolean;
  connected: boolean;
}

export interface BoardState {
  owner: (string | null)[];
  houses: number[];
  mortgaged: boolean[];
}

export type TurnPhase = 'roll' | 'action' | 'endturn';

export interface AuctionState {
  propId: number;
  highBid: number;
  highBidderId: string | null;
  passedIds: string[];
}

export interface TradeState {
  fromId: string;
  toId: string;
  offer:   { money: number; props: number[]; jailCards: number };
  request: { money: number; props: number[]; jailCards: number };
}

export interface Prompt { type: 'buy'; propId: number }

export interface GameState {
  roomCode: string;
  phase: 'lobby' | 'playing' | 'ended';
  players: Player[];
  currentPlayerIndex: number;
  dice: [number, number] | null;
  doublesCount: number;
  turnPhase: TurnPhase;
  board: BoardState;
  chanceDeck: number[];
  chestDeck: number[];
  freeParkingPot: number;
  settings: { freeParking: boolean; doubleGo: boolean; auction: boolean };
  log: string[];
  winner: string | null;
  prompt: Prompt | null;
  auction: AuctionState | null;
  trade: TradeState | null;
}

export type GameEvent =
  | { type: 'dice'; d1: number; d2: number }
  | { type: 'move'; playerId: string; from: number; to: number }
  | { type: 'money'; playerId: string; delta: number; reason: string }
  | { type: 'buy'; playerId: string; propId: number }
  | { type: 'build'; playerId: string; propId: number; houses: number }
  | { type: 'card'; deck: 'chance' | 'chest'; text: string }
  | { type: 'jail'; playerId: string }
  | { type: 'bankrupt'; playerId: string; creditorId: string | null }
  | { type: 'rent'; fromId: string; toId: string; amount: number; propId: number }
  | { type: 'trade'; fromId: string; toId: string }
  | { type: 'auctionWin'; playerId: string; propId: number; amount: number }
  | { type: 'turn'; playerId: string };