import { test, expect } from '@playwright/test';

test('Two players can see each other in multiplayer', async ({ browser }) => {
  const roomCode = 'TEST';

  // Create two browser contexts (two separate sessions)
  const context1 = await browser.newContext({ deviceScaleFactor: 2 });
  const context2 = await browser.newContext({ deviceScaleFactor: 2 });

  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  const logs1: string[] = [];
  const logs2: string[] = [];
  page1.on('console', msg => logs1.push(msg.text()));
  page2.on('console', msg => logs2.push(msg.text()));

  // Player 1: Host — connect with room code
  console.log('[Test] Player 1 connecting as HOST...');
  await page1.goto(`/?room=${roomCode}`);
  await page1.waitForSelector('canvas', { timeout: 30000 });
  await page1.waitForTimeout(5000); // wait for game + network init

  // Check Player 1 connected
  const p1Connected = logs1.some(l => l.includes('[Net] Connected') || l.includes('[Net] Welcome'));
  console.log(`[Test] Player 1 connected: ${p1Connected}`);
  console.log('[Test] Player 1 logs:', logs1.filter(l => l.includes('[Net]')).join('\n  '));

  // Player 2: Join the same room
  console.log('[Test] Player 2 connecting as CLIENT...');
  await page2.goto(`/?room=${roomCode}`);
  await page2.waitForSelector('canvas', { timeout: 30000 });
  await page2.waitForTimeout(5000);

  const p2Connected = logs2.some(l => l.includes('[Net] Connected') || l.includes('[Net] Welcome'));
  console.log(`[Test] Player 2 connected: ${p2Connected}`);
  console.log('[Test] Player 2 logs:', logs2.filter(l => l.includes('[Net]')).join('\n  '));

  // Wait for sync
  await page1.waitForTimeout(3000);
  await page2.waitForTimeout(3000);

  // Check if Player 1 sees Player 2
  const p1SeesP2 = logs1.some(l => l.includes('Remote player') || l.includes('peer_joined'));
  const p2SeesP1 = logs2.some(l => l.includes('Remote player') || l.includes('peer_joined'));

  console.log(`[Test] Player 1 sees Player 2: ${p1SeesP2}`);
  console.log(`[Test] Player 2 sees Player 1: ${p2SeesP1}`);

  // Take screenshots
  await page1.screenshot({ path: 'test-results/multiplayer-player1.png' });
  await page2.screenshot({ path: 'test-results/multiplayer-player2.png' });

  // Print all network logs
  console.log('\n=== PLAYER 1 NET LOGS ===');
  logs1.filter(l => l.includes('[Net]')).forEach(l => console.log('  P1:', l));
  console.log('\n=== PLAYER 2 NET LOGS ===');
  logs2.filter(l => l.includes('[Net]')).forEach(l => console.log('  P2:', l));

  // Assertions
  expect(p1Connected).toBeTruthy();
  expect(p2Connected).toBeTruthy();
  expect(p1SeesP2).toBeTruthy();

  await context1.close();
  await context2.close();
});
