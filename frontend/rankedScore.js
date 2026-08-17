/**
 * 婚禮大賽 - 積分賽加扣分計算模組
 *
 * 規則：
 * 1. 積分相同：贏家 +3，輸家 -3
 * 2. 積分高者贏：贏家 +1，輸家 -1
 * 3. 積分低者贏 (逆轉勝)：贏家 +5，輸家 -5
 * 4. 保底機制：所有玩家最低為 0 分
 */
export function calculateRankedPoints(winnerPoints = 0, loserPoints = 0) {
  const wPts = Math.max(0, Number(winnerPoints) || 0);
  const lPts = Math.max(0, Number(loserPoints) || 0);

  let winnerDelta = 3;
  let loserDelta = -3;

  if (wPts === lPts) {
    // 積分相同
    winnerDelta = 3;
    loserDelta = -3;
  } else if (wPts > lPts) {
    // 積分較高的人獲勝
    winnerDelta = 1;
    loserDelta = -1;
  } else {
    // 積分較低的人逆轉獲勝
    winnerDelta = 5;
    loserDelta = -5;
  }

  const newWinnerPoints = Math.max(0, wPts + winnerDelta);
  const newLoserPoints = Math.max(0, lPts + loserDelta);

  return {
    winnerDelta,
    loserDelta,
    newWinnerPoints,
    newLoserPoints
  };
}
