export type CardEffect =
  | { type: 'moveTo'; index: number; passGoReward?: boolean }
  | { type: 'moveBack'; steps: number }
  | { type: 'money'; amount: number }
  | { type: 'pay'; amount: number }
  | { type: 'jail' }
  | { type: 'jailCard' }
  | { type: 'payEach'; amount: number }
  | { type: 'collectEach'; amount: number }
  | { type: 'repairs'; perHouse: number; perHotel: number }
  | { type: 'nearest'; space: 'rr' | 'util' };

export interface Card { text: string; effect: CardEffect }

/** Classic pre-2021 US Chance deck. */
export const CHANCE: Card[] = [
  { text: 'Advance to GO. Collect $200.', effect: { type: 'moveTo', index: 0 } },
  { text: 'Advance to Illinois Avenue. If you pass GO, collect $200.', effect: { type: 'moveTo', index: 24 } },
  { text: 'Advance to St. Charles Place. If you pass GO, collect $200.', effect: { type: 'moveTo', index: 11 } },
  { text: 'Advance to the nearest Utility. If unowned you may buy it. If owned, pay owner ten times the amount thrown.', effect: { type: 'nearest', space: 'util' } },
  { text: 'Advance to the nearest Railroad. If unowned you may buy it. If owned, pay the owner twice the rental to which they are otherwise entitled.', effect: { type: 'nearest', space: 'rr' } },
  { text: 'Advance to the nearest Railroad. If unowned you may buy it. If owned, pay the owner twice the rental to which they are otherwise entitled.', effect: { type: 'nearest', space: 'rr' } },
  { text: 'Bank pays you dividend of $50.', effect: { type: 'money', amount: 50 } },
  { text: 'Get Out of Jail Free. Keep this card until needed or traded.', effect: { type: 'jailCard' } },
  { text: 'Go back 3 spaces.', effect: { type: 'moveBack', steps: 3 } },
  { text: 'Go directly to Jail. Do not pass GO, do not collect $200.', effect: { type: 'jail' } },
  { text: 'Make general repairs on all your property: $25 per house, $100 per hotel.', effect: { type: 'repairs', perHouse: 25, perHotel: 100 } },
  { text: 'Speeding fine $15.', effect: { type: 'pay', amount: 15 } },
  { text: 'Take a trip to Reading Railroad. If you pass GO, collect $200.', effect: { type: 'moveTo', index: 5 } },
  { text: 'Advance to Boardwalk.', effect: { type: 'moveTo', index: 39 } },
  { text: 'You have been elected Chairman of the Board. Pay each player $50.', effect: { type: 'payEach', amount: 50 } },
  { text: 'Your building loan matures. Collect $150.', effect: { type: 'money', amount: 150 } },
];

/** Classic pre-2021 US Community Chest deck. */
export const CHEST: Card[] = [
  { text: 'Advance to GO. Collect $200.', effect: { type: 'moveTo', index: 0 } },
  { text: 'Bank error in your favor. Collect $200.', effect: { type: 'money', amount: 200 } },
  { text: "Doctor's fee. Pay $50.", effect: { type: 'pay', amount: 50 } },
  { text: 'From sale of stock you get $50.', effect: { type: 'money', amount: 50 } },
  { text: 'Get Out of Jail Free. Keep this card until needed or traded.', effect: { type: 'jailCard' } },
  { text: 'Go directly to Jail. Do not pass GO, do not collect $200.', effect: { type: 'jail' } },
  { text: 'Holiday fund matures. Receive $100.', effect: { type: 'money', amount: 100 } },
  { text: 'Income tax refund. Collect $20.', effect: { type: 'money', amount: 20 } },
  { text: 'It is your birthday. Collect $10 from every player.', effect: { type: 'collectEach', amount: 10 } },
  { text: 'Life insurance matures. Collect $100.', effect: { type: 'money', amount: 100 } },
  { text: 'Pay hospital fees of $100.', effect: { type: 'pay', amount: 100 } },
  { text: 'Pay school fees of $50.', effect: { type: 'pay', amount: 50 } },
  { text: 'Receive $25 consultancy fee.', effect: { type: 'money', amount: 25 } },
  { text: 'You are assessed for street repairs: $40 per house, $115 per hotel.', effect: { type: 'repairs', perHouse: 40, perHotel: 115 } },
  { text: 'You have won second prize in a beauty contest. Collect $10.', effect: { type: 'money', amount: 10 } },
  { text: 'You inherit $100.', effect: { type: 'money', amount: 100 } },
];