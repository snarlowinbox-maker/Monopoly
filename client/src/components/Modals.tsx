import { useEffect, useState } from 'react';
import { BOARD, CHANCE, CHEST, COLORS, type GameState, type GameEvent } from '@monopoly/shared';
import { socket } from '../socket';

interface Props { state: GameState; myId: string }

/**
 * Central modal host: renders whichever modal is relevant given server state
 * (buy prompt, auction, trade, card draw, game over). Only one appears at a time.
 */
export default function Modals({ state, myId }: Props) {
  const myTurn = state.players[state.currentPlayerIndex]?.id === myId;
  const me = state.players.find(p => p.id === myId);

  // Buy prompt
  if (state.prompt?.type === 'buy' && myTurn) {
    return <BuyPrompt state={state} propId={state.prompt.propId} myId={myId} />;
  }

  // Auction
  if (state.auction) {
    return <AuctionModal state={state} myId={myId} />;
  }

  // Trade response — if I'm the target
  if (state.trade && state.trade.toId === myId) {
    return <TradeResponse state={state} myId={myId} />;
  }

  // Waiting for trade response — show subtle banner to initiator
  if (state.trade && state.trade.fromId === myId) {
    return (
      <div className="overlay" style={{ background: 'transparent', backdropFilter: 'none', pointerEvents: 'none' }}>
        <div style={{ position:'fixed', bottom: 24, left: '50%', transform:'translateX(-50%)',
          background: '#26314a', padding:'12px 20px', borderRadius:10, border:'1px solid #3a4761',
          fontSize: 13, fontWeight: 700, zIndex: 200 }}>
          🤝 Waiting for {state.players.find(p => p.id === state.trade!.toId)?.name} to respond…
        </div>
      </div>
    );
  }

  // Game over
  if (state.phase === 'ended' && state.winner) {
    const w = state.players.find(p => p.id === state.winner);
    return (
      <div className="overlay">
        <div className="modal">
          <div className="modal-head" style={{ fontSize: 22, textAlign: 'center' }}>🏆 Game Over</div>
          <div className="modal-body" style={{ textAlign: 'center', padding: '30px 22px' }}>
            <div style={{ fontSize: 48, marginBottom: 10 }}>👑</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: '#f0b429', marginBottom: 10 }}>
              {w?.name ?? 'Winner'} wins!
            </div>
            <div style={{ color: '#9fb0c8' }}>
              Final cash: ${w?.money ?? 0}
            </div>
          </div>
          <div className="modal-foot" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => location.reload()}>Play Again</button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

/* ---------- Buy Prompt ---------- */

function BuyPrompt({ state, propId, myId }: { state: GameState; propId: number; myId: string }) {
  const me = state.players.find(p => p.id === myId)!;
  const sp = BOARD[propId];
  return (
    <div className="overlay">
      <div className="modal">
        <div className="modal-head">Buy {sp.name}?</div>
        <div className="modal-body">
          <div style={{ display:'flex', gap:16, alignItems:'center' }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:20, fontWeight:900, marginBottom:6 }}>{sp.name}</div>
              <div style={{ color:'#9fb0c8', marginBottom:10 }}>
                {sp.t === 'prop' ? (sp.group ? `${sp.group.charAt(0).toUpperCase()}${sp.group.slice(1)} group` : '') : sp.t === 'rr' ? 'Railroad' : 'Utility'}
              </div>
              <div style={{ fontSize:18, fontWeight:800, color:'#5ddc8a' }}>Price: ${sp.price}</div>
              <div style={{ fontSize:13, color:'#9fb0c8', marginTop:4 }}>Your cash: ${me.money}</div>
              {sp.rent && (
                <div style={{ marginTop:10, fontSize:12, color:'#9fb0c8', lineHeight:1.6 }}>
                  Rent: ${sp.rent[0]} → ${sp.rent[5]} (hotel)
                  <br/>House: ${sp.house}
                </div>
              )}
            </div>
            {sp.group && <div style={{ width:60, height:120, background: COLORS[sp.group], borderRadius: 4 }}/>}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => socket.emit('decline')}>
            {state.settings.auction ? 'Auction' : 'Pass'}
          </button>
          <button className="btn primary" onClick={() => socket.emit('buy')}>
            Buy for ${sp.price}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Auction ---------- */

function AuctionModal({ state, myId }: { state: GameState; myId: string }) {
  const a = state.auction!;
  const sp = BOARD[a.propId];
  const [bid, setBid] = useState(a.highBid + 10);
  const isMePassed = a.passedIds.includes(myId);
  const isMeHigh = a.highBidderId === myId;
  const me = state.players.find(p => p.id === myId)!;
  const minBid = a.highBid === 0 ? 10 : a.highBid + 10;

  useEffect(() => { setBid(minBid); }, [a.highBid]);

  return (
    <div className="overlay">
      <div className="modal">
        <div className="modal-head">🔨 Auction — {sp.name}</div>
        <div className="modal-body">
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 4 }}>{sp.name}</div>
            <div style={{ color: '#9fb0c8' }}>
              Current high bid: <b style={{ color: '#5ddc8a' }}>
                {a.highBid > 0 ? `$${a.highBid}` : 'none'}
              </b>
              {a.highBidderId && ` by ${state.players.find(p => p.id === a.highBidderId)?.name}`}
            </div>
          </div>

          {isMePassed ? (
            <div style={{ color:'#ff7b6b', fontWeight: 700, textAlign: 'center', padding: 14 }}>
              You passed. Waiting for others…
            </div>
          ) : isMeHigh ? (
            <div style={{ color:'#5ddc8a', fontWeight: 700, textAlign: 'center', padding: 14 }}>
              You're the highest bidder! Waiting for others…
            </div>
          ) : (
            <>
              <label style={{ fontSize: 12, color: '#9fb0c8', display:'block', marginBottom: 6 }}>
                Your bid (min ${minBid}) — you have ${me.money}
              </label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input
                  type="number"
                  min={minBid}
                  max={me.money}
                  value={bid}
                  onChange={e => setBid(Math.max(minBid, Math.min(me.money, +e.target.value || minBid)))}
                />
              </div>
              <div className="btn-row">
                {[minBid, minBid + 20, minBid + 50, minBid + 100]
                  .filter(v => v <= me.money)
                  .map(v => (
                    <button key={v} className="btn sm" onClick={() => setBid(v)}>
                      ${v}
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          {!isMePassed && !isMeHigh && (
            <>
              <button className="btn danger" onClick={() => socket.emit('auctionPass')}>
                Pass
              </button>
              <button
                className="btn primary"
                disabled={bid > me.money || bid < minBid}
                onClick={() => socket.emit('auctionBid', { amount: bid })}
              >
                Bid ${bid}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Trade Response ---------- */

function TradeResponse({ state, myId }: { state: GameState; myId: string }) {
  const t = state.trade!;
  const from = state.players.find(p => p.id === t.fromId)!;
  return (
    <div className="overlay">
      <div className="modal">
        <div className="modal-head">🤝 Trade Offer from {from.name}</div>
        <div className="modal-body">
          <div className="tradeCols">
            <div>
              <h4>You receive</h4>
              <div className="tradeList">
                <div style={{ padding: 6, fontSize: 12 }}>${t.offer.money} cash</div>
                {t.offer.jailCards > 0 && <div style={{ padding: 6, fontSize: 12 }}>{t.offer.jailCards} jail card(s)</div>}
                {t.offer.props.map(i => <div key={i} style={{ padding: 6, fontSize: 12, borderLeft: `4px solid ${COLORS[BOARD[i].group!] || '#888'}`, marginLeft: 6 }}>{BOARD[i].name}</div>)}
              </div>
            </div>
            <div>
              <h4>You give</h4>
              <div className="tradeList">
                <div style={{ padding: 6, fontSize: 12 }}>${t.request.money} cash</div>
                {t.request.jailCards > 0 && <div style={{ padding: 6, fontSize: 12 }}>{t.request.jailCards} jail card(s)</div>}
                {t.request.props.map(i => <div key={i} style={{ padding: 6, fontSize: 12, borderLeft: `4px solid ${COLORS[BOARD[i].group!] || '#888'}`, marginLeft: 6 }}>{BOARD[i].name}</div>)}
              </div>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn danger" onClick={() => socket.emit('respondTrade', { accept: false })}>
            Decline
          </button>
          <button className="btn primary" onClick={() => socket.emit('respondTrade', { accept: true })}>
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}