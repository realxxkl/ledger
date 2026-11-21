(function () {
  const REQUEST_SOURCE = 'LEDGER_PLAYEROK_PRESENCE_REQUEST';
  const RESPONSE_SOURCE = 'LEDGER_PLAYEROK_PRESENCE_RESULT';
  const MESSAGE_REQUEST_SOURCE = 'LEDGER_PLAYEROK_SEND_MESSAGES_REQUEST';
  const MESSAGE_RESPONSE_SOURCE = 'LEDGER_PLAYEROK_SEND_MESSAGES_RESULT';
  const OFFERS_REQUEST_SOURCE = 'LEDGER_PLAYEROK_OFFERS_REQUEST';
  const OFFERS_RESPONSE_SOURCE = 'LEDGER_PLAYEROK_OFFERS_RESULT';

  window.addEventListener('message', (event) => {
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      event.data?.source !== REQUEST_SOURCE
    ) {
      return;
    }

    const { requestId, buyerUsernames } = event.data;
    if (
      typeof requestId !== 'string' ||
      !Array.isArray(buyerUsernames) ||
      buyerUsernames.length === 0 ||
      buyerUsernames.length > 50 ||
      buyerUsernames.some((username) => typeof username !== 'string' || !username.trim())
    ) {
      return;
    }

    chrome.runtime.sendMessage({
      type: 'LEDGER_PLAYEROK_PRESENCE_SCAN',
      buyerUsernames
    }, (response) => {
      const error = chrome.runtime.lastError;
      window.postMessage({
        source: RESPONSE_SOURCE,
        requestId,
        payload: error
          ? { error: 'Could not reach the Playerok extension. Check that it is enabled and reloaded.' }
          : response || { error: 'The Playerok extension returned no result.' }
      }, window.location.origin);
    });
  });

  window.addEventListener('message', (event) => {
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      event.data?.source !== MESSAGE_REQUEST_SOURCE
    ) {
      return;
    }

    const { requestId, recipients, message } = event.data;
    if (
      typeof requestId !== 'string' ||
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
      return;
    }

    chrome.runtime.sendMessage({
      type: 'LEDGER_PLAYEROK_SEND_MESSAGES',
      recipients,
      message
    }, (response) => {
      const error = chrome.runtime.lastError;
      window.postMessage({
        source: MESSAGE_RESPONSE_SOURCE,
        requestId,
        payload: error
          ? { error: 'Could not reach the Playerok extension. Check that it is enabled and reloaded.' }
          : response || { error: 'The Playerok extension returned no result.' }
      }, window.location.origin);
    });
  });

  window.addEventListener('message', (event) => {
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      event.data?.source !== OFFERS_REQUEST_SOURCE
    ) {
      return;
    }

    const { requestId, action, itemId } = event.data;
    if (
      typeof requestId !== 'string' ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(requestId) ||
      !['detect', 'republish', 'discontinue'].includes(action) ||
      (action !== 'detect' &&
        (typeof itemId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId)))
    ) {
      return;
    }

    chrome.runtime.sendMessage({
      type: 'LEDGER_PLAYEROK_OFFERS_ACTION',
      action,
      itemId
    }, (response) => {
      const error = chrome.runtime.lastError;
      window.postMessage({
        source: OFFERS_RESPONSE_SOURCE,
        requestId,
        payload: error
          ? { error: 'Could not reach the Playerok extension. Check that it is enabled and reloaded.' }
          : response || { error: 'The Playerok extension returned no result.' }
      }, window.location.origin);
    });
  });
})();
