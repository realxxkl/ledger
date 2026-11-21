(function () {
  let messageBatchInProgress = false;

  // 1. Relay intercepted deals from MAIN world (injected.js) to Background Service Worker
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'PLAYEROK_BRIDGE_INTERCEPT') return;
    chrome.runtime.sendMessage({
      type: 'NEW_PLAYEROK_PAYLOAD',
      data: event.data.payload,
      force: event.data.force === true
    }, (result) => {
      const error = chrome.runtime.lastError;
      const statusEl = document.getElementById('pk-sync-status');
      if (error) {
        console.error('[Playerok Bridge] Could not reach background worker:', error.message);
        if (statusEl) statusEl.innerText = `Ledger sync failed: ${error.message}`;
        return;
      }
      if (!statusEl || !result) return;
      if (result.error) {
        statusEl.innerText = result.error;
        return;
      }

      statusEl.innerText =
        `Ledger: ${result.accepted || 0} accepted; ${result.alreadyLogged || 0} already logged; ` +
        `${result.missingCostPreset || 0} missing cost preset; ` +
        `${result.skipped || 0} duplicate/in-flight; ${result.failed || 0} failed`;
    });
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'PLAYEROK_SYNC_COMPLETE') return;
    const result = event.data.payload || {};
    const statusEl = document.getElementById('pk-sync-status');
    const button = document.getElementById('pk-sync-btn');
    if (!statusEl || !button) return;

    button.disabled = false;
    statusEl.innerText = result.pagesFetched
      ? `Scanned ${result.pagesFetched} page(s); ${result.ordersFound || 0} order(s) found`
      : (result.reason || 'No order pages scanned');
  });

  // 2. Listen for background requests
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'LEDGER_PLAYEROK_OFFERS_ACTION') {
      relayLedgerOfferAction(msg)
        .then(sendResponse)
        .catch((error) => {
          console.error('[Playerok Bridge] Offer action failed:', error);
          sendResponse({ error: 'Could not process the Playerok offer action.' });
        });
      return true;
    }
    if (msg.type === 'AUTH_LINK_READY') {
      showAuthToast(msg.orderId, msg.authLink, msg.itemTitle);
      return;
    }
    if (msg.type === 'SCAN_PLAYEROK_PRESENCE') {
      sendResponse(scanPlayerokPresence(msg.buyerUsernames));
      return;
    }
    if (msg.type === 'SEND_PLAYEROK_MESSAGES') {
      sendPlayerokMessages(msg.recipients, msg.message)
        .then(sendResponse)
        .catch((error) => {
          console.error('[Playerok Bridge] Message queue failed:', error);
          sendResponse({ error: 'The Playerok message queue failed unexpectedly.' });
        });
      return true;
    }
  });

  function relayLedgerOfferAction(message) {
    if (
      typeof message.requestId !== 'string' ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(message.requestId) ||
      !['detect', 'republish', 'discontinue'].includes(message.action)
    ) {
      return Promise.resolve({ error: 'Invalid Playerok offer request.' });
    }

    return new Promise((resolve) => {
      const requestId = message.requestId;
      const timeout = setTimeout(() => {
        window.removeEventListener('message', listener);
        resolve({ error: 'Timed out waiting for the Playerok offers page.' });
      }, 60000);

      function listener(event) {
        if (
          event.source !== window ||
          event.origin !== window.location.origin ||
          event.data?.source !== 'PLAYEROK_LEDGER_OFFERS_RESULT' ||
          event.data.requestId !== requestId
        ) {
          return;
        }
        clearTimeout(timeout);
        window.removeEventListener('message', listener);
        resolve(event.data.payload || { error: 'The Playerok offers page returned no result.' });
      }

      window.addEventListener('message', listener);
      window.postMessage({
        source: 'PLAYEROK_LEDGER_OFFERS_ACTION',
        requestId,
        action: message.action,
        itemId: message.itemId
      }, window.location.origin);
    });
  }

  function normalizeUsername(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function getChatRows() {
    return Array.from(document.querySelectorAll('a[href*="/chats/"]')).filter((row) => {
      try {
        return /^\/chats\/[^/]+\/?$/.test(new URL(row.href, window.location.href).pathname);
      } catch {
        return false;
      }
    });
  }

  function getChatUsername(row) {
    const textNodes = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    while (textNodes.nextNode()) {
      const text = String(textNodes.currentNode.textContent || '').trim();
      if (text) return text.replace(/\s+\d{1,2}:\d{2}$/, '').trim();
    }
    return '';
  }

  function isGreen(value) {
    const match = String(value || '').match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (!match) return false;
    return Number(match[2]) >= 80 && Number(match[2]) - Number(match[1]) >= 35;
  }

  function hasOnlineIndicator(row) {
    const avatar = row.querySelector('img');
    if (!avatar) return false;
    const avatarBounds = avatar.getBoundingClientRect();
    if (!avatarBounds.width || !avatarBounds.height) return false;

    for (const element of row.querySelectorAll('*')) {
      if (element === avatar || element.tagName === 'IMG') continue;
      const bounds = element.getBoundingClientRect();
      if (bounds.width < 4 || bounds.height < 4 || bounds.width > 32 || bounds.height > 32) continue;

      const nearCorner =
        bounds.right >= avatarBounds.right - bounds.width * 1.5 &&
        bounds.bottom >= avatarBounds.bottom - bounds.height * 1.5;
      if (!nearCorner) continue;

      const style = window.getComputedStyle(element);
      if ([style.backgroundColor, style.borderTopColor, style.color, style.fill, style.stroke].some(isGreen)) {
        return true;
      }
    }
    return false;
  }

  function scanPlayerokPresence(buyerUsernames) {
    if (!Array.isArray(buyerUsernames) || buyerUsernames.length === 0 || buyerUsernames.length > 50) {
      return { error: 'Select between 1 and 50 orders.' };
    }

    const chatRows = getChatRows();
    const results = buyerUsernames.map((buyerUsername) => {
      const matches = chatRows.filter((row) => normalizeUsername(getChatUsername(row)) === normalizeUsername(buyerUsername));
      return {
        buyerUsername,
        status: matches.length === 1 && hasOnlineIndicator(matches[0]) ? 'online' : 'unknown'
      };
    });

    return { results, checkedAt: new Date().toISOString() };
  }

  async function sendPlayerokMessages(recipients, message) {
    if (
      messageBatchInProgress ||
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
      typeof message !== 'string' || !message.trim() || message.length > 2000
    ) {
      return {
        error: messageBatchInProgress
          ? 'Another message batch is already running.'
          : 'Select 1–10 buyers and enter a message of at most 2,000 characters.'
      };
    }

    const usernames = recipients.map((recipient) => normalizeUsername(recipient.buyerUsername));
    if (new Set(usernames).size !== recipients.length) {
      return { error: 'Duplicate buyer names are included in this batch.' };
    }

    messageBatchInProgress = true;
    try {
      return await new Promise((resolve) => {
        const requestId = Math.random().toString(36).substring(2);
        const timeout = setTimeout(() => {
          window.removeEventListener('message', listener);
          resolve({ error: 'Timed out waiting for GraphQL message sender.' });
        }, 60000);

        function listener(event) {
          if (
            event.source !== window ||
            event.origin !== window.location.origin ||
            event.data?.source !== 'PLAYEROK_EXEC_GQL_BATCH_RESPONSE' ||
            event.data.requestId !== requestId
          ) {
            return;
          }
          clearTimeout(timeout);
          window.removeEventListener('message', listener);
          resolve(event.data.payload);
        }

        window.addEventListener('message', listener);
        window.postMessage({
          source: 'PLAYEROK_EXEC_GQL_BATCH',
          requestId,
          recipients,
          messageText: message
        }, window.location.origin);
      });
    } finally {
      messageBatchInProgress = false;
    }
  }

  function mountSyncWidget() {
    if (document.getElementById('pk-sync-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'pk-sync-bar';
    bar.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:999999;background:rgba(15,23,42,0.92);backdrop-filter:blur(8px);color:#f8fafc;padding:8px 12px;border-radius:8px;border:1px solid #3c80fe;box-shadow:0 8px 20px rgba(0,0,0,0.5);font-family:sans-serif;font-size:12px;display:flex;gap:10px;align-items:center;';
    bar.innerHTML = `
      <span id="pk-sync-status" style="color:#94a3b8;font-weight:500;">Bridge Ready</span>
      <button id="pk-sync-btn" style="background:#3c80fe;color:#fff;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;font-weight:600;font-size:12px;">
        Sync Pending
      </button>
    `;
    document.body.appendChild(bar);

    document.getElementById('pk-sync-btn').onclick = (event) => {
      const statusEl = document.getElementById('pk-sync-status');
      event.currentTarget.disabled = true;
      statusEl.innerText = 'Syncing...';
      window.postMessage({ source: 'PLAYEROK_FORCE_SYNC' }, '*');
    };
  }

  function showAuthToast(orderId, authLink, itemTitle) {
    let container = document.getElementById('pk-bridge-toast');
    if (!container) {
      container = document.createElement('div');
      container.id = 'pk-bridge-toast';
      container.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:999999;background:rgba(17,24,39,0.95);backdrop-filter:blur(8px);color:#f9fafb;padding:14px 16px;border-radius:10px;border:1px solid #9144fb;box-shadow:0 10px 25px rgba(0,0,0,0.6);font-family:sans-serif;font-size:13px;max-width:320px;';
      document.body.appendChild(container);
    }

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-weight:700;color:#10b981;">✅ Order Logged</span>
        <span id="pk-toast-close" style="cursor:pointer;color:#9ca3af;font-size:14px;">✕</span>
      </div>
      <div style="margin-bottom:10px;color:#d1d5db;font-size:12px;word-break:break-word;">
        <b>${itemTitle || 'Order'}</b> (#${String(orderId).slice(0, 8)})
      </div>
      <button id="pk-copy-auth" style="background:linear-gradient(90deg,#3c80fe,#9144fb);color:#fff;border:none;padding:7px 12px;border-radius:6px;cursor:pointer;font-weight:600;width:100%;font-size:12px;">
        Copy Prepared Auth Link
      </button>
    `;

    document.getElementById('pk-toast-close').onclick = () => container.remove();
    document.getElementById('pk-copy-auth').onclick = () => {
      navigator.clipboard.writeText(authLink);
      const btn = document.getElementById('pk-copy-auth');
      btn.innerText = 'Copied to Clipboard!';
      btn.style.background = '#10b981';
    };
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', mountSyncWidget, { once: true });
  } else {
    mountSyncWidget();
  }
})();