const LEDGER_WEBHOOK_URL = 'https://ledger-one-gules.vercel.app/api/orders/playerok';
const WEBHOOK_SECRET = '62c1194930525e81e4a1daddfb5a89971a6cfafcc70ff12b6b507c40713748f3'; // Must match WEBHOOK_SECRET in .env.local
const MAX_CONCURRENT_WEBHOOKS = 4;
const inFlightDealIds = new Set();
let storageWriteQueue = Promise.resolve();
let activeMessageBatch = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'LEDGER_PLAYEROK_PRESENCE_SCAN') {
    scanPlayerokPresence(message.buyerUsernames)
      .then(sendResponse)
      .catch((error) => {
        console.error('[Playerok Bridge] Could not check buyer presence:', error);
        sendResponse({ error: 'Could not check buyer presence.' });
      });
    return true;
  }
  if (message?.type === 'LEDGER_PLAYEROK_SEND_MESSAGES') {
    if (!isLedgerSender(sender)) {
      sendResponse({ error: 'Message requests are only accepted from the Ledger app.' });
      return false;
    }

    sendPlayerokMessages(message.recipients, message.message)
      .then(sendResponse)
      .catch((error) => {
        console.error('[Playerok Bridge] Could not send the selected messages:', error);
        sendResponse({ error: 'Could not start the Playerok message queue.' });
      });
    return true;
  }
  if (message?.type === 'LEDGER_PLAYEROK_OFFERS_ACTION') {
    if (!isLedgerSender(sender)) {
      sendResponse({ error: 'Offer requests are only accepted from the Ledger app.' });
      return false;
    }

    handlePlayerokOffersAction(message.action, message.itemId)
      .then(sendResponse)
      .catch((error) => {
        console.error('[Playerok Bridge] Could not process offer request:', error);
        sendResponse({ error: 'Could not process the Playerok offer request.' });
      });
    return true;
  }
  if (message?.type !== 'NEW_PLAYEROK_PAYLOAD') return false;

  processDealsPayload(message.data, sender.tab?.id, message.force === true)
    .then(sendResponse)
    .catch((error) => {
      console.error('[Playerok Bridge] Could not process order batch:', error);
      sendResponse({ accepted: 0, alreadyLogged: 0, missingCostPreset: 0, skipped: 0, failed: 0, error: 'Order batch processing failed' });
    });
  return true;
});

function isLedgerSender(sender) {
  try {
    const url = new URL(sender.url || sender.tab?.url || '');
    return ['ledger-one-gules.vercel.app', 'localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
}

async function handlePlayerokOffersAction(action, itemId) {
  if (!['detect', 'republish', 'discontinue'].includes(action)) {
    return { error: 'Unsupported Playerok offer action.' };
  }
  if (
    action !== 'detect' &&
    (typeof itemId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(itemId))
  ) {
    return { error: 'Invalid Playerok offer ID.' };
  }

  const tabs = await chrome.tabs.query({
    url: ['*://playerok.com/profile/*/products*', '*://*.playerok.com/profile/*/products*']
  });
  const tab = tabs.find((candidate) => candidate.active) || tabs[0];
  if (!tab?.id) {
    return { error: 'Open your Playerok seller products page and wait for its offers to load.' };
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, {
      type: 'LEDGER_PLAYEROK_OFFERS_ACTION',
      requestId: crypto.randomUUID(),
      action,
      itemId: action === 'detect' ? undefined : itemId
    });
  } catch (error) {
    console.warn('[Playerok Bridge] Could not reach the Playerok seller page:', error);
    return { error: 'Reload the Playerok seller products page and try again.' };
  }
}

async function scanPlayerokPresence(buyerUsernames) {
  if (
    !Array.isArray(buyerUsernames) ||
    buyerUsernames.length === 0 ||
    buyerUsernames.length > 50 ||
    buyerUsernames.some((username) => typeof username !== 'string' || !username.trim())
  ) {
    return { error: 'Select between 1 and 50 orders with buyer usernames.' };
  }

  const chatTabs = await chrome.tabs.query({
    url: ['*://playerok.com/chats*', '*://*.playerok.com/chats*']
  });
  const chatTab = chatTabs.find((tab) => tab.active) || chatTabs[0];
  if (!chatTab?.id) {
    return { error: 'Open Playerok Chats in a tab, then check the selected orders again.' };
  }

  try {
    return await chrome.tabs.sendMessage(chatTab.id, {
      type: 'SCAN_PLAYEROK_PRESENCE',
      buyerUsernames
    });
  } catch (error) {
    console.warn('[Playerok Bridge] Could not read the Playerok Chats tab:', error);
    return { error: 'Could not read Playerok Chats. Reload that tab and try again.' };
  }
}

async function sendPlayerokMessages(recipients, message) {
  if (
    activeMessageBatch ||
    !Array.isArray(recipients) ||
    recipients.length === 0 ||
    recipients.length > 10 ||
    recipients.some((recipient) =>
      !recipient ||
      typeof recipient.buyerUsername !== 'string' ||
      !recipient.buyerUsername.trim() ||
      typeof recipient.orderId !== 'string' ||
      !recipient.orderId.trim()
    ) ||
    typeof message !== 'string' ||
    !message.trim() ||
    message.length > 2000
  ) {
    if (activeMessageBatch) return { error: 'Another message batch is already running.' };
    return { error: 'Select 1–10 buyers and enter a message of at most 2,000 characters.' };
  }

  const normalizedUsernames = recipients.map((recipient) => recipient.buyerUsername.trim().replace(/\s+/g, ' ').toLowerCase());
  if (new Set(normalizedUsernames).size !== recipients.length) {
    return { error: 'Duplicate buyers were included. Refresh the selection and try again.' };
  }
  const orderIds = recipients.map((recipient) => recipient.orderId.trim());
  if (new Set(orderIds).size !== orderIds.length) {
    return { error: 'Duplicate order IDs were included. Refresh the selection and try again.' };
  }

  activeMessageBatch = true;
  try {
    const chatTabs = await chrome.tabs.query({
      url: ['*://playerok.com/chats*', '*://*.playerok.com/chats*']
    });
    const chatTab = chatTabs.find((tab) => tab.active) || chatTabs[0];
    if (!chatTab?.id) {
      return { error: 'Open Playerok Chats in a tab before sending the selected messages.' };
    }

    await chrome.tabs.update(chatTab.id, { active: true });
    return await chrome.tabs.sendMessage(chatTab.id, {
      type: 'SEND_PLAYEROK_MESSAGES',
      recipients,
      message
    });
  } catch (error) {
    console.warn('[Playerok Bridge] Could not reach the Playerok Chats tab:', error);
    return { error: 'Could not reach Playerok Chats. Reload that tab and try again.' };
  } finally {
    activeMessageBatch = false;
  }
}

async function processDealsPayload(deals, tabId, forceSync) {
  if (!Array.isArray(deals)) {
    return { accepted: 0, alreadyLogged: 0, missingCostPreset: 0, skipped: 0, failed: 0, error: 'Invalid order batch' };
  }

  const { loggedDeals = {} } = await chrome.storage.local.get('loggedDeals');
  const result = { accepted: 0, alreadyLogged: 0, missingCostPreset: 0, skipped: 0, failed: 0 };
  const batchIds = new Set();
  const pendingDeals = [];

  for (const deal of deals) {
    if (!deal.id) {
      result.failed += 1;
      console.error('[Playerok Bridge] Skipping malformed order without an ID');
      continue;
    }
    const lastLoggedStatus = loggedDeals[deal.id];
    if ((!forceSync && lastLoggedStatus === deal.status) || batchIds.has(deal.id) || inFlightDealIds.has(deal.id)) {
      result.skipped += 1;
      continue;
    }

    batchIds.add(deal.id);
    inFlightDealIds.add(deal.id);
    pendingDeals.push(deal);
  }

  let nextDealIndex = 0;
  const workerCount = Math.min(MAX_CONCURRENT_WEBHOOKS, pendingDeals.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextDealIndex < pendingDeals.length) {
      const deal = pendingDeals[nextDealIndex++];
      try {
        const res = await fetch(LEDGER_WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-webhook-secret': WEBHOOK_SECRET
          },
          body: JSON.stringify({
            source: 'playerok',
            orderId: String(deal.id),
            status: deal.status,
            itemTitle: deal.itemTitle,
            price: deal.price,
            currency: deal.currency || 'RUB',
            buyerUsername: deal.buyerUsername,
            timestamp: deal.timestamp
          })
        });

        if (!res.ok) {
          result.failed += 1;
          console.error('[Playerok Bridge] Webhook error:', res.status, await res.text());
          continue;
        }

        const webhookResult = await res.json();
        loggedDeals[deal.id] = deal.status;
        await persistLoggedDeals(loggedDeals);
        result.accepted += 1;

        if (webhookResult.alreadyLogged) result.alreadyLogged += 1;
        if (webhookResult.costPresetMatched === false) result.missingCostPreset += 1;
        if (webhookResult.authLink && tabId) {
          chrome.tabs.sendMessage(tabId, {
            type: 'AUTH_LINK_READY',
            orderId: deal.id,
            authLink: webhookResult.authLink,
            itemTitle: deal.itemTitle
          }).catch((error) => {
            console.warn('[Playerok Bridge] Could not show the auth link notification:', error);
          });
        }
      } catch (error) {
        result.failed += 1;
        console.error('[Playerok Bridge] Fetch failed:', error);
      } finally {
        inFlightDealIds.delete(deal.id);
      }
    }
  });

  await Promise.all(workers);
  return result;
}

function persistLoggedDeals(loggedDeals) {
  const write = storageWriteQueue.then(() => chrome.storage.local.set({ loggedDeals }));
  storageWriteQueue = write.catch((error) => {
    console.error('[Playerok Bridge] Could not save the order sync state:', error);
  });
  return write;
}