// How-to-play text shown in the Rules sheet.

export const rulesHTML = `
<div class="rules">
  <p class="lede">Settle an island, trade for what you lack, and be the first to reach the target score (10 points unless the host changes it).</p>

  <h3>Setting up</h3>
  <p>Everyone places a settlement and a road, then everyone places a second pair in reverse order. Your second settlement immediately collects one card from each hex it touches.</p>
  <p>Settlements sit on corners. No settlement may be on a corner next to another settlement or city, anyone’s.</p>

  <h3>Your turn</h3>
  <ol>
    <li><b>Roll.</b> Every hex showing that number pays its resource: 1 card per touching settlement, 2 per city. A hex with the robber pays nothing.</li>
    <li><b>Trade.</b> Offer cards to other players, or trade with the bank: 4 of a kind for 1, or better at a harbor (3:1 for any resource, 2:1 for the harbor’s resource). Only the player whose turn it is can trade, but others can propose deals to them.</li>
    <li><b>Build.</b> Roads, settlements, cities and development cards. Then end your turn.</li>
  </ol>

  <h3>Building costs</h3>
  <ul class="costs">
    <li><b>Road</b>: brick + lumber. Must connect to your road, settlement or city.</li>
    <li><b>Settlement</b>: brick + lumber + wool + grain. Must touch your road. 1 point.</li>
    <li><b>City</b>: 3 ore + 2 grain. Upgrades a settlement. 2 points, double production.</li>
    <li><b>Development card</b>: ore + wool + grain.</li>
  </ul>
  <p>Each player has 15 roads, 5 settlements and 4 cities.</p>

  <h3>Rolling a 7</h3>
  <p>Nobody collects. Anyone holding more than 7 cards discards half, rounded down. Then the roller moves the robber to a new hex and steals one random card from a player with a building on it.</p>

  <h3>Development cards</h3>
  <ul>
    <li><b>Knight</b>: move the robber and steal.</li>
    <li><b>Road Building</b>: place 2 free roads.</li>
    <li><b>Year of Plenty</b>: take any 2 cards from the bank.</li>
    <li><b>Monopoly</b>: name a resource; everyone gives you all of theirs.</li>
    <li><b>Victory Point</b>: 1 hidden point.</li>
  </ul>
  <p>Play at most one development card per turn, at any point in your turn (even before rolling), but not on the turn you bought it.</p>

  <h3>Bonus cards</h3>
  <p><b>Longest Road</b> (2 points) goes to the first player with an unbroken road of at least 5 pieces, and moves when someone builds a longer one. A rival settlement on your road breaks it.</p>
  <p><b>Largest Army</b> (2 points) goes to the first player to play 3 knights, and moves to anyone who plays more.</p>

  <h3>Winning</h3>
  <p>You win the moment you have enough points during your own turn. Hidden victory point cards count.</p>

  <h3>5–6 player expansion</h3>
  <p>A larger island: 30 hexes, 2 deserts, 11 harbors, 34 development cards and 24 of each resource.</p>
  <p><b>Special build phase:</b> after each turn, every other player in order may build or buy development cards (no trading, no playing cards). Players who can’t afford anything are skipped automatically.</p>

  <h3>Options</h3>
  <p><b>Friendly robber</b>: the robber can’t be placed on hexes touching players with 2 points or fewer.</p>
</div>`;
