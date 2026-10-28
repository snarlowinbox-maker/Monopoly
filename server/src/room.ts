import {
  BOARD, CHANCE, CHEST, COLORS,
  type Player, type GameState, type GameEvent, type Card, type CardEffect,
} from '@monopoly/shared';

const PLAYER_COLORS = ['#ef4444', '#3b82f6', '#22c55e'];
const START_MONEY = 1500;

type StateEmitter = (room: Room) => void;
type EventEmitter = (room: Room, evt: GameEvent) => void;

let idCounter = 0;
const nextId = () => `p${++idCounter}_${Math.random().toString(36).slice(2, 7)}`;

/**
 * A Room encapsulates one game. Server holds authoritative state here.
 * All rule logic lives in this class — the client is a pure renderer.
 */
export class Room {
  code: string;
  emitState: StateEmitter;
  emitEvent: EventEmitter;

  phase: 'lobby' | 'playing' | 'ended' = 'lobby';
  players: Player[] = [];
  currentPlayerIndex = 0;
  dice: [number, number] | null = null;
  doublesCount = 0;
  turnPhase: GameState['turnPhase'] = 'roll';

  owner: (string | null)[] = Array(40).fill(null);
  houses: number[] = Array(40).fill(0);
  mortgaged: boolean[] = Array(40).fill(false);

  chanceDeck: number[] = [];
  chestDeck: number[] = [];
  freeParkingPot = 0;
  settings = { freeParking: false, doubleGo: false, auction: true };

  log: string[] = [];
  winner: string | null = null;
  prompt: GameState['prompt'] = null;
  auction: GameState['auction'] = null;
  trade: GameState['trade'] = null;

  constructor(code: string, emitState: StateEmitter, emitEvent: EventEmitter) {
    this.code = code;
    this.emitState = emitState;
    this.emitEvent = emitEvent;
    this.shuffleDecks();
  }

  /* ---------------- lobby ---------------- */

  addPlayer(socketId: string, name: string, isHost: boolean): Player {
    if (this.phase !== 'lobby') {
      // Allow reconnection by matching name
      const existing = this.players.find(p => !p.connected && p.name === name);
      if (existing) { existing.connected = true; return existing; }
      throw new Error('Game already in progress');
    }
    if (this.players.length >= 3) throw new Error('Room is full (3 players max)');
    const usedColors = new Set(this.players.map(p => p.color));
    const color = PLAYER_COLORS.find(c => !usedColors.has(c)) || '#888';
    const p: Player = {
      id: nextId(), name, color,
      money: START_MONEY, position: 0,
      jail: false, jailTurns: 0, jailCards: 0,
      bankrupt: false, connected: true,
    };
    this.players.push(p);
    this.pushLog(`${name} joined. (${this.players.length}/3)`);
    return p;
  }

  disconnectPlayer(playerId: string) {
    const p = this.players.find(pl => pl.id === playerId);
    if (!p) return;
    p.connected = false;
    this.pushLog(`${p.name} disconnected.`);
  }

  start(requesterSocket: string) {
    if (this.phase !== 'lobby') throw new Error('Game already started');
    const requester = this.players.find(p => p.connected);
    if (!requester) throw new Error('Not connected');
    if (this.players.length !== 3) throw new Error('Need exactly 3 players to start');
    this.phase = 'playing';
    this.turnPhase = 'roll';
    this.currentPlayerIndex = 0;
    this.pushLog('Game started!');
    this.emitEvent(this, { type: 'turn', playerId: this.currentPlayer().id });
  }

  /* ---------------- snapshot ---------------- */

  state(): GameState {
    return {
      roomCode: this.code,
      phase: this.phase,
      players: this.players.map(p => ({ ...p })),
      currentPlayerIndex: this.currentPlayerIndex,
      dice: this.dice,
      doublesCount: this.doublesCount,
      turnPhase: this.turnPhase,
      board: {
        owner: [...this.owner],
        houses: [...this.houses],
        mortgaged: [...this.mortgaged],
      },
      chanceDeck: [...this.chanceDeck],
      chestDeck: [...this.chestDeck],
      freeParkingPot: this.freeParkingPot,
      settings: { ...this.settings },
      log: [...this.log],
      winner: this.winner,
      prompt: this.prompt ? { ...this.prompt } : null,
      auction: this.auction ? { ...this.auction } : null,
      trade: this.trade ? JSON.parse(JSON.stringify(this.trade)) : null,
    };
  }

  /* ---------------- helpers ---------------- */

  private currentPlayer(): Player { return this.players[this.currentPlayerIndex]; }
  private requireCurrent(playerId: string, phase?: GameState['turnPhase']) {
    const p = this.currentPlayer();
    if (p.id !== playerId) throw new Error('Not your turn');
    if (phase && this.turnPhase !== phase) throw new Error(`Wrong phase: expected ${phase}`);
  }
  private pushLog(msg: string) {
    this.log.push(msg);
    if (this.log.length > 500) this.log.shift();
  }
  private shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  private shuffleDecks() {
    this.chanceDeck = this.shuffle(CHANCE.map((_, i) => i));
    this.chestDeck  = this.shuffle(CHEST.map((_, i) => i));
  }
  private alivePlayers(): Player[] { return this.players.filter(p => !p.bankrupt); }
  private groupIndices(group: string): number[] {
    const out: number[] = [];
    BOARD.forEach((s, i) => { if (s.group === group) out.push(i); });
    return out;
  }
  private ownsFullGroup(playerId: string, group: string): boolean {
    return this.groupIndices(group).every(i => this.owner[i] === playerId);
  }
  private propsOf(playerId: string): number[] {
    const out: number[] = [];
    this.owner.forEach((oid, i) => { if (oid === playerId) out.push(i); });
    return out;
  }
  /** Total cash a player could raise by liquidating (mortgages + building sale). */
  private liquidationValue(p: Player): number {
    let v = p.money;
    for (const i of this.propsOf(p.id)) {
      const sp = BOARD[i];
      const h = this.houses[i] || 0;
      if (h > 0) v += h * (sp.house! / 2);
      if (!this.mortgaged[i]) v += sp.mort || 0;
    }
    return v;
  }

  /* ---------------- turn actions ---------------- */

  roll(playerId: string) {
    this.requireCurrent(playerId, 'roll');
    const p = this.currentPlayer();
    if (p.jail) return this.rollInJail(p);

    const d1 = 1 + Math.floor(Math.random() * 6);
    const d2 = 1 + Math.floor(Math.random() * 6);
    this.dice = [d1, d2];
    this.emitEvent(this, { type: 'dice', d1, d2 });
    const isDouble = d1 === d2;
    if (isDouble) this.doublesCount++;
    else this.doublesCount = 0;
    this.pushLog(`${p.name} rolled ${d1} + ${d2} = ${d1 + d2}${isDouble ? ' (doubles)' : ''}`);

    if (this.doublesCount >= 3) {
      this.pushLog(`Three doubles in a row — ${p.name} goes to Jail!`);
      this.sendToJail(p);
      this.finishResolution();
      return;
    }

    this.movePlayerBy(p, d1 + d2, true);
    this.resolveLanding(p);
  }

  private rollInJail(p: Player) {
    const d1 = 1 + Math.floor(Math.random() * 6);
    const d2 = 1 + Math.floor(Math.random() * 6);
    this.dice = [d1, d2];
    this.emitEvent(this, { type: 'dice', d1, d2 });
    const isDouble = d1 === d2;
    this.pushLog(`${p.name} rolled ${d1} + ${d2} (in Jail)`);
    if (isDouble) {
      this.pushLog(`${p.name} rolled doubles — out of Jail!`);
      p.jail = false; p.jailTurns = 0;
      this.movePlayerBy(p, d1 + d2, false);
      this.doublesCount = 0;
      this.resolveLanding(p);
    } else {
      p.jailTurns++;
      if (p.jailTurns >= 3) {
        this.pushLog(`Third failed attempt — ${p.name} pays $50 and moves.`);
        this.chargePlayer(p, 50, null, 'Jail fine');
        p.jail = false; p.jailTurns = 0;
        this.movePlayerBy(p, d1 + d2, false);
        this.resolveLanding(p);
      } else {
        this.pushLog(`${p.name} stays in Jail (attempt ${p.jailTurns}/3).`);
        this.turnPhase = 'endturn';
      }
    }
  }

  /** Move player forward n spaces, optionally collecting GO salary. */
  private movePlayerBy(p: Player, steps: number, collectGo: boolean) {
    const from = p.position;
    const newPos = (from + steps) % 40;
    if (collectGo && from + steps >= 40) {
      const bonus = this.settings.doubleGo ? 400 : 200;
      p.money += bonus;
      this.pushLog(`${p.name} passed GO and collected $${bonus}.`);
      this.emitEvent(this, { type: 'money', playerId: p.id, delta: bonus, reason: 'GO' });
    }
    p.position = newPos;
    this.emitEvent(this, { type: 'move', playerId: p.id, from, to: newPos });
  }

  /** Resolves whatever the current player landed on. */
  private resolveLanding(p: Player) {
    const sp = BOARD[p.position];

    switch (sp.t) {
      case 'prop': case 'rr': case 'util': {
        if (this.owner[p.position] === null) {
          this.prompt = { type: 'buy', propId: p.position };
          this.turnPhase = 'action';
          return;
        }
        if (this.owner[p.position] === p.id) {
          this.pushLog(`${p.name} landed on their own property (${sp.name}).`);
          this.finishResolution();
          return;
        }
        this.payRent(p, p.position);
        this.finishResolution();
        return;
      }
      case 'tax': {
        this.pushLog(`${sp.name}: ${p.name} pays $${sp.amount}.`);
        this.chargePlayer(p, sp.amount!, null, sp.name);
        this.finishResolution();
        return;
      }
      case 'chance': case 'chest': {
        this.drawCard(p, sp.t);
        return;
      }
      case 'gotojail': {
        this.pushLog(`${p.name} landed on Go To Jail!`);
        this.sendToJail(p);
        this.finishResolution();
        return;
      }
      case 'free': {
        if (this.settings.freeParking && this.freeParkingPot > 0) {
          this.pushLog(`${p.name} collects the Free Parking pot: $${this.freeParkingPot}.`);
          p.money += this.freeParkingPot;
          this.emitEvent(this, { type: 'money', playerId: p.id, delta: this.freeParkingPot, reason: 'Free Parking' });
          this.freeParkingPot = 0;
        } else {
          this.pushLog(`${p.name} landed on Free Parking — nothing happens.`);
        }
        this.finishResolution();
        return;
      }
      case 'jail': {
        this.pushLog(`${p.name} is just visiting Jail.`);
        this.finishResolution();
        return;
      }
      default:
        this.finishResolution();
    }
  }

  /** Ends the "action" phase after landing resolution. Determines next turnPhase. */
  private finishResolution() {
    if (this.prompt) return; // blocked on buy prompt
    const p = this.currentPlayer();
    if (this.doublesCount > 0 && this.doublesCount < 3 && !p.jail && this.dice && this.dice[0] === this.dice[1]) {
      this.turnPhase = 'roll';
    } else {
      this.turnPhase = 'endturn';
    }
  }

  /* ---------------- rent & payments ---------------- */

  private calcRent(propId: number): number {
    const sp = BOARD[propId];
    const ownerId = this.owner[propId];
    if (!ownerId || this.mortgaged[propId]) return 0;

    if (sp.t === 'prop') {
      const h = this.houses[propId] || 0;
      if (h > 0) return sp.rent![h];
      return this.ownsFullGroup(ownerId, sp.group!) ? sp.rent![0] * 2 : sp.rent![0];
    }
    if (sp.t === 'rr') {
      const count = BOARD.filter((s, i) => s.t === 'rr' && this.owner[i] === ownerId).length;
      return 25 * Math.pow(2, count - 1);
    }
    if (sp.t === 'util') {
      const count = BOARD.filter((s, i) => s.t === 'util' && this.owner[i] === ownerId).length;
      const d = (this.dice?.[0] ?? 1) + (this.dice?.[1] ?? 1);
      return (count === 2 ? 10 : 4) * d;
    }
    return 0;
  }

  private payRent(from: Player, propId: number) {
    const ownerId = this.owner[propId];
    if (!ownerId || ownerId === from.id) return;
    const to = this.players.find(p => p.id === ownerId)!;
    const rent = this.calcRent(propId);
    if (rent === 0) {
      this.pushLog(`${BOARD[propId].name} is mortgaged — no rent due.`);
      return;
    }
    this.pushLog(`${from.name} pays $${rent} rent to ${to.name} for ${BOARD[propId].name}.`);
    this.chargePlayer(from, rent, to, 'Rent');
    this.emitEvent(this, { type: 'rent', fromId: from.id, toId: to.id, amount: rent, propId });
  }

  /**
   * Charge `payer` — handles bankruptcy. If payer cannot liquidate to cover,
   * they are declared bankrupt and all assets transfer to the creditor (or bank).
   */
  private chargePlayer(payer: Player, amount: number, creditor: Player | null, reason: string) {
    if (amount <= 0) return;
    // Simple auto-liquidation: if short, mortgage cheapest first until covered.
    if (payer.money < amount) {
      if (this.liquidationValue(payer) >= amount) {
        this.autoLiquidate(payer, amount);
      } else {
        // Bankrupt
        this.declareBankrupt(payer, creditor);
        return;
      }
    }
    payer.money -= amount;
    if (creditor) creditor.money += amount;
    else if (this.settings.freeParking && reason !== 'GO') this.freeParkingPot += amount;
    this.emitEvent(this, { type: 'money', playerId: payer.id, delta: -amount, reason });
    if (creditor) this.emitEvent(this, { type: 'money', playerId: creditor.id, delta: amount, reason });
  }

  /** Automatically mortgage properties / sell buildings until player can cover `need`. */
  private autoLiquidate(p: Player, need: number) {
    const props = this.propsOf(p.id).sort((a, b) => (BOARD[a].mort || 0) - (BOARD[b].mort || 0));
    for (const i of props) {
      if (p.money >= need) break;
      // Sell buildings first
      while ((this.houses[i] || 0) > 0 && p.money < need) {
        this.houses[i]--;
        p.money += BOARD[i].house! / 2;
        this.pushLog(`${p.name} sold a building on ${BOARD[i].name} for $${BOARD[i].house! / 2}.`);
      }
      if (p.money >= need) break;
      if (!this.mortgaged[i]) {
        this.mortgaged[i] = true;
        p.money += BOARD[i].mort!;
        this.pushLog(`${p.name} mortgaged ${BOARD[i].name} for $${BOARD[i].mort}.`);
      }
    }
  }

  /**
   * Bankruptcy: transfer all assets to the creditor (or return to bank if tax/bank fine).
   * Remaining players play until one remains, then winner declared.
   */
  private declareBankrupt(p: Player, creditor: Player | null) {
    this.pushLog(`💀 ${p.name} is BANKRUPT!`);
    p.bankrupt = true;
    const props = this.propsOf(p.id);
    for (const i of props) {
      // Sell any houses back to bank first
      if ((this.houses[i] || 0) > 0) {
        const val = (BOARD[i].house! / 2) * this.houses[i];
        if (creditor) creditor.money += val;
        this.houses[i] = 0;
      }
      if (creditor && !creditor.bankrupt) {
        this.owner[i] = creditor.id;
      } else {
        this.owner[i] = null;
        this.mortgaged[i] = false;
      }
    }
    if (creditor && !creditor.bankrupt) {
      creditor.money += Math.max(0, p.money);
      creditor.jailCards += p.jailCards;
    }
    p.money = 0;
    p.jailCards = 0;
    this.emitEvent(this, { type: 'bankrupt', playerId: p.id, creditorId: creditor?.id ?? null });

    // Check for winner
    const alive = this.alivePlayers();
    if (alive.length <= 1) {
      this.phase = 'ended';
      this.winner = alive[0]?.id ?? null;
      this.pushLog(`🏆 ${alive[0]?.name ?? 'Nobody'} wins the game!`);
      return;
    }
    // Skip to next player (current player might be the bankrupt one)
    if (this.currentPlayer()?.bankrupt) {
      this.turnPhase = 'endturn';
    }
  }

  /* ---------------- card effects ---------------- */

  private drawCard(p: Player, deck: 'chance' | 'chest') {
    const cards: Card[] = deck === 'chance' ? CHANCE : CHEST;
    const order = deck === 'chance' ? this.chanceDeck : this.chestDeck;
    if (!order.length) {
      // Refill from all cards (used only if all cards exhausted; rare)
      (deck === 'chance' ? this.chanceDeck : this.chestDeck);
      order.push(...this.shuffle(cards.map((_, i) => i)));
    }
    const idx = order.shift()!;
    const card = cards[idx];
    // Return card to bottom unless it's a Get Out of Jail Free (kept by player)
    if (card.effect.type !== 'jailCard') order.push(idx);

    this.pushLog(`${deck === 'chance' ? 'Chance' : 'Community Chest'}: ${card.text}`);
    this.emitEvent(this, { type: 'card', deck, text: card.text });

    this.applyCardEffect(p, card.effect);

    if (this.prompt) return; // effect may have set a buy prompt
    this.finishResolution();
  }

  private applyCardEffect(p: Player, eff: CardEffect) {
    switch (eff.type) {
      case 'moveTo': {
        const from = p.position;
        let target = eff.index;
        if (target > from && target < 40) {
          // passing GO
          const bonus = this.settings.doubleGo ? 400 : 200;
          p.money += bonus;
          this.pushLog(`${p.name} passed GO and collected $${bonus}.`);
          this.emitEvent(this, { type: 'money', playerId: p.id, delta: bonus, reason: 'GO' });
        }
        p.position = target;
        this.emitEvent(this, { type: 'move', playerId: p.id, from, to: target });
        this.resolveLanding(p);
        break;
      }
      case 'moveBack': {
        const from = p.position;
        const target = (p.position - eff.steps + 40) % 40;
        p.position = target;
        this.emitEvent(this, { type: 'move', playerId: p.id, from, to: target });
        this.resolveLanding(p);
        break;
      }
      case 'money': {
        p.money += eff.amount;
        this.pushLog(`${p.name} collects $${eff.amount}.`);
        this.emitEvent(this, { type: 'money', playerId: p.id, delta: eff.amount, reason: 'Card' });
        break;
      }
      case 'pay': {
        this.pushLog(`${p.name} pays $${eff.amount}.`);
        this.chargePlayer(p, eff.amount, null, 'Card');
        break;
      }
      case 'jailCard': {
        p.jailCards++;
        this.pushLog(`${p.name} keeps a Get Out of Jail Free card.`);
        break;
      }
      case 'jail': {
        this.pushLog(`${p.name} goes directly to Jail.`);
        this.sendToJail(p);
        break;
      }
      case 'payEach': {
        for (const o of this.alivePlayers()) {
          if (o.id === p.id) continue;
          this.chargePlayer(p, eff.amount, o, 'Card');
          if (p.bankrupt) break;
        }
        break;
      }
      case 'collectEach': {
        for (const o of this.alivePlayers()) {
          if (o.id === p.id) continue;
          this.chargePlayer(o, eff.amount, p, 'Card');
        }
        break;
      }
      case 'repairs': {
        let total = 0;
        for (const i of this.propsOf(p.id)) {
          const h = this.houses[i] || 0;
          if (h === 5) total += eff.perHotel;
          else total += h * eff.perHouse;
        }
        this.pushLog(`${p.name} pays $${total} for repairs.`);
        this.chargePlayer(p, total, null, 'Repairs');
        break;
      }
      case 'nearest': {
        // Find the nearest matching space forward (wrapping)
        const types = eff.space === 'rr' ? ['rr'] : ['util'];
        let target = (p.position + 1) % 40;
        for (let s = 0; s < 40; s++) {
          const i = (p.position + 1 + s) % 40;
          if (types.includes(BOARD[i].t)) { target = i; break; }
        }
        const from = p.position;
        if (target <= from) {
          const bonus = this.settings.doubleGo ? 400 : 200;
          p.money += bonus;
          this.pushLog(`${p.name} passed GO and collected $${bonus}.`);
          this.emitEvent(this, { type: 'money', playerId: p.id, delta: bonus, reason: 'GO' });
        }
        p.position = target;
        this.emitEvent(this, { type: 'move', playerId: p.id, from, to: target });
        this.resolveLanding(p);
        break;
      }
    }
  }

  /* ---------------- jail ---------------- */

  private sendToJail(p: Player) {
    p.position = 10;
    p.jail = true;
    p.jailTurns = 0;
    this.doublesCount = 0;
    this.emitEvent(this, { type: 'jail', playerId: p.id });
  }

  payFine(playerId: string) {
    this.requireCurrent(playerId, 'roll');
    const p = this.currentPlayer();
    if (!p.jail) throw new Error('Not in Jail');
    if (p.money < 50) throw new Error('Not enough cash');
    p.money -= 50;
    this.freeParkingPot += this.settings.freeParking ? 50 : 0;
    p.jail = false; p.jailTurns = 0;
    this.pushLog(`${p.name} paid the $50 fine and is free.`);
    this.emitEvent(this, { type: 'money', playerId: p.id, delta: -50, reason: 'Jail fine' });
    this.turnPhase = 'roll';
  }

  useJailCard(playerId: string) {
    this.requireCurrent(playerId, 'roll');
    const p = this.currentPlayer();
    if (!p.jail) throw new Error('Not in Jail');
    if (p.jailCards <= 0) throw new Error('No Get Out of Jail Free card');
    p.jailCards--;
    p.jail = false; p.jailTurns = 0;
    // Return card to bottom of Chance deck
    this.chanceDeck.push(CHANCE.findIndex(c => c.effect.type === 'jailCard'));
    this.pushLog(`${p.name} used a Get Out of Jail Free card.`);
    this.turnPhase = 'roll';
  }

  /* ---------------- buy / auction ---------------- */

  resolveBuy(playerId: string) {
    this.requireCurrent(playerId, 'action');
    if (!this.prompt || this.prompt.type !== 'buy') throw new Error('No buy prompt');
    const p = this.currentPlayer();
    const sp = BOARD[this.prompt.propId];
    if (p.money < sp.price!) throw new Error('Not enough cash');
    p.money -= sp.price!;
    this.owner[this.prompt.propId] = p.id;
    this.pushLog(`${p.name} bought ${sp.name} for $${sp.price}.`);
    this.emitEvent(this, { type: 'buy', playerId: p.id, propId: this.prompt.propId });
    this.emitEvent(this, { type: 'money', playerId: p.id, delta: -sp.price!, reason: 'Purchase' });
    const propId = this.prompt.propId;
    this.prompt = null;
    void propId;
    this.finishResolution();
  }

  resolveDecline(playerId: string) {
    this.requireCurrent(playerId, 'action');
    if (!this.prompt || this.prompt.type !== 'buy') throw new Error('No buy prompt');
    const propId = this.prompt.propId;
    this.prompt = null;
    if (this.settings.auction) {
      this.startAuction(propId);
    } else {
      this.pushLog(`${this.currentPlayer().name} declined ${BOARD[propId].name}.`);
      this.finishResolution();
    }
  }

  private startAuction(propId: number) {
    this.auction = {
      propId,
      highBid: 0,
      highBidderId: null,
      passedIds: [],
    };
    this.turnPhase = 'action';
    this.pushLog(`Auction started for ${BOARD[propId].name}.`);
  }

  auctionBid(playerId: string, amount: number) {
    if (!this.auction) throw new Error('No auction in progress');
    const bidder = this.players.find(p => p.id === playerId);
    if (!bidder || bidder.bankrupt) throw new Error('Cannot bid');
    if (this.auction.passedIds.includes(playerId)) throw new Error('You already passed');
    const minBid = this.auction.highBid === 0 ? 10 : this.auction.highBid + 10;
    if (amount < minBid) throw new Error(`Minimum bid is $${minBid}`);
    if (amount > bidder.money) throw new Error('Not enough cash');
    this.auction.highBid = amount;
    this.auction.highBidderId = playerId;
    this.pushLog(`${bidder.name} bids $${amount}.`);
    this.checkAuctionEnd();
  }

  auctionPass(playerId: string) {
    if (!this.auction) throw new Error('No auction in progress');
    this.auction.passedIds.push(playerId);
    const p = this.players.find(pl => pl.id === playerId);
    if (p) this.pushLog(`${p.name} passes.`);
    this.checkAuctionEnd();
  }

  private checkAuctionEnd() {
    if (!this.auction) return;
    const active = this.alivePlayers().filter(p => !this.auction!.passedIds.includes(p.id));
    if (active.length === 0) {
      // Nobody bid — property stays with bank
      this.pushLog(`${BOARD[this.auction.propId].name} returns to the bank.`);
      this.auction = null;
      this.finishResolution();
      return;
    }
    if (active.length === 1 && this.auction.highBidderId === active[0].id) {
      const winner = active[0];
      const propId = this.auction.propId;
      const price = this.auction.highBid;
      winner.money -= price;
      this.owner[propId] = winner.id;
      this.pushLog(`${winner.name} wins the auction for ${BOARD[propId].name} at $${price}.`);
      this.emitEvent(this, { type: 'auctionWin', playerId: winner.id, propId, amount: price });
      this.emitEvent(this, { type: 'money', playerId: winner.id, delta: -price, reason: 'Auction' });
      this.auction = null;
      this.finishResolution();
    }
  }

  /* ---------------- build / mortgage ---------------- */

  build(playerId: string, propId: number) {
    const p = this.players.find(pl => pl.id === playerId);
    if (!p) throw new Error('Player not found');
    const sp = BOARD[propId];
    if (sp.t !== 'prop') throw new Error('Cannot build here');
    if (this.owner[propId] !== p.id) throw new Error('You do not own this');
    if (this.mortgaged[propId]) throw new Error('Property is mortgaged');
    if (!this.ownsFullGroup(p.id, sp.group!)) throw new Error('You need the full colour group');
    const group = this.groupIndices(sp.group!);
    if (group.some(i => this.mortgaged[i])) throw new Error('Unmortgage the group first');
    const h = this.houses[propId] || 0;
    if (h >= 5) throw new Error('Hotel already built');
    const minH = Math.min(...group.map(i => this.houses[i] || 0));
    if (h > minH) throw new Error('Houses must be built evenly');
    if (p.money < sp.house!) throw new Error('Not enough cash');
    p.money -= sp.house!;
    this.houses[propId] = h + 1;
    this.pushLog(`${p.name} built ${h + 1 === 5 ? 'a hotel' : `house #${h + 1}`} on ${sp.name} for $${sp.house}.`);
    this.emitEvent(this, { type: 'build', playerId: p.id, propId, houses: h + 1 });
    this.emitEvent(this, { type: 'money', playerId: p.id, delta: -sp.house!, reason: 'Build' });
  }

  sellBuilding(playerId: string, propId: number) {
    const p = this.players.find(pl => pl.id === playerId);
    if (!p) throw new Error('Player not found');
    if (this.owner[propId] !== p.id) throw new Error('You do not own this');
    const h = this.houses[propId] || 0;
    if (h <= 0) throw new Error('No buildings to sell');
    const sp = BOARD[propId];
    const group = this.groupIndices(sp.group!);
    const maxH = Math.max(...group.map(i => this.houses[i] || 0));
    if (h < maxH) throw new Error('Sell buildings evenly across the group');
    this.houses[propId] = h - 1;
    p.money += sp.house! / 2;
    this.pushLog(`${p.name} sold a building on ${sp.name} for $${sp.house! / 2}.`);
    this.emitEvent(this, { type: 'build', playerId: p.id, propId, houses: h - 1 });
    this.emitEvent(this, { type: 'money', playerId: p.id, delta: sp.house! / 2, reason: 'Sell building' });
  }

  mortgage(playerId: string, propId: number) {
    const p = this.players.find(pl => pl.id === playerId);
    if (!p) throw new Error('Player not found');
    if (this.owner[propId] !== p.id) throw new Error('You do not own this');
    if (this.mortgaged[propId]) throw new Error('Already mortgaged');
    if ((this.houses[propId] || 0) > 0) throw new Error('Sell buildings first');
    const sp = BOARD[propId];
    this.mortgaged[propId] = true;
    p.money += sp.mort!;
    this.pushLog(`${p.name} mortgaged ${sp.name} for $${sp.mort}.`);
    this.emitEvent(this, { type: 'money', playerId: p.id, delta: sp.mort!, reason: 'Mortgage' });
  }

  unmortgage(playerId: string, propId: number) {
    const p = this.players.find(pl => pl.id === playerId);
    if (!p) throw new Error('Player not found');
    if (this.owner[propId] !== p.id) throw new Error('You do not own this');
    if (!this.mortgaged[propId]) throw new Error('Not mortgaged');
    const sp = BOARD[propId];
    const cost = Math.ceil(sp.mort! * 1.1);
    if (p.money < cost) throw new Error('Not enough cash (need $' + cost + ')');
    p.money -= cost;
    this.mortgaged[propId] = false;
    this.pushLog(`${p.name} unmortgaged ${sp.name} for $${cost} (incl. 10% interest).`);
    this.emitEvent(this, { type: 'money', playerId: p.id, delta: -cost, reason: 'Unmortgage' });
  }

  /* ---------------- trade ---------------- */

  /**
   * Validate and stage a trade offer. Both sides must own / have the offered items.
   * Properties being traded must have no houses. Trade only initiated on your turn.
   */
  proposeTrade(playerId: string, data: any) {
    this.requireCurrent(playerId);
    const from = this.players.find(p => p.id === playerId);
    const to = this.players.find(p => p.id === data.toId);
    if (!from || !to) throw new Error('Invalid players');
    if (from.bankrupt || to.bankrupt) throw new Error('Cannot trade with bankrupt player');

    const offer = data.offer as { money: number; props: number[]; jailCards: number };
    const request = data.request as { money: number; props: number[]; jailCards: number };

    const validateSide = (p: Player, side: typeof offer, label: string) => {
      if (side.money < 0) throw new Error(`${label}: cash cannot be negative`);
      if (side.money > p.money) throw new Error(`${label}: not enough cash`);
      if (side.jailCards > p.jailCards) throw new Error(`${label}: not enough jail cards`);
      for (const i of side.props) {
        if (this.owner[i] !== p.id) throw new Error(`${label}: does not own ${BOARD[i].name}`);
        if ((this.houses[i] || 0) > 0) throw new Error(`${label}: sell buildings on ${BOARD[i].name} first`);
      }
    };
    validateSide(from, offer, from.name);
    validateSide(to, request, to.name);

    this.trade = { fromId: from.id, toId: to.id, offer, request };
    this.pushLog(`${from.name} proposed a trade to ${to.name}.`);
  }

  respondTrade(playerId: string, accept: boolean) {
    if (!this.trade) throw new Error('No trade pending');
    if (this.trade.toId !== playerId) throw new Error('Not your trade to respond to');
    const { fromId, toId, offer, request } = this.trade;
    const from = this.players.find(p => p.id === fromId)!;
    const to = this.players.find(p => p.id === toId)!;

    if (!accept) {
      this.pushLog(`${to.name} declined the trade.`);
      this.trade = null;
      return;
    }

    // Re-validate at execution time (state may have changed)
    const revalidate = (p: Player, side: typeof offer) => {
      if (side.money > p.money) throw new Error(`${p.name} lacks cash`);
      if (side.jailCards > p.jailCards) throw new Error(`${p.name} lacks jail cards`);
      for (const i of side.props) {
        if (this.owner[i] !== p.id) throw new Error(`${p.name} no longer owns ${BOARD[i].name}`);
        if ((this.houses[i] || 0) > 0) throw new Error(`${p.name} built on ${BOARD[i].name}`);
      }
    };
    revalidate(from, offer);
    revalidate(to, request);

    from.money -= offer.money; from.money += request.money;
    to.money   -= request.money; to.money += offer.money;
    from.jailCards -= offer.jailCards; from.jailCards += request.jailCards;
    to.jailCards   -= request.jailCards; to.jailCards += offer.jailCards;
    for (const i of offer.props)   this.owner[i] = toId;
    for (const i of request.props) this.owner[i] = fromId;

    this.pushLog(`Trade completed between ${from.name} and ${to.name}.`);
    this.emitEvent(this, { type: 'trade', fromId, toId });
    this.trade = null;
  }

  /* ---------------- turn end ---------------- */

  endTurn(playerId: string) {
    this.requireCurrent(playerId, 'endturn');
    if (this.phase === 'ended') return;

    // Advance to next non-bankrupt player
    let next = this.currentPlayerIndex;
    for (let i = 0; i < this.players.length; i++) {
      next = (next + 1) % this.players.length;
      if (!this.players[next].bankrupt) break;
    }
    this.currentPlayerIndex = next;
    this.dice = null;
    this.doublesCount = 0;
    this.prompt = null;
    this.auction = null;
    this.trade = null;
    this.turnPhase = 'roll';

    const p = this.currentPlayer();
    this.pushLog(`— ${p.name}'s turn —`);
    this.emitEvent(this, { type: 'turn', playerId: p.id });
  }
}